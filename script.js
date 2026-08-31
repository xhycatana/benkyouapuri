// --- 1. アルゴリズム重み & パラメーター ---
let algorithmWeights = {
  w1: 1.2,
  w2: 1.5,
  w3: 0.8,
  lockMinutes: 30
};

// --- 2. グローバルデータストア ---
let originalList = [];        // 読み込まれた全データ（JSON構造拡張版）
let currentList = [];         // 現在取り組んでいる対象リスト
let userAnswers = {};         // 手書き画像キャッシュ
let userHasDrawn = {};        // 描画フラグ
let wrongQuestions = [];       // 間違えた問題リスト

let isFirstRound = true;       // 初回ラウンドか
let currentPhase = 'import';   // 'import', 'test', 'review'
let currentIndex = 0;         // 現在のインデックス
let isTransitioning = false;
let isBlanked = false;     // 切り替えガード

let settingGroupSize = 0;      // ループ分割数
let studyGroups = [];          // グループ配列
let currentGroupIndex = 0;     // 現在のグループ番号

let currentPenColor = '#000000';
let currentPenWidth = 1.75;

// タスクバー進捗キャッシュ
let lastTestConfirmedPercent = -1, lastTestCurrentPercent = -1;
let lastReviewConfirmedPercent = -1, lastReviewCurrentPercent = -1;
let lastTestGroupConfirmedPercent = -1, lastTestGroupCurrentPercent = -1;
let lastReviewGroupConfirmedPercent = -1, lastReviewGroupCurrentPercent = -1;

// サンプルデータ
const sampleQuestionsJSON = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    question: "Apple",
    answer: "りんご",
    commentary: "バラ科リンゴ属の果実。",
    correct_count: 0,
    incorrect_count: 0,
    lifespan: 1.0,
    last_answered_at: null,
    is_deleted: false
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    question: "Banana",
    answer: "バナナ",
    commentary: "熱帯の草本から採れる果実。",
    correct_count: 2,
    incorrect_count: 0,
    lifespan: 2.25,
    last_answered_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    is_deleted: false
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    question: "Cherry",
    answer: "さくらんぼ",
    commentary: "サクラ属の落葉高木。",
    correct_count: 1,
    incorrect_count: 2,
    lifespan: 0.5,
    last_answered_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    is_deleted: false
  }
];

// --- DOM要素 ---
const appBody = document.getElementById('app-body');
const phaseImport = document.getElementById('phase-import');
const phaseTest = document.getElementById('phase-test');
const phaseReview = document.getElementById('phase-review');
const leftControlsContainer = document.getElementById('left-controls-container');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const checkSrsSort = document.getElementById('check-srs-sort');
const checkRandom = document.getElementById('check-random');
const checkSwap = document.getElementById('check-swap');
const inputGroupSize = document.getElementById('input-group-size');

const btnUseSample = document.getElementById('btn-use-sample');
const btnToggleExample = document.getElementById('btn-toggle-example');
const exampleBox = document.getElementById('example-box');

const helpModal = document.getElementById('help-modal');
const btnShowHelp = document.getElementById('btn-show-help');
const btnCloseHelp = document.getElementById('btn-close-help');

const settingsModal = document.getElementById('settings-modal');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');

const testQuestion = document.getElementById('test-question');
const testProbIndicator = document.getElementById('test-prob-indicator');
const btnClearTestCanvas = document.getElementById('btn-clear-test-canvas');
const btnSubmitTest = document.getElementById('btn-submit-test');

const btnBackToImport = document.getElementById('btn-back-to-import');
const btnSkipGroup = document.getElementById('btn-skip-group');

const testGroupBarContainer = document.getElementById('test-group-bar-container');
const testGroupTextContainer = document.getElementById('test-group-text-container');
const testGroupBarCurrent = document.getElementById('test-group-bar-current');
const testGroupBarConfirmed = document.getElementById('test-group-bar-confirmed');
const testGroupText = document.getElementById('test-group-text');

const testProgressBarCurrent = document.getElementById('test-progress-bar-current');
const testProgressBarConfirmed = document.getElementById('test-progress-bar-confirmed');
const testProgressText = document.getElementById('test-progress-text');

