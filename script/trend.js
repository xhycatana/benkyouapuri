// 記憶の推移。全問題集の問題数・平均正答確率・合計知識量を、日ごとに記録してグラフにする。
// ----------------------------------------------------------------------
// 合計知識量 ＝ 全問題の「いま思い出せる確率」の合計（＝ 問題数 × 平均正答確率）。
// 「いま思い出せる問題が、だいたい何問か」を表す。まだ解いていない問題は 0% として数える。
//
// 確率は時間とともに下がり続けるので、サーバーは計算できない（解答履歴と全問題を見て、時刻を決めて計算する）。
// そこで、計算は端末側で行い、1日1件の結果だけをサーバーへ送る。
//
// 各日の最終的な値は、「その日の日付が切り替わる直前（23:59:59）」の値にする。
//   ・今日の値は、途中の値（final なし）。開くたび・解き終えるたびに置き換える
//   ・過去の日は、次にアプリを開いたとき（解き始める前）に、その日の終わりの時刻で計算し直して確定させる（final）。
//     アプリを開かなかった日も、同じ方法で埋める
// 確定のときに計算し直せるのは、確率が「最後に解いた時刻」と「寿命」だけで決まるため。
// 解いていない間は、成績は変わらないので、過去の日の終わりの値を、あとから正確に出せる。
// ただし、その日の終わりより後に解いた成績が混ざっていると、その日の値は出せない（成績は最新の状態しか持たない）。
// そのため、確定させるのは、最後に解いた時刻より後に終わる日だけにする。
// 全問題集の問題を毎回読み込まなくて済むよう、問題集ごとの問題IDの一覧を端末に控え、
// 問題集が書き換えられたとき（一覧の updated_at が変わったとき）だけ読み直す。

const STORAGE_KEY_QUESTION_IDS = 'flashmemo_question_ids';
const STORAGE_KEY_SNAPSHOT_LAST = 'flashmemo_snapshot_last';
const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000;   // 同じ日に何度も送らないよう、前回から空ける間隔

let snapshotTimer = null;
let snapshotBusy = false;

function readIdCache() {
  try {
    const j = JSON.parse(localStorage.getItem(STORAGE_KEY_QUESTION_IDS) || 'null');
    return (j && typeof j === 'object') ? j : {};
  } catch (err) { return {}; }
}

function writeIdCache(cache) {
  try { localStorage.setItem(STORAGE_KEY_QUESTION_IDS, JSON.stringify(cache)); } catch (err) {}
}

// 一覧にある全問題集の問題IDを集める。{ ok: すべて取れたか, byPath: { path: { updated_at, count, ids } } }
async function ensureQuestionIds() {
  const cache = readIdCache();
  const next = {};
  const todo = [];
  libraryIndex.sets.forEach(function (s) {
    const c = cache[s.path];
    if (c && c.updated_at === (s.updated_at || null) && c.count === (s.count || 0) && Array.isArray(c.ids)) next[s.path] = c;
    else todo.push(s);
  });

  let ok = true;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async function (s) {
      try {
        const set = await api('/api/questions?path=' + encodeURIComponent(s.path));
        next[s.path] = {
          updated_at: s.updated_at || null,
          count: s.count || 0,
          ids: (set.questions || []).map(function (q) { return q.id; })
        };
      } catch (err) {
        if (err.unauthorized) throw err;
        ok = false;   // 1つでも取れないと、問題数が欠けた値になる。その日は記録しない
      }
    }));
  }
  writeIdCache(next);
  return { ok: ok, byPath: next };
}

// stats: 成績（問題ID → { last_answered_at, lifespan, … }）。atMs: 何時の時点の値か（省略するといま）
// 「問題と答えを逆にすることを許可」した問題集は、逆向きの問題（id の末尾が ":swap"）も、別の1問として数える。
// 逆向きを覚えていることと、順向きを覚えていることは別なので、成績も別（stats[id + ':swap']）。
function computeSnapshot(byPath, stats, atMs) {
  const swappable = {};
  libraryIndex.sets.forEach(function (s) { if (s.allowSwap) swappable[s.path] = true; });

  let total = 0, knowledge = 0;
  const count = function (id) {
    total++;
    const st = stats[id];
    // 解いたことのない問題は 0。calculateProbability が読むのは、この2つだけ
    if (st) knowledge += calculateProbability({ last_answered_at: st.last_answered_at, lifespan: st.lifespan }, atMs);
  };
  Object.keys(byPath).forEach(function (path) {
    byPath[path].ids.forEach(function (id) {
      count(id);
      if (swappable[path]) count(id + ':swap');
    });
  });
  return { total: total, knowledge: knowledge };
}

