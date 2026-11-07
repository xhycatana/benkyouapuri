// ペンの診断（調査用）。iPad が受け取った入力を、画面に見える形で出して、ログに残す。
// ----------------------------------------------------------------------
// 目的は、「ペンで消した直後の1画目が書けない」「ボタンが反応しない」などが起きたときに、
// 入力が、いつ・どの要素に届いたか、アプリがそれをどう扱ったか（受け付けた・無視した・理由）を、あとから読めるようにすること。
//   ・画面の右上に、直近の記録を出す（色：ペン＝青、指＝緑、マウス＝灰、キャンバスの処理＝紫、アプリ＝黒、無視・異常＝赤）
//   ・触れた場所に、印を一瞬出す（▼ 触れた＝塗りつぶしの丸、▲ 離れた＝丸、✕ 取り消し＝赤い丸、click＝四角）
//   ・「コピー」で、全記録を文字にしてコピーする（チャットに貼って見せられる）
// ポインタ以外（touch・mouse・ジェスチャー・スクロール・選択・フォーカス・visualViewport）と、ページの処理が止まった時間も記録する。
//   「ペンが下りたのに pointerdown が届かない」とき、iPad が代わりに何をしているかを見るため。
// 設定画面の「ペンの診断」で、入り切りする。切っている間は、何も受け取らず、何も変えない。
// 受け取るだけで、入力の邪魔はしない（passive・capture のリスナーと、pointer-events: none のパネルだけ）。

const STORAGE_KEY_DIAG = 'flashmemo_diag';
const DIAG_MAX_LINES = 800;    // 持っておく行数（古いものから捨てる）
const DIAG_SHOW_LINES = 36;    // 画面に出す行数
const DIAG_COLORS = {
  pen: '#2563eb', touch: '#16a34a', mouse: '#64748b', click: '#d97706',
  canvas: '#7c3aed', app: '#0f172a', warn: '#dc2626', env: '#94a3b8', mark: '#db2777'
};

const penDiag = {
  on: false,
  t0: 0,            // 最初に入れた時刻。記録の時刻は、ここからの秒
  lines: [],        // { t, kind, text }
  panel: null,
  list: null,
  status: null,
  folded: false,
  runs: {},         // まとめている途中の行（レーンごと。pointermove と touchmove が交互に届いても、別々にまとめる）
  moveTimer: null,
  renderTimer: null,
  statusTimer: null,
  onceKey: '',
  lastClearAt: 0,  // 最後にキャンバスを消した時刻（消してから何秒後に描き始めたかを出すため）
  lagTimer: null,
  lagLast: 0
};

function diagNow() { return performance.now(); }

function diagPush(kind, text, atMs) {
  const t = (((atMs === undefined ? diagNow() : atMs) - penDiag.t0) / 1000).toFixed(3);
  penDiag.lines.push({ t: t, ms: (atMs === undefined ? diagNow() : atMs), kind: kind, text: text });
  if (penDiag.lines.length > DIAG_MAX_LINES) penDiag.lines.splice(0, penDiag.lines.length - DIAG_MAX_LINES);
  diagScheduleRender();
}

// 他のファイルから呼ぶ記録。診断が切れているときは、何もしない
function diagLog(kind, text) {
  if (!penDiag.on) return;
  diagFlushMove();   // 続いている pointermove は、別の記録が来る前にまとめて出す（順番が前後しないように）
  diagPush(kind, text);
}

// キャンバスを消した時刻を覚える。「消してから○秒後」を、ストロークの記録に付ける
function diagNoteClear() { if (penDiag.on) penDiag.lastClearAt = diagNow(); }
function diagSinceClear() {
  if (!penDiag.on || !penDiag.lastClearAt) return '';
  return ' / clearから ' + ((diagNow() - penDiag.lastClearAt) / 1000).toFixed(3) + '秒後';
}

