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

    const toggle = makeEl('button', 'flex-1 flex items-center text-left py-1 hover:bg-slate-50 focus:outline-none');
    toggle.appendChild(makeEl('span', 'w-4 text-slate-400', isClosed ? '▸' : '▾'));
    toggle.appendChild(makeEl('span', 'font-bold text-slate-700', f.name));
    toggle.addEventListener('click', function () {
      closedFolders[f.key] = !isClosed;
      renderManage();
    });
    row.appendChild(toggle);
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

    const del = makeEl('button', 'w-7 h-7 shrink-0 ml-1 text-sm text-slate-300 hover:text-red-600 focus:outline-none', '×');
    del.title = 'この問題集を削除';
    del.addEventListener('click', function () { deleteSet(s); });

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(edit);
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
  editTags.value = (set.tags || []).join(', ');
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

function renderEditHeadings() {
  editHeadings.innerHTML = '';
  const nodes = collectHeadingNodes();
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
editTitle.addEventListener('input', markEditDirty);
editTags.addEventListener('input', markEditDirty);
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
    tags: editTags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
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
    editState.questions.forEach(function (q) { q.reset = false; });
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
        tags: set.tags || [],
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
