// 問題集の読み書き。非公開リポジトリとのやり取りは、すべてこのサーバー側で行う。
// トークンはここ（Vercel の環境変数）にしか存在せず、ブラウザには一切渡さない。
//
//   GET  /api/questions                -> 問題集の一覧（index.json）
//   GET  /api/questions?path=世界史/…   -> 問題集1つの中身
//   GET  /api/questions?rebuild=1      -> リポジトリを走査して一覧を作り直す
//   GET  /api/questions?kind=progress  -> 解答履歴の集計
//   GET  /api/questions?kind=history&month=YYYY-MM -> 解答ログ（月ごと）
//   GET  /api/questions?kind=studytime&month=YYYY-MM -> 勉強時間の記録（月ごと）
//   GET  /api/questions?kind=studytimetotal -> 勉強時間の累計（全期間）
//   POST /api/questions                -> 問題集を保存する
//   POST /api/questions {kind:'order'}          -> 一覧の並び順を保存する
//   POST /api/questions {kind:'meta'}           -> 問題集の名前・タグ・逆向き許可だけを変える
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
async function rebuildIndex() {
  const repoInfo = await gh('https://api.github.com/repos/' + REPO);
  if (!repoInfo.ok) throw new Error('リポジトリ情報を取得できません (' + repoInfo.status + ')');
  const branch = (await repoInfo.json()).default_branch;

  const r = await gh('https://api.github.com/repos/' + REPO +
                     '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
  if (!r.ok) throw new Error('ファイル一覧を取得できません (' + r.status + ')');
  const tree = await r.json();

  const files = (tree.tree || []).filter(function (n) {
    return n.type === 'blob' && n.path.startsWith(SETS_DIR + '/') && n.path.endsWith('.json');
  });

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
          tags: Array.isArray(j.tags) ? j.tags : [],
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

      // 問題集の名前・タグ・逆向き許可だけを変える（問題の中身には触れない）
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
        if (Array.isArray(body.tags)) {
          set.tags = body.tags.map(function (x) { return String(x).trim(); }).filter(Boolean);
        }
        if (typeof body.allowSwap === 'boolean') set.allowSwap = body.allowSwap;
        set.updated_at = new Date().toISOString();
        await writeFile(file, JSON.stringify(set, null, 2), '設定を変更: ' + path);

        const index = await readIndex();
        const at = index.sets.findIndex(function (s) { return s.path === path; });
        if (at >= 0) {
          index.sets[at].title = set.title;
          index.sets[at].tags = Array.isArray(set.tags) ? set.tags : [];
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

      const tags = Array.isArray(body.tags)
        ? body.tags.map(function (t) { return String(t).trim(); }).filter(Boolean)
        : [];

      const set = {
        title: String(body.title || path.split('/').pop()).trim(),
        path: path,
        tags: tags,
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
        path: path, title: set.title, tags: tags, allowSwap: set.allowSwap,
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
