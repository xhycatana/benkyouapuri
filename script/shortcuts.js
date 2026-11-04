// 選択のショートカット。問題集の選び方に名前を付けて保存し、1回押すと選択を復元する。
// ----------------------------------------------------------------------
// 保存するのは、問題集の場所（パス）と、そのまま／逆向きのチェックだけ。出題の設定（上限など）は含めない。
// 使い方は、「ショートカットを押す → 選び直す → 上書き」。中身の変更に、専用の画面は使わない。
// 並べ替え・名前の変更・削除は、管理ページで行う（renderManageShortcuts）。

let shortcuts = [];            // [{ id, name, items: [{ path, normal, swap }] }]
let activeShortcutId = null;   // いま使っているショートカット（押したもの、保存したもの）
let shortcutNotice = '';       // 押したときに見つからなかった問題集などの知らせ
let shortcutNoticeKey = '';    // 知らせを出した時点の選択。選び直したら、知らせは消す
let shortcutOrderTimer = null;

// いまの選択を、保存する形にする（場所の順に並べておく。比べるときに順番の違いを無視できるように）
function currentSelectionItems() {
  return Object.keys(selection).filter(isSelected).sort().map(function (path) {
    return { path: path, normal: !!selection[path].normal, swap: !!selection[path].swap };
  });
}

function sameShortcutItems(a, b) {
  const key = function (list) {
    return JSON.stringify(list.slice().sort(function (x, y) { return x.path < y.path ? -1 : x.path > y.path ? 1 : 0; })
      .map(function (it) { return [it.path, !!it.normal, !!it.swap]; }));
  };
  return key(a) === key(b);
}

// --- 読み込み・保存 ---
async function loadShortcuts() {
  try {
    const data = await api('/api/questions?kind=shortcuts');
    shortcuts = Array.isArray(data && data.shortcuts) ? data.shortcuts : [];
    if (!shortcuts.some(function (s) { return s.id === activeShortcutId; })) activeShortcutId = null;
  } catch (err) {
    // 読めなくても、問題集の選択は普通に使える
  }
  renderShortcuts();
}

// 並べ替えのあとは少し待ってからまとめて送る。名前の変更・追加・削除はすぐ送る
async function persistShortcuts() {
  clearTimeout(shortcutOrderTimer);
  shortcutOrderTimer = null;
  try {
    await enqueueManage(function () {
      return postJSON({ kind: 'shortcuts', shortcuts: shortcuts });
    });
    return true;
  } catch (err) {
    if (!err.unauthorized) alert('ショートカットを保存できませんでした: ' + err.message);
    await loadShortcuts();   // 保存できなかったので、サーバーの状態に戻す
    renderManageShortcuts();
    return false;
  }
}

function persistShortcutsSoon() {
  clearTimeout(shortcutOrderTimer);
  shortcutOrderTimer = setTimeout(persistShortcuts, 700);
}

// --- 呼び出し（選択を、ショートカットの内容に置き換える） ---
function applyShortcut(sc) {
  const next = {};
  let missing = 0;
  sc.items.forEach(function (it) {
    const set = libraryIndex.sets.find(function (s) { return s.path === it.path; });
    if (!set) { missing++; return; }   // 削除された問題集などは飛ばす
    next[it.path] = { normal: !!it.normal, swap: !!it.swap && !!set.allowSwap };
  });
  selection = next;
  activeShortcutId = sc.id;
  shortcutNotice = missing > 0 ? (missing + '冊は見つかりませんでした') : '';
  shortcutNoticeKey = JSON.stringify(currentSelectionItems());
  renderLibrary();
}

// --- 保存・上書き ---
async function createShortcut() {
  const items = currentSelectionItems();
  if (items.length === 0) return;
  const name = (prompt('ショートカットの名前を入力してください。') || '').trim();
  if (!name) return;
  if (shortcuts.some(function (s) { return s.name === name; }) && !confirm('同じ名前のショートカットがあります。そのまま作りますか。')) return;
  const sc = { id: generateUUID(), name: name.slice(0, 40), items: items };
  shortcuts.push(sc);
  activeShortcutId = sc.id;
  shortcutNotice = '';
  renderShortcuts();
  await persistShortcuts();
}

async function overwriteShortcut() {
  const sc = shortcuts.find(function (s) { return s.id === activeShortcutId; });
  const items = currentSelectionItems();
  if (!sc || items.length === 0) return;
  if (!confirm('「' + sc.name + '」を上書きします（' + sc.items.length + '冊 → ' + items.length + '冊）。よろしいですか。')) return;
  sc.items = items;
  shortcutNotice = '';
  renderShortcuts();
  await persistShortcuts();
}