const reviewQuestion = document.getElementById('review-question');
const reviewModelAnswer = document.getElementById('review-model-answer');
const reviewCommentary = document.getElementById('review-commentary');
const reviewCommentaryBox = document.getElementById('review-commentary-box');

const reviewGroupBarContainer = document.getElementById('review-group-bar-container');
const reviewGroupTextContainer = document.getElementById('review-group-text-container');
const reviewGroupBarCurrent = document.getElementById('review-group-bar-current');
const reviewGroupBarConfirmed = document.getElementById('review-group-bar-confirmed');
const reviewGroupText = document.getElementById('review-group-text');

const reviewProgressBarCurrent = document.getElementById('review-progress-bar-current');
const reviewProgressBarConfirmed = document.getElementById('review-progress-bar-confirmed');
const reviewProgressText = document.getElementById('review-progress-text');

const btnSelfCorrect = document.getElementById('btn-self-correct');
const btnSelfWrong = document.getElementById('btn-self-wrong');
const btnClearReviewCanvas = document.getElementById('btn-clear-review-canvas');

const sizePickerButtons = document.querySelectorAll('.size-picker-btn');
const colorPickerButtons = document.querySelectorAll('.color-picker-btn');

// --- UUID生成 ---
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// --- 3. 改良版ロジスティック回帰アルゴリズム ---
function calculateProbability(q) {
  const now = new Date();
  let elapsedDays = 0;

  if (q.last_answered_at) {
    const lastDate = new Date(q.last_answered_at);
    const diffMs = Math.max(0, now - lastDate);
    elapsedDays = diffMs / (1000 * 60 * 60 * 24);
  }

  const lifespan = q.lifespan || 1.0;
  const w1 = algorithmWeights.w1;
  const w2 = algorithmWeights.w2;
  const w3 = algorithmWeights.w3;

  const fx = (w1 * (q.correct_count || 0)) 
           - (w2 * (q.incorrect_count || 0)) 
           - (w3 * (elapsedDays / lifespan));

  const p = 1 / (1 + Math.exp(-fx));
  return Math.min(Math.max(p, 0.001), 0.999);
}

function sortQuestionsBySrs(list) {
  const now = new Date();
  const lockMs = algorithmWeights.lockMinutes * 60 * 1000;

  // 時間ロックフィルタリング
  const nonLocked = list.filter(q => {
    if (!q.last_answered_at) return true;
    const lastDate = new Date(q.last_answered_at);
    return (now - lastDate) >= lockMs;
  });

  const pool = nonLocked.length > 0 ? nonLocked : list;

  const scored = pool.map(q => ({
    item: q,
    prob: calculateProbability(q)
  }));

  // 正解予測確率 P が低い（忘れかけている）順に昇順ソート
  scored.sort((a, b) => a.prob - b.prob);

  return scored.map(s => s.item);
}

