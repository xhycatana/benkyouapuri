// 設定が正しく入っているかを確認するための診断用エンドポイント。
// 合言葉やトークンの「中身」は絶対に返さない。設定されているかどうかだけを返す。
// GET /api/health

const REPO = process.env.QUESTIONS_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PASS = process.env.APP_PASSPHRASE;

module.exports = async (req, res) => {
  const result = {
    ok: false,
    repo_set: !!REPO,
    token_set: !!TOKEN,
    passphrase_set: !!PASS,
    repo: REPO || null,          // リポジトリ名は秘密ではないので、確認のため返す
    passphrase_length: PASS ? PASS.length : 0,   // 中身ではなく文字数だけ
    github: null,
    hint: null
  };

  if (!REPO || !TOKEN || !PASS) {
    result.hint = 'Vercel の Settings > Environment Variables に ' +
                  'QUESTIONS_REPO / GITHUB_TOKEN / APP_PASSPHRASE を登録し、再デプロイしてください。';
    res.status(200).json(result);
    return;
  }

  // トークンで実際にリポジトリへ到達できるかを確かめる
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO, {
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'benkyouapuri'
      }
    });
    if (r.ok) {
      const info = await r.json();
      result.github = {
        reachable: true,
        private: info.private,
        default_branch: info.default_branch,
        empty: info.size === 0
      };
      result.ok = true;
      if (!info.private) {
        result.hint = 'このリポジトリは公開されています。問題集を置くなら Private にしてください。';
      }
    } else {
      result.github = { reachable: false, status: r.status };
      result.hint = r.status === 404
        ? 'リポジトリが見つかりません。QUESTIONS_REPO の綴りと、トークンにこのリポジトリへのアクセス権があるかを確認してください。'
        : (r.status === 401 || r.status === 403)
          ? 'トークンが無効か、権限が足りません。Contents: Read and write になっているか確認してください。'
          : 'GitHub から想定外の応答がありました。';
    }
  } catch (err) {
    result.github = { reachable: false, error: String(err && err.message || err) };
    result.hint = 'GitHub への接続に失敗しました。';
  }

  res.status(200).json(result);
};
