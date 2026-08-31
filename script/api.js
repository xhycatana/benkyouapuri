// 合言葉と、サーバー側（/api/questions）との通信。
// ----------------------------------------------------------------------

const STORAGE_KEY_PASSPHRASE = 'flashmemo_passphrase';

function getPassphrase() {
  try { return localStorage.getItem(STORAGE_KEY_PASSPHRASE) || ''; } catch (err) { return ''; }
}
function savePassphrase(v) {
  try { localStorage.setItem(STORAGE_KEY_PASSPHRASE, v); } catch (err) {}
}

async function api(path, options) {
  const opts = Object.assign({}, options || {});
  opts.headers = Object.assign({ 'x-passphrase': getPassphrase() }, opts.headers || {});
  const res = await fetch(path, opts);

  let data = {};
  try { data = await res.json(); } catch (err) {}

  if (res.status === 401) {
    askPassphrase('合言葉が違います。もう一度入力してください。');
    const e = new Error('unauthorized');
    e.unauthorized = true;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data.error || ('通信に失敗しました (' + res.status + ')'));
    e.data = data;
    throw e;
  }
  return data;
}

// --- 合言葉の入力 ---
function askPassphrase(message) {
  passphraseError.textContent = message || '';
  passphraseError.classList.toggle('hidden', !message);
  passphraseInput.value = '';
  passphraseModal.classList.remove('hidden');
  setTimeout(function () { passphraseInput.focus(); }, 50);
}

function submitPassphrase() {
  const v = passphraseInput.value.trim();
  if (!v) return;
  savePassphrase(v);
  passphraseModal.classList.add('hidden');
  loadLibrary();
}

btnPassphraseSave.addEventListener('click', submitPassphrase);
passphraseInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') submitPassphrase();
});
