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
let closedFolders = {};       // 閉じているフォルダ（既定は開いた状態）

function isSelected(path) {
  const s = selection[path];
  return !!(s && (s.normal || s.swap));
}

// 問題集の選択の状態: 'off'（未選択）/ 'normal'（そのまま）/ 'swap'（逆向きだけ）/ 'both'（両方）
function selectionState(path) {
  const s = selection[path];
  if (s && s.normal && s.swap) return 'both';
  if (s && s.swap) return 'swap';
  if (s && s.normal) return 'normal';
  return 'off';
}

function setSelectionState(path, state) {
  if (!selection[path]) selection[path] = { normal: false, swap: false };
  selection[path].normal = (state === 'normal' || state === 'both');
  selection[path].swap = (state === 'swap' || state === 'both');
}

function setAllowsSwap(path) {
  const set = libraryIndex.sets.find(function (x) { return x.path === path; });
  return !!(set && set.allowSwap);
}

// 押すたびの切り替え。逆向きを許可した問題集: 未選択 → そのまま → 逆向き → 両方 → 未選択。それ以外: 未選択 ↔ 選択
function cycleSelection(path) {
  const order = setAllowsSwap(path) ? ['off', 'normal', 'swap', 'both'] : ['off', 'normal'];
  const at = order.indexOf(selectionState(path));
  setSelectionState(path, order[(at + 1) % order.length]);
}

// 問題集を、選ぶ（そのまま）／外す。フォルダのチェックや、名前を押したときに使う
function setSelected(path, on) {
  setSelectionState(path, on ? 'normal' : 'off');
}

// チェックボックスの中の絵。そのまま ✓（逆向きを許可していない問題集）、→ そのまま、← 逆向きだけ、⇄ 両方
const SELECT_ICONS = {
  check: ['M5 13l4 4L19 7'],
  normal: ['M5 12h14', 'M13 6l6 6-6 6'],
  swap: ['M19 12H5', 'M11 6l-6 6 6 6'],
  both: ['M4 8h14', 'M14 4l4 4-4 4', 'M20 16H6', 'M10 12l-4 4 4 4']
};
const SELECT_TITLES = {
  off: '未選択（押すと、そのまま）',
  normal: 'そのまま出題する（押すと、逆向きだけ）',
  swap: '答えを問題として、逆向きだけを出題する（押すと、両方）',
  both: 'そのまま と 逆向き の両方を出題する（押すと、未選択）'
};

// チェックボックス（ボタン）。選ぶと、白地から黒地＋白い絵へ反転する。
// 逆向きを許可した問題集は、絵が矢印になる（→ そのまま、← 逆向きだけ、⇄ 両方）。それ以外は ✓。
function makeSelectBox(path) {
  const state = selectionState(path);
  const swappable = setAllowsSwap(path);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'relative flex items-center justify-center w-5 h-5 border-2 border-black cursor-pointer shrink-0 focus:outline-none ' +
    (state === 'off' ? 'bg-white text-white' : 'bg-black text-white');
  btn.title = swappable ? SELECT_TITLES[state] : (state === 'off' ? '出題する問題集として選ぶ' : '選択を外す');

  if (state !== 'off') {
    const icon = swappable ? SELECT_ICONS[state] : SELECT_ICONS.check;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', swappable ? '3' : '3.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', swappable ? 'w-3.5 h-3.5' : 'w-3 h-3');
    icon.forEach(function (d) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    btn.appendChild(svg);
  }
  btn.addEventListener('click', function () {
    cycleSelection(path);
    renderLibrary();   // フォルダのチェック（一部・全部）も、合わせて更新する
  });
  return btn;
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
    startupSnapshots();   // 開かなかった日も含めて、過去の日の値を確定させる
    loadShortcuts();
  } catch (err) {
    if (!err.unauthorized) setTreeMessage(err.message, true);
  }
}

// --- ツリー ---
// 木の字下げ（1階層ぶん、px）。フォルダも問題集も、同じ階層なら同じ左端にそろえる。
// 階層の違い（フォルダの中身か、フォルダと同じ階層か）が、字下げの差ではっきり見えるように、広めにしている
const TREE_INDENT = 20;

