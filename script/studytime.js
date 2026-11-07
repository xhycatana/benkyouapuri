// 毎日の勉強時間の記録と表示。
// ----------------------------------------------------------------------
// 出題・丸つけ中（isDrawingPhase）で、かつ画面が見えている間だけを数える。
// ホーム画面や使い方画面を開いたままにしている時間、アプリを背面に回した時間、
// 画面をロックしている時間は数えない。
//
// 履歴ログ（progress.js の historyPending）と同じ考え方で、数え終えた
// 区切り（チャンク）ごとに固有IDを付けて非公開リポジトリに書き戻す。
// 複数端末で同時に使っても、IDで重複を除いてから追加するので、
// 取りこぼしたり二重に数えたりしない（サーバー側は mergeHistoryEntries を共用）。

const STORAGE_KEY_STUDY_TIME = 'flashmemo_studytime_pending';

let studyTimePending = [];     // まだ書き戻していない区切りの記録 { id, date, seconds }
let studyTimeDirty = false;
let studyTimeSaving = false;
let studyTimeSaveTimer = null;

let studySessionStart = null;  // 今数えている区切りの開始時刻（Date.now()）。数えていなければ null
let studySessionDate = null;   // その区切りの日付（端末のローカル日付、"YYYY-MM-DD"）

function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function readLocalStudyTime() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STUDY_TIME);
    const j = raw ? JSON.parse(raw) : null;
    return Array.isArray(j) ? j : [];
  } catch (err) { return []; }
}

function writeLocalStudyTime() {
  try { localStorage.setItem(STORAGE_KEY_STUDY_TIME, JSON.stringify(studyTimePending)); } catch (err) {}
}

function loadStudyTimePending() {
  studyTimePending = readLocalStudyTime();
  if (studyTimePending.length > 0) {
    studyTimeDirty = true;
    saveStudyTime();
  }
}

// 出題・丸つけ中で、画面が見えているときだけ数える
function isStudyTimeActive() {
  return isDrawingPhase() && document.visibilityState === 'visible';
}

// 今数えている区切りを締めて、記録に積む
function flushStudySession() {
  if (studySessionStart === null) return;
  const seconds = Math.round((Date.now() - studySessionStart) / 1000);
  const date = studySessionDate;
  studySessionStart = null;
  studySessionDate = null;
  if (seconds <= 0) return;

  studyTimePending.push({ id: makeHistoryEntryId(), date: date, seconds: seconds });
  studyTimeDirty = true;
  writeLocalStudyTime();

  clearTimeout(studyTimeSaveTimer);
  studyTimeSaveTimer = setTimeout(saveStudyTime, 60000);
}

// 数えるべき状態かどうかを確かめ、始める・止める・日をまたいだら区切り直す。
// フェーズの切り替え・画面の表示状態が変わったとき（switchPhase, visibilitychange）に呼ぶ。
function updateStudyTimer() {
  const today = localDateKey(new Date());
  if (isStudyTimeActive()) {
    if (studySessionStart === null) {
      studySessionStart = Date.now();
      studySessionDate = today;
    } else if (studySessionDate !== today) {
      // 日をまたいで解き続けた場合、いったん前の日で締めて、新しい日で数え直す
      flushStudySession();
      studySessionStart = Date.now();
      studySessionDate = today;
    }
  } else {
    flushStudySession();
  }
}

// 日付をまたいだまま長時間開きっぱなしでも、締め忘れないように定期チェックする
setInterval(updateStudyTimer, 5 * 60 * 1000);

document.addEventListener('visibilitychange', function () {
  updateStudyTimer();
  if (document.visibilityState === 'hidden') saveStudyTime();
});

function groupStudyTimeByMonth(entries) {
  const byMonth = {};
  entries.forEach(function (e) {
    const month = String(e.date || '').slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(e);
  });
  return Object.keys(byMonth).map(function (month) { return { month: month, entries: byMonth[month] }; });
}

async function saveStudyTime() {
  if (!studyTimeDirty || studyTimeSaving) return;
  if (!getPassphrase()) return;
  clearTimeout(studyTimeSaveTimer);
  studyTimeSaving = true;

  const toSend = studyTimePending.slice();
  try {
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'studytime', groups: groupStudyTimeByMonth(toSend) })
    });
    const sentIds = new Set(toSend.map(function (e) { return e.id; }));
    studyTimePending = studyTimePending.filter(function (e) { return !sentIds.has(e.id); });
    writeLocalStudyTime();
    studyTimeDirty = studyTimePending.length > 0;
  } catch (err) {
    // 失敗しても端末には残っているので、次回に送り直される
  } finally {
    studyTimeSaving = false;
  }
}

