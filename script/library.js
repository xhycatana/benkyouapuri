// 問題集の一覧、階層ツリー、タグ絞り込み、選択と削除。
// ----------------------------------------------------------------------

// --- 6. 問題集ライブラリ（非公開リポジトリから読み書きする） -----------------
// 通信はすべて /api/questions を経由する。GitHub のトークンはサーバー側にしかなく、
// ブラウザが持つのは合言葉だけ。


let libraryIndex = { sets: [] };
// 選択状態。パスごとに、そのまま(normal)・逆にして(swap)のどちらを選んでいるかを持つ。
// 「問題と答えを逆にする」は問題集ごとに許可・不許可が決まっており（upload.js の allowSwap）、
// 許可されている問題集だけ、選択欄にチェックボックスが2つ並ぶ。
let selection = {};
let activeTags = [];          // 絞り込みに使っているタグ
let closedFolders = {};       // 閉じているフォルダ（既定は開いた状態）

function isSelected(path) {
  const s = selection[path];
  return !!(s && (s.normal || s.swap));
}


// --- 一覧の読み込み ---
function setTreeMessage(text, isError) {
  libraryTree.innerHTML = '';
  const p = document.createElement('p');
  p.className = isError ? 'text-xs text-red-600' : 'text-xs text-slate-400';
  p.textContent = text;
  libraryTree.appendChild(p);
}

// 合言葉が無いときの案内。ボタンを押すまでは合言葉の入力欄を勝手に出さない
// （初めて開いた人が、合言葉を持っていなくても「サンプル」だけは試せるように）。
function setTreeMessageNoPassphrase() {
  libraryTree.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'text-xs text-slate-400';
  p.textContent = '自分の問題集を使うには合言葉が必要です。';
  const btn = document.createElement('button');
  btn.className = 'mt-1 text-xs text-black underline hover:no-underline focus:outline-none';
  btn.textContent = '合言葉を入力する';
  btn.addEventListener('click', function () { askPassphrase(''); });
  libraryTree.appendChild(p);
  libraryTree.appendChild(btn);
}