// 同じ理由を、1本の線の間に何度も出さないための記録（key が前回と同じなら出さない）。reset するまで有効
function diagLogOnce(key, kind, text) {
  if (!penDiag.on || penDiag.onceKey === key) return;
  penDiag.onceKey = key;
  diagLog(kind, text);
}
function diagResetOnce() { penDiag.onceKey = ''; }

// --- 要素の名前 ---
function diagDescribe(el) {
  if (!el || !el.tagName) return String(el);
  if (el === document.documentElement) return 'html';
  if (el === document.body) return 'body';
  if (el.id) return '#' + el.id;
  let s = el.tagName.toLowerCase();
  const cls = (typeof el.className === 'string' && el.className.trim()) ? el.className.trim().split(/\s+/)[0] : '';
  if (cls) s += '.' + cls;
  const holder = el.closest ? el.closest('[id]') : null;
  if (holder && holder !== el) s += ' (#' + holder.id + ' の中)';
  return s;
}

function diagKindOf(pointerType) {
  return pointerType === 'pen' ? 'pen' : (pointerType === 'touch' ? 'touch' : 'mouse');
}

function diagInsidePanel(el) {
  return !!(penDiag.panel && el && el.nodeType === 1 && penDiag.panel.contains(el));
}

// --- 触れた場所の印 ---
function diagMark(x, y, color, shape) {
  const size = shape === 'dot' ? 18 : 30;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;pointer-events:none;z-index:9998;box-sizing:border-box;' +
    'left:' + (x - size / 2) + 'px;top:' + (y - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;' +
    'border-radius:' + (shape === 'square' ? '3px' : '50%') + ';' +
    (shape === 'dot' ? ('background:' + color + '66;border:2px solid ' + color + ';') : ('border:2px solid ' + color + ';'));
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 1200);
}

// --- 入力の受け取り ---
const DIAG_MARKS = {
  pointerdown: '▼down', pointerup: '▲up', pointercancel: '✕cancel', lostpointercapture: '…lostcapture'
};

function diagOnPointer(e) {
  if (diagInsidePanel(e.target)) return;
  if (e.type === 'pointermove') { diagOnMove(e); return; }
  diagFlushMove();
  const text = DIAG_MARKS[e.type] + ' ' + e.pointerType + '#' + e.pointerId +
    ' (' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ') b=' + e.buttons +
    ' p=' + (e.pressure || 0).toFixed(2) + ' → ' + diagDescribe(e.target);
  diagPush(diagKindOf(e.pointerType), text);
  const color = DIAG_COLORS[diagKindOf(e.pointerType)];
  if (e.type === 'pointerdown') diagMark(e.clientX, e.clientY, color, 'dot');
  else if (e.type === 'pointerup') diagMark(e.clientX, e.clientY, color, 'ring');
  else if (e.type === 'pointercancel') diagMark(e.clientX, e.clientY, DIAG_COLORS.warn, 'ring');
}

function diagOnClick(e) {
  if (diagInsidePanel(e.target)) return;
  diagFlushMove();
  diagPush('click', '✔click ' + (e.pointerType || '') + ' detail=' + e.detail +
    ' (' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ') → ' + diagDescribe(e.target));
  diagMark(e.clientX, e.clientY, DIAG_COLORS.click, 'square');
}

// 数が多いもの（pointermove・scroll・touchmove など）は、続けて届いたものを1行にまとめる。
// まとめるのは、レーン（lane）ごと。ペンの pointermove と touchmove のように、種類の違うものが交互に届いても、
// 互いに邪魔をせず、それぞれ1行にまとまる（以前は交互に届くたびに行が分かれて、記録が長くなりすぎた）。
// 同じレーンで key が変わるか、別の種類の記録が来るか、250ms 何も届かなければ、まとめて1行にする
function diagRun(lane, key, kind, label, tail) {
  const now = diagNow();
  const m = penDiag.runs[lane];
  if (m && m.key === key) {
    m.n++;
    m.tail = tail;
  } else {
    diagFlushLane(lane);
    penDiag.runs[lane] = { key: key, kind: kind, label: label, n: 1, at: now, tail: tail };
  }
  clearTimeout(penDiag.moveTimer);
  penDiag.moveTimer = setTimeout(diagFlushMove, 250);
}

