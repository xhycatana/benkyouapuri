// 出題・採点・繰り返しと、画面の切り替え。
// ----------------------------------------------------------------------

// 手書きを受け付けるのは出題中と丸付け中だけ
function isDrawingPhase() {
  return currentPhase === 'test' || currentPhase === 'review';
}


// --- フェーズ切り替え ---
function switchPhase(newPhase) {
  currentPhase = newPhase;

  // 右上の歯車は、出題中・丸つけ中だけ出す（解きながら文字の大きさなどを変えられるように）。
  // ホーム画面ではフッターの「詳細設定」から開くので要らず、追加画面・使い方画面では使わない。
  appHeader.classList.toggle('hidden', newPhase !== 'test' && newPhase !== 'review');

  // ホーム画面と追加画面は内容が縦に伸びるのでスクロールさせる。
  // 解答中は画面全体が手書きの領域なので、固定したままにする。
  // pointer-events も切り替えないと、指の動きがスクロールとして届かない。
  const scrollable = (newPhase === 'import' || newPhase === 'upload' || newPhase === 'help');
  phaseContainer.classList.toggle('overflow-y-auto', scrollable);
  phaseContainer.classList.toggle('pointer-events-auto', scrollable);
  phaseContainer.classList.toggle('justify-center', !scrollable);
  // スクロールする画面では、スクロールする箱を画面の横幅いっぱいにする。
  // 幅を絞ったままだと、左右の余白に指を置いてもスクロールできない。
  // 中身の幅は各画面の section 側（max-w-3xl など）で絞っている。
  phaseContainer.classList.toggle('max-w-4xl', !scrollable);
  // 左側の余白は出題中の左のツールバーのぶん。ツールバーの無い画面では左右を揃える
  ['pl-10', 'pr-2', 'md:pl-12', 'md:pr-4'].forEach((c) => phaseContainer.classList.toggle(c, !scrollable));

  pageDivider.classList.add('hidden');
  phaseImport.classList.add('hidden');
  phaseUpload.classList.add('hidden');
  phaseHelp.classList.add('hidden');
  phaseTest.classList.add('hidden');
  phaseReview.classList.add('hidden');

  if (newPhase === 'import') {
    phaseImport.classList.remove('hidden');
    fitHomeMargins();
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    globalCanvas.resetPalmRejection();
    saveProgress();
    saveHistory();
  } else if (newPhase === 'upload') {
    phaseUpload.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
  } else if (newPhase === 'help') {
    phaseHelp.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    sizePenTestPad();
  } else if (newPhase === 'test') {
    phaseTest.classList.remove('hidden');
    leftControlsContainer.classList.remove('hidden');
    initTestPhase();
  } else if (newPhase === 'review') {
    phaseReview.classList.remove('hidden');
    leftControlsContainer.classList.remove('hidden');
    initReviewPhase();
  }
}

// --- ホーム画面の余白 ---
// 上下の余白を左右の余白と同じ大きさにする。中身の高さは問題集の数などで変わるので、CSS だけでは決められない。
// 横長の画面では、上下の余白の大きさまで左右を詰める（中身が横に広がる）。
// 縦長の画面では、上の余白を左右の余白に合わせ、余った高さは下に回す。
const HOME_MAX_WIDTH = 768;   // 縦長の画面での中身の最大幅（max-w-3xl）

function fitHomeMargins() {
  if (currentPhase !== 'import') return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // phaseContainer は body の余白の内側にある。その分を差し引いて section の外側の余白を決める
  const box = phaseContainer.getBoundingClientRect();

  // 画面の外枠にもともとある余白より小さくはできないので、それを最小にする
  const minMargin = box.top;
  let margin = minMargin;
  // 幅を変えると文字の折り返しで高さも変わるので、2回合わせる
  for (let i = 0; i < 2; i++) {
    const height = phaseImport.offsetHeight;
    const byWidth = (W - HOME_MAX_WIDTH) / 2;
    const byHeight = (H - height) / 2;
    margin = Math.max(minMargin, Math.min(byWidth, byHeight));
    phaseImport.style.maxWidth = Math.max(0, W - 2 * margin) + 'px';
  }
  phaseImport.style.marginTop = Math.max(0, margin - box.top) + 'px';
  phaseImport.style.marginBottom = Math.max(0, margin - (H - box.bottom)) + 'px';
}