// silent が true のときは、起動直後の自動読み込みなので、入力欄を勝手に出さない。
// 「再読み込み」を押すなど、本人が明示的に操作したときだけ自動で聞く。
async function loadLibrary(silent) {
  if (!getPassphrase()) {
    setTreeMessageNoPassphrase();
    if (!silent) askPassphrase('');
    return;
  }
  setTreeMessage('読み込み中…');
  try {
    const data = await api('/api/questions');
    libraryIndex = (data && Array.isArray(data.sets)) ? data : { sets: [] };
    await loadProgress();
    // 無くなった問題集の選択は捨て、許可が外れた問題集の「逆」選択も外す
    Object.keys(selection).forEach(function (p) {
      const set = libraryIndex.sets.find(function (s) { return s.path === p; });
      if (!set) { delete selection[p]; return; }
      if (!set.allowSwap) selection[p].swap = false;
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
    b.className = 'px-2.5 py-1 text-xs border focus:outline-none ' +
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
    row.className = 'w-full flex items-center text-left py-1.5 hover:bg-slate-50 focus:outline-none';
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
    const row = document.createElement('div');
    row.className = 'flex items-center py-1.5 hover:bg-slate-50';
    row.style.paddingLeft = (depth * 12 + 16) + 'px';

    if (!selection[s.path]) selection[s.path] = { normal: false, swap: false };
    const sel = selection[s.path];

    // チェックを入れると白地から黒地＋白いチェックへ反転する、同じ見た目のチェックボックス。
    // そのまま(normal)・逆(swap)の2つを線でつないで1組に見せることで区別する（文字は使わない）。
    function makeCheckbox(dir, title) {
      const wrap = document.createElement('label');
      wrap.className = 'relative flex items-center justify-center w-5 h-5 border-2 border-black cursor-pointer shrink-0 bg-white';
      wrap.title = title;

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = sel[dir];
      box.className = 'sr-only';

      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mark.setAttribute('viewBox', '0 0 24 24');
      mark.setAttribute('fill', 'none');
      mark.setAttribute('stroke', 'currentColor');
      mark.setAttribute('stroke-width', '3.5');
      mark.setAttribute('stroke-linecap', 'round');
      mark.setAttribute('stroke-linejoin', 'round');
      mark.className.baseVal = 'hidden w-3 h-3 text-white';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M5 13l4 4L19 7');
      mark.appendChild(path);

      function refresh() {
        wrap.classList.toggle('bg-black', box.checked);
        wrap.classList.toggle('bg-white', !box.checked);
        mark.classList.toggle('hidden', !box.checked);
      }
      box.addEventListener('change', function () {
        sel[dir] = box.checked;
        refresh();
        updateSelectionUI();
      });
      refresh();

      wrap.appendChild(box);
      wrap.appendChild(mark);
      return wrap;
    }

    if (s.allowSwap) {
      // 2つのチェックボックスを短い線でつないで、1組の選択肢だと分かるようにする
      const group = document.createElement('div');
      group.className = 'flex items-center mr-2';
      const line = document.createElement('div');
      line.className = 'w-5 h-0.5 bg-black shrink-0';
      group.appendChild(makeCheckbox('normal', 'そのまま出題する'));
      group.appendChild(line);
      group.appendChild(makeCheckbox('swap', '答えを問題として、逆向きに出題する'));
      row.appendChild(group);
    } else {
      const solo = document.createElement('div');
      solo.className = 'mr-2';
      solo.appendChild(makeCheckbox('normal', 'そのまま出題する'));
      row.appendChild(solo);
    }

    const label = document.createElement('span');
    label.className = 'text-slate-800 cursor-pointer';
    label.textContent = s.title || s.path.split('/').pop();
    label.addEventListener('click', function () {
      // タイトルをクリックしたときは、そのまま(normal)のチェックを切り替える（今まで通りの手軽さを残す）
      sel.normal = !sel.normal;
      renderLibrary();
    });

    const count = document.createElement('span');
    count.className = 'ml-2 text-xs text-slate-400';
    count.textContent = (s.count || 0) + '問';

    row.appendChild(label);
    row.appendChild(count);
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
  if (currentPhase === 'manage') renderManage();
}

function updateSelectionUI() {
  let setCount = 0, questionCount = 0;
  libraryIndex.sets.forEach(function (s) {
    const sel = selection[s.path];
    if (!sel || (!sel.normal && !sel.swap)) return;
    setCount++;
    if (sel.normal) questionCount += (s.count || 0);
    if (sel.swap) questionCount += (s.count || 0);   // 逆向きは同じ問題数の別出題として数える
  });
  librarySelected.textContent = setCount === 0
    ? '未選択'
    : (setCount + '冊 / ' + questionCount + '問を選択中');
  btnStartSelected.disabled = setCount === 0;
}

// 答えを問題として出す「逆向き」の1問を作る。
// 答えが「／」で複数に分かれている問題は、そのまま問題文として表示される
// （「走る／経営する」のように）。元の問題文はその答えになる。
// id は元と変えて、正解・不正解の記録（記憶予測）を順方向とは別に持つ
// （逆向きを覚えていることと、順向きを覚えていることは別なので）。
function makeSwappedQuestion(q) {
  return {
    id: q.id + ':swap',
    question: splitAnswers(q.answer).join('／'),
    answer: String(q.question).replace(/／/g, '／／'),
    commentary: q.commentary || ''
  };
}

// --- 選択した問題集で開始 ---
async function startFromSelection() {
  const paths = Object.keys(selection).filter(isSelected);
  if (paths.length === 0) return;
  btnStartSelected.disabled = true;
  btnStartSelected.textContent = '読み込み中…';
  try {
    let merged = [];
    for (const p of paths) {
      const sel = selection[p];
      const set = await api('/api/questions?path=' + encodeURIComponent(p));
      if (!Array.isArray(set.questions)) continue;
      // 出題中に問題を書き換えられるよう、どの問題集の問題かを持たせる（逆向きは書き換えの対象外）
      if (sel.normal) merged = merged.concat(set.questions.map(function (q) {
        return Object.assign({}, q, { setPath: p });
      }));
      if (sel.swap) merged = merged.concat(set.questions.map(makeSwappedQuestion));
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
    await saveOrderNow();   // 保存待ちの並び順を先に送る（読み直したときに古い並びに戻らないように）
    await enqueueManage(function () {
      return api('/api/questions?path=' + encodeURIComponent(set.path), { method: 'DELETE' });
    });
    delete selection[set.path];
    await loadLibrary();
  } catch (err) {
    if (!err.unauthorized) alert(err.message);
  }
}

btnStartSelected.addEventListener('click', startFromSelection);
btnLibraryReload.addEventListener('click', function () { loadLibrary(); });
