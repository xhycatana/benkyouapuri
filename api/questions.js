// 問題集の読み書き。非公開リポジトリとのやり取りは、すべてこのサーバー側で行う。
// トークンはここ（Vercel の環境変数）にしか存在せず、ブラウザには一切渡さない。
//
//   GET  /api/questions                -> 問題集の一覧（index.json）
//   GET  /api/questions?path=世界史/…   -> 問題集1つの中身
//   GET  /api/questions?rebuild=1      -> リポジトリを走査して一覧を作り直す
//   GET  /api/questions?strip_tags=1   -> 問題集のファイルから、廃止したタグの項目を消す（一度だけ）
//   GET  /api/questions?kind=shortcuts -> 選択のショートカット
//   GET  /api/questions?kind=progress  -> 解答履歴の集計
//   GET  /api/questions?kind=history&month=YYYY-MM -> 解答ログ（月ごと）
//   GET  /api/questions?kind=studytime&month=YYYY-MM -> 勉強時間の記録（月ごと）
//   GET  /api/questions?kind=studytimetotal -> 勉強時間の累計（全期間）
//   GET  /api/questions?kind=ink       -> 書いた線の長さ（端末ごとの累計）
//   GET  /api/questions?kind=snapshots -> 記憶の推移（日ごとの問題数・合計知識量）
//   POST /api/questions                -> 問題集を保存する
//   POST /api/questions {kind:'snapshot'}       -> 日ごとの問題数・合計知識量を保存する（同じ日は上書き。final の日は確定済み）
//   POST /api/questions {kind:'ink'}            -> 書いた線の長さと画面サイズを、端末ごとに保存する
//   POST /api/questions {kind:'move'}           -> 問題集・フォルダを別の場所へ移す（フォルダ名の変更も同じ）。1回のコミットにまとめる。keepOrder で並びを保つ
//   POST /api/questions {kind:'shortcuts'}      -> 選択のショートカット一覧を保存する（まるごと置き換え）
//   POST /api/questions {kind:'order'}          -> 一覧の並び順を保存する
//   POST /api/questions {kind:'meta'}           -> 問題集の名前・逆向き許可だけを変える
//   POST /api/questions {kind:'progress-reset'} -> 指定した問題の成績を消す
//   DELETE /api/questions?path=…       -> 問題集を削除する
//
// いずれも x-passphrase ヘッダーでの合言葉が必要。

const crypto = require('crypto');

const REPO = process.env.QUESTIONS_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PASS = process.env.APP_PASSPHRASE;

const SETS_DIR = 'sets';           // 問題集の置き場所
const INDEX_FILE = 'index.json';   // 一覧。保存のたびに更新する
const PROGRESS_FILE = 'progress.json'; // 解答履歴の集計。問題ごとの成績
const HISTORY_DIR = 'history';     // 解答ログ（1回ごと）。月ごとのファイルに分ける
const STUDY_TIME_DIR = 'studytime'; // 勉強時間の記録（区切りごと）。月ごとのファイルに分ける
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- 合言葉の確認 ---------------------------------------------------------
// 文字列比較にかかる時間から中身を推測されないよう、長さを揃えて比較する。
function passOk(given) {
  if (!PASS || typeof given !== 'string' || given.length === 0) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(PASS).digest();
  return crypto.timingSafeEqual(a, b);
}

// --- GitHub API -----------------------------------------------------------
function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function gh(url, init) {
  const r = await fetch(url, Object.assign({}, init, {
    headers: Object.assign({
      'Authorization': 'Bearer ' + TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'benkyouapuri',
      'Content-Type': 'application/json'
    }, (init && init.headers) || {})
  }));
  return r;
}

// ファイルを読む。無ければ null（エラーにしない）
async function readFile(path) {
  const r = await gh('https://api.github.com/repos/' + REPO + '/contents/' + encPath(path));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub 読み取り失敗 (' + r.status + ') ' + path);
  const j = await r.json();
  return {
    sha: j.sha,
    text: Buffer.from(j.content || '', 'base64').toString('utf8')
  };
}

async function writeFile(path, text, message) {
  const existing = await readFile(path);
  const body = {
    message: message,
    content: Buffer.from(text, 'utf8').toString('base64')
  };
  if (existing) body.sha = existing.sha;

  const r = await gh('https://api.github.com/repos/' + REPO + '/contents/' + encPath(path), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('GitHub 書き込み失敗 (' + r.status + ') ' + t.slice(0, 200));
  }
  return r.json();
}

async function deleteFile(path, message) {
  const existing = await readFile(path);
  if (!existing) return false;
  const r = await gh('https://api.github.com/repos/' + REPO + '/contents/' + encPath(path), {
    method: 'DELETE',
    body: JSON.stringify({ message: message, sha: existing.sha })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('GitHub 削除失敗 (' + r.status + ') ' + t.slice(0, 200));
  }
  return true;
}

// --- 一覧の読み書き -------------------------------------------------------
async function readIndex() {
  const f = await readFile(INDEX_FILE);
  if (!f) return { updated_at: null, sets: [] };
  try {
    const j = JSON.parse(f.text);
    if (!Array.isArray(j.sets)) j.sets = [];
    return j;
  } catch (err) {
    return { updated_at: null, sets: [] };
  }
}

async function writeIndex(index) {
  // 並び順は「追加した順」が既定で、管理画面で入れ替えた順もそのまま保つ。ここでは並べ替えない。
  index.updated_at = new Date().toISOString();
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), '一覧を更新');
}