window.addEventListener('resize', fitHomeMargins);
// 問題集の一覧を読み込み終えたときなど、中身の高さが変わったら合わせ直す
if (window.ResizeObserver) {
  let lastHomeHeight = 0;
  new ResizeObserver(() => {
    const h = phaseImport.offsetHeight;
    if (Math.abs(h - lastHomeHeight) < 1) return;
    lastHomeHeight = h;
    fitHomeMargins();
  }).observe(phaseImport);
}

function transitionPhase(actionAfterFadeOut) {
  // すでに暗転中（action の実行中）に呼ばれた場合は、さらに演出を重ねずにその場で実行する。
  // （この分岐がないと isTransitioning ガードに弾かれ、
  //   全問終了時・最終グループのスキップ時にホーム画面へ戻らなくなる）
  if (isBlanked) {
    actionAfterFadeOut();
    return;
  }

  if (isTransitioning) return;
  isTransitioning = true;

  setTimeout(() => {
    appBody.classList.add('fade-out');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isBlanked = true;
        try {
          actionAfterFadeOut();
        } finally {
          isBlanked = false;
        }
        setTimeout(() => {
          appBody.classList.remove('fade-out');
          isTransitioning = false;
        }, 500);
      });
    });
  }, 500);
}

// 進捗タスクバー反映
function updateTaskProgress(mode) {
  const totalGroups = studyGroups.length;
  if (totalGroups === 0) return;

  if (settingGroupSize > 0 && totalGroups > 1) {
    const completedGroups = currentGroupIndex; 
    const confirmedPercent = (completedGroups / totalGroups) * 100;
    const currentPercent = confirmedPercent;

    if (mode === 'test') {
      testGroupBarContainer.classList.remove('hidden');
      testGroupTextContainer.classList.remove('hidden');
      testGroupBarConfirmed.style.width = `${confirmedPercent}%`;
      testGroupBarCurrent.style.width = `${currentPercent}%`;
      testGroupText.innerText = `グループ ${completedGroups + 1} / ${totalGroups}`;
    } else if (mode === 'review') {
      reviewGroupBarContainer.classList.remove('hidden');
      reviewGroupTextContainer.classList.remove('hidden');
      reviewGroupBarConfirmed.style.width = `${confirmedPercent}%`;
      reviewGroupBarCurrent.style.width = `${currentPercent}%`;
      reviewGroupText.innerText = `グループ ${completedGroups + 1} / ${totalGroups}`;
    }
  } else {
    testGroupBarContainer.classList.add('hidden');
    testGroupTextContainer.classList.add('hidden');
    reviewGroupBarContainer.classList.add('hidden');
    reviewGroupTextContainer.classList.add('hidden');
  }

  const currentGroupQuestions = studyGroups[currentGroupIndex] || [];
  const N = currentGroupQuestions.length;
  if (N === 0) return;

  const activeCurrent = currentIndex;
  const confirmedCount = N - currentList.length;
  const confirmedPercent = (confirmedCount / N) * 100;
  const currentPercent = ((confirmedCount + activeCurrent) / N) * 100;

  if (mode === 'test') {
    testProgressBarConfirmed.style.width = `${confirmedPercent}%`;
    testProgressBarCurrent.style.width = `${currentPercent}%`;
    if (currentIndex < currentList.length) {
      testProgressText.innerText = `問題 ${confirmedCount + activeCurrent + 1} / ${N}`;
    }
  } else if (mode === 'review') {
    reviewProgressBarConfirmed.style.width = `${confirmedPercent}%`;
    reviewProgressBarCurrent.style.width = `${currentPercent}%`;
    if (currentIndex < currentList.length) {
      reviewProgressText.innerText = `丸付け ${confirmedCount + activeCurrent + 1} / ${N}`;
    }
  }
}