// --- 4. 全画面手書きキャンバス操作クラス ---
class GlobalHandwritingCanvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    // 進行中のストローク。手書きは常に1本なので、0本(null)か1本しか持たない
    this.stroke = null;

    // パームリジェクション用の状態
    this.hasSeenPen = false;          // ペン入力を検知したか
    this.touchSnapshot = null;        // 指ストローク開始前のキャンバス退避
    this.touchDrawnState = null;      // 指ストローク開始前の userHasDrawn の値

    this.canvas.addEventListener('pointerdown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('pointermove', (e) => this.draw(e));

    window.addEventListener('pointerup', (e) => this.stopDrawing(e));
    window.addEventListener('pointercancel', (e) => this.stopDrawing(e));

    this.canvas.addEventListener('touchstart', (e) => {
      if (currentPhase !== 'import' && !isTransitioning) e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      if (currentPhase !== 'import' && !isTransitioning) e.preventDefault();
    }, { passive: false });

    this.resizeTimeout = null;
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
    });
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    
    const tempCanvas = document.createElement('canvas');
    let hasContent = false;
    
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      try {
        tempCtx.drawImage(this.canvas, 0, 0);
        hasContent = true;
      } catch (err) {}
    }
    
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    
    this.applyPenConfig();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    if (hasContent && tempCanvas.width > 0 && tempCanvas.height > 0) {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        this.ctx.drawImage(tempCanvas, 0, 0, this.canvas.width, this.canvas.height);
      } catch (err) {}
      this.ctx.restore();
    }
  }

  getPointerPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  // --- パームリジェクション ---
  // ペン（Apple Pencil）を一度でも検知したら、以降このセッションでは指の接触を描画に使わない。
  // ペン検知より先に始まってしまった指ストロークは、ペンが触れた時点で取り消す。
  // ペンを一度も使わない場合は従来どおり指で描けるので、UIの切り替えは不要。
  notePointerType(e) {
    if (e.pointerType !== 'pen' || this.hasSeenPen) return;
    this.hasSeenPen = true;
    this.discardTouchStroke();
  }

  shouldIgnorePointer(e) {
    return this.hasSeenPen && e.pointerType === 'touch';
  }

  hasActiveTouch() {
    return !!(this.stroke && this.stroke.pointerType === 'touch');
  }

  // 指ストロークを描き始める直前の状態を退避しておく（ペンが来たら巻き戻すため）
  snapshotBeforeTouch() {
    if (this.hasSeenPen || this.touchSnapshot) return;
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

    const snap = document.createElement('canvas');
    snap.width = this.canvas.width;
    snap.height = this.canvas.height;
    try {
      snap.getContext('2d').drawImage(this.canvas, 0, 0);
      this.touchSnapshot = snap;
    } catch (err) { return; }

    const activeQuestion = currentList[currentIndex];
    this.touchDrawnState = activeQuestion
      ? { id: activeQuestion.id, wasDrawn: userHasDrawn[activeQuestion.id] === true }
      : null;
  }

  // 進行中の指ストロークを破棄し、退避しておいた状態へ巻き戻す
  discardTouchStroke() {
    if (this.hasActiveTouch()) this.stroke = null;

    const snap = this.touchSnapshot;
    const drawnState = this.touchDrawnState;
    this.touchSnapshot = null;
    this.touchDrawnState = null;
    if (!snap) return;

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    try { this.ctx.drawImage(snap, 0, 0); } catch (err) {}
    this.ctx.restore();
    this.applyPenConfig();

    // 手のひらの接触だけで「解答済み」扱いになっていた場合は元に戻す
    if (drawnState && !drawnState.wasDrawn) {
      delete userHasDrawn[drawnState.id];
      const activeQuestion = currentList[currentIndex];
      if (currentPhase === 'review' && activeQuestion && activeQuestion.id === drawnState.id) {
        btnSelfCorrect.classList.add('opacity-30', 'pointer-events-none');
        btnSelfCorrect.disabled = true;
      }
    }
  }

  // ホーム画面に戻ったときに解除（ペンが使えなくなった場合の逃げ道）
  resetPalmRejection() {
    this.hasSeenPen = false;
    this.touchSnapshot = null;
    this.touchDrawnState = null;
  }

  // --- ストローク管理 ---
  // 手書きは常に1本だけ。複数の指で同時に描く機能は使わないので、
  // 進行中のストロークは this.stroke（無ければ null）ひとつで管理する。
  // これにより、1ストローク中に別の pointerId が発行されても
  // それが独立した線として二重に描かれることはない。

  beginStroke(e) {
    const pos = this.getPointerPos(e);
    this.stroke = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      lastX: pos.x, lastY: pos.y,   // 直前のサンプル点
      midX: pos.x, midY: pos.y      // 直前に通過した中点（曲線の描き始め）
    };
    // ボタンの上をペンが通っても入力が途切れないよう、
    // このポインタの以降のイベントをキャンバスに固定する
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }

  startDrawing(e) {
    if (currentPhase === 'import' || isTransitioning) return;
    this.notePointerType(e);
    if (this.shouldIgnorePointer(e)) return;
    if (this.stroke) return;          // すでに1本描いている最中なら無視する
    e.preventDefault();
    if (e.pointerType === 'touch') this.snapshotBeforeTouch();
    this.beginStroke(e);
  }

  draw(e) {
    if (currentPhase === 'import' || isTransitioning) return;
    this.notePointerType(e);
    if (this.shouldIgnorePointer(e)) return;

    // pointerdown を取りこぼした場合に限り、ここでストロークを開始する
    if (!this.stroke && e.buttons > 0) {
      if (e.pointerType === 'touch') this.snapshotBeforeTouch();
      this.beginStroke(e);
    }

    // 進行中のストロークと違うポインタから来たイベントは捨てる
    if (!this.stroke || this.stroke.pointerId !== e.pointerId) return;

    e.preventDefault();

    // ペンは getCoalescedEvents() で間引かれる前の高頻度サンプル（240Hz）をすべて拾う。
    // ただしこのAPIは HTTPS でないと使えないので、ローカルのHTTPでは60Hz相当に落ちる。
    let positions;
    if (e.pointerType === 'pen') {
      // 空配列が返ることがある（空配列は truthy なので || では拾えない）
      let coalesced = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      if (coalesced.length === 0) coalesced = [e];
      positions = coalesced.map(ev => this.getPointerPos(ev));
    } else {
      positions = [this.getPointerPos(e)];
    }

    for (const pos of positions) this.extendStroke(pos);

    if (currentList[currentIndex]) {
      userHasDrawn[currentList[currentIndex].id] = true;
      if (currentPhase === 'review') {
        btnSelfCorrect.classList.remove('opacity-30', 'pointer-events-none');
        btnSelfCorrect.disabled = false;
      }
    }
  }

  // サンプル点をそのまま直線で結ぶと折れ線になって角が見えるため、
  // 「直前の点を制御点、隣り合う2点の中点を通過点」とする2次ベジェ曲線でつなぐ。
  extendStroke(pos) {
    const s = this.stroke;
    const midX = (s.lastX + pos.x) / 2;
    const midY = (s.lastY + pos.y) / 2;

    this.ctx.beginPath();
    this.ctx.moveTo(s.midX, s.midY);
    this.ctx.quadraticCurveTo(s.lastX, s.lastY, midX, midY);
    this.ctx.stroke();

    s.midX = midX;
    s.midY = midY;
    s.lastX = pos.x;
    s.lastY = pos.y;
  }

  stopDrawing(e) {
    if (!this.stroke) return;
    if (e && e.pointerId !== undefined && e.pointerId !== this.stroke.pointerId) return;

    const s = this.stroke;
    // 最後の中点から実際の終点までを描き足してストロークを閉じる
    if (s.midX !== s.lastX || s.midY !== s.lastY) {
      this.ctx.beginPath();
      this.ctx.moveTo(s.midX, s.midY);
      this.ctx.lineTo(s.lastX, s.lastY);
      this.ctx.stroke();
    }

    this.stroke = null;
    // 指ストロークが最後まで描き切られたら、巻き戻し用の退避データは不要
    this.touchSnapshot = null;
    this.touchDrawnState = null;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.stroke = null;
    this.touchSnapshot = null;
    this.touchDrawnState = null;
  }

  applyPenConfig() {
    this.ctx.strokeStyle = currentPenColor;
    this.ctx.lineWidth = currentPenWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  getDataURL() {
    return this.canvas.toDataURL();
  }

  loadState(dataURL) {
    this.clear();
    if (!dataURL) return;
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      if (this.canvas.width > 0 && this.canvas.height > 0) {
        try {
          this.ctx.drawImage(img, 0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        } catch (err) {}
      }
      this.applyPenConfig();
    };
    img.src = dataURL;
  }
}

