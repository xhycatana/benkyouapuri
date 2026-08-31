// 問題集の追加。CSV を読み取って保存する。
// ----------------------------------------------------------------------

// --- 問題集の追加 ---
// 前回の入力が残っていると、別の問題集を上書きしかねない。開くたびに空にする。
function resetUploadForm() {
  uploadPath.value = '';
  uploadTags.value = '';
  uploadCsv.value = '';
  uploadMessage.textContent = '';
  uploadMessage.className = 'text-xs';
  updateUploadPreview();
}

btnOpenUpload.addEventListener('click', function () {
  resetUploadForm();
  switchPhase('upload');
});

btnUploadSample.addEventListener('click', function () {
  uploadPath.value = 'サンプル/果物';
  uploadTags.value = 'サンプル';
  uploadCsv.value = sampleQuestionsJSON.map(function (q) {
    return q.question + ',' + q.answer + ',' + q.commentary;
  }).join(String.fromCharCode(10));
  updateUploadPreview();
});
btnUploadBack.addEventListener('click', function () {
  switchPhase('import');
});

function updateUploadPreview() {
  const rows = parseCSV(uploadCsv.value);
  const path = uploadPath.value.trim();

  // スラッシュがそのまま階層になることを、その場で見せる
  const parts = path.split('/').map(function (p) { return p.trim(); }).filter(Boolean);
  uploadPathPreview.textContent = parts.length === 0 ? ''
    : (parts.length === 1 ? '一番上に「' + parts[0] + '」として置かれます'
                          : parts.join('  >  '));
  uploadPreview.textContent = rows.length === 0
    ? '読み取れる問題がありません。'
    : (rows.length + '問を読み取りました。先頭: ' + rows[0].question + ' → ' + rows[0].answer);
  btnUploadSave.disabled = (rows.length === 0 || path.length === 0);
}

uploadCsv.addEventListener('input', updateUploadPreview);
uploadPath.addEventListener('input', updateUploadPreview);

// CSV はファイルからも読み込めるようにする。
// iPad では「ファイル」アプリが開くので、Gemini の出力を保存しておけばそのまま選べる。
btnUploadFile.addEventListener('click', function () { uploadFile.click(); });

uploadFile.addEventListener('change', async function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    uploadCsv.value = await file.text();
    // 保存先が空なら、ファイル名（拡張子を除く）を初期値として入れておく
    if (!uploadPath.value.trim()) {
      uploadPath.value = file.name.replace(/\.[^.]+$/, '');
    }
    uploadMessage.className = 'text-xs text-slate-500';
    uploadMessage.textContent = file.name + ' を読み込みました。';
  } catch (err) {
    uploadMessage.className = 'text-xs text-red-600';
    uploadMessage.textContent = 'ファイルを読めませんでした: ' + err.message;
  }
  uploadFile.value = '';   // 同じファイルを続けて選べるようにする
  updateUploadPreview();
});

async function saveUpload(overwrite) {
  const rows = parseCSV(uploadCsv.value);
  const path = uploadPath.value.trim();
  const payload = {
    path: path,
    title: path.split('/').pop(),
    tags: uploadTags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    questions: rows.map(function (r) {
      return { question: r.question, answer: r.answer, commentary: r.commentary };
    }),
    overwrite: !!overwrite
  };

  btnUploadSave.disabled = true;
  btnUploadSave.textContent = '保存中…';
  uploadMessage.textContent = '';

  try {
    const r = await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    uploadMessage.className = 'text-xs text-green-700';
    uploadMessage.textContent = (r.updated ? '上書き保存しました: ' : '保存しました: ') +
                                r.path + '（' + r.count + '問）';
    uploadCsv.value = '';
    await loadLibrary();
  } catch (err) {
    if (err.unauthorized) return;
    if (err.data && err.data.exists && !overwrite) {
      if (confirm('同じ場所に問題集があります。上書きしますか？')) {
        await saveUpload(true);
        return;
      }
      uploadMessage.className = 'text-xs text-slate-500';
      uploadMessage.textContent = '保存を中止しました。';
    } else {
      uploadMessage.className = 'text-xs text-red-600';
      uploadMessage.textContent = err.message;
    }
  } finally {
    btnUploadSave.textContent = '保存する';
    updateUploadPreview();
  }
}

btnUploadSave.addEventListener('click', function () { saveUpload(false); });