// --- 5. 学習開始 ＆ 長期・短期ハイブリッド出題生成 ---
function startLearning(problemData) {
  const shouldSrsSort = checkSrsSort.checked;
  const shouldShuffle = checkRandom.checked;
  const shouldSwap = checkSwap.checked;
  settingGroupSize = Math.max(0, parseInt(inputGroupSize.value) || 0);
  settingQuestionLimit = Math.max(0, parseInt(inputQuestionLimit.value) || 0);

  // 表裏（問題と答え）の入れ替え
  originalList = problemData.map(item => {
    const id = item.id || generateUUID();
    // 保存済みの解答履歴があれば、それを優先して使う。
    // これが無いと記憶予測が常に初期値のままになり、優先出題が意味を持たない。
    const st = progressStats[id] || {};
    // 逆にしたとき、答えの「／」区切りは問題文としてそのまま見せる（「／／」だけ「／」に戻す）。
    // 元の問題文が新しい答えになるので、そこに「／」があっても区切りとして扱わないよう重ねておく。
    return {
      id: id,
      question: shouldSwap ? splitAnswers(item.answer).join('／') : item.question,
      answer: shouldSwap ? String(item.question).replace(/／/g, '／／') : item.answer,
      commentary: item.commentary || '',
      correct_count: Number.isFinite(st.correct) ? st.correct : (item.correct_count || 0),
      incorrect_count: Number.isFinite(st.incorrect) ? st.incorrect : (item.incorrect_count || 0),
      lifespan: (Number.isFinite(st.lifespan) && st.lifespan > 0) ? st.lifespan : (item.lifespan || 1.0),
      last_answered_at: st.last_answered_at || item.last_answered_at || null,
      is_deleted: item.is_deleted || false
    };
  });

  // どの問題を出すかを決める
  if (shouldSrsSort) {
    originalList = sortQuestionsBySrs(originalList);
  } else if (shouldShuffle) {
    // 優先選出を使わない場合は、どれを選ぶかをここで無作為にする
    originalList = shuffleArray(originalList);
  }

  // 並べ替えた後に上位だけ残す。順番を決める前に切ると、優先度と無関係な問題が選ばれてしまう。
  // 短い時間しか無いときでも、いま最も価値の高い問題から解けるようにするための設定。
  if (settingQuestionLimit > 0 && originalList.length > settingQuestionLimit) {
    originalList = originalList.slice(0, settingQuestionLimit);
  }

  // 出す問題が決まった後で、その中の順番だけを入れ替える。
  // 選出より前に混ぜると「優先度の高い問題を選ぶ」こと自体が壊れる。
  // 毎回同じ並びだと、内容ではなく順番を覚えてしまうので、それを避けるための設定。
  if (shouldShuffle) {
    originalList = shuffleArray(originalList);
  }

  studyGroups = [];
  if (settingGroupSize === 0) {
    studyGroups.push(originalList);
  } else {
    for (let i = 0; i < originalList.length; i += settingGroupSize) {
      studyGroups.push(originalList.slice(i, i + settingGroupSize));
    }
  }

  currentGroupIndex = 0;
  currentList = [...studyGroups[currentGroupIndex]];

  userAnswers = {};
  userHasDrawn = {}; 
  wrongQuestions = [];
  answeredThisSession = {};

  switchPhase('test');
}

// --- ホーム画面のドロップゾーン ---
// ここに落としたファイルは、その場で解き始めるのではなく、
// 「問題集を追加」画面へ中身をコピーして開く。保存先・タグを付けずに
// 問題集の管理から外れてしまうのを避けるため。
// 保存先は1つしか指定できないので、まとめて複数は受け付けない。
function handleHomeDrop(files) {
  if (!files || files.length === 0) return;
  if (files.length > 1) {
    alert('まとめては追加できません。1つずつ追加してください。');
    return;
  }
  resetUploadForm();
  switchPhase('upload');
  loadFileIntoUploadForm(files[0]);
}

// --- イベント設定 ---
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-black', 'bg-slate-50');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-black', 'bg-slate-50');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-black', 'bg-slate-50');
  handleHomeDrop(e.dataTransfer.files);
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => handleHomeDrop(e.target.files));

btnUseSample.addEventListener('click', () => {
  startLearning(JSON.parse(JSON.stringify(sampleQuestionsJSON)));
});

btnShowHelp.addEventListener('click', () => switchPhase('help'));
btnHelpBack.addEventListener('click', () => switchPhase('import'));

btnOpenSettings.addEventListener('click', () => settingsModal.classList.remove('hidden'));
btnOpenSettingsHome.addEventListener('click', () => settingsModal.classList.remove('hidden'));
btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

// --- 戻る ---
btnBackToImport.addEventListener('click', () => {
  if (isTransitioning) return;
  transitionPhase(() => switchPhase('import'));
});

