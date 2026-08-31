// 解答履歴。端末に控えを置き、区切りで非公開リポジトリへ書き戻す。
// ----------------------------------------------------------------------

// --- 解答履歴 -------------------------------------------------------------
// 問題のIDごとに成績を貯め、非公開リポジトリに書き戻す。
// 1問ごとに通信するとコミットが膨大になるので、区切りでまとめて送る。
// 送る前にアプリが閉じても失わないよう、端末にも控えを置く。

const STORAGE_KEY_PROGRESS = 'flashmemo_progress';

let progressStats = {};      // { 問題ID: { correct, incorrect, lifespan, last_answered_at } }
let progressDirty = false;   // まだ書き戻していない変更があるか
let progressSaving = false;
let progressTimer = null;

function readLocalProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS);
    const j = raw ? JSON.parse(raw) : null;
    return (j && typeof j === 'object') ? j : {};
  } catch (err) { return {}; }
}

function writeLocalProgress() {
  try { localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progressStats)); } catch (err) {}
}

// 同じ問題については、最後に解いた日時が新しい方を残す
function mergeProgress(into, from) {
  Object.keys(from || {}).forEach(function (id) {
    const b = from[id];
    if (!b || typeof b !== 'object') return;
    const a = into[id];
    if (!a) { into[id] = b; return; }
    const ta = a.last_answered_at ? Date.parse(a.last_answered_at) : 0;
    const tb = b.last_answered_at ? Date.parse(b.last_answered_at) : 0;
    if (tb >= ta) into[id] = b;
  });
  return into;
}

async function loadProgress() {
  const local = readLocalProgress();
  try {
    const remote = await api('/api/questions?kind=progress');
    progressStats = mergeProgress({}, (remote && remote.stats) || {});
    // 端末にだけ残っている新しい記録があれば、それを優先して書き戻す対象にする
    const before = JSON.stringify(progressStats);
    mergeProgress(progressStats, local);
    if (JSON.stringify(progressStats) !== before) progressDirty = true;
  } catch (err) {
    if (err.unauthorized) return;
    // 通信できないときは端末の控えだけで続行する
    progressStats = local;
  }
  writeLocalProgress();
  if (progressDirty) saveProgress();
}

function recordProgress(question) {
  if (!question || !question.id) return;
  progressStats[question.id] = {
    correct: question.correct_count || 0,
    incorrect: question.incorrect_count || 0,
    lifespan: question.lifespan || 1.0,
    last_answered_at: question.last_answered_at || new Date().toISOString()
  };
  progressDirty = true;
  writeLocalProgress();

  // 解き続けている間も、しばらく操作が途切れたら書き戻す
  clearTimeout(progressTimer);
  progressTimer = setTimeout(saveProgress, 60000);
}

async function saveProgress() {
  if (!progressDirty || progressSaving) return;
  if (!getPassphrase()) return;
  clearTimeout(progressTimer);
  progressSaving = true;
  try {
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'progress', stats: progressStats })
    });
    progressDirty = false;   // 送れたときだけ下ろす。失敗したら次の機会に再送する
  } catch (err) {
    // 失敗しても端末には残っているので、次回の起動時に送り直される
  } finally {
    progressSaving = false;
  }
}

// アプリを閉じたり、別のアプリに切り替えたときにも書き戻す
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') saveProgress();
});