function diagFlushLane(lane) {
  const m = penDiag.runs[lane];
  if (!m) return;
  delete penDiag.runs[lane];
  diagPush(m.kind, m.label + ' ×' + m.n + ' → ' + m.tail, m.at);
}

function diagFlushMove() {
  clearTimeout(penDiag.moveTimer);
  Object.keys(penDiag.runs).forEach(diagFlushLane);
}

// pointermove（触れている間＝移動、触れていない間＝ホバー）
function diagOnMove(e) {
  const head = e.pointerType + '#' + e.pointerId;
  const moving = e.buttons > 0;
  diagRun('ptr', head + '|' + (moving ? 'move' : 'hover'), diagKindOf(e.pointerType), (moving ? '…移動 ' : '…ホバー ') + head,
    '(' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ') ' + diagDescribe(e.target));
}

// --- ページに届く、ポインタ以外の入力 ---
// 「ペンが下りたのに、pointerdown が届かない」とき、iPad が代わりに何を受け取っているかを見るためのもの。
// タッチ（touchType が stylus ならペン、direct なら指）・マウス・ジェスチャー・メニュー・ドラッグ・選択・フォーカス・スクロール
function diagTouchText(e) {
  const list = Array.prototype.map.call(e.changedTouches || [], function (t) {
    return (t.touchType || '?') + '@' + Math.round(t.clientX) + ',' + Math.round(t.clientY);
  });
  return 'touches=' + (e.touches ? e.touches.length : '?') + ' 変化=[' + list.join(' ') + '] → ' + diagDescribe(e.target);
}

function diagOnOther(e) {
  if (diagInsidePanel(e.target)) return;
  const type = e.type;
  if (type === 'touchmove') { diagRun('tch', 'touchmove', 'touch', '…touchmove', diagTouchText(e)); return; }
  if (type === 'scroll') {
    const tg = e.target;
    diagRun('scroll', 'scroll|' + diagDescribe(tg), 'warn', '…スクロール',
      (tg === document || tg === window) ? ('window y=' + window.scrollY) : (diagDescribe(tg) + ' top=' + tg.scrollTop));
    return;
  }
  if (type === 'selectionchange') {
    const sel = window.getSelection ? window.getSelection() : null;
    diagRun('sel', 'selectionchange', 'warn', '…selectionchange', sel ? ('type=' + sel.type + ' 長さ=' + String(sel).length) : '?');
    return;
  }
  if (type === 'gesturechange') { diagRun('gest', 'gesturechange', 'warn', '…gesturechange', 'scale=' + (e.scale || '?')); return; }
  diagFlushMove();
  if (type === 'touchstart' || type === 'touchend' || type === 'touchcancel') {
    diagPush('touch', '◆' + type + ' ' + diagTouchText(e));
  } else if (type === 'mousedown' || type === 'mouseup') {
    diagPush('mouse', '◇' + type + ' (' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ') → ' + diagDescribe(e.target));
  } else if (type === 'focusin' || type === 'focusout') {
    diagPush('app', type + ' → ' + diagDescribe(e.target));
  } else {
    diagPush('warn', '※' + type + ' → ' + diagDescribe(e.target));   // gesturestart・contextmenu・dragstart・selectstart など。普通は出ない
  }
}

// visualViewport（拡大・スクロールで動く、実際に見えている範囲）
function diagOnViewport(e) {
  const vv = window.visualViewport;
  diagRun('vv', 'vv|' + e.type, 'warn', '…visualViewport ' + e.type,
    'scale=' + vv.scale.toFixed(3) + ' offset=(' + vv.offsetLeft.toFixed(1) + ',' + vv.offsetTop.toFixed(1) + ') size=' + Math.round(vv.width) + '×' + Math.round(vv.height));
}