// --- 問題文の文字の大きさ ---
// 見た目だけの設定なので、記憶モデル(memorySettings)とは別に持つ。
const STORAGE_KEY_DISPLAY = 'flashmemo_displaySettings';
let displaySettings = { questionFontSize: 24 };

try {
  const savedDisplay = JSON.parse(localStorage.getItem(STORAGE_KEY_DISPLAY) || 'null');
  if (savedDisplay && typeof savedDisplay.questionFontSize === 'number' && isFinite(savedDisplay.questionFontSize)) {
    displaySettings.questionFontSize = savedDisplay.questionFontSize;
  }
} catch (err) {}

function saveDisplaySettings() {
  try { localStorage.setItem(STORAGE_KEY_DISPLAY, JSON.stringify(displaySettings)); } catch (err) {}
}

function applyQuestionFontSize() {
  testQuestion.style.fontSize = displaySettings.questionFontSize + 'px';
  reviewQuestion.style.fontSize = displaySettings.questionFontSize + 'px';
  placePageDivider();
}

function applyDisplaySettingsToUI() {
  questionFontInput.value = displaySettings.questionFontSize;
  questionFontVal.textContent = displaySettings.questionFontSize + ' px';
  applyQuestionFontSize();
}

questionFontInput.addEventListener('input', function () {
  displaySettings.questionFontSize = parseInt(questionFontInput.value, 10);
  questionFontVal.textContent = displaySettings.questionFontSize + ' px';
  saveDisplaySettings();
  applyQuestionFontSize();
});


// --- 答案のページめくり（見開き） ---
// 画面の左半分と右半分がそれぞれ1ページで、2ページずつ見える。めくると1ページずつ進むので、
// 右にあったページが左に移り、1つ前のページを見ながら次のページに書ける。
// 答案エリアをスクロールさせたり大きな1枚にしたりすると、iPad の Safari のキャンバスの
// 大きさ・メモリの上限にぶつかるので、キャンバスは画面1枚のまま、見えていないページは画像にして取っておく。
// answerPageIndex は左のページの番号。右のページは answerPageIndex + 1。

// saved（提出済みの答案）が無ければ白紙2ページから始める
function resetAnswerPages(saved) {
  answerPages = saved ? saved.images.slice() : [];
  answerPageInked = saved ? saved.inked.slice() : [];
  while (answerPages.length < 2) {
    answerPages.push(null);
    answerPageInked.push(false);
  }
  answerPageIndex = 0;
  globalCanvas.loadHalf(0, answerPages[0]);
  globalCanvas.loadHalf(1, answerPages[1]);
  updatePageControls();
  placePageDivider();
}

// 見えている2ページをキャンバスから取り込み、全ページをまとめて返す
function collectAnswerPages() {
  [0, 1].forEach((side) => {
    // 画像の読み込みが終わっていない間は、キャンバスに中身がまだ無いので取り込まない
    if (globalCanvas.halfLoading[side]) return;
    const page = answerPageIndex + side;
    answerPages[page] = answerPageInked[page] ? globalCanvas.getHalfDataURL(side) : null;
  });
  return { images: answerPages.slice(), inked: answerPageInked.slice() };
}

// 1ページ進める・戻す
function flipAnswerPage(step) {
  const next = answerPageIndex + step;
  if (next < 0) return;
  collectAnswerPages();
  const last = answerPages.length - 1;
  if (step < 0 && last === answerPageIndex + 1 && last > 1 && !answerPageInked[last]) {
    // 何も書いていない最後のページから戻るときは、そのページを消す（白紙のページが後ろに溜まらないように）
    answerPages.pop();
    answerPageInked.pop();
  }
  if (next + 1 >= answerPages.length) {
    answerPages.push(null);
    answerPageInked.push(false);
  }
  answerPageIndex = next;

  if (globalCanvas.loading) {
    // 読み込み途中の側があるときは、見えている中身を使わずに両側とも読み直す
    globalCanvas.loadHalf(0, answerPages[next]);
    globalCanvas.loadHalf(1, answerPages[next + 1]);
  } else if (step > 0) {
    globalCanvas.moveHalf(1, 0);
    globalCanvas.loadHalf(1, answerPages[next + 1]);
  } else {
    globalCanvas.moveHalf(0, 1);
    globalCanvas.loadHalf(0, answerPages[next]);
  }
  updatePageControls();
}

