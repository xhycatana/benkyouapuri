// 問題集の管理（並べ替え・名前の変更・削除）と、問題集の編集（問題・見出しの書き換え、成績のリセット）。
// ----------------------------------------------------------------------

// 一覧（index.json）を書き換える通信は、同時に走らせると更新がぶつかって失敗する。
// そのため、並べ替え・名前の変更・削除・編集の保存は、すべてこの列に並べて1つずつ順に行う。
let manageQueue = Promise.resolve();
function enqueueManage(job) {
  const run = manageQueue.then(job);
  manageQueue = run.catch(function () {});
  return run;
}

function postJSON(body) {
  return api('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function makeEl(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setMessage(box, text, kind) {
  box.textContent = text || '';
  box.className = 'text-xs ' + (kind === 'error' ? 'text-red-600' : kind === 'ok' ? 'text-green-700' : 'text-slate-500');
}


// =====================================================================
// 管理ページ（一覧の並べ替え・名前・削除）
// =====================================================================

// 木を、画面に並ぶ順のまま平らな一覧に戻す（フォルダが先、その後ろにフォルダ直下の問題集）。
// 一覧の保存順＝この順にしておくと、読み込み直したときに同じ並びの木が作られる。
function flattenTree(node) {
  let out = [];
  node.folders.forEach(function (f) { out = out.concat(flattenTree(f)); });
  return out.concat(node.items);
}

function swapSibling(list, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return false;
  const tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
  return true;
}

let orderTimer = null;

function saveOrderNow() {
  if (orderTimer === null) return Promise.resolve();
  clearTimeout(orderTimer);
  orderTimer = null;
  const paths = libraryIndex.sets.map(function (s) { return s.path; });
  return enqueueManage(function () {
    return postJSON({ kind: 'order', paths: paths });
  }).then(function () {
    setMessage(manageMessage, '並び順を保存しました。', 'ok');
  }).catch(function (err) {
    if (!err.unauthorized) setMessage(manageMessage, '並び順を保存できませんでした: ' + err.message, 'error');
  });
}

// 連続して押している間は送らず、止まってからまとめて1回だけ保存する
function scheduleOrderSave() {
  setMessage(manageMessage, '並び順を保存します…');
  clearTimeout(orderTimer);
  orderTimer = setTimeout(saveOrderNow, 700);
}

function makeArrowButton(label, title, disabled, onClick) {
  const b = makeEl('button', 'w-7 h-7 shrink-0 border border-slate-300 text-[10px] text-slate-500 hover:border-black hover:text-black focus:outline-none disabled:opacity-20 disabled:pointer-events-none', label);
  b.title = title;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderManageNode(node, container, depth, root) {
  function moveButtons(list, i) {
    const wrap = makeEl('div', 'flex shrink-0 mr-2');
    wrap.appendChild(makeArrowButton('▲', '上へ', i === 0, function () {
      if (swapSibling(list, i, -1)) afterMove(root);
    }));
    wrap.appendChild(makeArrowButton('▼', '下へ', i === list.length - 1, function () {
      if (swapSibling(list, i, 1)) afterMove(root);
    }));
    return wrap;
  }

  node.folders.forEach(function (f, i) {
    const isClosed = closedFolders[f.key] === true;
    const row = makeEl('div', 'flex items-center py-1');
    row.style.paddingLeft = (depth * 12) + 'px';
    row.appendChild(moveButtons(node.folders, i));

    const toggle = makeEl('button', 'w-6 h-7 shrink-0 text-slate-400 hover:text-black focus:outline-none', isClosed ? '▸' : '▾');
    toggle.title = isClosed ? '開く' : '閉じる';
    toggle.addEventListener('click', function () {
      closedFolders[f.key] = !isClosed;
      renderManage();
    });
    row.appendChild(toggle);

    // フォルダの名前。書き換えて確定すると、中の問題集の場所がまとめて変わる（フォルダ名の変更）
    const fname = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-transparent hover:border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:border-black');
    fname.type = 'text';
    fname.value = f.name;
    fname.addEventListener('change', function () { renameFolder(f, fname); });
    row.appendChild(fname);

    const fmove = makeEl('button', 'ml-1 px-2 h-7 shrink-0 border border-slate-300 text-[10px] text-slate-500 hover:border-black hover:text-black focus:outline-none', '移動');
    fmove.title = 'このフォルダを、別の場所へ移す';
    fmove.addEventListener('click', function () { openMoveDialog(f.key, true); });
    row.appendChild(fmove);
    container.appendChild(row);

    if (!isClosed) renderManageNode(f, container, depth + 1, root);
  });

  node.items.forEach(function (s, i) {
    const row = makeEl('div', 'flex items-center py-1');
    row.style.paddingLeft = (depth * 12) + 'px';
    row.appendChild(moveButtons(node.items, i));

    // 名前（タイトル）。書き換えて確定すると、その場で保存される
    const name = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-slate-200 text-sm focus:outline-none focus:border-black');
    name.type = 'text';
    name.value = s.title || s.path.split('/').pop();
    name.addEventListener('change', function () {
      renameSet(s, name);
    });

    const count = makeEl('span', 'mx-2 text-xs text-slate-400 shrink-0', (s.count || 0) + '問');

    const edit = makeEl('button', 'w-7 h-7 shrink-0 border border-slate-300 text-sm text-slate-500 hover:border-black hover:text-black focus:outline-none', '✎');
    edit.title = '問題・見出しを編集';
    edit.addEventListener('click', function () { openEditor(s); });

    const mv = makeEl('button', 'ml-1 px-2 h-7 shrink-0 border border-slate-300 text-[10px] text-slate-500 hover:border-black hover:text-black focus:outline-none', '移動');
    mv.title = 'この問題集を、別のフォルダへ移す';
    mv.addEventListener('click', function () { openMoveDialog(s.path, false); });

    const del = makeEl('button', 'w-7 h-7 shrink-0 ml-1 text-sm text-slate-300 hover:text-red-600 focus:outline-none', '×');
    del.title = 'この問題集を削除';
    del.addEventListener('click', function () { deleteSet(s); });

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(edit);
    row.appendChild(mv);
    row.appendChild(del);
    container.appendChild(row);
  });
}

function afterMove(root) {
  libraryIndex.sets = flattenTree(root);
  renderManage();
  scheduleOrderSave();
}

function renderManage() {
  renderManageShortcuts();
  manageTree.innerHTML = '';
  if (libraryIndex.sets.length === 0) {
    manageTree.appendChild(makeEl('p', 'text-xs text-slate-400', 'まだ問題集がありません。'));
    return;
  }
  const root = buildTree(libraryIndex.sets);
  renderManageNode(root, manageTree, 0, root);
}

async function renameSet(set, input) {
  const title = input.value.trim();
  if (!title) {
    input.value = set.title || set.path.split('/').pop();
    setMessage(manageMessage, '名前を空にはできません。', 'error');
    return;
  }
  if (title === set.title) return;
  setMessage(manageMessage, '名前を保存します…');
  try {
    await enqueueManage(function () {
      return postJSON({ kind: 'meta', path: set.path, title: title });
    });
    set.title = title;
    renderLibrary();
    setMessage(manageMessage, '名前を変更しました。', 'ok');
  } catch (err) {
    input.value = set.title || set.path.split('/').pop();
    if (!err.unauthorized) setMessage(manageMessage, '名前を変更できませんでした: ' + err.message, 'error');
  }
}

btnOpenManage.addEventListener('click', function () {
  setMessage(manageMessage, '');
  renderManage();
  switchPhase('manage');
});

btnManageBack.addEventListener('click', function () {
  saveOrderNow();
  if (shortcutOrderTimer !== null) persistShortcuts();   // 並べ替え待ちのショートカットも送る
  switchPhase('import');
});


// =====================================================================
// 編集ページ（問題・見出しの書き換え、成績のリセット）
// =====================================================================
// 問題集の中身は「見出し…→問題文」を改行でつないだ1つの文字列（question）で持っている。
// 最後の1行が問題文、それより上の行がすべて見出し。見出しの書き換えは、
// 同じ見出しを通る問題すべての、その行を置き換えることで行う。
// 書き換えても問題の id は変えないので、成績（id ごとに持っている）は引き継がれる。

let editState = null;   // { set, questions: [{ id, lines, answer, commentary, reset, removed }] }
let editDirty = false;

function markEditDirty() {
  editDirty = true;
  setMessage(editMessage, '');
}

async function openEditor(set) {
  await saveOrderNow();
  editState = null;
  editDirty = false;
  editSubtitle.textContent = set.path;
  editTitle.value = set.title || set.path.split('/').pop();
  editAllowSwap.checked = !!set.allowSwap;
  editSearch.value = '';
  editHeadings.innerHTML = '';
  editList.innerHTML = '';
  editCount.textContent = '';
  btnEditSave.disabled = true;
  btnEditResetAll.disabled = true;
  setMessage(editMessage, '読み込み中…');
  switchPhase('edit');

  try {
    const data = await api('/api/questions?path=' + encodeURIComponent(set.path));
    editState = {
      set: set,
      questions: (data.questions || []).map(function (q) {
        return {
          id: q.id,
          lines: String(q.question).split('\n'),
          answer: String(q.answer || ''),
          commentary: String(q.commentary || ''),
          reset: false,
          removed: false
        };
      })
    };
    btnEditSave.disabled = false;
    btnEditResetAll.disabled = false;
    setMessage(editMessage, '');
    renderEdit();
  } catch (err) {
    if (!err.unauthorized) setMessage(editMessage, err.message, 'error');
  }
}

function renderEdit() {
  renderEditHeadings();
  renderEditList();
}

// --- 見出し ---
// 見出しの木。同じ見出しは1つにまとめて、通っている問題の数を添える。
function collectHeadingNodes() {
  const nodes = [];
  const seen = {};
  editState.questions.forEach(function (q) {
    for (let k = 0; k < q.lines.length - 1; k++) {
      const path = q.lines.slice(0, k + 1);
      const key = JSON.stringify(path);
      if (!seen[key]) {
        seen[key] = { path: path, count: 0 };
        nodes.push(seen[key]);
      }
      seen[key].count++;
    }
  });
  return nodes;
}

// 「問題を追加」で選べる見出し。0 番目は見出しなし、最後は新しい見出し
let addHeadingChoices = [];

function renderAddHeadingOptions(nodes) {
  const keep = editAddHeading.value;
  addHeadingChoices = nodes.map(function (n) { return n.path; });
  editAddHeading.innerHTML = '';
  const add = function (value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    editAddHeading.appendChild(o);
  };
  add('none', '（見出しなし）');
  addHeadingChoices.forEach(function (path, i) { add(String(i), path.join(' › ')); });
  add('new', '新しい見出しを作る…');
  if (Array.prototype.some.call(editAddHeading.options, function (o) { return o.value === keep; })) editAddHeading.value = keep;
  editAddNewHeading.classList.toggle('hidden', editAddHeading.value !== 'new');
}

function renderEditHeadings() {
  editHeadings.innerHTML = '';
  const nodes = collectHeadingNodes();
  renderAddHeadingOptions(nodes);
  if (nodes.length === 0) {
    editHeadings.appendChild(makeEl('p', 'text-xs text-slate-400', 'この問題集に見出しはありません。'));
    return;
  }
  nodes.forEach(function (n) {
    const row = makeEl('div', 'flex items-center py-0.5');
    row.style.paddingLeft = ((n.path.length - 1) * 14) + 'px';
    const input = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-slate-200 text-xs focus:outline-none focus:border-black');
    input.type = 'text';
    input.value = n.path[n.path.length - 1];
    input.addEventListener('change', function () { renameHeading(n.path, input); });
    row.appendChild(input);
    row.appendChild(makeEl('span', 'ml-2 text-[10px] text-slate-400 shrink-0', n.count + '問'));
    editHeadings.appendChild(row);
  });
}

function renameHeading(path, input) {
  const name = input.value.trim();
  const k = path.length - 1;
  if (!name) {
    input.value = path[k];
    setMessage(editMessage, '見出しを空にはできません。', 'error');
    return;
  }
  if (name === path[k]) return;
  editState.questions.forEach(function (q) {
    if (q.lines.length <= path.length) return;
    for (let i = 0; i < path.length; i++) {
      if (q.lines[i] !== path[i]) return;
    }
    q.lines[k] = name;
  });
  markEditDirty();
  renderEdit();
}

// --- 問題の一覧 ---
function questionStatsText(q) {
  const st = progressStats[q.id];
  if (!st) return '未解答';
  return '⭕' + (st.correct || 0) + ' ❌' + (st.incorrect || 0);
}

function renderEditList() {
  editList.innerHTML = '';
  const word = editSearch.value.trim().toLowerCase();
  let shown = 0;

  editState.questions.forEach(function (q) {
    const heads = q.lines.slice(0, -1).join(' › ');
    const body = q.lines[q.lines.length - 1];
    if (word) {
      const hay = (heads + ' ' + body + ' ' + q.answer + ' ' + q.commentary).toLowerCase();
      if (hay.indexOf(word) === -1) return;
    }
    shown++;

    const card = makeEl('div', 'py-2 border-b border-slate-200 space-y-1');
    if (q.removed) card.classList.add('opacity-40');
    if (heads) card.appendChild(makeEl('div', 'text-[10px] text-slate-400 break-words', heads));

    const text = makeEl('textarea', 'w-full p-1.5 border border-slate-200 text-sm focus:outline-none focus:border-black');
    text.rows = 2;
    text.value = body;
    text.addEventListener('input', function () {
      q.lines[q.lines.length - 1] = text.value;
      markEditDirty();
    });

    const answer = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-slate-200 text-sm focus:outline-none focus:border-black');
    answer.type = 'text';
    answer.placeholder = '答え';
    answer.value = q.answer;
    answer.addEventListener('input', function () { q.answer = answer.value; markEditDirty(); });

    const commentary = makeEl('input', 'flex-1 min-w-0 p-1.5 border border-slate-200 text-xs focus:outline-none focus:border-black');
    commentary.type = 'text';
    commentary.placeholder = '解説';
    commentary.value = q.commentary;
    commentary.addEventListener('input', function () { q.commentary = commentary.value; markEditDirty(); });

    const foot = makeEl('div', 'flex items-center text-[10px] text-slate-400');
    foot.appendChild(makeEl('span', '', questionStatsText(q)));
    if (q.reset) foot.appendChild(makeEl('span', 'ml-2 font-bold text-red-600', '保存すると成績をリセット'));
    if (q.removed) foot.appendChild(makeEl('span', 'ml-2 font-bold text-red-600', '保存すると削除'));
    if (q.isNew) foot.appendChild(makeEl('span', 'ml-2 font-bold text-slate-600', '新規'));

    const resetBtn = makeEl('button', 'ml-auto px-2 h-6 border text-[10px] focus:outline-none ' +
      (q.reset ? 'bg-black text-white border-black' : 'border-slate-300 text-slate-500 hover:border-black hover:text-black'), '成績リセット');
    resetBtn.title = 'この問題の成績（正答率）をリセットする。保存したときに反映されます';
    resetBtn.addEventListener('click', function () {
      q.reset = !q.reset;
      markEditDirty();
      renderEditList();
    });

    const removeBtn = makeEl('button', 'ml-1 px-2 h-6 border text-[10px] focus:outline-none ' +
      (q.removed ? 'bg-black text-white border-black' : 'border-slate-300 text-slate-500 hover:border-red-600 hover:text-red-600'), '削除');
    removeBtn.title = 'この問題を削除する。保存したときに反映されます';
    removeBtn.addEventListener('click', function () {
      q.removed = !q.removed;
      markEditDirty();
      renderEditList();
    });

    foot.appendChild(resetBtn);
    foot.appendChild(removeBtn);

    const fields = makeEl('div', 'flex gap-1');
    fields.appendChild(answer);
    fields.appendChild(commentary);

    card.appendChild(text);
    card.appendChild(fields);
    card.appendChild(foot);
    editList.appendChild(card);
  });

  const total = editState.questions.length;
  editCount.textContent = word ? (shown + ' / ' + total + '問を表示') : (total + '問');
  if (shown === 0) editList.appendChild(makeEl('p', 'text-xs text-slate-400 py-2', '当てはまる問題がありません。'));
}

editSearch.addEventListener('input', function () {
  if (editState) renderEditList();
});

editAddHeading.addEventListener('change', function () {
  editAddNewHeading.classList.toggle('hidden', editAddHeading.value !== 'new');
});

// --- 問題を1問ずつ追加する ---
// 選んだ見出しの下の、いちばん最後に入れる（見出しごとの並びが崩れないように）。
function addQuestionToEdit() {
  if (!editState) return;
  const text = editAddQuestion.value.trim();
  const answer = editAddAnswer.value.trim();
  if (!text || !answer) {
    setMessage(editMessage, '追加する問題の、問題文と答えを入力してください。', 'error');
    return;
  }

  let heading = [];
  if (editAddHeading.value === 'new') {
    const name = editAddNewHeading.value.trim();
    if (!name) {
      setMessage(editMessage, '新しい見出しの名前を入力してください。', 'error');
      return;
    }
    heading = [name];
  } else if (editAddHeading.value !== 'none') {
    heading = addHeadingChoices[parseInt(editAddHeading.value, 10)] || [];
  }

  const entry = {
    id: generateUUID(),
    lines: heading.concat([text]),
    answer: answer,
    commentary: editAddCommentary.value.trim(),
    reset: false,
    removed: false,
    isNew: true
  };

  // 同じ見出しを通る問題の、最後の次に入れる。見つからなければ末尾
  let at = editState.questions.length;
  if (heading.length > 0) {
    for (let i = editState.questions.length - 1; i >= 0; i--) {
      const lines = editState.questions[i].lines;
      if (lines.length > heading.length && heading.every(function (s, k) { return lines[k] === s; })) { at = i + 1; break; }
    }
  }
  editState.questions.splice(at, 0, entry);

  editAddQuestion.value = '';
  editAddAnswer.value = '';
  editAddCommentary.value = '';
  markEditDirty();
  renderEdit();
  setMessage(editMessage, '問題を追加しました（「保存する」を押すと反映されます）。', 'ok');
}

btnEditAdd.addEventListener('click', addQuestionToEdit);
editTitle.addEventListener('input', markEditDirty);
editAllowSwap.addEventListener('change', markEditDirty);

// --- 成績のリセット ---
// 端末の控えから先に消す（残っていると、次の書き戻しで復活してしまうため）。
// サーバーへの送信に失敗したときは、消した控えを元に戻す。
async function resetProgressFor(ids) {
  const backup = {};
  ids.forEach(function (id) {
    [id, id + ':swap'].forEach(function (key) {
      if (progressStats[key]) { backup[key] = progressStats[key]; delete progressStats[key]; }
    });
  });
  writeLocalProgress();
  try {
    await enqueueManage(function () {
      return postJSON({ kind: 'progress-reset', ids: ids });
    });
  } catch (err) {
    Object.keys(backup).forEach(function (key) { progressStats[key] = backup[key]; });
    writeLocalProgress();
    throw err;
  }
}

btnEditResetAll.addEventListener('click', async function () {
  if (!editState) return;
  const ids = editState.questions.map(function (q) { return q.id; });
  if (!confirm('この問題集の成績（正答率）を、' + ids.length + '問ぶんすべてリセットします。よろしいですか。' +
               String.fromCharCode(10) + '元には戻せません。')) return;
  try {
    await resetProgressFor(ids);
    editState.questions.forEach(function (q) { q.reset = false; });
    renderEditList();
    setMessage(editMessage, '成績をリセットしました。', 'ok');
  } catch (err) {
    if (!err.unauthorized) setMessage(editMessage, '成績をリセットできませんでした: ' + err.message, 'error');
  }
});

// --- 保存 ---
async function saveEdit() {
  if (!editState) return;
  const title = editTitle.value.trim();
  if (!title) {
    setMessage(editMessage, '問題集の名前を入力してください。', 'error');
    return;
  }
  const kept = editState.questions.filter(function (q) { return !q.removed; });
  if (kept.length === 0) {
    setMessage(editMessage, '問題が1問も残りません。問題集ごと消すときは、管理ページの × を使ってください。', 'error');
    return;
  }
  const blank = kept.filter(function (q) {
    return !q.lines.join('\n').trim() || !q.answer.trim();
  });
  if (blank.length > 0) {
    setMessage(editMessage, '問題文か答えが空の問題が' + blank.length + '問あります。埋めるか、削除してください。', 'error');
    return;
  }
  const removedCount = editState.questions.length - kept.length;
  if (removedCount > 0 && !confirm(removedCount + '問を削除して保存します。よろしいですか。')) return;

  const resetIds = kept.filter(function (q) { return q.reset; }).map(function (q) { return q.id; });
  const payload = {
    path: editState.set.path,
    title: title,
    allowSwap: editAllowSwap.checked,
    overwrite: true,
    resetIds: resetIds,
    questions: kept.map(function (q) {
      return { id: q.id, question: q.lines.join('\n'), answer: q.answer, commentary: q.commentary };
    })
  };

  // 成績のリセットを頼むときは、端末の控えも先に消す（失敗したら戻す）
  const backup = {};
  resetIds.forEach(function (id) {
    [id, id + ':swap'].forEach(function (key) {
      if (progressStats[key]) { backup[key] = progressStats[key]; delete progressStats[key]; }
    });
  });
  if (resetIds.length > 0) writeLocalProgress();

  btnEditSave.disabled = true;
  btnEditSave.textContent = '保存中…';
  setMessage(editMessage, '');
  try {
    const r = await enqueueManage(function () { return postJSON(payload); });
    editState.questions = kept;
    editState.questions.forEach(function (q) { q.reset = false; q.isNew = false; });
    editDirty = false;
    setMessage(editMessage, '保存しました（' + r.count + '問' + (r.reset ? '、成績をリセット ' + resetIds.length + '問' : '') + '）。', 'ok');
    renderEdit();
    await loadLibrary();
    // 一覧を読み直すと、手元の set が新しいものに置き換わる
    const fresh = libraryIndex.sets.find(function (s) { return s.path === payload.path; });
    if (fresh) editState.set = fresh;
  } catch (err) {
    Object.keys(backup).forEach(function (key) { progressStats[key] = backup[key]; });
    if (resetIds.length > 0) writeLocalProgress();
    if (!err.unauthorized) setMessage(editMessage, '保存できませんでした: ' + err.message, 'error');
  } finally {
    btnEditSave.disabled = false;
    btnEditSave.textContent = '保存する';
  }
}

btnEditSave.addEventListener('click', saveEdit);

btnEditBack.addEventListener('click', function () {
  if (editDirty && !confirm('保存していない変更があります。破棄して戻りますか。')) return;
  editState = null;
  editDirty = false;
  renderManage();
  switchPhase('manage');
});


// =====================================================================
// 出題中に、いまの問題だけを書き換える
// =====================================================================
// 間違いに気づいたその場で直せるよう、出題画面・丸付け画面から開く。
// 問題集を読み直して該当の問題だけを差し替え、保存する（id は変えないので成績は引き継がれる）。
// 逆向き（答えを問題として出す）の問題は、元の問題集の側から直す。

function currentQuestionForEdit() {
  const q = currentList[currentIndex];
  if (!q) return null;
  if (!q.setPath || /:swap$/.test(q.id)) {
    alert('この問題は、ここでは書き換えられません（逆向きの出題、またはサンプルです）。ホーム画面の「管理」から、元の問題集を編集してください。');
    return null;
  }
  return q;
}

function openQuestionEdit() {
  if (isTransitioning) return;
  const q = currentQuestionForEdit();
  if (!q) return;
  const lines = q.question.split('\n');
  qeditHeadings.textContent = lines.slice(0, -1).join(' › ');
  qeditHeadings.classList.toggle('hidden', lines.length <= 1);
  qeditQuestion.value = lines[lines.length - 1];
  qeditAnswer.value = q.answer;
  qeditCommentary.value = q.commentary || '';
  qeditAnswerHint.classList.add('hidden');
  setMessage(qeditMessage, '');
  btnQeditSave.disabled = false;
  questionEditModal.classList.remove('hidden');
}

function closeQuestionEdit() {
  questionEditModal.classList.add('hidden');
}

qeditAnswer.addEventListener('input', function () {
  const q = currentList[currentIndex];
  if (!q) return;
  const changed = qeditAnswer.value.trim() !== q.answer;
  qeditAnswerHint.classList.toggle('hidden', !(changed && (multiAnswerProgress[q.id] || []).length > 0));
});

async function saveQuestionEdit() {
  const q = currentQuestionForEdit();
  if (!q) { closeQuestionEdit(); return; }
  const lines = q.question.split('\n');
  lines[lines.length - 1] = qeditQuestion.value.trim();
  const newQuestion = lines.join('\n');
  const newAnswer = qeditAnswer.value.trim();
  const newCommentary = qeditCommentary.value.trim();
  if (!qeditQuestion.value.trim() || !newAnswer) {
    setMessage(qeditMessage, '問題文と答えは空にできません。', 'error');
    return;
  }

  btnQeditSave.disabled = true;
  setMessage(qeditMessage, '保存中…');
  try {
    await enqueueManage(async function () {
      const set = await api('/api/questions?path=' + encodeURIComponent(q.setPath));
      const target = (set.questions || []).find(function (x) { return x.id === q.id; });
      if (!target) throw new Error('問題集の中にこの問題が見つかりません。管理ページで確認してください。');
      target.question = newQuestion;
      target.answer = newAnswer;
      target.commentary = newCommentary;
      await postJSON({
        path: q.setPath,
        title: set.title,
        allowSwap: !!set.allowSwap,
        overwrite: true,
        questions: set.questions
      });
    });
  } catch (err) {
    btnQeditSave.disabled = false;
    if (!err.unauthorized) setMessage(qeditMessage, '保存できませんでした: ' + err.message, 'error');
    return;
  }

  const answerChanged = newAnswer !== q.answer;
  q.question = newQuestion;
  q.answer = newAnswer;
  q.commentary = newCommentary;
  if (answerChanged) delete multiAnswerProgress[q.id];   // 答えの項目が変わるので、正解済みの記録は使えない
  closeQuestionEdit();

  // 画面の表示を直す。書きかけの答案は残す
  if (currentPhase === 'test') {
    testQuestion.innerText = q.question;
    testAnswerCountHint.textContent = answerCountHintText(q);
    placePageDivider();
  } else if (currentPhase === 'review') {
    userAnswers[q.id] = collectAnswerPages();
    showReviewItem();
  }
}

btnEditQuestionTest.addEventListener('click', openQuestionEdit);
btnEditQuestionReview.addEventListener('click', openQuestionEdit);
btnQeditCancel.addEventListener('click', closeQuestionEdit);
btnQeditSave.addEventListener('click', saveQuestionEdit);

// --- 出題中に、いまの問題を削除する ---
// 問題集から消し、この回の出題リストからも外して、次の問題へ進む（解答履歴は残る。問題集ごと消したときと同じ）。
async function deleteCurrentQuestion() {
  const q = currentQuestionForEdit();
  if (!q) { closeQuestionEdit(); return; }
  if (!confirm('この問題を、問題集から削除します。よろしいですか。' + String.fromCharCode(10) +
               '解答履歴は残ります。')) return;

  btnQeditDelete.disabled = true;
  btnQeditSave.disabled = true;
  setMessage(qeditMessage, '削除中…');
  try {
    await enqueueManage(async function () {
      const set = await api('/api/questions?path=' + encodeURIComponent(q.setPath));
      const remaining = (set.questions || []).filter(function (x) { return x.id !== q.id; });
      if (remaining.length === (set.questions || []).length) throw new Error('問題集の中にこの問題が見つかりません。');
      if (remaining.length === 0) throw new Error('この問題集の最後の1問です。問題集ごと消すときは、ホーム画面の「管理」の × を使ってください。');
      await postJSON({
        path: q.setPath,
        title: set.title,
        allowSwap: !!set.allowSwap,
        overwrite: true,
        questions: remaining
      });
    });
  } catch (err) {
    btnQeditDelete.disabled = false;
    btnQeditSave.disabled = false;
    if (!err.unauthorized) setMessage(qeditMessage, '削除できませんでした: ' + err.message, 'error');
    return;
  }
  btnQeditDelete.disabled = false;
  btnQeditSave.disabled = false;
  closeQuestionEdit();
  removeQuestionFromSession(q);
}

// この回の出題から、問題（と、その逆向きの出題）を外して、画面を次の問題へ進める
function removeQuestionFromSession(q) {
  const gone = {};
  gone[q.id] = true;
  gone[q.id + ':swap'] = true;
  const drop = function (list) {
    for (let i = list.length - 1; i >= 0; i--) if (gone[list[i].id]) list.splice(i, 1);
  };

  // いまの位置より前にある分だけ、位置を詰める
  currentIndex -= currentList.slice(0, currentIndex).filter(function (x) { return gone[x.id]; }).length;
  drop(currentList);
  drop(wrongQuestions);
  drop(originalList);
  studyGroups.forEach(drop);
  Object.keys(gone).forEach(function (id) {
    delete userAnswers[id];
    delete userHasDrawn[id];
    delete multiAnswerProgress[id];
    delete answeredThisSession[id];
  });
  lastReviewAction = null;   // 位置が変わるので、一問前に戻る記録は使えない

  if (currentIndex < currentList.length) {
    if (currentPhase === 'test') showQuestion(); else showReviewItem();
  } else if (currentPhase === 'test') {
    // 最後の問題だった。残りがあれば丸付けへ、残りが無ければ次のグループ（無ければ終わり）へ
    if (currentList.length > 0) transitionPhase(function () { switchPhase('review'); });
    else transitionPhase(function () { goToNextGroupOrFinish(); });
  } else {
    transitionPhase(function () { evaluateRoundResult(); });
  }
  updateTaskProgress(currentPhase);
}

btnQeditDelete.addEventListener('click', deleteCurrentQuestion);


// =====================================================================
// 階層の移動（問題集・フォルダの移動、フォルダ名の変更）
// =====================================================================
// 移動先は、フォルダの木から選ぶ（問題集は、移動先にならない）。フォルダを動かすときは、
// 自分自身と、自分の下のフォルダを選べない（自分の中へ入れてしまうのを防ぐ）。
// 動かしたあと、場所に紐づく端末側の状態（選択・開閉）も、新しい場所へ付け替える。

let moveState = null;   // { from, isFolder, name, dest: 選んだフォルダの場所（'' はいちばん上）, picked: 選んだか }

function pathName(p) { return p.split('/').pop(); }
function pathDir(p) { return p.split('/').slice(0, -1).join('/'); }

// 場所 p が、from そのもの、または from の下か
function isSameOrUnder(p, from) { return p === from || p.indexOf(from + '/') === 0; }

// 全フォルダの場所を、木の順に集める（［場所, 深さ］の並び）
function collectFolderPaths() {
  const out = [];
  (function walk(node, depth) {
    node.folders.forEach(function (f) {
      out.push([f.key, depth]);
      walk(f, depth + 1);
    });
  })(buildTree(libraryIndex.sets), 0);
  return out;
}

// 移動後の場所（移動先 + 名前）
function moveTarget() {
  const newName = moveNewFolder.value.trim();
  const base = moveState.dest + (newName ? ((moveState.dest ? '/' : '') + newName) : '');
  return (base ? base + '/' : '') + moveState.name;
}

function renderMoveList() {
  moveList.innerHTML = '';
  const choose = function (dest, label, depth, disabledNote) {
    const row = makeEl('button', 'w-full flex items-center text-left py-1.5 px-2 focus:outline-none ' +
      (disabledNote ? 'text-slate-300 cursor-default' : 'hover:bg-slate-50 text-slate-800') +
      (moveState.picked && moveState.dest === dest && !disabledNote ? ' bg-black text-white hover:bg-black' : ''));
    row.style.paddingLeft = (8 + depth * 14) + 'px';
    row.appendChild(makeEl('span', 'flex-1', label));
    if (disabledNote) row.appendChild(makeEl('span', 'text-[10px]', disabledNote));
    row.disabled = !!disabledNote;
    row.addEventListener('click', function () {
      moveState.dest = dest;
      moveState.picked = true;
      renderMoveList();
      updateMovePreview();
    });
    moveList.appendChild(row);
  };

  const here = pathDir(moveState.from);   // いまの場所（親のフォルダ）
  choose('', 'いちばん上（フォルダなし）', 0, here === '' ? 'いまの場所' : '');
  collectFolderPaths().forEach(function (fp) {
    const path = fp[0];
    if (moveState.isFolder && isSameOrUnder(path, moveState.from)) return;   // 自分自身と、自分の下は、移動先にしない
    choose(path, pathName(path), fp[1] + 1, path === here ? 'いまの場所' : '');
  });
}

function updateMovePreview() {
  if (!moveState.picked) {
    movePreview.textContent = '';
    btnMoveOk.disabled = true;
    return;
  }
  const to = moveTarget();
  movePreview.textContent = '移動後：' + to.split('/').join('  >  ');
  btnMoveOk.disabled = (to === moveState.from);
}

function openMoveDialog(from, isFolder) {
  moveState = { from: from, isFolder: isFolder, name: pathName(from), dest: '', picked: false };
  moveTitle.textContent = '「' + (isFolder ? pathName(from) : (libraryIndex.sets.find(function (s) { return s.path === from; }) || {}).title || pathName(from)) + '」を移動';
  moveNewFolder.value = '';
  setMessage(moveMessage, '');
  renderMoveList();
  updateMovePreview();
  moveModal.classList.remove('hidden');
}

function closeMoveDialog() {
  moveModal.classList.add('hidden');
  moveState = null;
}

// 場所の付け替え：選択（selection）と、フォルダの開閉（closedFolders）
function remapPathKeys(from, to) {
  [selection, closedFolders].forEach(function (obj) {
    Object.keys(obj).forEach(function (k) {
      if (!isSameOrUnder(k, from)) return;
      const nk = to + k.slice(from.length);
      obj[nk] = obj[k];
      delete obj[k];
    });
  });
}

// 移動の実行。from の場所にあるものを to へ。成功したら true
async function runMove(from, to) {
  await saveOrderNow();   // 保存待ちの並び順を先に送る（移動で一覧が書き換わるため）
  try {
    const r = await enqueueManage(function () { return postJSON({ kind: 'move', from: from, to: to }); });
    remapPathKeys(from, to);
    await loadLibrary();
    renderManage();
    setMessage(manageMessage, '移動しました（' + r.moved + '冊）。', 'ok');
    return true;
  } catch (err) {
    if (err.unauthorized) return false;
    // 途中まで移っていることがあるので、一覧を読み直して、実際の状態を見せる
    await loadLibrary();
    renderManage();
    setMessage(manageMessage, '移動できませんでした: ' + err.message, 'error');
    return false;
  }
}

btnMoveOk.addEventListener('click', async function () {
  if (!moveState || !moveState.picked) return;
  const name = moveNewFolder.value.trim();
  if (name && /[\/\\<>:"|?*\u0000-\u001f]/.test(name)) {
    setMessage(moveMessage, '新しいフォルダの名前に使えない文字があります。', 'error');
    return;
  }
  const from = moveState.from, to = moveTarget();
  btnMoveOk.disabled = true;
  btnMoveOk.textContent = '移動中…';
  const ok = await runMove(from, to);
  btnMoveOk.textContent = '移動する';
  if (ok) closeMoveDialog(); else { btnMoveOk.disabled = false; closeMoveDialog(); }
});
btnMoveCancel.addEventListener('click', closeMoveDialog);
moveNewFolder.addEventListener('input', function () { if (moveState) updateMovePreview(); });

// フォルダ名の変更（同じ親の下で、名前だけを変える）
async function renameFolder(folder, input) {
  const name = input.value.trim();
  if (!name || /[\/\\<>:"|?*\u0000-\u001f]/.test(name)) {
    input.value = folder.name;
    setMessage(manageMessage, name ? 'フォルダの名前に使えない文字があります。' : 'フォルダの名前を空にはできません。', 'error');
    return;
  }
  if (name === folder.name) return;
  const parent = pathDir(folder.key);
  const to = (parent ? parent + '/' : '') + name;
  if (collectFolderPaths().some(function (fp) { return fp[0] === to; }) &&
      !confirm('「' + name + '」というフォルダがすでにあります。中の問題集を、そちらへまとめますか。')) {
    input.value = folder.name;
    return;
  }
  setMessage(manageMessage, 'フォルダ名を変更しています…');
  const ok = await runMove(folder.key, to);
  if (!ok) input.value = folder.name;
}
