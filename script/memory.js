// 記憶モデル。忘却曲線による予測と、正解・不正解による寿命の更新。
// ----------------------------------------------------------------------

// --- 1. 記憶モデルのパラメーター ---
// 忘却曲線 R = exp(-経過日数 / 記憶の寿命) で、いま思い出せる確率を見積もる。
const STORAGE_KEY_MEMORY = 'flashmemo_memorySettings';
const FIRST_INTERVAL_DAYS = 1.0;   // 初めて正解したときの寿命

// 歯車の中の設定。一度決めたら普段は変えないものを置く。
// ホーム画面に残す「出題する上限」は、空いた時間の長さで毎回変わるので別扱い。
let memorySettings = {
  ease: 2.5,          // 正解したとき寿命を何倍にするか
  lapseKeep: 0.2,     // 間違えたとき、以前の寿命をどれだけ残すか
  failMinutes: 30,    // 間違えたときの寿命の下限（分）
  groupSize: 0        // 何問ずつに区切るか（長時間の勉強用）。0 で区切らない
};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_MEMORY) || 'null');
  if (saved && typeof saved === 'object') {
    // 知っている項目だけを受け取る。廃止した設定が保存に残り続けないように。
    Object.keys(memorySettings).forEach(function (k) {
      if (typeof saved[k] === 'number' && isFinite(saved[k])) memorySettings[k] = saved[k];
    });
  }
} catch (err) {}

function saveMemorySettings() {
  try { localStorage.setItem(STORAGE_KEY_MEMORY, JSON.stringify(memorySettings)); } catch (err) {}
}


// --- 3. 忘却曲線による記憶予測 ---
// いま思い出せる確率を R = exp(-経過日数 / 記憶の寿命) で見積もる。
// 時間が経つほど必ず下がるので、どれだけ習熟した問題でも寿命を過ぎれば戻ってくる。
// 正解数を足し込む方式では、熟達した問題が頭打ちになって二度と出題されなかった。
function calculateProbability(q) {
  // 一度も解いていない問題は、思い出せるはずがないので最優先
  if (!q.last_answered_at) return 0;

  const lifespan = (q.lifespan > 0) ? q.lifespan : FIRST_INTERVAL_DAYS;
  const elapsedMs = Math.max(0, Date.now() - Date.parse(q.last_answered_at));
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  const r = Math.exp(-elapsedDays / lifespan);
  return Math.min(Math.max(r, 0), 1);
}

function sortQuestionsBySrs(list) {
  const scored = list.map(q => ({
    item: q,
    prob: calculateProbability(q)
  }));

  // 思い出せる確率が低い順に並べる。
  // 直前に解いた問題は経過時間がほぼ0なので確率がほぼ100%になり、自然に後ろへ回る。
  // かつては「時間ロック」で明示的に締め出していたが、それは正解数を足し込む
  // 旧アルゴリズムのための対策だった。忘却曲線に置き換えた時点で不要になったので廃止した。
  scored.sort((a, b) => a.prob - b.prob);

  return scored.map(s => s.item);
}


// 自己採点時（⭕/❌）に記憶の寿命を更新する。
//
// 同じセッション内で二度目以降に解いた問題は更新しない。
// 間違えた問題はその場のループで必ずもう一度出題されるため、
// そこでの正解まで数えると「数分間覚えていただけ」を長期記憶と誤認してしまう。
// 記録するのは、そのセッションで最初に答えた結果だけ。
function updateSrsMetrics(question, isCorrect) {
  if (answeredThisSession[question.id]) return;
  answeredThisSession[question.id] = true;

  // 全履歴ログ（あとで忘却曲線のパラメータを学習するときに使う）。
  // 集計を更新する前の値を記録する＝そのとき何を予測していたかを残す。
  const now = new Date().toISOString();
  recordHistoryEntry({
    id: makeHistoryEntryId(),
    question_id: question.id,
    answered_at: now,
    correct: !!isCorrect,
    lifespan_before: (question.lifespan > 0) ? question.lifespan : null,
    elapsed_days: question.last_answered_at
      ? Math.max(0, (Date.parse(now) - Date.parse(question.last_answered_at)) / (1000 * 60 * 60 * 24))
      : null
  });

  if (isCorrect) {
    question.correct_count = (question.correct_count || 0) + 1;
    const previous = question.lifespan;
    // 正解したら、少なくとも初回間隔ぶんは空ける
    question.lifespan = (previous > 0 && question.last_answered_at)
      ? Math.max(previous * memorySettings.ease, FIRST_INTERVAL_DAYS)
      : FIRST_INTERVAL_DAYS;
  } else {
    question.incorrect_count = (question.incorrect_count || 0) + 1;
    // 間違えても、以前の寿命の一部は残す。
    // 一度覚えたものは覚え直すのも速いので、まっさらな新問題と同じ扱いにはしない。
    // なお「すぐもう一度解かせる」役割は、その場の短期記憶ループが担っている。
    // ここで決めるのは、解き直した後に次はいつ出すか。
    const floorDays = memorySettings.failMinutes / (60 * 24);
    const previousLife = (question.lifespan > 0) ? question.lifespan : 0;
    question.lifespan = Math.max(floorDays, previousLife * memorySettings.lapseKeep);
  }

  question.last_answered_at = now;
  recordProgress(question);
}


function setupSlider(inputId, valId, callback) {
  const input = document.getElementById(inputId);
  const valDisplay = document.getElementById(valId);
  input.addEventListener('input', (e) => {
    const val = e.target.value;
    const formatted = callback(val);
    valDisplay.textContent = formatted || val;
  });
}

setupSlider('ease-input', 'ease-val', val => {
  memorySettings.ease = parseFloat(val);
  saveMemorySettings();
  return val + ' 倍';
});
setupSlider('lapse-input', 'lapse-val', val => {
  memorySettings.lapseKeep = parseInt(val, 10) / 100;
  saveMemorySettings();
  return val + ' %';
});
setupSlider('fail-input', 'fail-val', val => {
  memorySettings.failMinutes = parseInt(val, 10);
  saveMemorySettings();
  return val + ' 分';
});
// 区切りの数はつまみではなく数値入力なので、個別に受け取る
inputGroupSize.addEventListener('input', function () {
  memorySettings.groupSize = Math.max(0, parseInt(inputGroupSize.value, 10) || 0);
  saveMemorySettings();
});

// 保存してある設定をつまみと表示に反映する
function applyMemorySettingsToUI() {
  const pairs = [
    ['ease-input', 'ease-val', memorySettings.ease, ' 倍'],
    ['lapse-input', 'lapse-val', Math.round(memorySettings.lapseKeep * 100), ' %'],
    ['fail-input', 'fail-val', memorySettings.failMinutes, ' 分']
  ];
  inputGroupSize.value = memorySettings.groupSize;

  pairs.forEach(function (p) {
    const input = document.getElementById(p[0]);
    const label = document.getElementById(p[1]);
    if (input) input.value = p[2];
    if (label) label.textContent = p[2] + p[3];
  });
}