// リポジトリを走査して一覧を作り直す。
// PC から直接ファイルを追加した場合など、一覧とずれたときに使う。
// リポジトリを走査して、問題集のファイル（sets/…json）の一覧を返す
async function listSetFiles() {
  const repoInfo = await gh('https://api.github.com/repos/' + REPO);
  if (!repoInfo.ok) throw new Error('リポジトリ情報を取得できません (' + repoInfo.status + ')');
  const branch = (await repoInfo.json()).default_branch;

  const r = await gh('https://api.github.com/repos/' + REPO +
                     '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
  if (!r.ok) throw new Error('ファイル一覧を取得できません (' + r.status + ')');
  const tree = await r.json();

  return (tree.tree || []).filter(function (n) {
    return n.type === 'blob' && n.path.startsWith(SETS_DIR + '/') && n.path.endsWith('.json');
  });
}

// 廃止したタグを、問題集のファイルから消す。消したあと、一覧も作り直す。一度だけ実行すればよい
async function stripTags() {
  const files = await listSetFiles();
  let stripped = 0;
  for (const n of files) {
    const f = await readFile(n.path);
    if (!f) continue;
    let j;
    try { j = JSON.parse(f.text); } catch (err) { continue; }
    if (!Object.prototype.hasOwnProperty.call(j, 'tags')) continue;
    delete j.tags;
    await writeFile(n.path, JSON.stringify(j, null, 2), 'タグを削除: ' + n.path.slice(SETS_DIR.length + 1));
    stripped++;
  }
  const index = await rebuildIndex();
  return { stripped: stripped, count: index.sets.length };
}

async function rebuildIndex() {
  const files = await listSetFiles();

  const sets = [];
  // 一度に大量のリクエストを投げないよう、少しずつ処理する
  for (let i = 0; i < files.length; i += 8) {
    const chunk = files.slice(i, i + 8);
    const loaded = await Promise.all(chunk.map(async function (n) {
      try {
        const f = await readFile(n.path);
        if (!f) return null;
        const j = JSON.parse(f.text);
        const rel = n.path.slice(SETS_DIR.length + 1).replace(/\.json$/, '');
        return {
          path: rel,
          title: j.title || rel.split('/').pop(),
          allowSwap: !!j.allowSwap,
          count: Array.isArray(j.questions) ? j.questions.length : 0,
          updated_at: j.updated_at || null
        };
      } catch (err) {
        return null;
      }
    }));
    loaded.forEach(function (x) { if (x) sets.push(x); });
  }

  // 作り直しで並び順が壊れないよう、前の一覧にあった問題集は前の順のまま先に並べ、新しく見つかったものを後ろに足す
  const before = await readIndex();
  const rank = {};
  before.sets.forEach(function (s, i) { rank[s.path] = i; });
  const known = sets.filter(function (s) { return rank[s.path] !== undefined; })
    .sort(function (a, b) { return rank[a.path] - rank[b.path]; });
  const fresh = sets.filter(function (s) { return rank[s.path] === undefined; })
    .sort(function (a, b) { return a.path.localeCompare(b.path, 'ja'); });

  const index = { updated_at: null, sets: known.concat(fresh) };
  await writeIndex(index);
  return index;
}

// --- 解答履歴 -------------------------------------------------------------
// 問題のIDごとに、正解数・不正解数・記憶の寿命・最終解答日時を持つ。
// 端末をまたいでも引き継げるよう、問題集と同じ非公開リポジトリに置く。
async function readProgress() {
  const f = await readFile(PROGRESS_FILE);
  if (!f) return { updated_at: null, stats: {} };
  try {
    const j = JSON.parse(f.text);
    if (!j.stats || typeof j.stats !== 'object') j.stats = {};
    return j;
  } catch (err) {
    return { updated_at: null, stats: {} };
  }
}

// 端末を複数使っても取りこぼさないよう、置き換えではなく合成する。
// 同じ問題については、最後に解いた日時が新しい方を採用する。
function mergeStats(base, incoming) {
  Object.keys(incoming || {}).forEach(function (id) {
    const a = base[id];
    const b = incoming[id];
    if (!b || typeof b !== 'object') return;

    const entry = {
      correct: Math.max(0, parseInt(b.correct, 10) || 0),
      incorrect: Math.max(0, parseInt(b.incorrect, 10) || 0),
      lifespan: Number(b.lifespan) > 0 ? Number(b.lifespan) : 1.0,
      last_answered_at: b.last_answered_at || null
    };

    if (!a) { base[id] = entry; return; }

    const ta = a.last_answered_at ? Date.parse(a.last_answered_at) : 0;
    const tb = entry.last_answered_at ? Date.parse(entry.last_answered_at) : 0;
    if (tb >= ta) base[id] = entry;
  });
  return base;
}

// 指定した問題の成績を消す。逆向き出題の成績（IDの末尾に :swap が付く）も一緒に消す。
function removeStats(stats, ids) {
  let removed = 0;
  ids.forEach(function (id) {
    [id, id + ':swap'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(stats, key)) { delete stats[key]; removed++; }
    });
  });
  return removed;
}

function cleanIds(ids) {
  return (Array.isArray(ids) ? ids : []).filter(function (x) {
    return typeof x === 'string' && x.length > 0;
  });
}

// --- 全履歴ログ（1回ごと。忘却曲線のパラメータ学習用の材料） ----------------
// 月ごとのファイルに分けて、集計と違って際限なく太らないようにする。
function historyFile(month) {
  return HISTORY_DIR + '/' + month + '.json';
}