const globalCanvas = new GlobalHandwritingCanvas(document.getElementById('app-global-canvas'));

// --- CSV & JSON パース処理 ---
function parseCSV(text) {
  const result = [];
  let row = [], cell = '', insideQuote = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i], nextChar = text[i + 1];
    if (insideQuote) {
      if (char === '"') {
        if (nextChar === '"') { cell += '"'; i++; } else { insideQuote = false; }
      } else { cell += char; }
    } else {
      if (char === '"') { insideQuote = true; }
      else if (char === ',') { row.push(cell.trim()); cell = ''; }
      else if (char === '\r' || char === '\n') {
        row.push(cell.trim()); cell = '';
        if (row.length > 0 && (row.length > 1 || row[0] !== '')) result.push(row);
        row = [];
        if (char === '\r' && nextChar === '\n') i++;
      } else { cell += char; }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    if (row.length > 0 && (row.length > 1 || row[0] !== '')) result.push(row);
  }
  
  return result.map(parts => {
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return {
        id: generateUUID(),
        question: parts[0],
        answer: parts[1],
        commentary: parts[2] || '',
        correct_count: 0,
        incorrect_count: 0,
        lifespan: 1.0,
        last_answered_at: null,
        is_deleted: false
      };
    }
    return null;
  }).filter(item => item !== null);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// --- フェーズ切り替え ---
