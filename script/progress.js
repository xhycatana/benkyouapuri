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
  if (document.visibilityState === 'hidden') { saveProgress(); saveHistory(); }
});


// --- 全履歴ログ -------------------------------------------------------------
// 上の集計（progressStats）とは別に、解答1回ごとの記録を残す。
// 今は忘却曲線のパラメータを学習する材料として貯めておくだけで、
// アプリ自身はこのログを読み書きにも出題にも使わない。
// 月ごとのファイルに分けて非公開リポジトリへ送るので、集計と違って際限なく太らない。
// 同じ記録を二重に送っても大丈夫なよう、記録ごとに固有IDを持たせて、
// サーバー側では「置き換え」ではなく「IDで重複を除いてから追加」で合成する。

const STORAGE_KEY_HISTORY = 'flashmemo_history_pending';

let historyPending = [];     // まだ書き戻していない、解答1回ごとの記録
let historyDirty = false;
let historySaving = false;
let historyTimer = null;

function makeHistoryEntryId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function readLocalHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const j = raw ? JSON.parse(raw) : null;
    return Array.isArray(j) ? j : [];
  } catch (err) { return []; }
}

function writeLocalHistory() {
  try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyPending)); } catch (err) {}
}

// 起動時に、前回送りきれなかった分があれば読み込んで送信を試みる
function loadHistoryPending() {
  historyPending = readLocalHistory();
  if (historyPending.length > 0) {
    historyDirty = true;
    saveHistory();
  }
}

function recordHistoryEntry(entry) {
  historyPending.push(entry);
  historyDirty = true;
  writeLocalHistory();

  clearTimeout(historyTimer);
  historyTimer = setTimeout(saveHistory, 60000);
}

// 記録を、解答日時から決まる月（"YYYY-MM"）ごとに束ねる。
// オフラインの期間が月をまたいでいれば、3つ以上に分かれることもある。
function groupHistoryByMonth(entries) {
  const byMonth = {};
  entries.forEach(function (e) {
    const month = String(e.answered_at || '').slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(e);
  });
  return Object.keys(byMonth).map(function (month) {
    return { month: month, entries: byMonth[month] };
  });
}

async function saveHistory() {
  if (!historyDirty || historySaving) return;
  if (!getPassphrase()) return;
  clearTimeout(historyTimer);
  historySaving = true;

  // 送信中に新しい記録が増えても取りこぼさないよう、今ある分だけのスナップショットを送る
  const toSend = historyPending.slice();
  try {
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'history', groups: groupHistoryByMonth(toSend) })
    });
    // 送れた分だけ取り除く（送信中に増えた分は次回に回す）
    const sentIds = new Set(toSend.map(function (e) { return e.id; }));
    historyPending = historyPending.filter(function (e) { return !sentIds.has(e.id); });
    writeLocalHistory();
    historyDirty = historyPending.length > 0;
  } catch (err) {
    // 失敗しても端末には残っているので、次回の起動時に送り直される
  } finally {
    historySaving = false;
  }
}