// --- 書いた線の長さ ---
// 手書きで引いた線の長さ（画面上のピクセル）を、端末ごとに足し続ける。
// 実際の長さ（cm・m・km）にするには、その端末の画面の大きさが要る。ブラウザは画面の物理的な大きさを
// 教えてくれないので、本人が画面サイズ（インチ）を入力した端末だけ、長さを出す。
//   mm / px ＝ 25.4 × インチ ÷ 画面の対角線のピクセル数（入力したときの screen.width・screen.height から）
// 端末ごとの累計をそのまま上書きで送る（通信を取りこぼして再送しても、二重に数えない）。
const STORAGE_KEY_INK = 'flashmemo_ink';

// px: この端末の累計、sent: 送信済みの値、inch/diag: 入力された画面サイズ（無ければ null）、metaDirty: 画面サイズの変更を未送信
let inkState = { device: '', px: 0, sent: 0, inch: null, diag: null, metaDirty: false };
let inkLocalTimer = null;
let inkSendTimer = null;
let inkSaving = false;

try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_INK) || 'null');
  if (raw && typeof raw.device === 'string' && raw.device) {
    inkState.device = raw.device;
    inkState.px = Number(raw.px) > 0 ? Number(raw.px) : 0;
    inkState.sent = Number(raw.sent) > 0 ? Number(raw.sent) : 0;
    if (Number(raw.inch) > 0 && Number(raw.diag) > 0) {
      inkState.inch = Number(raw.inch);
      inkState.diag = Number(raw.diag);
    }
    inkState.metaDirty = !!raw.metaDirty;
  }
} catch (err) {}
if (!inkState.device) inkState.device = generateUUID();

// 画面のピクセル数。取れない環境（0 が返る）では、ウィンドウの大きさで代用する
function inkScreenSize() {
  return [screen.width || window.innerWidth, screen.height || window.innerHeight];
}

// 端末の種類と画面のピクセル数（向きによらない）。一覧で、どの端末か分かるようにするための名前
function inkDeviceName() {
  const ua = navigator.userAgent || '';
  let kind = 'PC';
  if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''))) kind = 'iPad';
  else if (/iPhone/.test(ua)) kind = 'iPhone';
  else if (/Android/.test(ua)) kind = 'Android';
  const w = inkScreenSize()[0], h = inkScreenSize()[1];
  return kind + '（' + Math.min(w, h) + '×' + Math.max(w, h) + '）';
}

function writeLocalInk() {
  clearTimeout(inkLocalTimer);
  inkLocalTimer = null;
  try { localStorage.setItem(STORAGE_KEY_INK, JSON.stringify(inkState)); } catch (err) {}
}

// 線を引くたびに呼ばれる。端末への書き込みは、続けて引く間はまとめて行う
function addInkLength(px) {
  if (!(px > 0)) return;
  inkState.px += px;
  if (inkLocalTimer === null) inkLocalTimer = setTimeout(writeLocalInk, 3000);
  if (inkSendTimer === null) inkSendTimer = setTimeout(saveInk, 60000);
}

async function saveInk() {
  clearTimeout(inkSendTimer);
  inkSendTimer = null;
  writeLocalInk();
  const needsSend = inkState.px > inkState.sent || inkState.metaDirty;
  if (inkSaving || !needsSend || !getPassphrase()) return;
  inkSaving = true;
  const sending = Math.round(inkState.px);
  const sendingMeta = inkState.metaDirty;
  const body = { kind: 'ink', device: inkState.device, px: sending, name: inkDeviceName() };
  if (inkState.inch > 0 && inkState.diag > 0) { body.inch = inkState.inch; body.diag = inkState.diag; }
  else if (sendingMeta) body.inch = null;   // 入力を消したときは、サーバー側の値も消す
  try {
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    inkState.sent = sending;
    if (sendingMeta) inkState.metaDirty = false;
    writeLocalInk();
  } catch (err) {
    // 失敗しても端末には残っているので、次の機会に送り直される
  } finally {
    inkSaving = false;
  }
}