// 木の線（├ └ │）を、行の中に描く。どの項目が、どのフォルダの下にあるかを、線でたどれるようにする。
// 最上位の項目も、「見えないルートフォルダ」の中身として、線でつなぐ（最上位の行は階層1）。
//   depth: この行の階層（1 が最上位）
//   lastFlags: 上の階層のフォルダが、兄弟の最後かどうか。最後でなければ、その階層の位置に縦線を続ける
//   isLast: この行が、兄弟の最後かどうか。最後なら「└」、そうでなければ「├」
// 線は、親の行のチェックボックスの真ん中（階層の左端 + 10px）に引く。
function addTreeGuides(row, depth, lastFlags, isLast) {
  row.style.position = 'relative';
  const line = function (css) {
    const d = document.createElement('div');
    d.className = 'absolute bg-slate-400 pointer-events-none';
    Object.keys(css).forEach(function (k) { d.style[k] = css[k]; });
    row.appendChild(d);
  };
  lastFlags.forEach(function (last, k) {
    if (!last) line({ left: (k * TREE_INDENT + 10) + 'px', top: '0', bottom: '0', width: '1px' });
  });
  const x = (depth - 1) * TREE_INDENT + 10;
  line({ left: x + 'px', top: '0', height: isLast ? '50%' : '100%', width: '1px' });                  // 縦線（最後の行は、真ん中まで）
  line({ left: x + 'px', top: '50%', width: (TREE_INDENT - 12) + 'px', height: '1px' });               // 横線（項目の手前まで）
}

// 木を作る。各階層に、フォルダと問題集を混ぜた1本の並び（order）を持たせる。
// 並びは、一覧（index.json）の配列の順番で決まる。問題集は自分の順番、フォルダは「中の最初の問題集」の順番。
// これで、問題集をフォルダより上にも置ける（▲▼で、フォルダと問題集を区別せず入れ替える）。
function buildTree(sets) {
  const root = { name: '', key: '', folders: [], items: [], order: [] };
  sets.forEach(function (s) {
    const parts = s.path.split('/');
    let node = root;
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? (prefix + '/' + parts[i]) : parts[i];
      let next = null;
      for (const f of node.folders) { if (f.name === parts[i]) { next = f; break; } }
      if (!next) {
        next = { name: parts[i], key: prefix, folders: [], items: [], order: [] };
        node.folders.push(next);
        node.order.push({ folder: next });
      }
      node = next;
    }
    node.items.push(s);
    node.order.push({ item: s });
  });
  return root;
}

// フォルダの中（さらに下のフォルダも含む）の問題集すべて
function collectSets(node) {
  let out = node.items.slice();
  node.folders.forEach(function (f) { out = out.concat(collectSets(f)); });
  return out;
}

// フォルダの選択欄。中の問題集がすべて「そのまま」で選ばれていれば on、一部なら partial、1つもなければ off
function makeFolderCheckbox(folder, isRoot) {
  const sets = collectSets(folder);
  const selectedCount = sets.filter(function (s) { return isSelected(s.path); }).length;
  const state = selectedCount === 0 ? 'off' : (selectedCount === sets.length ? 'on' : 'partial');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'relative flex items-center justify-center w-5 h-5 border-2 border-black cursor-pointer shrink-0 focus:outline-none ' +
    (state === 'on' ? 'bg-black text-white' : 'bg-white text-black');
  if (isRoot) btn.title = state === 'on' ? 'すべての問題集の選択を外す' : 'すべての問題集を選ぶ';
  else btn.title = state === 'on' ? 'このフォルダの問題集の選択を外す' : 'このフォルダの問題集をすべて選ぶ';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'w-3 h-3' + (state === 'off' ? ' hidden' : ''));
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', state === 'partial' ? 'M6 12h12' : 'M5 13l4 4L19 7');   // 一部だけなら横線
  svg.appendChild(path);
  btn.appendChild(svg);

  btn.addEventListener('click', function () {
    const turnOn = state !== 'on';
    // 選ぶときは、まだ選んでいない問題集を「そのまま」で選ぶ（すでに選んでいる向きは、そのまま残す）。外すときは、逆向きも含めて、すべて外す
    sets.forEach(function (s) { if (!turnOn || !isSelected(s.path)) setSelected(s.path, turnOn); });
    renderLibrary();
  });
  return btn;
}

