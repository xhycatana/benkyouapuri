// 記憶モデル。忘却曲線による予測と、正解・不正解による寿命の更新。
// ----------------------------------------------------------------------

// --- 1. 記憶モデルのパラメーター ---
// 忘却曲線 R = exp(-経過日数 / 記憶の寿命) で、いま思い出せる確率を見積もる。
const STORAGE_KEY_MEMORY = 'flashmemo_memorySettings';
const FIRST_INTERVAL_DAYS = 1.0;   // 初めて正解したときの寿命
// 「残す割合」を0%にすると寿命がちょうど0になり、0除算やNaN、他の「寿命が0以下なら
// 異常値として扱う」処理（calculateProbability など）を誤って引っかけてしまう。
// これは設定ではなく、式の連続性を保つためだけの固定値（1分）。
const MIN_LIFESPAN_DAYS = 1 / 1440;

// 歯車の中の設定。一度決めたら普段は変えないものを置く。
// ホーム画面に残す「出題する上限」は、空いた時間の長さで毎回変わるので別扱い。
let memorySettings = {
  ease: 2.5,          // 正解したとき寿命を何倍にするか
  lapseKeep: 0.2,     // 間違えたとき、以前の寿命をどれだけ残すか
  retryBoost: 1.2,    // 間違えた直後の解き直しで正解したとき、寿命を何倍にするか（ease より小さくする）
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
  // 同じ確率どうし（特に、まだ解いていない問題はすべて確率0）は無作為な順にする。
  // 並べ替えは同点なら元の順を保つので、先に混ぜておかないと、上限で切ったときに
  // 新しい問題集では毎回、先頭から同じ問題ばかりが選ばれてしまう。
  // 確率の違う問題どうしの順は、混ぜても並べ替えで元に戻るので影響しない。
  const scored = shuffleArray(list.slice()).map(q => ({
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
  if (answeredThisSession[question.id]) {
    // 間違えた直後の解き直し（同じセッションで2回目以降）。
    // 数十秒前に答えを見ただけなので、通常の正解（ease）と同じようには伸ばさない。
    // ただし、正解できたこと自体は多少は覚えている証拠なので、それより小さい倍率で少しだけ伸ばす。
    // 履歴ログには残さない（このログは実際に間隔を空けて解いたときの記録として使うため）。
    if (isCorrect && question.lifespan > 0) {
      question.lifespan *= memorySettings.retryBoost;
      recordProgress(question);
    }
    return;
  }
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
    const previousLife = (question.lifespan > 0) ? question.lifespan : 0;
    question.lifespan = Math.max(previousLife * memorySettings.lapseKeep, MIN_LIFESPAN_DAYS);
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
setupSlider('retry-boost-input', 'retry-boost-val', val => {
  memorySettings.retryBoost = parseFloat(val);
  saveMemorySettings();
  return val + ' 倍';
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
    ['retry-boost-input', 'retry-boost-val', memorySettings.retryBoost, ' 倍']
  ];
  inputGroupSize.value = memorySettings.groupSize;

  pairs.forEach(function (p) {
    const input = document.getElementById(p[0]);
    const label = document.getElementById(p[1]);
    if (input) input.value = p[2];
    if (label) label.textContent = p[2] + p[3];
  });
}


// --- 使い方ページ：忘却曲線の触って試せるグラフ ---
// 実際の設定（伸び率・残す割合）を初期値にした、独立したお試し用の状態。
// ここでスライダーを動かしても本番の memorySettings は変えない。
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const M = { left: 32, top: 8, right: 6, bottom: 20 };
  const VBW = 600, VBH = 220;
  const plotW = VBW - M.left - M.right;
  const plotH = VBH - M.top - M.bottom;

  const fcState = {
    ease: memorySettings.ease,
    lapseKeep: memorySettings.lapseKeep,
    maxDays: 8
  };
  let fcIdCounter = 0;
  let fcEvents = [
    { id: 'f' + (fcIdCounter++), t: 0, type: 'correct' },
    { id: 'f' + (fcIdCounter++), t: 5, type: 'incorrect' },
    { id: 'f' + (fcIdCounter++), t: 5.1, type: 'correct' }
  ];
  let fcSelectedTool = 'incorrect';
  let fcDragState = null;

  function fcDayToX(t) { return M.left + (t / fcState.maxDays) * plotW; }
  function fcXToDay(x) { return ((x - M.left) / plotW) * fcState.maxDays; }
  function fcProbToY(p) { return M.top + (1 - p) * plotH; }
  function fcClampDay(t) { return Math.min(fcState.maxDays, Math.max(0, t)); }
  function fcToSvgPoint(e) {
    const pt = fcChart.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(fcChart.getScreenCTM().inverse());
  }
  function fcPathFromPoints(pts) {
    return pts.map((pt, i) => (i === 0 ? 'M' : 'L') + pt[0].toFixed(2) + ',' + pt[1].toFixed(2)).join(' ');
  }
  function fcSample(fromT, toT, lifespanVal) {
    const pts = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = fromT + (toT - fromT) * (i / n);
      pts.push([fcDayToX(t), fcProbToY(Math.exp(-(t - fromT) / lifespanVal))]);
    }
    return pts;
  }

  function fcBuildSegments() {
    const sorted = fcEvents.slice().sort((a, b) => a.t - b.t);
    const segs = [];
    let lifespan = 1.0;
    let answered = false;
    sorted.forEach((e) => {
      const prevSeg = segs[segs.length - 1];
      const incoming = answered ? Math.exp(-(e.t - prevSeg.t) / prevSeg.lifespan) : 0;
      let newLifespan;
      if (e.type === 'correct') {
        newLifespan = answered ? Math.max(lifespan * fcState.ease, FIRST_INTERVAL_DAYS) : FIRST_INTERVAL_DAYS;
      } else {
        const prevLife = lifespan > 0 ? lifespan : 0;
        newLifespan = Math.max(prevLife * fcState.lapseKeep, MIN_LIFESPAN_DAYS);
      }
      segs.push({ id: e.id, t: e.t, type: e.type, lifespan: newLifespan, incoming: incoming });
      lifespan = newLifespan;
      answered = true;
    });
    return segs;
  }

  function fcRender() {
    const segs = fcBuildSegments();
    fcChart.innerHTML = '';

    const gridG = document.createElementNS(NS, 'g');
    const curveG = document.createElementNS(NS, 'g');
    const resetG = document.createElementNS(NS, 'g');
    const markG = document.createElementNS(NS, 'g');
    const axisG = document.createElementNS(NS, 'g');

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', M.left); bg.setAttribute('y', M.top);
    bg.setAttribute('width', plotW); bg.setAttribute('height', plotH);
    bg.setAttribute('fill', '#f8fafc'); bg.setAttribute('stroke', '#e2e8f0');
    fcChart.appendChild(bg);

    [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
      const y = fcProbToY(p);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', M.left); line.setAttribute('x2', M.left + plotW);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', '#e2e8f0'); line.setAttribute('stroke-width', '1');
      gridG.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', M.left - 4); label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '9'); label.setAttribute('fill', '#94a3b8');
      label.textContent = Math.round(p * 100) + '%';
      axisG.appendChild(label);
    });

    for (let d = 0; d <= fcState.maxDays; d++) {
      const x = fcDayToX(d);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', x); label.setAttribute('y', VBH - M.bottom + 14);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '9'); label.setAttribute('fill', '#94a3b8');
      label.textContent = d;
      axisG.appendChild(label);
    }

    if (segs.length === 0 || segs[0].t > 0) {
      const endT = segs.length ? segs[0].t : fcState.maxDays;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', fcPathFromPoints([[fcDayToX(0), fcProbToY(0)], [fcDayToX(endT), fcProbToY(0)]]));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#2563eb'); path.setAttribute('stroke-width', '2');
      curveG.appendChild(path);
    }

    segs.forEach((seg, i) => {
      const nextT = (i + 1 < segs.length) ? segs[i + 1].t : fcState.maxDays;
      if (nextT > seg.t) {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', fcPathFromPoints(fcSample(seg.t, nextT, seg.lifespan)));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#2563eb'); path.setAttribute('stroke-width', '2');
        curveG.appendChild(path);
      }

      const x = fcDayToX(seg.t);
      const yIncoming = fcProbToY(seg.incoming);
      const yTop = fcProbToY(1);
      if (Math.abs(yIncoming - yTop) > 1) {
        const rl = document.createElementNS(NS, 'line');
        rl.setAttribute('x1', x); rl.setAttribute('x2', x);
        rl.setAttribute('y1', yIncoming); rl.setAttribute('y2', yTop);
        rl.setAttribute('stroke', '#94a3b8'); rl.setAttribute('stroke-width', '1');
        rl.setAttribute('stroke-dasharray', '3,3');
        resetG.appendChild(rl);
      }

      const g = document.createElementNS(NS, 'g');
      g.setAttribute('data-fc-marker-id', seg.id);
      g.style.cursor = 'pointer';
      const mbg = document.createElementNS(NS, 'circle');
      mbg.setAttribute('cx', x); mbg.setAttribute('cy', yIncoming); mbg.setAttribute('r', 9);
      mbg.setAttribute('fill', '#ffffff'); mbg.setAttribute('stroke', '#cbd5e1'); mbg.setAttribute('stroke-width', '0.5');
      g.appendChild(mbg);
      if (seg.type === 'correct') {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', yIncoming); c.setAttribute('r', 6);
        c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#16a34a'); c.setAttribute('stroke-width', '2.5');
        g.appendChild(c);
      } else {
        const p1 = document.createElementNS(NS, 'line');
        p1.setAttribute('x1', x - 4); p1.setAttribute('y1', yIncoming - 4); p1.setAttribute('x2', x + 4); p1.setAttribute('y2', yIncoming + 4);
        p1.setAttribute('stroke', '#dc2626'); p1.setAttribute('stroke-width', '2.5'); p1.setAttribute('stroke-linecap', 'round');
        const p2 = document.createElementNS(NS, 'line');
        p2.setAttribute('x1', x - 4); p2.setAttribute('y1', yIncoming + 4); p2.setAttribute('x2', x + 4); p2.setAttribute('y2', yIncoming - 4);
        p2.setAttribute('stroke', '#dc2626'); p2.setAttribute('stroke-width', '2.5'); p2.setAttribute('stroke-linecap', 'round');
        g.appendChild(p1); g.appendChild(p2);
      }
      markG.appendChild(g);
    });

    fcChart.appendChild(gridG);
    fcChart.appendChild(curveG);
    fcChart.appendChild(resetG);
    fcChart.appendChild(markG);
    fcChart.appendChild(axisG);

    fcEaseOut.textContent = fcState.ease.toFixed(1) + ' 倍';
    fcLapseOut.textContent = Math.round(fcState.lapseKeep * 100) + ' %';
  }

  function fcUpdateToolButtons() {
    fcToolCorrect.classList.toggle('border-2', fcSelectedTool === 'correct');
    fcToolCorrect.classList.toggle('border-black', fcSelectedTool === 'correct');
    fcToolCorrect.classList.toggle('border', fcSelectedTool !== 'correct');
    fcToolCorrect.classList.toggle('border-slate-300', fcSelectedTool !== 'correct');
    fcToolIncorrect.classList.toggle('border-2', fcSelectedTool === 'incorrect');
    fcToolIncorrect.classList.toggle('border-black', fcSelectedTool === 'incorrect');
    fcToolIncorrect.classList.toggle('border', fcSelectedTool !== 'incorrect');
    fcToolIncorrect.classList.toggle('border-slate-300', fcSelectedTool !== 'incorrect');
  }

  fcEaseInput.value = fcState.ease;
  fcLapseInput.value = Math.round(fcState.lapseKeep * 100);
  fcEaseInput.addEventListener('input', function () { fcState.ease = parseFloat(fcEaseInput.value); fcRender(); });
  fcLapseInput.addEventListener('input', function () { fcState.lapseKeep = parseFloat(fcLapseInput.value) / 100; fcRender(); });
  fcToolCorrect.addEventListener('click', function () { fcSelectedTool = 'correct'; fcUpdateToolButtons(); });
  fcToolIncorrect.addEventListener('click', function () { fcSelectedTool = 'incorrect'; fcUpdateToolButtons(); });
  fcReset.addEventListener('click', function () { fcEvents = []; fcRender(); });

  // 追加とドラッグ移動だけに絞る。正解⇔不正解の切替・削除はリセットで代用できるので持たせない
  // （pointerdown が捉えた場所だけを見て、後から来る click イベントには頼らない。
  //   setPointerCapture 後は click の e.target がキャプチャ元の要素にすり替わることがあり、
  //   印の上で判定するはずが背景と誤判定されて、印をクリックしても新しい印が
  //   追加されてしまう不具合の原因になっていた）。
  fcChart.addEventListener('pointerdown', function (e) {
    const markerEl = e.target.closest('[data-fc-marker-id]');
    const p = fcToSvgPoint(e);
    fcDragState = markerEl
      ? { id: markerEl.getAttribute('data-fc-marker-id'), startX: p.x, startY: p.y, moved: false }
      : { id: null, startX: p.x, startY: p.y, moved: false, addDay: fcClampDay(fcXToDay(p.x)) };
    fcChart.setPointerCapture(e.pointerId);
  });

  fcChart.addEventListener('pointermove', function (e) {
    if (!fcDragState) return;
    const p = fcToSvgPoint(e);
    if (!fcDragState.moved && Math.hypot(p.x - fcDragState.startX, p.y - fcDragState.startY) > 4) fcDragState.moved = true;
    if (fcDragState.moved && fcDragState.id) {
      const t = fcClampDay(fcXToDay(p.x));
      const ev = fcEvents.find(function (x) { return x.id === fcDragState.id; });
      if (ev) { ev.t = t; fcRender(); }
    }
  });

  fcChart.addEventListener('pointerup', function () {
    if (!fcDragState) return;
    const state = fcDragState;
    fcDragState = null;
    if (state.moved || state.id) return;
    fcEvents.push({ id: 'f' + (fcIdCounter++), t: state.addDay, type: fcSelectedTool });
    fcRender();
  });

  fcUpdateToolButtons();
  fcRender();
})();
