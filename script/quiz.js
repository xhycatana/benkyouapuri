// 出題・採点・繰り返しと、画面の切り替え。
// ----------------------------------------------------------------------

// 手書きを受け付けるのは出題中と丸付け中だけ
function isDrawingPhase() {
  return currentPhase === 'test' || currentPhase === 'review';
}


// --- フェーズ切り替え ---
function switchPhase(newPhase) {
  currentPhase = newPhase;

  // ホーム画面と追加画面は内容が縦に伸びるのでスクロールさせる。
  // 解答中は画面全体が手書きの領域なので、固定したままにする。
  // pointer-events も切り替えないと、指の動きがスクロールとして届かない。
  const scrollable = (newPhase === 'import' || newPhase === 'upload');
  phaseContainer.classList.toggle('overflow-y-auto', scrollable);
  phaseContainer.classList.toggle('pointer-events-auto', scrollable);
  phaseContainer.classList.toggle('justify-center', !scrollable);
  
  phaseImport.classList.add('hidden');
  phaseUpload.classList.add('hidden');
  phaseTest.classList.add('hidden');
  phaseReview.classList.add('hidden');

  if (newPhase === 'import') {
    phaseImport.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    globalCanvas.resetPalmRejection();
    saveProgress();
  } else if (newPhase === 'upload') {
    phaseUpload.classList.remove('hidden');
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

  // 長期記憶アルゴリズムによる優先順選出またはランダム
  if (shouldSrsSort) {
    originalList = sortQuestionsBySrs(originalList);
  } else if (shouldShuffle) {
    originalList = shuffleArray(originalList);
  }

  // 並べ替えた後に上位だけ残す。順番を決める前に切ると、優先度と無関係な問題が選ばれてしまう。
  // 短い時間しか無いときでも、いま最も価値の高い問題から解けるようにするための設定。
  if (settingQuestionLimit > 0 && originalList.length > settingQuestionLimit) {
    originalList = originalList.slice(0, settingQuestionLimit);
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
  isFirstRound = true;

  switchPhase('test');
}

// --- ファイル読み込みハンドラー ---
async function handleFileUpload(files) {
  if (files.length === 0) return;

  let mergedData = [];
  for (const file of files) {
    const text = await file.text();
    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) mergedData = mergedData.concat(parsed);
      } catch(e) {
        alert("JSONファイルの読み込みに失敗しました。");
      }
    } else {
      const parsed = parseCSV(text);
      mergedData = mergedData.concat(parsed);
    }
  }

  if (mergedData.length > 0) {
    startLearning(mergedData);
  }
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
  handleFileUpload(e.dataTransfer.files);
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));

btnUseSample.addEventListener('click', () => {
  startLearning(JSON.parse(JSON.stringify(sampleQuestionsJSON)));
});

btnToggleExample.addEventListener('click', () => {
  exampleBox.classList.toggle('hidden');
});

btnShowHelp.addEventListener('click', () => helpModal.classList.remove('hidden'));
btnCloseHelp.addEventListener('click', () => helpModal.classList.add('hidden'));

btnOpenSettings.addEventListener('click', () => settingsModal.classList.remove('hidden'));
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
  reviewModelAnswer.innerText = activeQuestion.answer;
  
  globalCanvas.loadState(uAnswerImg);

  if (activeQuestion.commentary) {
    reviewCommentary.innerText = activeQuestion.commentary;
    reviewCommentaryBox.style.display = 'block';
  } else {
    reviewCommentaryBox.style.display = 'none';
  }

  const hasDrawn = userHasDrawn[activeQuestion.id] === true;
  if (hasDrawn) {
    btnSelfCorrect.classList.remove('opacity-30', 'pointer-events-none');
    btnSelfCorrect.disabled = false;
  } else {
    btnSelfCorrect.classList.add('opacity-30', 'pointer-events-none');
    btnSelfCorrect.disabled = true;
  }
}


btnSelfCorrect.addEventListener('click', () => {
  if (isTransitioning) return; 
  const activeQuestion = currentList[currentIndex];
  if (activeQuestion) updateSrsMetrics(activeQuestion, true);
  goToNextReviewItem();
});

btnSelfWrong.addEventListener('click', () => {
  if (isTransitioning) return; 
  const activeQuestion = currentList[currentIndex];
  if (activeQuestion) {
    updateSrsMetrics(activeQuestion, false);
    userAnswers[activeQuestion.id] = globalCanvas.getDataURL();
    wrongQuestions.push(activeQuestion);
  }
  goToNextReviewItem();
});

btnClearReviewCanvas.addEventListener('click', () => {
  if (isTransitioning) return; 
  globalCanvas.clear();
  const activeQuestion = currentList[currentIndex];
  if (activeQuestion) {
    userHasDrawn[activeQuestion.id] = false;
    btnSelfCorrect.classList.add('opacity-30', 'pointer-events-none');
    btnSelfCorrect.disabled = true;
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
function evaluateRoundResult() {
  if (wrongQuestions.length > 0) {
    currentList = [...wrongQuestions];
    isFirstRound = false;
    switchPhase('test');
  } else {
    if (isFirstRound) {
      goToNextGroupOrFinish();
    } else {
      currentList = [...studyGroups[currentGroupIndex]];
      isFirstRound = true;
      switchPhase('test');
    }
  }
}

function goToNextGroupOrFinish() {
  currentGroupIndex++;
  if (currentGroupIndex < studyGroups.length) {
    currentList = [...studyGroups[currentGroupIndex]];
    isFirstRound = true;
    switchPhase('test');
  } else {
    transitionPhase(() => switchPhase('import'));
  }
}
