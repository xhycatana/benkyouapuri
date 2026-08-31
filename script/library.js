// 問題集の一覧、階層ツリー、タグ絞り込み、選択と削除。
// ----------------------------------------------------------------------

// --- 6. 問題集ライブラリ（非公開リポジトリから読み書きする） -----------------
// 通信はすべて /api/questions を経由する。GitHub のトークンはサーバー側にしかなく、
// ブラウザが持つのは合言葉だけ。


let libraryIndex = { sets: [] };
let selectedPaths = [];       // 選択中の問題集のパス
let activeTags = [];          // 絞り込みに使っているタグ
let closedFolders = {};       // 閉じているフォルダ（既定は開いた状態）


// --- 一覧の読み込み ---
function setTreeMessage(text, isError) {
  libraryTree.innerHTML = '';
  const p = document.createElement('p');
  p.className = isError ? 'text-[10px] text-red-600' : 'text-[10px] text-slate-400';
  p.textContent = text;
  libraryTree.appendChild(p);
}

async function loadLibrary() {
  if (!getPassphrase()) {
    setTreeMessage('合言葉を入力してください。');
    askPassphrase('');
    return;
  }
  setTreeMessage('読み込み中…');
  try {
    const data = await api('/api/questions');
    libraryIndex = (data && Array.isArray(data.sets)) ? data : { sets: [] };
    await loadProgress();
    selectedPaths = selectedPaths.filter(function (p) {
      return libraryIndex.sets.some(function (s) { return s.path === p; });
    });
    renderLibrary();
  } catch (err) {
    if (!err.unauthorized) setTreeMessage(err.message, true);
  }
}

