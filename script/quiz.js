// 出題・採点・繰り返しと、画面の切り替え。
// ----------------------------------------------------------------------

// 手書きを受け付けるのは出題中と丸付け中だけ
function isDrawingPhase() {
  return currentPhase === 'test' || currentPhase === 'review';
}


// --- フェーズ切り替え ---
function switchPhase(newPhase) {
  currentPhase = newPhase;

  // ホーム画面では歯車ボタンを設定カードの中に置くので、右上の独立ボタンは隠す。
  appHeader.classList.toggle('hidden', newPhase === 'import');

  // ホーム画面と追加画面は内容が縦に伸びるのでスクロールさせる。
  // 解答中は画面全体が手書きの領域なので、固定したままにする。
  // pointer-events も切り替えないと、指の動きがスクロールとして届かない。
  const scrollable = (newPhase === 'import' || newPhase === 'upload' || newPhase === 'help');
  phaseContainer.classList.toggle('overflow-y-auto', scrollable);
  phaseContainer.classList.toggle('pointer-events-auto', scrollable);
  phaseContainer.classList.toggle('justify-center', !scrollable);

  phaseImport.classList.add('hidden');
  phaseUpload.classList.add('hidden');
  phaseHelp.classList.add('hidden');
  phaseTest.classList.add('hidden');
  phaseReview.classList.add('hidden');

  if (newPhase === 'import') {
    phaseImport.classList.remove('hidden');
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
    return {
      id: id,
      question: shouldSwap ? item.answer : item.question,
      answer: shouldSwap ? item.question : item.answer,
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

// --- 戻る・スキップ ---
btnBackToImport.addEventListener('click', () => {
  if (isTransitioning) return;
  transitionPhase(() => switchPhase('import'));
});

btnSkipGroup.addEventListener('click', () => {
  if (isTransitioning) return;
  transitionPhase(() => goToNextGroupOrFinish());
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
}

btnClearTestCanvas.addEventListener('click', () => {
  if (isTransitioning) return; 
  globalCanvas.clear();
  if (currentList[currentIndex]) userHasDrawn[currentList[currentIndex].id] = false;
});

btnSubmitTest.addEventListener('click', () => {
  if (isTransitioning) return; 
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;

  userAnswers[activeQuestion.id] = globalCanvas.getDataURL();
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

  const uAnswerImg = userAnswers[activeQuestion.id] || '';

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
    reviewModelAnswer.innerText = activeQuestion.answer;
  }

  globalCanvas.loadState(uAnswerImg);

  if (activeQuestion.commentary) {
    reviewCommentary.innerText = activeQuestion.commentary;
    reviewCommentaryBox.style.display = 'block';
  } else {
    reviewCommentaryBox.style.display = 'none';
  }

  const hasDrawn = userHasDrawn[activeQuestion.id] === true;
  setReviewCorrectButtonsEnabled(hasDrawn);
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
    userAnswers[activeQuestion.id] = globalCanvas.getDataURL();
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
  globalCanvas.clear();
  const activeQuestion = currentList[currentIndex];
  if (activeQuestion) {
    userHasDrawn[activeQuestion.id] = false;
    setReviewCorrectButtonsEnabled(false);
  }
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