// ミリメートル → 「1km234m5cm」。大きい単位が 0 のときは出さない（1m未満なら「8cm」）
function formatInkLength(mm) {
  const totalCm = Math.round(mm / 10);
  const km = Math.floor(totalCm / 100000);
  const m = Math.floor((totalCm % 100000) / 100);
  const cm = totalCm % 100;
  const parts = [];
  if (km > 0) parts.push(km + 'km');
  if (km > 0 || m > 0) parts.push(m + 'm');
  parts.push(cm + 'cm');
  return parts.join(' ');
}

// 入力された画面サイズから、1ピクセルが何ミリかを出す。画面サイズが無い端末は null
function inkMmPerPx(inch, diag) {
  return (inch > 0 && diag > 0) ? (25.4 * inch / diag) : null;
}

// 画面サイズ（インチ）の入力。いまの画面の対角線のピクセル数と一緒に控える。空にすると消す
function setInkScreenInch(value) {
  const v = parseFloat(value);
  if (Number.isFinite(v) && v >= 1 && v <= 100) {
    inkState.inch = v;
    inkState.diag = Math.round(Math.hypot(inkScreenSize()[0], inkScreenSize()[1]));
  } else {
    inkState.inch = null;
    inkState.diag = null;
  }
  inkState.metaDirty = true;
  writeLocalInk();
  saveInk().then(renderInkList);
  renderInkList();
}

// 実寸の確認用の定規。入力した画面サイズで「10cm」を画面に描く（収まらない画面では 5cm、2cm）。
// 本物の定規を当てて、同じ長さになっていれば、画面サイズが合っている。
// 入力の途中でも見えるよう、保存とは別に、いま入力欄にある値で描き直す
function renderInkRuler(inchValue) {
  studyInkRuler.innerHTML = '';
  const diag = Math.hypot(inkScreenSize()[0], inkScreenSize()[1]);
  const mmPerPx = inkMmPerPx(parseFloat(inchValue), diag);
  if (!mmPerPx) return;

  const room = Math.max(0, studyInkRuler.clientWidth - 8);
  const cmChoices = [10, 5, 2];
  const cm = cmChoices.find(function (c) { return c * 10 / mmPerPx <= room; }) || 1;
  const cmPx = 10 / mmPerPx;   // 1cm が何ピクセルか

  const ruler = document.createElement('div');
  ruler.className = 'relative';
  ruler.style.width = (cm * cmPx) + 'px';
  ruler.style.height = '14px';
  for (let i = 0; i <= cm; i++) {
    const tick = document.createElement('div');
    tick.className = 'absolute bottom-0 bg-black';
    tick.style.left = (i * cmPx) + 'px';
    tick.style.width = '1px';
    tick.style.height = (i === 0 || i === cm) ? '14px' : '8px';
    ruler.appendChild(tick);
  }
  const base = document.createElement('div');
  base.className = 'absolute bottom-0 left-0 bg-black';
  base.style.width = (cm * cmPx + 1) + 'px';
  base.style.height = '1px';
  ruler.appendChild(base);

  const note = document.createElement('div');
  note.className = 'text-[10px] text-slate-400 pt-1';
  note.textContent = cm + 'cm（1cmごとに目盛り）。本物の定規を当てて、同じ長さか確かめてください。' +
    '定規より線が短いときは画面サイズを小さく、長いときは大きくしてください。';
  studyInkRuler.appendChild(ruler);
  studyInkRuler.appendChild(note);
}

let inkServerDevices = {};   // サーバーから読んだ、端末ごとの記録

function normalizeInkEntry(v) {
  if (typeof v === 'number') return { px: v, name: '', inch: null, diag: null };
  return v && typeof v === 'object' ? v : { px: 0, name: '', inch: null, diag: null };
}