// ページの処理が止まっていたか。100ms ごとに自分を呼び、予定より大きく遅れたら記録する
function diagStartLagWatch() {
  penDiag.lagLast = diagNow();
  clearInterval(penDiag.lagTimer);
  penDiag.lagTimer = setInterval(function () {
    const now = diagNow();
    const late = now - penDiag.lagLast - 100;
    penDiag.lagLast = now;
    if (late > 120 && !document.hidden) diagLog('warn', 'app: ページの処理が約 ' + Math.round(late) + 'ms 止まっていた');
  }, 100);
}

// 「★失敗」を押した時点の、画面の状態
function diagStateText() {
  const vv = window.visualViewport;
  const parts = [
    'active=' + diagDescribe(document.activeElement),
    'phase=' + currentPhase,
    'isTransitioning=' + isTransitioning,
    'ペン検知済み=' + (typeof globalCanvas !== 'undefined' ? globalCanvas.hasSeenPen : '?'),
    'ストローク=' + (typeof globalCanvas !== 'undefined' && globalCanvas.stroke ? '進行中' : 'なし'),
    expText(),
    'window scroll=(' + window.scrollX + ',' + window.scrollY + ')',
    'phaseContainer top=' + (typeof phaseContainer !== 'undefined' ? phaseContainer.scrollTop : '?')
  ];
  if (vv) parts.push('visualViewport scale=' + vv.scale.toFixed(3) + ' offset=(' + vv.offsetLeft.toFixed(1) + ',' + vv.offsetTop.toFixed(1) + ')');
  return parts.join(' / ');
}

// --- 画面全体の出来事 ---
function diagOnWindow(e) {
  diagFlushMove();
  let text = e.type;
  if (e.type === 'resize') text = 'resize → ' + window.innerWidth + '×' + window.innerHeight;
  else if (e.type === 'visibilitychange') text = 'visibilitychange → ' + document.visibilityState;
  diagPush('app', text);
}

const DIAG_POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
const DIAG_WINDOW_EVENTS = ['resize', 'orientationchange', 'pagehide', 'pageshow', 'focus', 'blur'];
const DIAG_OTHER_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup',
  'gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dragstart', 'selectstart', 'selectionchange',
  'focusin', 'focusout', 'scroll'];
const DIAG_VIEWPORT_EVENTS = ['resize', 'scroll'];
const diagListenOpts = { capture: true, passive: true };

function diagAttach() {
  DIAG_POINTER_EVENTS.forEach(function (t) { document.addEventListener(t, diagOnPointer, diagListenOpts); });
  document.addEventListener('click', diagOnClick, diagListenOpts);
  document.addEventListener('visibilitychange', diagOnWindow, diagListenOpts);
  DIAG_WINDOW_EVENTS.forEach(function (t) { window.addEventListener(t, diagOnWindow); });
  DIAG_OTHER_EVENTS.forEach(function (t) { document.addEventListener(t, diagOnOther, diagListenOpts); });
  if (window.visualViewport) DIAG_VIEWPORT_EVENTS.forEach(function (t) { window.visualViewport.addEventListener(t, diagOnViewport); });
  diagStartLagWatch();
}

function diagDetach() {
  DIAG_POINTER_EVENTS.forEach(function (t) { document.removeEventListener(t, diagOnPointer, diagListenOpts); });
  document.removeEventListener('click', diagOnClick, diagListenOpts);
  document.removeEventListener('visibilitychange', diagOnWindow, diagListenOpts);
  DIAG_WINDOW_EVENTS.forEach(function (t) { window.removeEventListener(t, diagOnWindow); });
  DIAG_OTHER_EVENTS.forEach(function (t) { document.removeEventListener(t, diagOnOther, diagListenOpts); });
  if (window.visualViewport) DIAG_VIEWPORT_EVENTS.forEach(function (t) { window.visualViewport.removeEventListener(t, diagOnViewport); });
  clearInterval(penDiag.lagTimer);
  penDiag.lagTimer = null;
}