// 出題中・丸つけ中の両方にあるページ送りの表示を揃える。
// 右のページが最後のページなら「次へ」は「ページを足す」になる。白紙のページの後ろには足せない。
function updatePageControls() {
  const total = answerPages.length;
  const right = answerPageIndex + 1;
  const onLast = right === total - 1;
  const canPrev = answerPageIndex > 0;
  const canNext = !onLast || answerPageInked[right];

  document.querySelectorAll('.page-indicator').forEach((el) => {
    el.textContent = (answerPageIndex + 1) + '-' + (right + 1) + ' / ' + total;
  });
  document.querySelectorAll('.page-prev-btn').forEach((btn) => {
    btn.disabled = !canPrev;
    btn.classList.toggle('opacity-30', !canPrev);
  });
  document.querySelectorAll('.page-next-btn').forEach((btn) => {
    btn.disabled = !canNext;
    btn.classList.toggle('opacity-30', !canNext);
    btn.title = onLast ? 'ページを足す' : '次のページ';
    btn.querySelector('.page-next-icon').classList.toggle('hidden', onLast);
    btn.querySelector('.page-add-icon').classList.toggle('hidden', !onLast);
  });
}

// 見開きの真ん中の区切り線。画面のちょうど真ん中に短く引く。
// 問題文が長いときや解説があるときは、問題文とボタンにかからない範囲まで削る。
// 問題文の長さ・丸つけの解説の有無・文字の大きさで削る量が変わるので、そのたびに置き直す。
const PAGE_DIVIDER_GAP = 16;
const PAGE_DIVIDER_RATIO = 0.07;   // 線の長さ（画面の高さに対する割合）

function placePageDivider() {
  const drawing = isDrawingPhase();
  pageDivider.classList.toggle('hidden', !drawing);
  if (!drawing) return;
  const above = currentPhase === 'test' ? testQuestionBox : reviewInfoBox;
  const below = currentPhase === 'test' ? btnSubmitTest : btnClearReviewCanvas;
  const minTop = above.getBoundingClientRect().bottom + PAGE_DIVIDER_GAP;
  const maxBottom = below.getBoundingClientRect().top - PAGE_DIVIDER_GAP;
  const center = window.innerHeight / 2;
  const half = window.innerHeight * PAGE_DIVIDER_RATIO / 2;
  const top = Math.max(center - half, minTop);
  const bottom = Math.min(center + half, maxBottom);
  if (bottom - top < 4) {
    pageDivider.classList.add('hidden');
    return;
  }
  pageDivider.style.top = top + 'px';
  pageDivider.style.height = (bottom - top) + 'px';
}

window.addEventListener('resize', placePageDivider);

// どれか1ページにでも書いてあれば「書いた」とする
function syncHasDrawn() {
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;
  const any = answerPageInked.some(Boolean);
  userHasDrawn[activeQuestion.id] = any;
  if (currentPhase === 'review') setReviewCorrectButtonsEnabled(any);
}

// キャンバスの左(0)・右(1)のページに線が引かれたときに呼ばれる
function noteAnswerDrawn(side) {
  if (!currentList[currentIndex]) return;
  const page = answerPageIndex + side;
  if (!answerPageInked[page]) {
    answerPageInked[page] = true;
    updatePageControls();
  }
  syncHasDrawn();
}

// 手のひらの接触を取り消すときのために、指で描き始める直前の状態を返す
function currentAnswerDrawnState() {
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return null;
  return {
    id: activeQuestion.id,
    page: answerPageIndex,
    inked: [answerPageInked[answerPageIndex] === true, answerPageInked[answerPageIndex + 1] === true]
  };
}

function restoreAnswerDrawnState(state) {
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion || activeQuestion.id !== state.id || state.page !== answerPageIndex) return;
  answerPageInked[state.page] = state.inked[0];
  answerPageInked[state.page + 1] = state.inked[1];
  syncHasDrawn();
  updatePageControls();
}

// 消去ボタンは、見えている2ページを消す
function clearCurrentAnswerPage() {
  globalCanvas.clear();
  answerPageInked[answerPageIndex] = false;
  answerPageInked[answerPageIndex + 1] = false;
  syncHasDrawn();
  updatePageControls();
}

document.querySelectorAll('.page-prev-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isTransitioning || btn.disabled) return;
    flipAnswerPage(-1);
  });
});
document.querySelectorAll('.page-next-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isTransitioning || btn.disabled) return;
    flipAnswerPage(1);
  });
});