function roundKnowledge(v) { return Math.round(v * 100) / 100; }

// その日（"YYYY-MM-DD"、端末のローカル日付）の最後の瞬間（23:59:59.999）
function dayEndMs(dateKey) {
  const p = dateKey.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).getTime();
}

function addDaysKey(dateKey, n) {
  const p = dateKey.split('-').map(Number);
  return localDateKey(new Date(p[0], p[1] - 1, p[2] + n));
}

let snapshotFinalizedAt = 0;   // 前回、過去の日を確定させた時刻。続けて何度も走らせない

// 過去の日の値を、その日の終わりの時刻で確定させる（開かなかった日も埋める）。
// 開いた直後、解き始める前に呼ぶ。成績は、呼んだ時点のものを使う。
async function finalizePastSnapshots() {
  if (!getPassphrase() || libraryIndex.sets.length === 0) return;
  if (Date.now() - snapshotFinalizedAt < 60000) return;
  snapshotFinalizedAt = Date.now();

  const stats = Object.assign({}, progressStats);   // 通信の間に新しい成績が入っても、この時点の値で計算する
  let lastAnswered = 0;
  Object.keys(stats).forEach(function (id) {
    const t = stats[id] && stats[id].last_answered_at ? Date.parse(stats[id].last_answered_at) : 0;
    if (t > lastAnswered) lastAnswered = t;
  });

  const data = await api('/api/questions?kind=snapshots');
  const entries = (data && data.entries) || [];
  if (entries.length === 0) return;   // 記録を取り始める前の日は、遡らない

  const byDate = {};
  entries.forEach(function (e) { byDate[e.date] = e; });
  const first = entries.reduce(function (min, e) { return e.date < min ? e.date : min; }, entries[0].date);
  const today = localDateKey(new Date());

  const need = [];
  for (let d = first, guard = 0; d < today && guard < 400; d = addDaysKey(d, 1), guard++) {
    const e = byDate[d];
    if (e && e.final) continue;                // 確定済み
    if (dayEndMs(d) < lastAnswered) continue;  // その日の後に解いた成績が混ざっているので、正確には出せない
    need.push(d);
  }
  if (need.length === 0) return;

  const ids = await ensureQuestionIds();
  if (!ids.ok) return;
  const out = need.map(function (d) {
    const snap = computeSnapshot(ids.byPath, stats, dayEndMs(d));
    return { date: d, total: snap.total, knowledge: roundKnowledge(snap.knowledge), final: true };
  });
  await api('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'snapshot', entries: out })
  });
}

function readLastSnapshot() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SNAPSHOT_LAST) || 'null'); } catch (err) { return null; }
}

// いまの状態を、今日の記録として送る。force が true のときは、間隔をおかずに送る（グラフを開くとき）
async function recordSnapshot(force) {
  if (snapshotBusy || !getPassphrase() || libraryIndex.sets.length === 0) return;
  snapshotBusy = true;
  try {
    const ids = await ensureQuestionIds();
    if (!ids.ok) return;
    const snap = computeSnapshot(ids.byPath, progressStats);
    const date = localDateKey(new Date());
    const knowledge = roundKnowledge(snap.knowledge);

    const last = readLastSnapshot();
    if (last && last.date === date) {
      if (last.total === snap.total && Math.abs(last.knowledge - knowledge) < 0.05) return;   // 変わっていない
      if (!force && Date.now() - last.at < SNAPSHOT_MIN_INTERVAL_MS) return;
    }
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'snapshot', date: date, total: snap.total, knowledge: knowledge })
    });
    try {
      localStorage.setItem(STORAGE_KEY_SNAPSHOT_LAST, JSON.stringify({ date: date, total: snap.total, knowledge: knowledge, at: Date.now() }));
    } catch (err) {}
  } catch (err) {
    // 失敗しても解くことには影響させない。次の機会に送る
  } finally {
    snapshotBusy = false;
  }
}