// --- 端末の情報（記録の先頭に入れる） ---
function diagLogEnv() {
  const ver = (document.querySelector('script[src*="diag.js"]') || {}).src || '';
  const m = ver.match(/v=([\d.]+)/);
  diagPush('env', 'アプリ v' + (m ? m[1] : '?') + ' / 画面 ' + currentPhase);
  diagPush('env', 'UA: ' + navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''));
  diagPush('env', 'screen ' + screen.width + '×' + screen.height + ' / inner ' + window.innerWidth + '×' + window.innerHeight +
    ' / dpr ' + window.devicePixelRatio + ' / touchPoints ' + navigator.maxTouchPoints);
  diagPush('env', 'hover:' + (window.matchMedia && matchMedia('(hover: hover)').matches) +
    ' / standalone:' + (navigator.standalone === true) +
    ' / coalesced:' + (typeof PointerEvent !== 'undefined' && 'getCoalescedEvents' in PointerEvent.prototype) +
    ' / https:' + (location.protocol === 'https:'));
  diagPush('env', expText());
}

// --- パネル ---
function diagButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'pointer-events:auto;padding:2px 6px;margin-right:4px;border:1px solid #000;background:#fff;font:inherit;';
  b.addEventListener('click', onClick);
  return b;
}

function diagBuildPanel() {
  const p = document.createElement('div');
  p.id = 'pen-diag-panel';
  p.style.cssText = 'position:fixed;top:6px;right:6px;width:min(380px,64vw);z-index:9999;' +
    'background:rgba(255,255,255,.94);border:1px solid #000;color:#0f172a;pointer-events:none;' +
    'font:10px/1.4 ui-monospace,Menlo,Consolas,monospace;';

  const head = document.createElement('div');
  head.style.cssText = 'padding:3px 4px;border-bottom:1px solid #cbd5e1;white-space:nowrap;overflow:hidden;';
  head.appendChild(diagButton('コピー', function () { diagCopy('near'); }));
  head.appendChild(diagButton('全部', function () { diagCopy('all'); }));
  head.appendChild(diagButton('★失敗', function () {
    diagLog('mark', '★ 本人の印: いまの操作が失敗した（この直前の記録が、失敗した操作）');
    diagLog('mark', '★ 状態: ' + diagStateText());
    diagSetStatus('★を記録');
  }));
  head.appendChild(diagButton('消す', function () { penDiag.lines.length = 0; diagPush('env', '記録を消した'); diagRenderNow(); }));
  head.appendChild(diagButton('たたむ', function () { penDiag.folded = !penDiag.folded; diagRenderNow(); }));
  head.appendChild(diagButton('閉じる', function () { diagSetEnabled(false); }));
  const status = document.createElement('span');
  status.style.cssText = 'color:#64748b;';
  status.textContent = '新しい順';
  head.appendChild(status);

  const list = document.createElement('div');
  list.style.cssText = 'padding:3px 4px;max-height:42vh;overflow:hidden;';

  p.appendChild(head);
  p.appendChild(list);
  document.body.appendChild(p);
  penDiag.panel = p;
  penDiag.list = list;
  penDiag.status = status;
}

function diagScheduleRender() {
  if (penDiag.renderTimer || !penDiag.panel) return;
  penDiag.renderTimer = setTimeout(diagRenderNow, 80);
}