// 端末ごとの一覧。この端末は手元の値を優先する。長さは、画面サイズを入力した端末だけ出す
function renderInkList() {
  studyInkList.innerHTML = '';
  const rows = [];
  Object.keys(inkServerDevices).forEach(function (id) {
    if (id === inkState.device) return;
    const e = normalizeInkEntry(inkServerDevices[id]);
    rows.push({ id: id, name: e.name || '別の端末', px: Number(e.px) || 0, mm: inkMmPerPx(e.inch, e.diag), self: false });
  });
  const mine = normalizeInkEntry(inkServerDevices[inkState.device]);
  rows.unshift({ id: inkState.device, name: inkDeviceName(), px: Math.max(inkState.px, Number(mine.px) || 0),
                 mm: inkMmPerPx(inkState.inch, inkState.diag), self: true });

  // 同じ名前の端末が複数あるときは、(2) (3) と番号を付けて区別する
  const seen = {};
  rows.forEach(function (r) {
    seen[r.name] = (seen[r.name] || 0) + 1;
    if (seen[r.name] > 1) r.name += ' (' + seen[r.name] + ')';
  });

  let totalMm = 0, counted = 0;
  rows.forEach(function (r) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2';

    const label = document.createElement('span');
    label.textContent = r.name + (r.self ? '（この端末）' : '');
    row.appendChild(label);

    const right = document.createElement('span');
    right.className = 'flex items-center gap-2';
    if (r.self) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';   // 11インチ表記でも実際は10.88インチ、のように、少数第2位で合わせられるように
      input.min = '1';
      input.max = '100';
      input.placeholder = '画面サイズ';
      input.value = inkState.inch || '';
      input.className = 'w-20 p-1 border border-slate-300 text-[10px] text-right focus:outline-none focus:border-black';
      input.title = 'この端末の画面サイズ（対角線の長さ、インチ）。入力すると、この端末で書いた線の長さを出せます';
      input.addEventListener('input', function () { renderInkRuler(input.value); });   // 入力の途中でも、定規だけ描き直す
      input.addEventListener('change', function () { setInkScreenInch(input.value); });
      right.appendChild(input);
      right.appendChild(document.createTextNode('インチ'));
    }
    const value = document.createElement('span');
    value.className = 'font-mono text-slate-600';
    if (r.mm) {
      const mm = r.px * r.mm;
      value.textContent = formatInkLength(mm);
      totalMm += mm;
      counted++;
    } else {
      value.textContent = r.self ? '画面サイズを入れると表示' : '画面サイズ未入力';
      value.className = 'text-slate-300';
    }
    right.appendChild(value);
    row.appendChild(right);
    studyInkList.appendChild(row);
  });

  if (counted >= 2) {
    const sum = document.createElement('div');
    sum.className = 'flex items-center justify-between border-t border-slate-200 pt-1 text-slate-500';
    sum.innerHTML = '<span>合計（画面サイズを入力した端末）</span>';
    const v = document.createElement('span');
    v.className = 'font-mono';
    v.textContent = formatInkLength(totalMm);
    sum.appendChild(v);
    studyInkList.appendChild(sum);
  }
  renderInkRuler(inkState.inch);
}

async function renderInkTotal() {
  renderInkList();   // 通信できなくても、この端末の分は見えるように
  try {
    const data = await api('/api/questions?kind=ink');
    inkServerDevices = (data && data.devices) || {};
    renderInkList();
  } catch (err) {}
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') saveInk();
});

// --- 表示 ---

function monthKeysBack(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    d.setDate(1);            // 月末日から1つ戻すと月が2つ戻ることがあるので、先に1日にしておく
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function formatStudyDuration(totalSeconds) {
  if (totalSeconds < 60) return '1分未満';
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return h > 0 ? (h + '時間' + (m > 0 ? m + '分' : '')) : (m + '分');
}

function formatStudyDateLabel(key) {
  const parts = key.split('-').map(Number);
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
  return parts[1] + '/' + parts[2] + '（' + week + '）';
}

async function renderStudyTimeView() {
  renderInkTotal();
  studyTimeTotal.textContent = '-';
  studyTimeList.innerHTML = '<p class="text-slate-400">読み込み中…</p>';

  const days = {};   // "YYYY-MM-DD" -> 秒
  function addEntries(list) {
    (list || []).forEach(function (e) {
      if (!e || !e.date) return;
      days[e.date] = (days[e.date] || 0) + (e.seconds || 0);
    });
  }
  addEntries(studyTimePending);   // まだ送れていない今日の分もその場で見えるように

  let cumulativeSeconds = studyTimePending.reduce(function (a, e) { return a + e.seconds; }, 0);
  try {
    for (const month of monthKeysBack(2)) {   // 今月・先月で、直近30日をまかなう
      const data = await api('/api/questions?kind=studytime&month=' + month);
      addEntries(data && data.entries);
    }
    const totalData = await api('/api/questions?kind=studytimetotal');
    cumulativeSeconds += (totalData && totalData.total_seconds) || 0;
  } catch (err) {
    if (err.unauthorized) return;
    studyTimeList.innerHTML = '<p class="text-red-600">' + err.message + '</p>';
    return;
  }

  studyTimeCumulative.textContent = formatStudyDuration(cumulativeSeconds);

  // 直近30日は、記録のある日だけでなく、暦の上での30日間として固定する
  // （途中に何日も解かない日があっても、「30日」の意味がずれないように）
  const window30 = last30DayKeys();
  const total30 = window30.reduce(function (a, k) { return a + (days[k] || 0); }, 0);
  studyTimeTotal.textContent = formatStudyDuration(total30);

  renderStudyTimeChart(window30, days);

  studyTimeList.innerHTML = '';
  const nonZeroKeys = window30.filter(function (k) { return days[k] > 0; }).reverse();   // 新しい日から
  if (nonZeroKeys.length === 0) {
    studyTimeList.innerHTML = '<p class="text-slate-400">まだ記録がありません。出題・丸つけをすると記録されます。</p>';
    return;
  }
  const todayKey = localDateKey(new Date());
  nonZeroKeys.forEach(function (key) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between py-1 border-b border-slate-100';

    const label = document.createElement('span');
    label.textContent = formatStudyDateLabel(key) + (key === todayKey ? '（今日）' : '');

    const value = document.createElement('span');
    value.className = 'font-mono text-slate-600';
    value.textContent = formatStudyDuration(days[key]);

    row.appendChild(label);
    row.appendChild(value);
    studyTimeList.appendChild(row);
  });
}

