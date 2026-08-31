// 問題集の読み書き。非公開リポジトリとのやり取りは、すべてこのサーバー側で行う。
// トークンはここ（Vercel の環境変数）にしか存在せず、ブラウザには一切渡さない。
//
//   GET  /api/questions                -> 問題集の一覧（index.json）
//   GET  /api/questions?path=世界史/…   -> 問題集1つの中身
//   GET  /api/questions?rebuild=1      -> リポジトリを走査して一覧を作り直す
//   POST /api/questions                -> 問題集を保存する
//
// いずれも x-passphrase ヘッダーでの合言葉が必要。

const crypto = require('crypto');

const REPO = process.env.QUESTIONS_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PASS = process.env.APP_PASSPHRASE;

const SETS_DIR = 'sets';        // 問題集の置き場所
const INDEX_FILE = 'index.json'; // 一覧。保存のたびに更新する

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
  index.updated_at = new Date().toISOString();
  index.sets.sort(function (a, b) { return a.path.localeCompare(b.path, 'ja'); });
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
          count: Array.isArray(j.questions) ? j.questions.length : 0,
          updated_at: j.updated_at || null
        };
      } catch (err) {
        return null;
      }
    }));
    loaded.forEach(function (x) { if (x) sets.push(x); });
  }

  const index = { updated_at: null, sets: sets };
  await writeIndex(index);
  return index;
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

      // 一覧にも反映する
      const index = await readIndex();
      const entry = {
        path: path, title: set.title, tags: tags,
        count: questions.length, updated_at: set.updated_at
      };
      const at = index.sets.findIndex(function (s) { return s.path === path; });
      if (at >= 0) index.sets[at] = entry; else index.sets.push(entry);
      await writeIndex(index);

      res.status(200).json({ saved: true, path: path, count: questions.length, updated: existed });
      return;
    }

    res.status(405).json({ error: '対応していない操作です。' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
