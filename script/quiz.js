// 出題・採点・繰り返しと、画面の切り替え。
// ----------------------------------------------------------------------

// 手書きを受け付けるのは出題中と丸付け中だけ
function isDrawingPhase() {
  return currentPhase === 'test' || currentPhase === 'review';
}


// --- フェーズ切り替え ---
function switchPhase(newPhase) {
  currentPhase = newPhase;
  updateStudyTimer();   // 出題・丸つけへの出入りで、勉強時間の計測を始める・止める

  // 右上の歯車は、出題中・丸つけ中だけ出す（解きながら文字の大きさなどを変えられるように）。
  // ホーム画面ではフッターの「詳細設定」から開くので要らず、追加画面・使い方画面では使わない。
  appHeader.classList.toggle('hidden', newPhase !== 'test' && newPhase !== 'review');

  // ホーム画面と追加画面は内容が縦に伸びるのでスクロールさせる。
  // 解答中は画面全体が手書きの領域なので、固定したままにする。
  // pointer-events も切り替えないと、指の動きがスクロールとして届かない。
  const scrollable = (newPhase === 'import' || newPhase === 'upload' || newPhase === 'help' || newPhase === 'studytime');
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
  ruledLines.classList.add('hidden');
  phaseImport.classList.add('hidden');
  phaseUpload.classList.add('hidden');
  phaseHelp.classList.add('hidden');
  phaseStudyTime.classList.add('hidden');
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
    saveStudyTime();
  } else if (newPhase === 'upload') {
    phaseUpload.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
  } else if (newPhase === 'help') {
    phaseHelp.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    sizePenTestPad();
  } else if (newPhase === 'studytime') {
    phaseStudyTime.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    renderStudyTimeView();
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
// 上下左右の余白を同じ大きさにする。大きさは、中身の幅を 768px（max-w-3xl）にしたときの左右の余白の 2/3。
// 横向きの画面では中身が画面に収まらなくなるが、そのぶんはスクロールし、スクロールしきった先の下の余白も同じにする。
const HOME_BASE_WIDTH = 768;
const HOME_MARGIN_RATIO = 2 / 3;

function fitHomeMargins() {
  if (currentPhase !== 'import') return;
  const W = window.innerWidth;
  // phaseContainer は body の余白の内側にある。画面の外枠にもともとある余白より小さくはできないので、それを最小にする
  const box = phaseContainer.getBoundingClientRect();
  const margin = Math.max(box.top, (W - HOME_BASE_WIDTH) / 2 * HOME_MARGIN_RATIO);
  phaseImport.style.maxWidth = Math.max(0, W - 2 * margin) + 'px';
  phaseImport.style.marginTop = Math.max(0, margin - box.top) + 'px';
  phaseImport.style.marginBottom = Math.max(0, margin - (window.innerHeight - box.bottom)) + 'px';
}

window.addEventListener('resize', fitHomeMargins);

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
  settingGroupSize = Math.max(0, parseInt(inputGroupSize.value) || 0);
  settingQuestionLimit = Math.max(0, parseInt(inputQuestionLimit.value) || 0);

  // 問題と答えを逆にする問題集は、この時点までに library.js が既に
  // 入れ替え済みの問題（id の末尾が ":swap"）として混ぜ込んでいる
  originalList = problemData.map(item => {
    const id = item.id || generateUUID();
    // 保存済みの解答履歴があれば、それを優先して使う。
    // これが無いと記憶予測が常に初期値のままになり、優先出題が意味を持たない。
    const st = progressStats[id] || {};
    return {
      id: id,
      question: item.question,
      answer: item.answer,
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
  multiAnswerProgress = {};

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

btnUseSampleKanji.addEventListener('click', () => {
  startLearning(JSON.parse(JSON.stringify(sampleKanjiJSON)));
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

// --- 見た目だけの設定（問題文の文字の大きさ・背景の罫線・1ページ/見開き） ---
// 記憶モデル(memorySettings)とは別に持つ。
const STORAGE_KEY_DISPLAY = 'flashmemo_displaySettings';
let displaySettings = { questionFontSize: 24, showRuledLines: true, pageSpread: 1 };

try {
  const savedDisplay = JSON.parse(localStorage.getItem(STORAGE_KEY_DISPLAY) || 'null');
  if (savedDisplay && typeof savedDisplay.questionFontSize === 'number' && isFinite(savedDisplay.questionFontSize)) {
    displaySettings.questionFontSize = savedDisplay.questionFontSize;
  }
  if (savedDisplay && typeof savedDisplay.showRuledLines === 'boolean') {
    displaySettings.showRuledLines = savedDisplay.showRuledLines;
  }
  if (savedDisplay && (savedDisplay.pageSpread === 1 || savedDisplay.pageSpread === 2)) {
    displaySettings.pageSpread = savedDisplay.pageSpread;
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
  checkRuledLines.checked = displaySettings.showRuledLines;
  updateSpreadToggleIcon();
  applyQuestionFontSize();
}

questionFontInput.addEventListener('input', function () {
  displaySettings.questionFontSize = parseInt(questionFontInput.value, 10);
  questionFontVal.textContent = displaySettings.questionFontSize + ' px';
  saveDisplaySettings();
  applyQuestionFontSize();
});

checkRuledLines.addEventListener('change', function () {
  displaySettings.showRuledLines = checkRuledLines.checked;
  saveDisplaySettings();
  placePageDivider();
});


// --- 答案のページめくり（1ページ／見開き） ---
// 画面いっぱいが1ページ（1ページ表示）か、左半分・右半分がそれぞれ1ページ（見開き）かを、
// displaySettings.pageSpread（1 か 2）で切り替えられる。見開きでは、めくると1ページずつ進むので、
// 右にあったページが左に移り、1つ前のページを見ながら次のページに書ける。
// 答案エリアをスクロールさせたり大きな1枚にしたりすると、iPad の Safari のキャンバスの
// 大きさ・メモリの上限にぶつかるので、キャンバスは画面1枚のまま、見えていないページは画像にして取っておく。
// answerPageIndex は一番左（1ページ表示ならそのページ）の番号。見開きでは、右のページは +1。

function visiblePageCount() {
  return displaySettings.pageSpread === 1 ? 1 : 2;
}

// saved（提出済みの答案）が無ければ白紙から始める
function resetAnswerPages(saved) {
  answerPages = saved ? saved.images.slice() : [];
  answerPageInked = saved ? saved.inked.slice() : [];
  const n = visiblePageCount();
  while (answerPages.length < n) {
    answerPages.push(null);
    answerPageInked.push(false);
  }
  answerPageIndex = 0;
  globalCanvas.setSlotCount(n);
  for (let i = 0; i < n; i++) globalCanvas.loadHalf(i, answerPages[i]);
  updatePageControls();
  placePageDivider();
}

// 見えているページをキャンバスから取り込み、全ページをまとめて返す
function collectAnswerPages() {
  const n = visiblePageCount();
  for (let side = 0; side < n; side++) {
    // 画像の読み込みが終わっていない間は、キャンバスに中身がまだ無いので取り込まない
    if (globalCanvas.halfLoading[side]) continue;
    const page = answerPageIndex + side;
    answerPages[page] = answerPageInked[page] ? globalCanvas.getHalfDataURL(side) : null;
  }
  return { images: answerPages.slice(), inked: answerPageInked.slice() };
}

// 1ページ進める・戻す
function flipAnswerPage(step) {
  const next = answerPageIndex + step;
  if (next < 0) return;
  collectAnswerPages();
  const n = visiblePageCount();
  const last = answerPages.length - 1;
  const rightmost = answerPageIndex + n - 1;
  if (step < 0 && last === rightmost && last >= n && !answerPageInked[last]) {
    // 何も書いていない最後のページから戻るときは、そのページを消す（白紙のページが後ろに溜まらないように）
    answerPages.pop();
    answerPageInked.pop();
  }
  if (next + n - 1 >= answerPages.length) {
    answerPages.push(null);
    answerPageInked.push(false);
  }
  answerPageIndex = next;

  if (globalCanvas.loading) {
    // 読み込み途中のスロットがあるときは、見えている中身を使わずに全スロット読み直す
    for (let i = 0; i < n; i++) globalCanvas.loadHalf(i, answerPages[next + i]);
  } else if (step > 0) {
    // 1つ前のスロットへずらして詰め、空いた一番右だけ新しく読み込む（1ページ表示なら詰める分は無い）
    for (let i = 0; i < n - 1; i++) globalCanvas.moveHalf(i + 1, i);
    globalCanvas.loadHalf(n - 1, answerPages[next + n - 1]);
  } else {
    for (let i = n - 1; i > 0; i--) globalCanvas.moveHalf(i - 1, i);
    globalCanvas.loadHalf(0, answerPages[next]);
  }
  updatePageControls();
}

// 出題中・丸つけ中の両方にあるページ送りの表示を揃える。
// 一番右のページが最後のページなら「次へ」は「ページを足す」になる。白紙のページの後ろには足せない。
function updatePageControls() {
  const total = answerPages.length;
  const n = visiblePageCount();
  const rightmost = answerPageIndex + n - 1;
  const onLast = rightmost === total - 1;
  const canPrev = answerPageIndex > 0;
  const canNext = !onLast || answerPageInked[rightmost];

  document.querySelectorAll('.page-indicator').forEach((el) => {
    el.textContent = n === 1
      ? (answerPageIndex + 1) + ' / ' + total
      : (answerPageIndex + 1) + '-' + (rightmost + 1) + ' / ' + total;
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

// --- 1ページ／見開きの切り替え ---
function updateSpreadToggleIcon() {
  const two = displaySettings.pageSpread !== 1;
  document.querySelectorAll('.spread-icon-2').forEach((el) => el.classList.toggle('hidden', !two));
  document.querySelectorAll('.spread-icon-1').forEach((el) => el.classList.toggle('hidden', two));
}

function setPageSpread(n) {
  if (displaySettings.pageSpread === n) return;
  // 今のキャンバスの中身を、今のスロット数のまま先に確定させてから人数を変える
  if (isDrawingPhase()) collectAnswerPages();
  displaySettings.pageSpread = n;
  saveDisplaySettings();
  updateSpreadToggleIcon();
  if (!isDrawingPhase()) return;

  while (answerPages.length < answerPageIndex + n) {
    answerPages.push(null);
    answerPageInked.push(false);
  }
  globalCanvas.setSlotCount(n);
  for (let i = 0; i < n; i++) globalCanvas.loadHalf(i, answerPages[answerPageIndex + i]);
  updatePageControls();
  placePageDivider();
}

btnToggleSpread.addEventListener('click', function () {
  if (isTransitioning) return;
  setPageSpread(displaySettings.pageSpread === 1 ? 2 : 1);
});

// 見開きの真ん中の区切り線。罫線と同じ範囲（罫線の一番上から一番下まで）に伸ばす。

const RULE_HEIGHT = 32;

// 罫線を1本ずつ、実際の要素として置く。CSSの背景パターンの位相合わせ（position の
// ずらし量）は計算を間違えやすく、実際の見た目とずれる原因になっていたため、
// 「文字の1行目の位置」から単純な足し算だけで済むこの方式に変えた。
// phase: 文字の1行目の位置（ruledLines 自身の一番上からの距離、0以上）。
// 1行目の真上（進捗バーのすぐ下）に線を置くと窮屈なので、1本目は1行目の下（phase+間隔）から始める。
function layoutRuledLines(phase) {
  ruledLines.innerHTML = '';
  const height = window.innerHeight - ruledLines.getBoundingClientRect().top;
  for (let y = phase + RULE_HEIGHT; y < height; y += RULE_HEIGHT) {
    const line = document.createElement('div');
    line.className = 'ruled-line';
    line.style.top = y + 'px';
    ruledLines.appendChild(line);
  }
}

function placePageDivider() {
  const drawing = isDrawingPhase();
  const showDivider = drawing && displaySettings.pageSpread !== 1;   // 1ページ表示なら区切る線は不要
  pageDivider.classList.toggle('hidden', !showDivider);
  ruledLines.classList.toggle('hidden', !drawing || !displaySettings.showRuledLines);
  if (!drawing) return;

  // 罫線は進捗バーの下、問題文・模範解答の後ろから出す。実際のノートと同じように、
  // 文字（問題文・模範解答・解説。行の高さは leading-[32px] で罫線の間隔と揃えてある）が
  // 罫線の上に乗って見えるよう、罫線の1本目を文字の1行目の位置に合わせる。
  const progressHeader = currentPhase === 'test' ? testProgressHeader : reviewProgressHeader;
  const ruledTop = progressHeader.getBoundingClientRect().bottom;
  ruledLines.style.top = ruledTop + 'px';

  const textRef = currentPhase === 'test' ? testQuestion : reviewInfoBox.firstElementChild;
  // phase は「罫線の帯（ruledLines）自身の一番上」から、1本目の罫線までの距離。
  // 文字の1行目より上に、行の高さ未満の隙間しか残らないようにする
  // （それ以上余ると、そこだけ罫線の無い帯として上に飛び出て見える）。
  const phase = textRef
    ? (((textRef.getBoundingClientRect().top - ruledTop) % RULE_HEIGHT) + RULE_HEIGHT) % RULE_HEIGHT
    : 0;
  layoutRuledLines(phase);

  if (!showDivider) return;

  // 区切り線は、1本目の罫線（ぴったり。文字の1行目の真上の線は無いので、その次の線）から
  // 画面の一番下まで伸ばす
  const firstRuleTop = ruledTop + phase + RULE_HEIGHT;
  pageDivider.style.top = firstRuleTop + 'px';
  pageDivider.style.height = (window.innerHeight - firstRuleTop) + 'px';
}

// iOS で Web フォントの読み込みが遅れて文字の位置が後からずれることがあるため、
// フォントの読み込みが終わった時点でもう一度、罫線・区切り線の位置を合わせ直す。
if (window.document && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function () {
    if (isDrawingPhase()) placePageDivider();
  });
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
  const n = visiblePageCount();
  const inked = [];
  for (let i = 0; i < n; i++) inked.push(answerPageInked[answerPageIndex + i] === true);
  return { id: activeQuestion.id, page: answerPageIndex, inked: inked };
}

function restoreAnswerDrawnState(state) {
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion || activeQuestion.id !== state.id || state.page !== answerPageIndex) return;
  state.inked.forEach(function (v, i) { answerPageInked[state.page + i] = v; });
  syncHasDrawn();
  updatePageControls();
}

// 消去ボタンは、見えているページを消す
function clearCurrentAnswerPage() {
  globalCanvas.clear();
  const n = visiblePageCount();
  for (let i = 0; i < n; i++) answerPageInked[answerPageIndex + i] = false;
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

// 答えが「／」で複数に分かれている問題は、いくつ答えればいいかを示す。
// 前の周で正解済みの項目があれば、それも名前で見せる（もう書かなくていい・
// 判定し直さなくていいと分かるように）。出題中・丸つけ中の両方で使う。
function answerCountHintText(activeQuestion) {
  const answerItems = splitAnswers(activeQuestion.answer);
  if (answerItems.length <= 1) return '';
  const carriedOver = multiAnswerProgress[activeQuestion.id] || [];
  const known = answerItems.filter((_, i) => carriedOver[i] === true);
  return known.length > 0
    ? `・残り${answerItems.length - known.length}つ（${known.join('・')}は正解済み）`
    : `・${answerItems.length}つ答える`;
}

function showQuestion() {
  updateTaskProgress('test');
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;

  testQuestion.innerText = activeQuestion.question;
  const prob = calculateProbability(activeQuestion);
  testProbIndicator.innerText = `記憶予測確率: ${(prob * 100).toFixed(1)}%`;
  testAnswerCountHint.textContent = answerCountHintText(activeQuestion);

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
  lastReviewAction = null;   // 前の回の採点までは戻れないようにする
  showReviewItem();
}

function showReviewItem() {
  updateTaskProgress('review');
  const activeQuestion = currentList[currentIndex];
  if (!activeQuestion) return;

  reviewQuestion.innerText = activeQuestion.question;
  reviewAnswerCountHint.textContent = answerCountHintText(activeQuestion);

  // 答えが「／」で複数に分かれている問題（例：英単語の意味を複数答える）は、
  // 1つずつ判定できるように、通常の一括表示とは別の見た目に切り替える。
  // 前の周で正解していた項目は、判定し直させない。一覧にも出さず（問題文の横のヒントで
  // 済んでいることは分かるので）、まだ判定していない項目だけを並べる。
  currentAnswerItems = splitAnswers(activeQuestion.answer);
  const carriedOver = multiAnswerProgress[activeQuestion.id] || [];
  currentAnswerItemResults = currentAnswerItems.map((_, i) => (carriedOver[i] === true) ? true : undefined);
  currentAnswerItemLocked = currentAnswerItemResults.map((r) => r === true);
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
  btnReviewUndo.disabled = !lastReviewAction;
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
    // 前の周で正解済みの項目は、行ごと出さない（済んでいることは問題文の横のヒントで分かる。
    // 間違えた項目だけが並ぶので、そこに集中できる）。
    if (currentAnswerItemLocked[index]) return;

    const row = document.createElement('div');
    row.className = 'answer-item-row flex items-center justify-between gap-2 text-base leading-[32px] h-8';

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

    refreshRowStyle();

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

  // 押し間違えたときに一問前へ戻れるよう、書き換える前の状態を控えておく
  lastReviewAction = {
    index: currentIndex,
    questionId: activeQuestion.id,
    question: activeQuestion,
    prevSrs: {
      correct_count: activeQuestion.correct_count,
      incorrect_count: activeQuestion.incorrect_count,
      lifespan: activeQuestion.lifespan,
      last_answered_at: activeQuestion.last_answered_at
    },
    prevAnsweredThisSession: !!answeredThisSession[activeQuestion.id],
    prevMultiAnswerProgress: multiAnswerProgress[activeQuestion.id] ? multiAnswerProgress[activeQuestion.id].slice() : undefined,
    prevHistoryLength: historyPending.length,
    prevWrongQuestionsLength: wrongQuestions.length
  };

  updateSrsMetrics(activeQuestion, isCorrect);
  if (!isCorrect) {
    userAnswers[activeQuestion.id] = collectAnswerPages();
    wrongQuestions.push(activeQuestion);
    // 複数答えの問題は、今回○だった項目を覚えておく（正解するまで判定し直させないため）
    if (currentAnswerItems.length > 1) {
      multiAnswerProgress[activeQuestion.id] = currentAnswerItemResults.slice();
    }
  } else {
    delete multiAnswerProgress[activeQuestion.id];
  }
  goToNextReviewItem();
}

// 直前の1問の採点を取り消し、その問題をもう一度丸つけし直す（一問前にだけ戻れる）。
function undoLastReviewItem() {
  if (isTransitioning || !lastReviewAction) return;
  const a = lastReviewAction;
  lastReviewAction = null;

  Object.assign(a.question, a.prevSrs);
  if (a.prevAnsweredThisSession) {
    answeredThisSession[a.questionId] = true;
  } else {
    delete answeredThisSession[a.questionId];
  }
  recordProgress(a.question);   // 戻した値で progressStats・端末の控えを上書きする

  // 履歴ログに記録済みなら、まだ送信していない分だけ取り消す
  if (historyPending.length > a.prevHistoryLength) {
    historyPending.length = a.prevHistoryLength;
    writeLocalHistory();
    historyDirty = historyPending.length > 0;
  }

  if (a.prevMultiAnswerProgress) {
    multiAnswerProgress[a.questionId] = a.prevMultiAnswerProgress;
  } else {
    delete multiAnswerProgress[a.questionId];
  }

  if (wrongQuestions.length > a.prevWrongQuestionsLength) {
    wrongQuestions.length = a.prevWrongQuestionsLength;
  }

  currentIndex = a.index;
  showReviewItem();
}

btnReviewUndo.addEventListener('click', undoLastReviewItem);

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