async function readHistoryMonth(month) {
  const f = await readFile(historyFile(month));
  if (!f) return { updated_at: null, entries: [] };
  try {
    const j = JSON.parse(f.text);
    if (!Array.isArray(j.entries)) j.entries = [];
    return j;
  } catch (err) {
    return { updated_at: null, entries: [] };
  }
}

function sanitizeHistoryEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const id = (typeof e.id === 'string' && e.id) ? e.id : null;
  const questionId = (typeof e.question_id === 'string' && e.question_id) ? e.question_id : null;
  const answeredAt = (typeof e.answered_at === 'string' && !isNaN(Date.parse(e.answered_at))) ? e.answered_at : null;
  if (!id || !questionId || !answeredAt) return null;
  return {
    id: id,
    question_id: questionId,
    answered_at: answeredAt,
    correct: !!e.correct,
    lifespan_before: (typeof e.lifespan_before === 'number' && e.lifespan_before > 0) ? e.lifespan_before : null,
    elapsed_days: (typeof e.elapsed_days === 'number' && e.elapsed_days >= 0) ? e.elapsed_days : null
  };
}

// 端末を複数使っても取りこぼしたり重複したりしないよう、
// 「置き換え」ではなく「id で重複を除いてから追加」で合成する。
function mergeHistoryEntries(base, incoming) {
  const seen = new Set(base.map(function (e) { return e.id; }));
  incoming.forEach(function (e) {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    base.push(e);
  });
  return base;
}

// --- 毎日の勉強時間（区切りごと。1件が「数え続けた一続きの時間」） -----------
// 履歴ログと同じ形（月ごとのファイル、id で重複除去）なので、合成には
// 上の mergeHistoryEntries をそのまま使う。
function studyTimeFile(month) {
  return STUDY_TIME_DIR + '/' + month + '.json';
}

// 累計（全期間の合計）。月ごとのファイルを毎回全部読んで合計しなくても済むよう、
// 新しく増えた分をそのつど足しておく1つの小さなファイルに持たせる。
// 月ごとのファイルは消さないので、これは「持っている記録の合計」を先に計算してあるだけで、
// 別の記録というわけではない。
const STUDY_TIME_TOTAL_FILE = STUDY_TIME_DIR + '/total.json';

async function readStudyTimeTotal() {
  const f = await readFile(STUDY_TIME_TOTAL_FILE);
  if (!f) return { total_seconds: 0, updated_at: null };
  try {
    const j = JSON.parse(f.text);
    return { total_seconds: Number(j.total_seconds) > 0 ? Number(j.total_seconds) : 0, updated_at: j.updated_at || null };
  } catch (err) {
    return { total_seconds: 0, updated_at: null };
  }
}

async function addStudyTimeTotal(addSeconds) {
  if (!(addSeconds > 0)) return;
  const current = await readStudyTimeTotal();
  const saved = { total_seconds: current.total_seconds + addSeconds, updated_at: new Date().toISOString() };
  await writeFile(STUDY_TIME_TOTAL_FILE, JSON.stringify(saved, null, 2), '勉強時間の累計を更新');
}