// --- ホーム画面の表示 ---
function renderShortcuts() {
  libraryShortcuts.innerHTML = '';
  shortcutActions.innerHTML = '';

  const items = currentSelectionItems();
  const active = shortcuts.find(function (s) { return s.id === activeShortcutId; }) || null;
  const differs = !!active && !sameShortcutItems(active.items, items);

  shortcuts.forEach(function (sc) {
    const on = !!active && sc.id === active.id;
    const b = makeEl('button', 'px-2.5 py-1 text-xs border focus:outline-none ' +
      (on ? 'bg-black text-white border-black' : 'bg-white text-slate-600 border-slate-300 hover:border-black'), sc.name);
    b.title = sc.items.length + '冊';
    b.addEventListener('click', function () { applyShortcut(sc); });
    libraryShortcuts.appendChild(b);
  });
  if (differs) libraryShortcuts.appendChild(makeEl('span', 'ml-1 text-[10px] text-slate-400', '変更あり'));

  // 保存のリンクは、見出し「問題集から選ぶ」の右側（いつもある行）に出す。
  // 一覧の上に行を出し入れすると、選ぶたびに一覧が押し下げられて、スクロールがずれるため。
  // どのショートカットを上書きするかは、強調されているボタン（active）で分かるので、ラベルは短くする。
  const link = function (label, title, onClick) {
    const b = makeEl('button', 'text-xs text-slate-600 hover:text-black underline focus:outline-none whitespace-nowrap', label);
    b.title = title;
    b.addEventListener('click', onClick);
    shortcutActions.appendChild(b);
  };
  if (items.length > 0) {
    if (differs) link('上書き', '「' + active.name + '」の中身を、いまの選択に置き換える', overwriteShortcut);
    link(active ? '別名で保存' : '選択を保存', '問題集の選び方に名前を付けて、ショートカットとして保存する', createShortcut);
  }

  // 見つからなかった問題集の知らせは、一覧の下の「○冊を選択中」の行に出す（高さが変わらない場所）
  libraryNotice.textContent = (shortcutNotice && JSON.stringify(items) === shortcutNoticeKey) ? shortcutNotice : '';
}

// --- 管理ページ（並べ替え・名前の変更・削除） ---
function renderManageShortcuts() {
  manageShortcuts.innerHTML = '';
  if (shortcuts.length === 0) {
    manageShortcuts.appendChild(makeEl('p', 'text-xs text-slate-400', 'まだありません。'));
    return;
  }
  shortcuts.forEach(function (sc, i) {
    const row = makeEl('div', 'flex items-center py-1');

    const arrows = makeEl('div', 'flex shrink-0 mr-2');
    const move = function (delta) {
      if (!swapSibling(shortcuts, i, delta)) return;
      renderManageShortcuts();
      renderShortcuts();
      persistShortcutsSoon();
    };
    arrows.appendChild(makeArrowButton('▲', '上へ', i === 0, function () { move(-1); }));
    arrows.appendChild(makeArrowButton('▼', '下へ', i === shortcuts.length - 1, function () { move(1); }));

    const name = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-slate-200 text-sm focus:outline-none focus:border-black');
    name.type = 'text';
    name.value = sc.name;
    name.addEventListener('change', async function () {
      const v = name.value.trim();
      if (!v) { name.value = sc.name; return; }
      sc.name = v.slice(0, 40);
      renderShortcuts();
      await persistShortcuts();
    });

    const count = makeEl('span', 'mx-2 text-xs text-slate-400 shrink-0', sc.items.length + '冊');

    const del = makeEl('button', 'w-7 h-7 shrink-0 ml-1 text-sm text-slate-300 hover:text-red-600 focus:outline-none', '×');
    del.title = 'このショートカットを削除';
    del.addEventListener('click', async function () {
      if (!confirm('ショートカット「' + sc.name + '」を削除します。よろしいですか。（問題集は消えません）')) return;
      shortcuts = shortcuts.filter(function (s) { return s !== sc; });
      if (activeShortcutId === sc.id) activeShortcutId = null;
      renderManageShortcuts();
      renderShortcuts();
      await persistShortcuts();
    });

    row.appendChild(arrows);
    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(del);
    manageShortcuts.appendChild(row);
  });
}