function diagRenderNow() {
  clearTimeout(penDiag.renderTimer);
  penDiag.renderTimer = null;
  if (!penDiag.list) return;
  penDiag.list.style.display = penDiag.folded ? 'none' : '';
  penDiag.list.innerHTML = '';
  // 新しい順（いちばん新しい行が上）。枠からはみ出すのは、古い行になる
  penDiag.lines.slice(-DIAG_SHOW_LINES).reverse().forEach(function (l) {
    const row = document.createElement('div');
    row.style.cssText = 'white-space:pre-wrap;word-break:break-all;color:' + (DIAG_COLORS[l.kind] || '#0f172a') + ';';
    row.textContent = l.t + ' ' + l.text;
    penDiag.list.appendChild(row);
  });
}

function diagSetStatus(text) {
  if (!penDiag.status) return;
  penDiag.status.textContent = text;
  clearTimeout(penDiag.statusTimer);
  penDiag.statusTimer = setTimeout(function () { if (penDiag.status) penDiag.status.textContent = '新しい順'; }, 3000);
}

// --- コピー ---
// 時刻順に並べた全行（まとめ行は、まとめ始めた時刻で並ぶ）
function diagSortedLines() {
  diagFlushMove();
  return penDiag.lines.slice().sort(function (a, b) { return a.ms - b.ms; });
}

// 貼れる長さにするため、既定は「最後の★失敗の前6秒〜後1.5秒」と、先頭の端末情報だけ。★が無ければ、直近の40行。
// mode が 'all' のときは、全部
const DIAG_COPY_MAX_LINES = 120;
function diagLinesFor(mode) {
  const all = diagSortedLines();
  if (mode === 'all') return all;
  const env = all.filter(function (l) { return l.kind === 'env'; }).slice(0, 6);
  let star = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].kind === 'mark' && all[i].text.indexOf('本人の印') >= 0) { star = i; break; }
  }
  let body;
  if (star >= 0) {
    const center = all[star].ms;
    body = all.filter(function (l) { return l.kind !== 'env' && l.ms >= center - 6000 && l.ms <= center + 1500; });
  } else {
    body = all.filter(function (l) { return l.kind !== 'env'; }).slice(-40);
  }
  if (body.length > DIAG_COPY_MAX_LINES) body = body.slice(-DIAG_COPY_MAX_LINES);
  return env.concat(body);
}

function diagText(mode) {
  return diagLinesFor(mode).map(function (l) { return l.t + ' [' + l.kind + '] ' + l.text; }).join('\n');
}

async function diagCopy(mode) {
  const lines = diagLinesFor(mode);
  const text = lines.map(function (l) { return l.t + ' [' + l.kind + '] ' + l.text; }).join('\n');
  const label = '✓ ' + lines.length + '行（' + text.length + '文字）をコピー';
  try {
    await navigator.clipboard.writeText(text);
    diagSetStatus(label);
    return;
  } catch (err) {}
  // clipboard が使えないときの代わり
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    diagSetStatus(ok ? label : 'コピーできませんでした');
  } catch (err) {
    diagSetStatus('コピーできませんでした');
  }
}

// --- 入り切り ---
function diagSetEnabled(on) {
  on = !!on;
  try { localStorage.setItem(STORAGE_KEY_DIAG, on ? '1' : '0'); } catch (err) {}
  if (typeof checkDiag !== 'undefined' && checkDiag) checkDiag.checked = on;
  if (on === penDiag.on) return;
  penDiag.on = on;
  if (on) {
    if (!penDiag.t0) penDiag.t0 = diagNow();
    diagBuildPanel();
    diagAttach();
    diagLogEnv();
    diagRenderNow();
  } else {
    diagFlushMove();
    diagDetach();
    if (penDiag.panel) penDiag.panel.remove();
    penDiag.panel = null; penDiag.list = null; penDiag.status = null;
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (typeof checkDiag !== 'undefined' && checkDiag) {
    checkDiag.addEventListener('change', function () { diagSetEnabled(checkDiag.checked); });
  }
  let stored = '0';
  try { stored = localStorage.getItem(STORAGE_KEY_DIAG) || '0'; } catch (err) {}
  diagSetEnabled(stored === '1');
});