// 一覧と成績を読み込んだ直後に呼ぶ。まず過去の日を確定させ、そのあと今日の値を記録する
async function startupSnapshots() {
  try {
    await finalizePastSnapshots();
  } catch (err) {
    // 失敗しても解くことには影響させない。次に開いたときにやり直す
    snapshotFinalizedAt = 0;
  }
  scheduleSnapshot();
}

// 解き終えて戻ったときなどに呼ぶ。少し待って、続けて呼ばれたらまとめる
function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(function () { recordSnapshot(false); }, 3000);
}


// --- 表示 ---
const TREND_INK = '#0f172a';     // 主な線（slate-900）
const TREND_SUB = '#94a3b8';     // もう1本の線（slate-400）。濃さが違うので、色が見分けにくくても区別できる
const TREND_GRID = '#e2e8f0';
const TREND_TEXT = '#64748b';

let trendEntries = [];      // サーバーから読んだ日ごとの記録（古い順）
let trendRangeDays = 90;    // 表示する期間（日）。0 なら全期間

function trendDateMs(key) { return Date.parse(key + 'T00:00:00'); }

function trendShortDate(key) {
  const p = key.split('-').map(Number);
  return p[1] + '/' + p[2];
}

// 縦軸の上限。大きすぎると線が下に潰れるので、1・1.2・1.5・2・2.5・3・4・5・6・8 の刻みで、値に近い方へ丸める
function niceCeil(v) {
  if (!(v > 0)) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(function (s) { return n <= s + 1e-9; });
  return step * pow;
}

function visibleTrendEntries() {
  if (trendRangeDays === 0) return trendEntries;
  const from = Date.now() - trendRangeDays * 86400000;
  return trendEntries.filter(function (e) { return trendDateMs(e.date) >= from; });
}

function svgNode(name, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
  return n;
}