// --- 出題フェーズ (Testing) ---
function initTestPhase() {
  currentIndex = 0;
  userAnswers = {};
  showQuestion();
}

function showQuestion() {
  updateTaskProgress('test');
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return; 

  testQuestion.innerText = activeQuestion.question;
  const prob = calculateProbability(activeQuestion);
  testProbIndicator.innerText = `記憶予測確率: ${(prob * 100).toFixed(1)}%`;

  globalCanvas.clear();
  globalCanvas.resizeCanvas();
  resetAnswerPages(null);
}

btnClearTestCanvas.addEventListener('click', () => {
  if (isTransitioning) return; 
  clearCurrentAnswerPage();
});

btnSubmitTest.addEventListener('click', () => {
  if (isTransitioning) return; 
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;

  userAnswers[activeQuestion.id] = collectAnswerPages();
  currentIndex++;
  updateTaskProgress('test');

  if (currentIndex < currentList.length) {
    showQuestion();
  } else {
    transitionPhase(() => switchPhase('review'));
  }
});

// --- 振り返り・採点フェーズ (Review & Long-Term Update) ---
function initReviewPhase() {
  currentIndex = 0;
  wrongQuestions = [];
  showReviewItem();
}

function showReviewItem() {
  updateTaskProgress('review');
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;

  reviewQuestion.innerText = activeQuestion.question;

  // 答えが「／」で複数に分かれている問題（例：英単語の意味を複数答える）は、
  // 1つずつ判定できるように、通常の一括表示とは別の見た目に切り替える。
  currentAnswerItems = splitAnswers(activeQuestion.answer);
  currentAnswerItemResults = currentAnswerItems.map(() => undefined);
  const isMultiAnswer = currentAnswerItems.length > 1;

  reviewModelAnswerSingle.classList.toggle('hidden', isMultiAnswer);
  reviewModelAnswerList.classList.toggle('hidden', !isMultiAnswer);
  btnSelfWrong.classList.toggle('hidden', isMultiAnswer);
  btnSelfCorrect.classList.toggle('hidden', isMultiAnswer);
  btnReviewNext.classList.toggle('hidden', !isMultiAnswer);

  if (isMultiAnswer) {
    renderAnswerItemRows(currentAnswerItems);
    updateReviewNextButtonReadiness();
  } else {
    // 「／／」（本物の「／」1文字）を戻した後の答えを見せる
    reviewModelAnswer.innerText = currentAnswerItems[0] || activeQuestion.answer;
  }

  resetAnswerPages(userAnswers[activeQuestion.id] || null);

  if (activeQuestion.commentary) {
    reviewCommentary.innerText = activeQuestion.commentary;
    reviewCommentaryBox.style.display = 'block';
  } else {
    reviewCommentaryBox.style.display = 'none';
  }

  const hasDrawn = userHasDrawn[activeQuestion.id] === true;
  setReviewCorrectButtonsEnabled(hasDrawn);
  placePageDivider();   // 解説の有無で問題文の欄の高さが変わった後に置き直す
}

// 「合ってた」系のボタン（一括・1項目ずつ、どちらも）を、まだ何も
// 描いていない間は押せないようにする。白紙のまま丸を付けられてしまうのを防ぐ。
function setReviewCorrectButtonsEnabled(enabled) {
  btnSelfCorrect.classList.toggle('opacity-30', !enabled);
  btnSelfCorrect.classList.toggle('pointer-events-none', !enabled);
  btnSelfCorrect.disabled = !enabled;
  reviewModelAnswerList.querySelectorAll('.answer-item-correct-btn').forEach((btn) => {
    btn.classList.toggle('opacity-30', !enabled);
    btn.classList.toggle('pointer-events-none', !enabled);
  });
}