// --- 1回のコミットで、複数のファイルを書き換える（Git Data API） ---
// 問題集1冊ごとに「書く→消す→一覧を書く」をすると、フォルダ名を1つ変えるだけで、冊数×3回前後のコミットになる。
// ここでは、いまの最新のコミットを土台に、変更をまとめた新しいコミットを1つ作って、ブランチをそこへ進める。
// ファイルの中身は読み込まず、すでにあるデータ（blob）を別の場所に付け替えるだけなので、冊数が多くても通信の数は同じ。
// ブランチを進めるのが最後の1回だけなので、途中で失敗しても何も変わらない（半端に移った状態にならない）。
async function ghJson(url, init) {
  const r = await gh(url, init);
  if (!r.ok) {
    const t = await r.text();
    const e = new Error('GitHub ' + ((init && init.method) || 'GET') + ' 失敗 (' + r.status + ') ' + t.slice(0, 200));
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// build(snap) は、土台のコミットの中身（snap.files: パス → {sha, mode}、snap.readText(sha): 中身の文字列）を見て、
//   { fail: { status, error } }                        … 何も書かずに断る
//   { changes: [...], result: … }                      … changes を1つのコミットにする
// を返す。changes の要素: { path, text } 書く／置き換える、{ path, remove: true } 消す、{ path, sha, mode } 同じ中身を別の場所へ。
// 別の書き込みが先に入っていたときは、土台を取り直して、build からやり直す（最大3回）。
async function commitInOne(message, build) {
  const base = 'https://api.github.com/repos/' + REPO;
  for (let attempt = 0; attempt < 3; attempt++) {
    const info = await ghJson(base);
    const branch = info.default_branch;
    const ref = await ghJson(base + '/git/ref/heads/' + encPath(branch));
    const headSha = ref.object.sha;
    const head = await ghJson(base + '/git/commits/' + headSha);
    const treeSha = head.tree.sha;
    const tree = await ghJson(base + '/git/trees/' + treeSha + '?recursive=1');
    if (tree.truncated) throw new Error('ファイルが多すぎて、一度に扱えません。');
    const files = {};
    (tree.tree || []).forEach(function (n) { if (n.type === 'blob') files[n.path] = { sha: n.sha, mode: n.mode }; });

    const snap = {
      files: files,
      readText: async function (sha) {
        const b = await ghJson(base + '/git/blobs/' + sha);
        return Buffer.from(b.content || '', b.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
      }
    };
    const out = await build(snap);
    if (out.fail) return { fail: out.fail };

    const entries = [];
    for (const c of out.changes) {
      if (c.remove) {
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      } else if (c.sha) {
        entries.push({ path: c.path, mode: c.mode || '100644', type: 'blob', sha: c.sha });
      } else {
        const blob = await ghJson(base + '/git/blobs', { method: 'POST', body: JSON.stringify({ content: c.text, encoding: 'utf-8' }) });
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    const newTree = await ghJson(base + '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree: entries }) });
    const commit = await ghJson(base + '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: message, tree: newTree.sha, parents: [headSha] })
    });
    const r = await gh(base + '/git/refs/heads/' + encPath(branch), {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
    if (r.ok) return { result: out.result };
    if (r.status === 422 || r.status === 409) continue;   // 別の書き込みが先に入った。取り直してやり直す
    const text = await r.text();
    throw new Error('GitHub 更新失敗 (' + r.status + ') ' + text.slice(0, 200));
  }
  throw new Error('ほかの書き込みと重なって、移せませんでした。もう一度お試しください（何も移していません）。');
}

// --- 階層の移動 ---
// 問題集1つ、またはフォルダ（中の問題集すべて）を、別の場所へ移す。フォルダ名の変更も、これで行う。
// 問題集のファイルを新しい場所へ付け替え、古い場所を消し、一覧（index.json）とショートカットの場所も直す。
// これらすべてを、1回のコミットにまとめる（commitInOne）。成績は問題の id で持っているので、場所が変わっても影響しない。
// 途中で失敗したときは、何も移っていない。
function dirOf(p) { return p.split('/').slice(0, -1).join('/'); }

// opts.keepOrder: 一覧での並びを変えない（フォルダ名の変更のように、親のフォルダが変わらない移動のとき）
async function moveSets(from, to, opts) {
  opts = opts || {};
  if (from === to) return { status: 400, error: '移動先が、いまの場所と同じです。' };

  const out = await commitInOne('移動: ' + from + ' → ' + to, async function (snap) {
    // 一覧とショートカットは、これから書き換える土台のコミットから読む（途中で別の書き込みが入っても、古い内容で上書きしないため）
    let index = { updated_at: null, sets: [] };
    if (snap.files[INDEX_FILE]) {
      try {
        const j = JSON.parse(await snap.readText(snap.files[INDEX_FILE].sha));
        if (Array.isArray(j.sets)) index = j;
      } catch (err) {}
    }

    const isSet = index.sets.some(function (s) { return s.path === from; });
    const moving = isSet
      ? index.sets.filter(function (s) { return s.path === from; })
      : index.sets.filter(function (s) { return s.path.startsWith(from + '/'); });
    if (moving.length === 0) return { fail: { status: 404, error: '見つかりません: ' + from } };
    if (!isSet && to.startsWith(from + '/')) return { fail: { status: 400, error: 'フォルダを、自分自身の中へは移せません。' } };

    const plan = moving.map(function (s) { return { oldPath: s.path, newPath: to + s.path.slice(from.length) }; });
    const movingPaths = {};
    plan.forEach(function (p) { movingPaths[p.oldPath] = true; });
    const allPaths = index.sets.map(function (s) { return s.path; });

    // 移した先で、同じ場所に問題集がある／問題集とフォルダの名前がぶつかるときは、何も移さない
    for (const p of plan) {
      const parts = p.newPath.split('/');
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join('/');
        if (allPaths.indexOf(ancestor) !== -1 && !movingPaths[ancestor]) {
          return { fail: { status: 409, error: '「' + ancestor + '」は問題集なので、その中へは移せません。' } };
        }
      }
      const clash = allPaths.some(function (q) { return !movingPaths[q] && (q === p.newPath || q.startsWith(p.newPath + '/')); });
      if (clash || snap.files[SETS_DIR + '/' + p.newPath + '.json']) {
        return { fail: { status: 409, error: '移動先に、同じ名前の問題集かフォルダがあります: ' + p.newPath } };
      }
      if (!snap.files[SETS_DIR + '/' + p.oldPath + '.json']) {
        return { fail: { status: 404, error: '問題集のファイルが見つかりません: ' + p.oldPath + '（一覧とずれています。一覧の作り直しで直ります）' } };
      }
    }

    const changes = [];
    plan.forEach(function (p) {
      const old = snap.files[SETS_DIR + '/' + p.oldPath + '.json'];
      changes.push({ path: SETS_DIR + '/' + p.newPath + '.json', sha: old.sha, mode: old.mode });   // 中身はそのまま、別の場所へ
      changes.push({ path: SETS_DIR + '/' + p.oldPath + '.json', remove: true });
    });

    // 一覧: 場所を直す。親のフォルダが変わるときは、移した先のいちばん下に並べる
    const byOld = {};
    plan.forEach(function (p) { byOld[p.oldPath] = p.newPath; });
    index.sets.forEach(function (s) { if (byOld[s.path]) s.path = byOld[s.path]; });
    if (!opts.keepOrder && dirOf(from) !== dirOf(to)) {
      const moved = index.sets.filter(function (s) { return plan.some(function (p) { return p.newPath === s.path; }); });
      index.sets = index.sets.filter(function (s) { return moved.indexOf(s) === -1; }).concat(moved);
    }
    index.updated_at = new Date().toISOString();
    changes.push({ path: INDEX_FILE, text: JSON.stringify(index, null, 2) });

    // ショートカット: 中の場所も直す（変わるものがあるときだけ書く）
    if (snap.files[SHORTCUT_FILE]) {
      let sc = null;
      try { sc = JSON.parse(await snap.readText(snap.files[SHORTCUT_FILE].sha)); } catch (err) {}
      if (sc) {
        const list = sanitizeShortcuts(sc.shortcuts);
        let changed = false;
        list.forEach(function (s) {
          s.items.forEach(function (it) {
            if (byOld[it.path]) { it.path = byOld[it.path]; changed = true; }
          });
        });
        if (changed) changes.push({ path: SHORTCUT_FILE, text: JSON.stringify({ updated_at: new Date().toISOString(), shortcuts: list }, null, 2) });
      }
    }

    return { changes: changes, result: plan };
  });

  if (out.fail) return { status: out.fail.status, error: out.fail.error };
  return { status: 200, moved: out.result.length, plan: out.result.map(function (p) { return { from: p.oldPath, to: p.newPath }; }) };
}

// --- 選択のショートカット ---
// 「期末範囲」のように、問題集の選び方（どの問題集を、そのまま／逆向きで選ぶか）に名前を付けて持つ。
// 問題集の場所（パス）で持つ。問題集の場所を変えたときは、ここの場所も一緒に直す。
const SHORTCUT_FILE = 'shortcuts.json';

function sanitizeShortcuts(list) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 100).forEach(function (s) {
    if (!s || typeof s !== 'object') return;
    const id = (typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id)) ? s.id : null;
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 40) : '';
    if (!id || !name) return;
    const items = [];
    (Array.isArray(s.items) ? s.items : []).slice(0, 1000).forEach(function (it) {
      const path = it && cleanPath(it.path);
      if (!path || !(it.normal || it.swap)) return;
      items.push({ path: path, normal: !!it.normal, swap: !!it.swap });
    });
    out.push({ id: id, name: name, items: items });
  });
  return out;
}

async function readShortcuts() {
  const f = await readFile(SHORTCUT_FILE);
  if (!f) return { updated_at: null, shortcuts: [] };
  try {
    const j = JSON.parse(f.text);
    return { updated_at: j.updated_at || null, shortcuts: sanitizeShortcuts(j.shortcuts) };
  } catch (err) {
    return { updated_at: null, shortcuts: [] };
  }
}

// --- 記憶の推移（日ごとの記録） ---
// 1日に1件。その日の問題数（全問題集の合計）と、合計知識量（全問題の「いま思い出せる確率」の合計）。
// 平均正答確率は 合計知識量 ÷ 問題数 で出せるので、持たない。
// 計算は、解答履歴とすべての問題集を見られる端末側（ブラウザ）で行い、ここでは受け取った値を日付ごとに置き換えて持つ。
const SNAPSHOT_FILE = STUDY_TIME_DIR + '/memory.json';

async function readSnapshots() {
  const f = await readFile(SNAPSHOT_FILE);
  if (!f) return { updated_at: null, entries: [] };
  try {
    const j = JSON.parse(f.text);
    return { updated_at: j.updated_at || null, entries: Array.isArray(j.entries) ? j.entries : [] };
  } catch (err) {
    return { updated_at: null, entries: [] };
  }
}

function sanitizeSnapshotEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const date = typeof e.date === 'string' ? e.date : '';
  const total = Number(e.total);
  const knowledge = Number(e.knowledge);
  if (!DATE_RE.test(date) || !Number.isInteger(total) || total < 0 || total > 1e7 ||
      !isFinite(knowledge) || knowledge < 0 || knowledge > total + 1e-6) return null;
  const out = { date: date, total: total, knowledge: Math.round(knowledge * 100) / 100 };
  if (e.final === true) out.final = true;
  return out;
}

// --- 書いた線の長さ（画面上の長さ。ピクセル） ---
// 足し込む方式だと、通信の応答を取りこぼして再送したときに二重に数えてしまう。
// そこで、端末ごとに「その端末の累計」をそのまま上書きで送らせ（小さくならない方だけ採用）、
// 端末ごとの値として持つ。端末をまたいでも、再送しても、値がずれない。
// 実際の長さにするには画面の大きさが要るので、端末ごとに、本人が入れた画面サイズ（インチ）と、
// そのときの画面の対角線のピクセル数（diag）も持つ。これが無い端末は、長さを出せない。
const INK_FILE = STUDY_TIME_DIR + '/ink.json';
const DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeInkDevice(v) {
  if (typeof v === 'number') return { px: v > 0 ? v : 0, name: '', inch: null, diag: null };
  const o = (v && typeof v === 'object') ? v : {};
  const inch = Number(o.inch), diag = Number(o.diag);
  const sized = inch > 0 && diag > 0;
  return {
    px: Number(o.px) > 0 ? Number(o.px) : 0,
    name: typeof o.name === 'string' ? o.name : '',
    inch: sized ? inch : null,
    diag: sized ? diag : null
  };
}

async function readInk() {
  const f = await readFile(INK_FILE);
  const devices = {};
  let updated = null;
  if (f) {
    try {
      const j = JSON.parse(f.text);
      updated = j.updated_at || null;
      Object.keys((j.devices && typeof j.devices === 'object') ? j.devices : {}).forEach(function (id) {
        devices[id] = normalizeInkDevice(j.devices[id]);
      });
    } catch (err) {}
  }
  return { devices: devices, updated_at: updated };
}

async function readStudyTimeMonth(month) {
  const f = await readFile(studyTimeFile(month));
  if (!f) return { updated_at: null, entries: [] };
  try {
    const j = JSON.parse(f.text);
    if (!Array.isArray(j.entries)) j.entries = [];
    return j;
  } catch (err) {
    return { updated_at: null, entries: [] };
  }
}

function sanitizeStudyTimeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const id = (typeof e.id === 'string' && e.id) ? e.id : null;
  const date = (typeof e.date === 'string' && DATE_RE.test(e.date)) ? e.date : null;
  // 1件は「数え続けた一続きの時間」なので、1日（86400秒）を超えることはあり得ない。
  // 端末の時計が狂った場合などにおかしな値が紛れ込まないよう、上限で弾く。
  const seconds = (typeof e.seconds === 'number' && e.seconds > 0 && e.seconds <= 86400)
    ? Math.round(e.seconds) : null;
  if (!id || !date || !seconds) return null;
  return { id: id, date: date, seconds: seconds };
}