function switchPhase(newPhase) {
  currentPhase = newPhase;
  
  phaseImport.classList.add('hidden');
  phaseTest.classList.add('hidden');
  phaseReview.classList.add('hidden');

  if (newPhase === 'import') {
    phaseImport.classList.remove('hidden');
    leftControlsContainer.classList.add('hidden');
    globalCanvas.clear();
    globalCanvas.resetPalmRejection();
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

  // 表裏（問題と答え）の入れ替え
  originalList = problemData.map(item => ({
    id: item.id || generateUUID(),
    question: shouldSwap ? item.answer : item.question,
    answer: shouldSwap ? item.question : item.answer,
    commentary: item.commentary || '',
    correct_count: item.correct_count || 0,
    incorrect_count: item.incorrect_count || 0,
    lifespan: item.lifespan || 1.0,
    last_answered_at: item.last_answered_at || null,
    is_deleted: item.is_deleted || false
  }));

  // 長期記憶アルゴリズムによる優先順選出またはランダム
  if (shouldSrsSort) {
    originalList = sortQuestionsBySrs(originalList);
  } else if (shouldShuffle) {
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

// 自己採点時（⭕/❌）に長期記憶パラメーターを自動更新
function updateSrsMetrics(question, isCorrect) {
  if (isCorrect) {
    question.correct_count = (question.correct_count || 0) + 1;
    question.lifespan = (question.lifespan || 1.0) * 1.5;
  } else {
    question.incorrect_count = (question.incorrect_count || 0) + 1;
    question.lifespan = Math.max(1.0, (question.lifespan || 1.0) * 0.5);
  }
  question.last_answered_at = new Date().toISOString();
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

// --- ペン・設定関連コントロール ---
sizePickerButtons.forEach(btn => {
  btn.addEventListener('click', function() {
    sizePickerButtons.forEach(b => {
      b.classList.remove('border-2', 'border-black');
      b.classList.add('border', 'border-slate-300');
    });
    this.classList.remove('border', 'border-slate-300');
    this.classList.add('border-2', 'border-black');
    currentPenWidth = parseFloat(this.getAttribute('data-size'));
    globalCanvas.applyPenConfig();
  });
});

colorPickerButtons.forEach(btn => {
  btn.addEventListener('click', function() {
    colorPickerButtons.forEach(b => {
      b.classList.remove('border-2', 'border-black');
      b.classList.add('border', 'border-slate-300');
    });
    this.classList.remove('border', 'border-slate-300');
    this.classList.add('border-2', 'border-black');
    const selectedColor = this.getAttribute('data-color');
    currentPenColor = selectedColor;
    globalCanvas.applyPenConfig();
    document.querySelectorAll('.size-dot').forEach(dot => {
      dot.style.backgroundColor = selectedColor;
    });
  });
});

// スライダー設定
function setupSlider(inputId, valId, callback) {
  const input = document.getElementById(inputId);
  const valDisplay = document.getElementById(valId);
  input.addEventListener('input', (e) => {
    const val = e.target.value;
    const formatted = callback(val);
    valDisplay.textContent = formatted || val;
  });
}

setupSlider('w1-input', 'w1-val', val => algorithmWeights.w1 = parseFloat(val));
setupSlider('w2-input', 'w2-val', val => algorithmWeights.w2 = parseFloat(val));
setupSlider('w3-input', 'w3-val', val => algorithmWeights.w3 = parseFloat(val));
setupSlider('lock-input', 'lock-val', val => {
  algorithmWeights.lockMinutes = parseInt(val);
  return `${val}分`;
});

window.onload = function() {
  switchPhase('import');
  globalCanvas.resizeCanvas();
};
