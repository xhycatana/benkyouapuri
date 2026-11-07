// ペンの診断（調査用）。iPad が受け取った入力を、画面に見える形で出して、ログに残す。
// ----------------------------------------------------------------------
// 目的は、「ペンで消した直後の1画目が書けない」「ボタンが反応しない」などが起きたときに、
// 入力が、いつ・どの要素に届いたか、アプリがそれをどう扱ったか（受け付けた・無視した・理由）を、あとから読めるようにすること。
//   ・画面の右上に、直近の記録を出す（色：ペン＝青、指＝緑、マウス＝灰、キャンバスの処理＝紫、アプリ＝黒、無視・異常＝赤）
//   ・触れた場所に、印を一瞬出す（▼ 触れた＝塗りつぶしの丸、▲ 離れた＝丸、✕ 取り消し＝赤い丸、click＝四角）
//   ・「コピー」で、全記録を文字にしてコピーする（チャットに貼って見せられる）
// 設定画面の「ペンの診断」で、入り切りする。切っている間は、何も受け取らず、何も変えない。
// 受け取るだけで、入力の邪魔はしない（passive・capture のリスナーと、pointer-events: none のパネルだけ）。

const STORAGE_KEY_DIAG = 'flashmemo_diag';
const DIAG_MAX_LINES = 800;    // 持っておく行数（古いものから捨てる）
const DIAG_SHOW_LINES = 36;    // 画面に出す行数
const DIAG_COLORS = {
  pen: '#2563eb', touch: '#16a34a', mouse: '#64748b', click: '#d97706',
  canvas: '#7c3aed', app: '#0f172a', warn: '#dc2626', env: '#94a3b8'
};

const penDiag = {
  on: false,
  t0: 0,            // 最初に入れた時刻。記録の時刻は、ここからの秒
  lines: [],        // { t, kind, text }
  panel: null,
  list: null,
  status: null,
  folded: false,
  move: null,       // まとめている途中の pointermove
  moveTimer: null,
  renderTimer: null,
  statusTimer: null,
  onceKey: ''
};

function diagNow() { return performance.now(); }

function diagPush(kind, text, atMs) {
  const t = (((atMs === undefined ? diagNow() : atMs) - penDiag.t0) / 1000).toFixed(3);
  penDiag.lines.push({ t: t, kind: kind, text: text });
  if (penDiag.lines.length > DIAG_MAX_LINES) penDiag.lines.splice(0, penDiag.lines.length - DIAG_MAX_LINES);
  diagScheduleRender();
}

// 他のファイルから呼ぶ記録。診断が切れているときは、何もしない
function diagLog(kind, text) {
  if (!penDiag.on) return;
  diagFlushMove();   // 続いている pointermove は、別の記録が来る前にまとめて出す（順番が前後しないように）
  diagPush(kind, text);
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

// pointermove は数が多いので、続けて届いたものを1行にまとめる（触れている間＝移動、触れていない間＝ホバー）
function diagOnMove(e) {
  const key = e.pointerType + '#' + e.pointerId + '|' + (e.buttons > 0 ? 'move' : 'hover');
  const now = diagNow();
  const m = penDiag.move;
  if (m && m.key === key) {
    m.n++;
    m.x = e.clientX; m.y = e.clientY; m.target = e.target;
  } else {
    diagFlushMove();
    penDiag.move = { key: key, type: e.pointerType, id: e.pointerId, n: 1, at: now, x: e.clientX, y: e.clientY, target: e.target };
  }
  clearTimeout(penDiag.moveTimer);
  penDiag.moveTimer = setTimeout(diagFlushMove, 250);
}

function diagFlushMove() {
  const m = penDiag.move;
  if (!m) return;
  penDiag.move = null;
  clearTimeout(penDiag.moveTimer);
  const label = m.key.endsWith('|move') ? '…移動' : '…ホバー';
  diagPush(diagKindOf(m.type), label + ' ' + m.type + '#' + m.id + ' ×' + m.n +
    ' → (' + Math.round(m.x) + ',' + Math.round(m.y) + ') ' + diagDescribe(m.target), m.at);
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
const diagListenOpts = { capture: true, passive: true };

function diagAttach() {
  DIAG_POINTER_EVENTS.forEach(function (t) { document.addEventListener(t, diagOnPointer, diagListenOpts); });
  document.addEventListener('click', diagOnClick, diagListenOpts);
  document.addEventListener('visibilitychange', diagOnWindow, diagListenOpts);
  DIAG_WINDOW_EVENTS.forEach(function (t) { window.addEventListener(t, diagOnWindow); });
}

function diagDetach() {
  DIAG_POINTER_EVENTS.forEach(function (t) { document.removeEventListener(t, diagOnPointer, diagListenOpts); });
  document.removeEventListener('click', diagOnClick, diagListenOpts);
  document.removeEventListener('visibilitychange', diagOnWindow, diagListenOpts);
  DIAG_WINDOW_EVENTS.forEach(function (t) { window.removeEventListener(t, diagOnWindow); });
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
  head.appendChild(diagButton('コピー', diagCopy));
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
function diagText() {
  return penDiag.lines.map(function (l) { return l.t + ' [' + l.kind + '] ' + l.text; }).join('\n');
}

async function diagCopy() {
  diagFlushMove();
  const text = diagText();
  const n = penDiag.lines.length;
  try {
    await navigator.clipboard.writeText(text);
    diagSetStatus('✓ ' + n + '行をコピー');
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
    diagSetStatus(ok ? ('✓ ' + n + '行をコピー') : 'コピーできませんでした');
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