// --- タグ ---
function allTags() {
  const seen = {};
  libraryIndex.sets.forEach(function (s) {
    (s.tags || []).forEach(function (t) { seen[t] = true; });
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
}

// タグは絞り込み。複数選ぶと、そのすべてを持つ問題集だけが残る。
function visibleSets() {
  if (activeTags.length === 0) return libraryIndex.sets;
  return libraryIndex.sets.filter(function (s) {
    const tags = s.tags || [];
    return activeTags.every(function (t) { return tags.indexOf(t) !== -1; });
  });
}

function renderTags() {
  libraryTags.innerHTML = '';
  const tags = allTags();
  tags.forEach(function (t) {
    const on = activeTags.indexOf(t) !== -1;
    const b = document.createElement('button');
    b.className = 'px-2 py-0.5 text-[10px] border focus:outline-none ' +
      (on ? 'bg-black text-white border-black'
          : 'bg-white text-slate-500 border-slate-300 hover:border-black');
    b.textContent = t;
    b.addEventListener('click', function () {
      const at = activeTags.indexOf(t);
      if (at === -1) activeTags.push(t); else activeTags.splice(at, 1);
      renderLibrary();
    });
    libraryTags.appendChild(b);
  });
}

// --- ツリー ---
function buildTree(sets) {
  const root = { name: '', key: '', folders: [], items: [] };
  sets.forEach(function (s) {
    const parts = s.path.split('/');
    let node = root;
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? (prefix + '/' + parts[i]) : parts[i];
      let next = null;
      for (const f of node.folders) { if (f.name === parts[i]) { next = f; break; } }
      if (!next) {
        next = { name: parts[i], key: prefix, folders: [], items: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.items.push(s);
  });
  return root;
}

function renderNode(node, container, depth) {
  node.folders.forEach(function (f) {
    const isClosed = closedFolders[f.key] === true;

    const row = document.createElement('button');
    row.className = 'w-full flex items-center text-left py-0.5 hover:bg-slate-50 focus:outline-none';
    row.style.paddingLeft = (depth * 12) + 'px';

    const mark = document.createElement('span');
    mark.className = 'w-4 text-slate-400';
    mark.textContent = isClosed ? '▸' : '▾';

    const name = document.createElement('span');
    name.className = 'font-bold text-slate-700';
    name.textContent = f.name;

    row.appendChild(mark);
    row.appendChild(name);
    row.addEventListener('click', function () {
      closedFolders[f.key] = !isClosed;
      renderLibrary();
    });
    container.appendChild(row);

    if (!isClosed) renderNode(f, container, depth + 1);
  });

  node.items.forEach(function (s) {
    const row = document.createElement('label');
    row.className = 'flex items-center py-0.5 cursor-pointer hover:bg-slate-50';
    row.style.paddingLeft = (depth * 12 + 16) + 'px';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedPaths.indexOf(s.path) !== -1;
    box.className = 'mr-2 accent-black';
    box.addEventListener('change', function () {
      const at = selectedPaths.indexOf(s.path);
      if (box.checked) { if (at === -1) selectedPaths.push(s.path); }
      else if (at !== -1) { selectedPaths.splice(at, 1); }
      updateSelectionUI();
    });

    const label = document.createElement('span');
    label.className = 'text-slate-800';
    label.textContent = s.title || s.path.split('/').pop();

    const count = document.createElement('span');
    count.className = 'ml-2 text-[10px] text-slate-400';
    count.textContent = (s.count || 0) + '問';

    const del = document.createElement('button');
    del.className = 'ml-auto px-2 text-[11px] text-slate-300 hover:text-red-600 focus:outline-none';
    del.textContent = '×';
    del.title = 'この問題集を削除';
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      deleteSet(s);
    });

    row.appendChild(box);
    row.appendChild(label);
    row.appendChild(count);
    row.appendChild(del);
    container.appendChild(row);
  });
}

function renderLibrary() {
  renderTags();

  const sets = visibleSets();
  libraryTree.innerHTML = '';

  if (libraryIndex.sets.length === 0) {
    setTreeMessage('まだ問題集がありません。「問題集を追加」から登録してください。');
  } else if (sets.length === 0) {
    setTreeMessage('このタグに当てはまる問題集はありません。');
  } else {
    renderNode(buildTree(sets), libraryTree, 0);
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const chosen = libraryIndex.sets.filter(function (s) {
    return selectedPaths.indexOf(s.path) !== -1;
  });
  const total = chosen.reduce(function (a, s) { return a + (s.count || 0); }, 0);
  librarySelected.textContent = chosen.length === 0
    ? '未選択'
    : (chosen.length + '冊 / ' + total + '問を選択中');
  btnStartSelected.disabled = chosen.length === 0;
}

// --- 選択した問題集で開始 ---
async function startFromSelection() {
  if (selectedPaths.length === 0) return;
  btnStartSelected.disabled = true;
  btnStartSelected.textContent = '読み込み中…';
  try {
    let merged = [];
    for (const p of selectedPaths) {
      const set = await api('/api/questions?path=' + encodeURIComponent(p));
      if (Array.isArray(set.questions)) merged = merged.concat(set.questions);
    }
    if (merged.length === 0) throw new Error('選んだ問題集に問題が入っていません。');
    startLearning(merged);
  } catch (err) {
    if (!err.unauthorized) alert(err.message);
  } finally {
    btnStartSelected.textContent = '選択した問題集で開始';
    updateSelectionUI();
  }
}

async function deleteSet(set) {
  const label = (set.title || set.path) + '（' + (set.count || 0) + '問）';
  if (!confirm(label + ' を削除します。よろしいですか。' + String.fromCharCode(10) +
               '解答履歴は残るので、同じ問題集を入れ直せば成績も戻ります。')) return;
  try {
    await api('/api/questions?path=' + encodeURIComponent(set.path), { method: 'DELETE' });
    const at = selectedPaths.indexOf(set.path);
    if (at !== -1) selectedPaths.splice(at, 1);
    await loadLibrary();
  } catch (err) {
    if (!err.unauthorized) alert(err.message);
  }
}

btnStartSelected.addEventListener('click', startFromSelection);
btnLibraryReload.addEventListener('click', loadLibrary);