function last30DayKeys() {
  const out = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    out.push(localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

// 文字を使わず、棒の高さだけで日ごとの量を見せる（古い日 → 新しい日の順、一番右が今日）。
// 記録が無い日も、位置が飛ばないよう薄い印を残す。
// 棒の高さを、その日その日の最大値ではなく、きりのいい時間を軸の上限にして決める。
// そうしないと「一番長い日」が常に満タンに見えてしまい、それが何時間かが読み取れない。
function niceAxisMaxSeconds(seconds) {
  const stepsMinutes = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1080, 1440];
  for (const m of stepsMinutes) { if (seconds <= m * 60) return m * 60; }
  return Math.ceil(seconds / 3600) * 3600;
}

function renderStudyTimeChart(keys, days) {
  const rawMax = Math.max(0, ...keys.map(function (k) { return days[k] || 0; }));
  const axisMax = niceAxisMaxSeconds(Math.max(rawMax, 60));
  const todayKey = localDateKey(new Date());

  // 基準の横線を2本（半分・満杯）引き、その時間を左に添える。
  // これが無いと、棒どうしの比較はできても「それが何時間か」が読み取れない。
  // 満杯の線は箱の一番上ぎりぎりなので、文字を線の上に半分はみ出させず、線から下向きに収める
  // （はみ出すと、上に置いた別の箱の文字と重なって見えることがある）。
  studyTimeChartGrid.innerHTML = '';
  [0.5, 1].forEach(function (frac) {
    const line = document.createElement('div');
    line.className = 'absolute left-0 right-0 border-t border-slate-200';
    line.style.bottom = (frac * 100) + '%';

    const label = document.createElement('span');
    label.className = 'absolute right-full mr-1 whitespace-nowrap text-[9px] font-mono text-slate-400 ' +
      (frac >= 1 ? 'top-0' : '-translate-y-1/2');
    label.textContent = formatStudyDuration(Math.round(axisMax * frac));
    line.appendChild(label);
    studyTimeChartGrid.appendChild(line);
  });

  studyTimeChart.innerHTML = '';
  keys.forEach(function (key) {
    const seconds = days[key] || 0;
    const bar = document.createElement('div');
    const heightPct = seconds > 0 ? Math.max(2, Math.round((seconds / axisMax) * 100)) : 1;
    bar.style.height = heightPct + '%';
    bar.className = 'flex-1 ' + (seconds > 0 ? 'bg-black' : 'bg-slate-200') +
      (key === todayKey ? ' outline outline-1 outline-slate-400' : '');
    bar.title = formatStudyDateLabel(key) + '：' + (seconds > 0 ? formatStudyDuration(seconds) : '0分');
    studyTimeChart.appendChild(bar);
  });
}

btnShowStudyTime.addEventListener('click', () => switchPhase('studytime'));
btnStudyTimeBack.addEventListener('click', () => switchPhase('import'));