// --- 入力の検証 -----------------------------------------------------------
function cleanPath(p) {
  if (typeof p !== 'string') return null;
  const parts = p.replace(/\\/g, '/').split('/')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  if (parts.length === 0) return null;
  // 上位ディレクトリへの脱出や、ファイル名に使えない文字を弾く
  for (const s of parts) {
    if (s === '.' || s === '..') return null;
    if (/[<>:"|?*\u0000-\u001f]/.test(s)) return null;
  }
  return parts.join('/');
}

// --- 本体 -----------------------------------------------------------------
module.exports = async (req, res) => {
  if (!REPO || !TOKEN || !PASS) {
    res.status(500).json({ error: '設定が未完了です。/api/health で確認してください。' });
    return;
  }

  if (!passOk(req.headers['x-passphrase'])) {
    res.status(401).json({ error: '合言葉が違います。' });
    return;
  }

  try {
    if (req.method === 'GET') {
      if (req.query.kind === 'progress') {
        res.status(200).json(await readProgress());
        return;
      }

      if (req.query.kind === 'history') {
        const month = typeof req.query.month === 'string' ? req.query.month : '';
        if (!MONTH_RE.test(month)) {
          res.status(400).json({ error: '月の指定が正しくありません（例: 2026-09）。' });
          return;
        }
        res.status(200).json(await readHistoryMonth(month));
        return;
      }

      if (req.query.kind === 'studytime') {
        const month = typeof req.query.month === 'string' ? req.query.month : '';
        if (!MONTH_RE.test(month)) {
          res.status(400).json({ error: '月の指定が正しくありません（例: 2026-09）。' });
          return;
        }
        res.status(200).json(await readStudyTimeMonth(month));
        return;
      }

      if (req.query.kind === 'ink') {
        res.status(200).json(await readInk());
        return;
      }

      if (req.query.kind === 'shortcuts') {
        res.status(200).json(await readShortcuts());
        return;
      }

      if (req.query.strip_tags) {
        res.status(200).json(await stripTags());
        return;
      }

      if (req.query.kind === 'snapshots') {
        res.status(200).json(await readSnapshots());
        return;
      }

      if (req.query.kind === 'studytimetotal') {
        res.status(200).json(await readStudyTimeTotal());
        return;
      }

      if (req.query.rebuild) {
        const index = await rebuildIndex();
        res.status(200).json({ rebuilt: true, count: index.sets.length, sets: index.sets });
        return;
      }

      const path = req.query.path ? cleanPath(req.query.path) : null;
      if (req.query.path && !path) {
        res.status(400).json({ error: '保存先の指定が正しくありません。' });
        return;
      }

      if (path) {
        const f = await readFile(SETS_DIR + '/' + path + '.json');
        if (!f) {
          res.status(404).json({ error: '見つかりません: ' + path });
          return;
        }
        res.status(200).json(JSON.parse(f.text));
        return;
      }

      const index = await readIndex();
      res.status(200).json(index);
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: '内容が空です。' });
        return;
      }

      // 記憶の推移。日ごとの問題数と合計知識量を、日付ごとに置き換えて保存する。
      // 1件（{date, total, knowledge, final}）でも、まとめて（{entries: [...]}）でも送れる。
      // final が true の日は「その日の終わりの値で確定済み」。確定済みの日を、確定していない値で上書きはしない
      if (body.kind === 'snapshot') {
        const incoming = (Array.isArray(body.entries) ? body.entries : [body]).slice(0, 400)
          .map(sanitizeSnapshotEntry).filter(Boolean);
        if (incoming.length === 0) {
          res.status(400).json({ error: '記憶の推移の値が正しくありません。' });
          return;
        }
        const current = await readSnapshots();
        let changed = false;
        incoming.forEach(function (e) {
          const at = current.entries.findIndex(function (x) { return x.date === e.date; });
          if (at >= 0) {
            const ex = current.entries[at];
            if (ex.final && !e.final) return;
            if (ex.total === e.total && ex.knowledge === e.knowledge && !!ex.final === !!e.final) return;
            current.entries[at] = e;
          } else {
            current.entries.push(e);
          }
          changed = true;
        });
        if (!changed) {
          res.status(200).json({ saved: false });
          return;
        }
        current.entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        const saved = { updated_at: new Date().toISOString(), entries: current.entries };
        await writeFile(SNAPSHOT_FILE, JSON.stringify(saved, null, 2), '記憶の推移を更新（' + incoming.length + '日分）');
        res.status(200).json({ saved: true });
        return;
      }

      // 書いた線の長さ。端末ごとの累計を受け取り、小さくならない方だけ採用する。
      // 画面サイズ（inch・diag）は、送られたときに置き換える（null を送ると消す）
      if (body.kind === 'ink') {
        const device = typeof body.device === 'string' ? body.device : '';
        const px = Number(body.px);
        if (!DEVICE_RE.test(device) || !isFinite(px) || px < 0 || px > 1e12) {
          res.status(400).json({ error: '線の長さの指定が正しくありません。' });
          return;
        }
        const current = await readInk();
        const prev = current.devices[device] || normalizeInkDevice(null);
        const next = { px: Math.max(prev.px, Math.round(px)), name: prev.name, inch: prev.inch, diag: prev.diag };
        if (typeof body.name === 'string') next.name = body.name.trim().slice(0, 40);
        if (body.inch === null) {
          next.inch = null;
          next.diag = null;
        } else if (Number(body.inch) >= 1 && Number(body.inch) <= 100 && Number(body.diag) >= 100 && Number(body.diag) <= 20000) {
          next.inch = Number(body.inch);
          next.diag = Math.round(Number(body.diag));
        }
        if (JSON.stringify(prev) === JSON.stringify(next)) {
          res.status(200).json({ saved: false });
          return;
        }
        current.devices[device] = next;
        const saved = { devices: current.devices, updated_at: new Date().toISOString() };
        await writeFile(INK_FILE, JSON.stringify(saved, null, 2), '書いた線の長さを更新');
        res.status(200).json({ saved: true });
        return;
      }

      // 一覧の並び順の保存。渡された順に並べ、渡されなかった問題集は元の順のまま後ろに付ける
      if (body.kind === 'order') {
        const wanted = Array.isArray(body.paths) ? body.paths : [];
        const index = await readIndex();
        const byPath = {};
        index.sets.forEach(function (s) { byPath[s.path] = s; });
        const sorted = [];
        wanted.forEach(function (p) {
          if (typeof p === 'string' && byPath[p]) { sorted.push(byPath[p]); delete byPath[p]; }
        });
        index.sets.forEach(function (s) { if (byPath[s.path]) sorted.push(s); });
        index.sets = sorted;
        await writeIndex(index);
        res.status(200).json({ saved: true, count: sorted.length });
        return;
      }

      // 問題集・フォルダの移動（フォルダ名の変更も同じ。from / to は、問題集やフォルダの「場所」）
      if (body.kind === 'move') {
        const from = cleanPath(body.from);
        const to = cleanPath(body.to);
        if (!from || !to) {
          res.status(400).json({ error: '場所の指定が正しくありません。' });
          return;
        }
        const r = await moveSets(from, to, { keepOrder: body.keepOrder === true });
        if (r.status === 200) res.status(200).json({ moved: r.moved, from: from, to: to, plan: r.plan });
        else res.status(r.status).json({ error: r.error, moved: 0 });
        return;
      }

      // 選択のショートカット。一覧をまるごと置き換える（件数が少なく、同時に何人も書き換えるものではないため）
      if (body.kind === 'shortcuts') {
        const saved = { updated_at: new Date().toISOString(), shortcuts: sanitizeShortcuts(body.shortcuts) };
        await writeFile(SHORTCUT_FILE, JSON.stringify(saved, null, 2), 'ショートカットを更新（' + saved.shortcuts.length + '件）');
        res.status(200).json({ saved: true, count: saved.shortcuts.length });
        return;
      }

      // 問題集の名前・逆向き許可だけを変える（問題の中身には触れない）
      if (body.kind === 'meta') {
        const path = cleanPath(body.path);
        if (!path) {
          res.status(400).json({ error: '問題集の指定が正しくありません。' });
          return;
        }
        const file = SETS_DIR + '/' + path + '.json';
        const f = await readFile(file);
        if (!f) {
          res.status(404).json({ error: '見つかりません: ' + path });
          return;
        }
        const set = JSON.parse(f.text);
        if (typeof body.title === 'string') {
          const title = body.title.trim();
          if (!title) {
            res.status(400).json({ error: '名前を空にはできません。' });
            return;
          }
          set.title = title;
        }
        delete set.tags;   // 廃止したタグは、書き直すときに消す
        if (typeof body.allowSwap === 'boolean') set.allowSwap = body.allowSwap;
        set.updated_at = new Date().toISOString();
        await writeFile(file, JSON.stringify(set, null, 2), '設定を変更: ' + path);

        const index = await readIndex();
        const at = index.sets.findIndex(function (s) { return s.path === path; });
        if (at >= 0) {
          index.sets[at].title = set.title;
          delete index.sets[at].tags;
          index.sets[at].allowSwap = !!set.allowSwap;
          index.sets[at].updated_at = set.updated_at;
          await writeIndex(index);
        }
        res.status(200).json({ saved: true, path: path, title: set.title });
        return;
      }

      // 指定した問題の成績を消す
      if (body.kind === 'progress-reset') {
        const ids = cleanIds(body.ids);
        const current = await readProgress();
        const removed = removeStats(current.stats || {}, ids);
        if (removed > 0) {
          const saved = { updated_at: new Date().toISOString(), stats: current.stats };
          await writeFile(PROGRESS_FILE, JSON.stringify(saved, null, 2), '成績をリセット（' + removed + '件）');
        }
        res.status(200).json({ saved: true, removed: removed });
        return;
      }

      // 解答履歴の保存
      if (body.kind === 'progress') {
        const current = await readProgress();
        const merged = mergeStats(current.stats || {}, body.stats || {});
        const saved = { updated_at: new Date().toISOString(), stats: merged };
        await writeFile(PROGRESS_FILE, JSON.stringify(saved, null, 2), '解答履歴を更新');
        res.status(200).json({ saved: true, count: Object.keys(merged).length });
        return;
      }

      // 全履歴ログの保存（月ごとのファイルに分けて追加する）
      if (body.kind === 'history') {
        const groups = Array.isArray(body.groups) ? body.groups : [];
        let added = 0;
        for (const g of groups) {
          const month = (g && typeof g.month === 'string') ? g.month : '';
          if (!MONTH_RE.test(month)) continue;
          const entries = (g && Array.isArray(g.entries) ? g.entries : [])
            .map(sanitizeHistoryEntry)
            .filter(Boolean);
          if (entries.length === 0) continue;

          const current = await readHistoryMonth(month);
          const before = current.entries.length;
          const merged = mergeHistoryEntries(current.entries, entries);
          if (merged.length === before) continue; // 新規分がなければ書き込まない

          added += merged.length - before;
          const saved = { updated_at: new Date().toISOString(), entries: merged };
          await writeFile(historyFile(month), JSON.stringify(saved, null, 2), '解答ログを更新（' + month + '）');
        }
        res.status(200).json({ saved: true, added: added });
        return;
      }

      // 勉強時間の保存（月ごとのファイルに分けて追加する。仕組みは全履歴ログと同じ）
      if (body.kind === 'studytime') {
        const groups = Array.isArray(body.groups) ? body.groups : [];
        let added = 0;
        let addedSeconds = 0;   // 新しく増えた分だけを、消えない累計に上乗せする
        for (const g of groups) {
          const month = (g && typeof g.month === 'string') ? g.month : '';
          if (!MONTH_RE.test(month)) continue;
          const entries = (g && Array.isArray(g.entries) ? g.entries : [])
            .map(sanitizeStudyTimeEntry)
            .filter(Boolean);
          if (entries.length === 0) continue;

          const current = await readStudyTimeMonth(month);
          const before = current.entries.length;
          const merged = mergeHistoryEntries(current.entries, entries);
          if (merged.length === before) continue;

          const newlyAdded = merged.slice(before);
          added += newlyAdded.length;
          addedSeconds += newlyAdded.reduce(function (a, e) { return a + e.seconds; }, 0);
          const saved = { updated_at: new Date().toISOString(), entries: merged };
          await writeFile(studyTimeFile(month), JSON.stringify(saved, null, 2), '勉強時間を更新（' + month + '）');
        }
        await addStudyTimeTotal(addedSeconds);
        res.status(200).json({ saved: true, added: added });
        return;
      }

      const path = cleanPath(body.path);
      if (!path) {
        res.status(400).json({ error: '保存先を入力してください（例: 世界史/近代/フランス革命）。' });
        return;
      }
      if (!Array.isArray(body.questions) || body.questions.length === 0) {
        res.status(400).json({ error: '問題が1問も含まれていません。' });
        return;
      }

      const questions = body.questions.map(function (q, i) {
        return {
          id: (q && q.id) || (Date.now().toString(36) + '-' + i.toString(36)),
          question: String((q && q.question) || '').trim(),
          answer: String((q && q.answer) || '').trim(),
          commentary: String((q && q.commentary) || '').trim()
        };
      }).filter(function (q) { return q.question && q.answer; });

      if (questions.length === 0) {
        res.status(400).json({ error: '問題文と答えの両方が入っている行がありません。' });
        return;
      }

      const set = {
        title: String(body.title || path.split('/').pop()).trim(),
        path: path,
        allowSwap: !!body.allowSwap,
        updated_at: new Date().toISOString(),
        questions: questions
      };

      const file = SETS_DIR + '/' + path + '.json';
      const existed = !!(await readFile(file));
      if (existed && !body.overwrite) {
        res.status(409).json({ error: '同じ場所に問題集があります。上書きしますか？', exists: true });
        return;
      }

      await writeFile(file, JSON.stringify(set, null, 2),
                      (existed ? '更新: ' : '追加: ') + path + '（' + questions.length + '問）');

      // 書き換えと同時に成績を消す指定があるときだけ消す（既定は、IDが同じなら成績を引き継ぐ）
      const resetIds = cleanIds(body.resetIds);
      let resetCount = 0;
      if (resetIds.length > 0) {
        const current = await readProgress();
        resetCount = removeStats(current.stats || {}, resetIds);
        if (resetCount > 0) {
          const savedProgress = { updated_at: new Date().toISOString(), stats: current.stats };
          await writeFile(PROGRESS_FILE, JSON.stringify(savedProgress, null, 2), '成績をリセット（' + resetCount + '件）');
        }
      }

      // 一覧にも反映する
      const index = await readIndex();
      const entry = {
        path: path, title: set.title, allowSwap: set.allowSwap,
        count: questions.length, updated_at: set.updated_at
      };
      const at = index.sets.findIndex(function (s) { return s.path === path; });
      if (at >= 0) index.sets[at] = entry; else index.sets.push(entry);
      await writeIndex(index);

      res.status(200).json({ saved: true, path: path, count: questions.length, updated: existed, reset: resetCount });
      return;
    }

    if (req.method === 'DELETE') {
      const path = cleanPath(req.query.path);
      if (!path) {
        res.status(400).json({ error: '削除する問題集の指定が正しくありません。' });
        return;
      }

      const removed = await deleteFile(SETS_DIR + '/' + path + '.json', '削除: ' + path);
      if (!removed) {
        res.status(404).json({ error: '見つかりません: ' + path });
        return;
      }

      const index = await readIndex();
      index.sets = index.sets.filter(function (s) { return s.path !== path; });
      await writeIndex(index);

      res.status(200).json({ deleted: true, path: path });
      return;
    }

    res.status(405).json({ error: '対応していない操作です。' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