// 「／」で分かれた答えを1行ずつ、小さな○×付きで表示する
function renderAnswerItemRows(items) {
  reviewModelAnswerList.querySelectorAll('.answer-item-row').forEach((el) => el.remove());

  items.forEach((text, index) => {
    const row = document.createElement('div');
    row.className = 'answer-item-row flex items-center justify-between gap-2 border-b border-slate-100 py-1 text-sm';

    const label = document.createElement('span');
    label.className = 'flex-1';
    label.innerText = text;

    const wrongBtn = document.createElement('button');
    wrongBtn.type = 'button';
    wrongBtn.className = 'w-8 h-8 flex items-center justify-center border border-black bg-white hover:bg-slate-50 focus:outline-none';
    wrongBtn.title = '間違えた';
    wrongBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';

    const correctBtn = document.createElement('button');
    correctBtn.type = 'button';
    correctBtn.className = 'answer-item-correct-btn w-8 h-8 flex items-center justify-center border border-black bg-white hover:bg-slate-50 focus:outline-none ml-1';
    correctBtn.title = '合ってた';
    correctBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8" /></svg>';

    function refreshRowStyle() {
      const r = currentAnswerItemResults[index];
      wrongBtn.classList.toggle('bg-red-100', r === false);
      wrongBtn.classList.toggle('border-red-500', r === false);
      correctBtn.classList.toggle('bg-green-100', r === true);
      correctBtn.classList.toggle('border-green-500', r === true);
    }

    wrongBtn.addEventListener('click', () => {
      if (isTransitioning) return;
      currentAnswerItemResults[index] = false;
      refreshRowStyle();
      updateReviewNextButtonReadiness();
    });
    correctBtn.addEventListener('click', () => {
      if (isTransitioning || correctBtn.classList.contains('pointer-events-none')) return;
      currentAnswerItemResults[index] = true;
      refreshRowStyle();
      updateReviewNextButtonReadiness();
    });

    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex items-center';
    btnGroup.appendChild(wrongBtn);
    btnGroup.appendChild(correctBtn);

    row.appendChild(label);
    row.appendChild(btnGroup);
    reviewModelAnswerList.appendChild(row);
  });
}

// 全項目が判定済みになったら「次へ」を押せるようにする
function updateReviewNextButtonReadiness() {
  const allMarked = currentAnswerItemResults.length > 0 &&
    currentAnswerItemResults.every((r) => r === true || r === false);
  btnReviewNext.disabled = !allMarked;
  btnReviewNext.classList.toggle('opacity-30', !allMarked);
  btnReviewNext.classList.toggle('pointer-events-none', !allMarked);
}

// 採点を確定して次の問題へ進む。一括判定（従来のボタン）・1項目ずつの
// 判定（複数答えの問題）の、どちらからも同じ処理に合流させる。
function finalizeReviewItem(isCorrect) {
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;
  updateSrsMetrics(activeQuestion, isCorrect);
  if (!isCorrect) {
    userAnswers[activeQuestion.id] = collectAnswerPages();
    wrongQuestions.push(activeQuestion);
  }
  goToNextReviewItem();
}

btnSelfCorrect.addEventListener('click', () => {
  if (isTransitioning) return;
  finalizeReviewItem(true);
});

btnSelfWrong.addEventListener('click', () => {
  if (isTransitioning) return;
  finalizeReviewItem(false);
});

btnReviewNext.addEventListener('click', () => {
  if (isTransitioning || btnReviewNext.disabled) return;
  const allCorrect = currentAnswerItemResults.length > 0 &&
    currentAnswerItemResults.every((r) => r === true);
  finalizeReviewItem(allCorrect);
});

btnClearReviewCanvas.addEventListener('click', () => {
  if (isTransitioning) return;
  clearCurrentAnswerPage();
});

function goToNextReviewItem() {
  currentIndex++;
  updateTaskProgress('review');

  if (currentIndex < currentList.length) {
    showReviewItem();
  } else {
    transitionPhase(() => evaluateRoundResult());
  }
}

// --- ラウンド判定・ループ処理 ---
// 間違えた問題を正解するまで繰り返し、終わったら次へ進む。
//
// 以前は、間違いを全部つぶした後もう一度その束を最初から解き直していた。
// 20問やるつもりが最後にもう20問積まれることになり、
// 空いた時間で区切って使うという目的と衝突するため取りやめた。
function evaluateRoundResult() {
  if (wrongQuestions.length > 0) {
    currentList = [...wrongQuestions];
    switchPhase('test');
  } else {
    goToNextGroupOrFinish();
  }
}

function goToNextGroupOrFinish() {
  currentGroupIndex++;
  if (currentGroupIndex < studyGroups.length) {
    currentList = [...studyGroups[currentGroupIndex]];
    switchPhase('test');
  } else {
    transitionPhase(() => switchPhase('import'));
  }
}
