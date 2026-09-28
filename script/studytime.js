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