// 折れ線グラフ。軸は1本（単位の違うものは別のグラフにする）。
// series: [{ name, color, values: [数値…] }]（entries と同じ並び）。yMax: 縦軸の上限。labels: 右端に系列名を出すか
function drawTrendChart(box, entries, series, yMax, fmtY, fmtTip, labels) {
  box.innerHTML = '';
  if (entries.length === 0) return;

  const W = Math.max(280, box.clientWidth || 640);
  const H = 190;
  const m = { l: 48, r: labels ? 64 : 14, t: 10, b: 24 };
  const times = entries.map(function (e) { return trendDateMs(e.date); });
  const tMin = times[0], tMax = times[times.length - 1];
  const xOf = function (t) { return tMax === tMin ? (m.l + (W - m.l - m.r) / 2) : m.l + (t - tMin) / (tMax - tMin) * (W - m.l - m.r); };
  const yOf = function (v) { return m.t + (1 - Math.min(1, Math.max(0, v / yMax))) * (H - m.t - m.b); };

  const svg = svgNode('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
  svg.style.display = 'block';

  // 横の基準線（0・半分・上限）と、その値
  [0, 0.5, 1].forEach(function (f) {
    const y = yOf(yMax * f);
    svg.appendChild(svgNode('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: TREND_GRID, 'stroke-width': 1 }));
    const t = svgNode('text', { x: m.l - 6, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: TREND_TEXT });
    t.textContent = fmtY(yMax * f);
    svg.appendChild(t);
  });

  // 日付の目印（最初・真ん中・最後）
  const xTicks = entries.length === 1 ? [0] : [0, Math.floor((entries.length - 1) / 2), entries.length - 1];
  xTicks.filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (i) {
    const t = svgNode('text', { x: xOf(times[i]), y: H - 6, 'text-anchor': i === 0 && entries.length > 1 ? 'start' : (i === entries.length - 1 && entries.length > 1 ? 'end' : 'middle'), 'font-size': 10, fill: TREND_TEXT });
    t.textContent = trendShortDate(entries[i].date);
    svg.appendChild(t);
  });

  // 線。後ろの系列（薄い方）から描いて、主な線を上に重ねる
  const showMarkers = entries.length <= 45;
  series.slice().reverse().forEach(function (s) {
    const pts = s.values.map(function (v, i) { return xOf(times[i]) + ',' + yOf(v); }).join(' ');
    if (entries.length > 1) {
      svg.appendChild(svgNode('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    if (showMarkers || entries.length === 1) {
      s.values.forEach(function (v, i) {
        svg.appendChild(svgNode('circle', { cx: xOf(times[i]), cy: yOf(v), r: 3.5, fill: s.color, stroke: '#fff', 'stroke-width': 2 }));
      });
    }
  });

  // 右端に系列名を直接書く（近いときは上下にずらす）
  if (labels) {
    const ends = series.map(function (s) { return { s: s, y: yOf(s.values[s.values.length - 1]) }; }).sort(function (a, b) { return a.y - b.y; });
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(function (e) {
      const t = svgNode('text', { x: W - m.r + 6, y: e.y + 3, 'font-size': 10, fill: TREND_TEXT });
      t.textContent = e.s.name;
      svg.appendChild(t);
    });
  }

  // 触ったところの日付に縦線を引き、その日の値を出す
  const cross = svgNode('line', { y1: m.t, y2: H - m.b, stroke: TREND_TEXT, 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = series.map(function (s) {
    const d = svgNode('circle', { r: 5, fill: s.color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(d);
    return d;
  });
  const hit = svgNode('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' });
  hit.style.touchAction = 'pan-y';   // 縦のスクロールは邪魔しない
  svg.appendChild(hit);
  box.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'hidden absolute z-10 bg-white border border-black px-2 py-1 text-[11px] text-slate-700 pointer-events-none whitespace-nowrap';
  box.appendChild(tip);

  function show(clientX) {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(xOf(times[i]) - x) < Math.abs(xOf(times[best]) - x)) best = i;
    const cx = xOf(times[best]);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    dots.forEach(function (d, k) {
      d.setAttribute('cx', cx);
      d.setAttribute('cy', yOf(series[k].values[best]));
      d.setAttribute('visibility', 'visible');
    });
    tip.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'font-bold';
    head.textContent = formatStudyDateLabel(entries[best].date);
    tip.appendChild(head);
    fmtTip(entries[best], best).forEach(function (line) {
      const r = document.createElement('div');
      r.textContent = line;
      tip.appendChild(r);
    });
    tip.classList.remove('hidden');
    tip.style.top = '4px';
    tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, cx + 10)) + 'px';
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
    tip.classList.add('hidden');
  }
  hit.addEventListener('pointermove', function (e) { show(e.clientX); });
  hit.addEventListener('pointerdown', function (e) { show(e.clientX); });
  hit.addEventListener('pointerleave', hide);
}

function trendAverage(e) { return e.total > 0 ? e.knowledge / e.total : 0; }

function fmtCount(v) { return Math.round(v).toLocaleString('ja-JP'); }
function fmtKnowledge(v) { return (Math.round(v * 10) / 10).toLocaleString('ja-JP'); }
function fmtPercent(v) { return (v * 100).toFixed(1) + '%'; }   // 桁がそろうよう、いつも小数1桁

function renderTrendTiles(entries) {
  trendTiles.innerHTML = '';
  const last = entries[entries.length - 1];
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;
  const tile = function (label, value, delta) {
    const box = makeEl('div', 'min-w-0 bg-white border border-black p-3 flex flex-col justify-between');
    box.appendChild(makeEl('span', 'text-xs font-bold text-slate-700', label));
    box.appendChild(makeEl('span', 'font-mono text-lg md:text-xl font-bold text-slate-900 break-words', value));
    box.appendChild(makeEl('span', 'text-[10px] text-slate-400 break-words', delta));
    trendTiles.appendChild(box);
  };
  const sign = function (v, text) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + text; };
  tile('問題数', fmtCount(last.total) + '問',
       prev ? '前回比 ' + sign(last.total - prev.total, fmtCount(Math.abs(last.total - prev.total)) + '問') : trendShortDate(last.date) + ' 時点');
  tile('平均正答確率', fmtPercent(trendAverage(last)),
       prev ? '前回比 ' + sign(trendAverage(last) - trendAverage(prev), (Math.round(Math.abs(trendAverage(last) - trendAverage(prev)) * 1000) / 10) + '点') : trendShortDate(last.date) + ' 時点');
  tile('合計知識量', fmtKnowledge(last.knowledge) + '問',
       prev ? '前回比 ' + sign(last.knowledge - prev.knowledge, fmtKnowledge(Math.abs(last.knowledge - prev.knowledge)) + '問') : trendShortDate(last.date) + ' 時点');
}

function renderTrendRangeButtons() {
  trendRange.innerHTML = '';
  [[30, '30日'], [90, '90日'], [365, '1年'], [0, '全期間']].forEach(function (r) {
    const on = trendRangeDays === r[0];
    const b = makeEl('button', 'px-2.5 py-1 text-xs border focus:outline-none ' +
      (on ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-300 hover:border-black'), r[1]);
    b.addEventListener('click', function () { trendRangeDays = r[0]; drawTrend(); });
    trendRange.appendChild(b);
  });
}

function drawTrend() {
  renderTrendRangeButtons();
  const entries = visibleTrendEntries();
  trendTiles.innerHTML = '';
  trendChartKnowledge.innerHTML = '';
  trendChartAverage.innerHTML = '';
  trendTable.innerHTML = '';

  if (trendEntries.length === 0) {
    setMessage(trendMessage, 'まだ記録がありません。ホーム画面を開いたり、問題を解いたりすると、その日の分が記録されます。');
    return;
  }
  if (entries.length === 0) {
    setMessage(trendMessage, 'この期間の記録がありません。期間を広げてください。');
    return;
  }
  setMessage(trendMessage, '');

  renderTrendTiles(entries);

  // 問題数と合計知識量は、同じ「問」の単位なので1つのグラフ（縦軸は共通）
  const yMax = niceCeil(Math.max.apply(null, entries.map(function (e) { return e.total; })));
  drawTrendChart(trendChartKnowledge, entries, [
    { name: '知識量', color: TREND_INK, values: entries.map(function (e) { return e.knowledge; }) },
    { name: '問題数', color: TREND_SUB, values: entries.map(function (e) { return e.total; }) }
  ], yMax, fmtCount, function (e) {
    return ['合計知識量 ' + fmtKnowledge(e.knowledge) + '問', '問題数 ' + fmtCount(e.total) + '問'];
  }, true);

  // 平均正答確率は単位が違う（%）ので、別のグラフ。0〜100% に固定して、高さがそのまま割合になるようにする
  drawTrendChart(trendChartAverage, entries, [
    { name: '平均', color: TREND_INK, values: entries.map(trendAverage) }
  ], 1, function (v) { return Math.round(v * 100) + '%'; }, function (e) {
    return ['平均正答確率 ' + fmtPercent(trendAverage(e))];
  }, false);

  // 数値の表（新しい日から）
  const head = makeEl('div', 'grid grid-cols-4 gap-2 py-1 border-b border-slate-300 font-bold text-slate-500');
  ['日付', '問題数', '平均正答確率', '合計知識量'].forEach(function (h, i) { head.appendChild(makeEl('span', i ? 'text-right' : '', h)); });
  trendTable.appendChild(head);
  entries.slice().reverse().forEach(function (e) {
    const row = makeEl('div', 'grid grid-cols-4 gap-2 py-1 border-b border-slate-100 font-mono text-slate-600');
    [formatStudyDateLabel(e.date), fmtCount(e.total), fmtPercent(trendAverage(e)), fmtKnowledge(e.knowledge)].forEach(function (c, i) {
      row.appendChild(makeEl('span', i ? 'text-right' : '', c));
    });
    trendTable.appendChild(row);
  });
}

async function renderTrendView() {
  setMessage(trendMessage, '読み込み中…');
  trendTiles.innerHTML = '';
  trendChartKnowledge.innerHTML = '';
  trendChartAverage.innerHTML = '';
  trendTable.innerHTML = '';
  renderTrendRangeButtons();
  try {
    await recordSnapshot(true);   // 開いた時点の状態も、今日の記録にしてから読む
    const data = await api('/api/questions?kind=snapshots');
    trendEntries = ((data && data.entries) || []).filter(function (e) {
      return e && typeof e.date === 'string' && Number.isFinite(e.total) && Number.isFinite(e.knowledge);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    drawTrend();
  } catch (err) {
    if (!err.unauthorized) setMessage(trendMessage, err.message, 'error');
  }
}

window.addEventListener('resize', function () { if (currentPhase === 'trend' && trendEntries.length > 0) drawTrend(); });
btnShowTrend.addEventListener('click', function () { switchPhase('trend'); });
btnTrendBack.addEventListener('click', function () { switchPhase('import'); });