// 一番上の階層（名前のないルートフォルダ）の行。チェックボックスは、全問題集をまとめて選ぶ・外す。
// 名前も絵も置かない（完全に無名）。最上位の項目は、この行の下に線でつながる。
function renderRootRow(root, container) {
  const row = document.createElement('div');
  row.className = 'w-full flex items-center py-1.5 hover:bg-slate-50';
  row.style.position = 'relative';

  const box = makeFolderCheckbox(root, true);
  box.classList.add('mr-2');

  row.appendChild(box);

  // チェックボックスの真ん中から、行の下まで縦線を引く（次の行の線へつなげる）
  const line = document.createElement('div');
  line.className = 'absolute bg-slate-400 pointer-events-none';
  line.style.left = '10px';
  line.style.top = 'calc(50% + 10px)';
  line.style.bottom = '0';
  line.style.width = '1px';
  row.appendChild(line);

  container.appendChild(row);
}

function renderNode(node, container, depth, lastFlags) {
  lastFlags = lastFlags || [];
  function renderFolder(f, isLast) {
    const isClosed = closedFolders[f.key] === true;

    const row = document.createElement('div');
    row.className = 'w-full flex items-center py-1.5 hover:bg-slate-50';
    row.style.paddingLeft = ((depth + 1) * TREE_INDENT) + 'px';   // 最上位も、ルートの中の1階層目として、線の分だけ内側から始める

    const toggle = document.createElement('button');
    toggle.className = 'flex-1 flex items-center text-left focus:outline-none';

    const mark = document.createElement('span');
    mark.className = 'w-4 text-slate-400';
    mark.textContent = isClosed ? '▸' : '▾';

    const name = document.createElement('span');
    name.className = 'font-bold text-slate-700';
    name.textContent = f.name;

    toggle.appendChild(mark);
    toggle.appendChild(name);
    toggle.addEventListener('click', function () {
      closedFolders[f.key] = !isClosed;
      renderLibrary();
    });

    const box = makeFolderCheckbox(f);
    box.classList.add('mr-2');
    row.appendChild(box);
    row.appendChild(toggle);
    addTreeGuides(row, depth + 1, lastFlags, isLast);
    container.appendChild(row);

    // 中の階層には、この行が兄弟の最後かどうかを渡す
    if (!isClosed) renderNode(f, container, depth + 1, lastFlags.concat([isLast]));
  }

  function renderItem(s, isLast) {
    const row = document.createElement('div');
    row.className = 'flex items-center py-1.5 hover:bg-slate-50';
    row.style.paddingLeft = ((depth + 1) * TREE_INDENT) + 'px';   // フォルダと同じ階層なら、同じ左端（余分な字下げを付けない）

    if (!selection[s.path]) selection[s.path] = { normal: false, swap: false };

    const solo = document.createElement('div');
    solo.className = 'mr-2';
    solo.appendChild(makeSelectBox(s.path));
    row.appendChild(solo);

    const label = document.createElement('span');
    label.className = 'text-slate-800 cursor-pointer';
    label.textContent = s.title || s.path.split('/').pop();
    label.addEventListener('click', function () {
      // 名前を押したときは、選ぶ（そのまま）／外すを切り替える。向きを順に切り替えず、手軽に選び外しできるようにする
      setSelected(s.path, !isSelected(s.path));
      renderLibrary();
    });

    const count = document.createElement('span');
    count.className = 'ml-2 text-xs text-slate-400';
    count.textContent = (s.count || 0) + '問';

    row.appendChild(label);
    row.appendChild(count);
    addTreeGuides(row, depth + 1, lastFlags, isLast);
    container.appendChild(row);
  }

  // フォルダと問題集は、混ぜた1本の並びのまま描く
  node.order.forEach(function (e, i) {
    const isLast = i === node.order.length - 1;
    if (e.folder) renderFolder(e.folder, isLast); else renderItem(e.item, isLast);
  });
}

function renderLibrary() {
  const sets = libraryIndex.sets;
  const scrollTop = libraryTree.scrollTop;   // 描き直しても、スクロール位置が先頭へ戻らないように
  libraryTree.innerHTML = '';

  if (libraryIndex.sets.length === 0) {
    setTreeMessage('まだ問題集がありません。「問題集を追加」から登録してください。');
  } else {
    const root = buildTree(sets);
    renderRootRow(root, libraryTree);
    renderNode(root, libraryTree, 0);
  }
  libraryTree.scrollTop = scrollTop;
  // 矢印の意味の凡例。逆向きを許可した問題集があるときだけ出す
  libraryLegend.classList.toggle('hidden', !sets.some(function (s) { return s.allowSwap; }));
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
  renderShortcuts();   // 選び直したとき、ショートカットの「変更あり」を更新する
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