// --- 実験の入り切り（style.css の body.exp-a / body.exp-b） ---
// 記録の先頭の端末情報に、どの実験がONかも入れる
const STORAGE_KEY_EXP = 'flashmemo_exp';

function expState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY_EXP) || '{}') || {}; } catch (err) {}
  return s;
}

let expCOn = false;   // 実験C（下の expCStart・expCEnd）がONか

function expApply() {
  const s = expState();
  document.body.classList.toggle('exp-a', !!s.a);
  document.body.classList.toggle('exp-b', !!s.b);
  expCOn = !!s.c;
  if (typeof checkExpA !== 'undefined' && checkExpA) checkExpA.checked = !!s.a;
  if (typeof checkExpB !== 'undefined' && checkExpB) checkExpB.checked = !!s.b;
  if (typeof checkExpC !== 'undefined' && checkExpC) checkExpC.checked = !!s.c;
}

function expSet(name, on) {
  const s = expState();
  s[name] = !!on;
  try { localStorage.setItem(STORAGE_KEY_EXP, JSON.stringify(s)); } catch (err) {}
  expApply();
  diagLog('env', '実験 ' + name.toUpperCase() + ' を ' + (on ? 'ON' : 'OFF') + ' にした（いま A=' + !!s.a + ' B=' + !!s.b + ' C=' + !!s.c + '）');
}

function expText() {
  const s = expState();
  return '実験 A=' + !!s.a + ' B=' + !!s.b + ' C=' + !!s.c;
}

// 実験C: 出題・丸付け中のボタンの touchstart を、キャンバスと同じようにページ側で止める（preventDefault）。
// 止めると、click が作られなくなるので、指やペンが離れたときに「ほとんど動かさず、ボタンの上で離した」ことを確かめて、
// 自分で click() を呼ぶ。キャンバスと同じ「この触れ方はページが引き受ける」やり方で、iPad の側の判定を始めさせないための実験
const EXP_C_SELECTOR = '#left-controls-container button, #phase-test button, #phase-review button, #app-header button';
let expCTouch = null;

function expCStart(e) {
  if (!expCOn || !e.target || !e.target.closest) return;
  const btn = e.target.closest(EXP_C_SELECTOR);
  if (!btn || btn.disabled || !isDrawingPhase() || e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  expCTouch = { btn: btn, id: t.identifier, x: t.clientX, y: t.clientY };
}

function expCEnd(e) {
  const s = expCTouch;
  if (!s) return;
  const t = Array.prototype.find.call(e.changedTouches, function (x) { return x.identifier === s.id; });
  if (!t) return;
  expCTouch = null;
  if (e.type === 'touchcancel') { diagLog('warn', '実験C: touchcancel（押した扱いにしない）'); return; }
  const r = s.btn.getBoundingClientRect();
  const inside = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
  const moved = Math.hypot(t.clientX - s.x, t.clientY - s.y);
  diagLog('app', '実験C: touchend → ' + (inside && moved <= 12 ? 'ボタンを押した扱い' : '押した扱いにしない（inside=' + inside + ' 動き=' + Math.round(moved) + 'px）') + ' → ' + diagDescribe(s.btn));
  if (inside && moved <= 12) s.btn.click();
}

document.addEventListener('touchstart', expCStart, { capture: true, passive: false });
document.addEventListener('touchend', expCEnd, { capture: true });
document.addEventListener('touchcancel', expCEnd, { capture: true });

document.addEventListener('DOMContentLoaded', function () {
  expApply();
  if (typeof checkExpA !== 'undefined' && checkExpA) checkExpA.addEventListener('change', function () { expSet('a', checkExpA.checked); });
  if (typeof checkExpB !== 'undefined' && checkExpB) checkExpB.addEventListener('change', function () { expSet('b', checkExpB.checked); });
  if (typeof checkExpC !== 'undefined' && checkExpC) checkExpC.addEventListener('change', function () { expSet('c', checkExpC.checked); });
});
