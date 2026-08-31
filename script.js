// --- 1. 記憶モデルのパラメーター ---
// 忘却曲線 R = exp(-経過日数 / 記憶の寿命) で、いま思い出せる確率を見積もる。
const STORAGE_KEY_MEMORY = 'flashmemo_memorySettings';
const FIRST_INTERVAL_DAYS = 1.0;   // 初めて正解したときの寿命

let memorySettings = {
  ease: 2.5,          // 正解したとき寿命を何倍にするか
  failMinutes: 30,    // 間違えたとき寿命を何分に戻すか
  lockMinutes: 30     // 直前に解いた問題を出題対象から外す時間
};

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_MEMORY) || 'null');
  if (saved && typeof saved === 'object') Object.assign(memorySettings, saved);
} catch (err) {}

function saveMemorySettings() {
  try { localStorage.setItem(STORAGE_KEY_MEMORY, JSON.stringify(memorySettings)); } catch (err) {}
}

// --- 2. グローバルデータストア ---
let originalList = [];        // 読み込まれた全データ（JSON構造拡張版）
let currentList = [];         // 現在取り組んでいる対象リスト
let userAnswers = {};         // 手書き画像キャッシュ
let userHasDrawn = {};        // 描画フラグ
let wrongQuestions = [];       // 間違えた問題リスト

let answeredThisSession = {};  // このセッションで既に採点した問題（重複更新の防止）
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
const phaseUpload = document.getElementById('phase-upload');

const libraryTags = document.getElementById('library-tags');
const libraryTree = document.getElementById('library-tree');
const librarySelected = document.getElementById('library-selected');
const btnLibraryReload = document.getElementById('btn-library-reload');
const btnOpenUpload = document.getElementById('btn-open-upload');
const btnStartSelected = document.getElementById('btn-start-selected');

const uploadPath = document.getElementById('upload-path');
const uploadTags = document.getElementById('upload-tags');
const uploadCsv = document.getElementById('upload-csv');
const uploadPreview = document.getElementById('upload-preview');
const uploadMessage = document.getElementById('upload-message');
const btnUploadBack = document.getElementById('btn-upload-back');
const uploadFile = document.getElementById('upload-file');
const btnUploadFile = document.getElementById('btn-upload-file');
const btnUploadSample = document.getElementById('btn-upload-sample');
const uploadPathPreview = document.getElementById('upload-path-preview');
const btnResetZoom = document.getElementById('btn-reset-zoom');
const btnUploadSave = document.getElementById('btn-upload-save');

const passphraseModal = document.getElementById('passphrase-modal');
const passphraseInput = document.getElementById('passphrase-input');
const passphraseError = document.getElementById('passphrase-error');
const btnPassphraseSave = document.getElementById('btn-passphrase-save');
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

// --- 3. 忘却曲線による記憶予測 ---
// いま思い出せる確率を R = exp(-経過日数 / 記憶の寿命) で見積もる。
// 時間が経つほど必ず下がるので、どれだけ習熟した問題でも寿命を過ぎれば戻ってくる。
// 正解数を足し込む方式では、熟達した問題が頭打ちになって二度と出題されなかった。
function calculateProbability(q) {
  // 一度も解いていない問題は、思い出せるはずがないので最優先
  if (!q.last_answered_at) return 0;

  const lifespan = (q.lifespan > 0) ? q.lifespan : FIRST_INTERVAL_DAYS;
  const elapsedMs = Math.max(0, Date.now() - Date.parse(q.last_answered_at));
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  const r = Math.exp(-elapsedDays / lifespan);
  return Math.min(Math.max(r, 0), 1);
}

function sortQuestionsBySrs(list) {
  const now = new Date();
  const lockMs = memorySettings.lockMinutes * 60 * 1000;

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

// 手書きを受け付けるのは出題中と丸付け中だけ
function isDrawingPhase() {
  return currentPhase === 'test' || currentPhase === 'review';
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
      if (isDrawingPhase() && !isTransitioning) e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      if (isDrawingPhase() && !isTransitioning) e.preventDefault();
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
    return { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }

  // --- パームリジェクション ---
  // ペン（Apple Pencil）を一度でも検知したら、以降このセッションでは指の接触を描画に使わない。
  // ペン検知より先に始まってしまった指ストロークは、ペンが触れた時点で取り消す。
  // ペンを一度も使わない場合は従来どおり指で描けるので、UIの切り替えは不要。
  // なお、これはキャンバスへの描画だけの話で、ボタンは指でも押せる。
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
      lastT: pos.t,                 // 直前のサンプル点の時刻（再配信の検出用）
      midX: pos.x, midY: pos.y      // 直前に通過した中点（曲線の描き始め）
    };
    // ボタンの上をペンが通っても入力が途切れないよう、
    // このポインタの以降のイベントをキャンバスに固定する
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }

  startDrawing(e) {
    if (!isDrawingPhase() || isTransitioning) return;
    this.notePointerType(e);
    if (this.shouldIgnorePointer(e)) return;
    e.preventDefault();
    if (e.pointerType === 'touch') this.snapshotBeforeTouch();

    // 前のストロークが残っていたら、閉じてから新しく始める。
    // ペンを上げてすぐ下ろすと pointerup を取りこぼすことがあり、
    // 古いストロークが残ったままだと次の線が引けなくなる。
    if (this.stroke) this.finishStroke();
    this.beginStroke(e);
  }

  draw(e) {
    if (!isDrawingPhase() || isTransitioning) return;
    this.notePointerType(e);
    if (this.shouldIgnorePointer(e)) return;

    // pointerdown を取りこぼした場合に限り、ここでストロークを開始する
    if (!this.stroke && e.buttons > 0) {
      if (e.pointerType === 'touch') this.snapshotBeforeTouch();
      this.beginStroke(e);
    }

    // 別のポインタから来たペンの描画イベントなら、前のストロークが
    // 取り残されていると判断して引き継ぐ（pointerdown ごと取りこぼした場合の保険）
    if (this.stroke && this.stroke.pointerId !== e.pointerId &&
        e.pointerType === 'pen' && e.buttons > 0) {
      this.finishStroke();
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

    // Safari は同じ pointermove を2回発火させ、getCoalescedEvents() が
    // まったく同じ点の並びを返してくることがある（実機で確認）。
    // そのまま繋ぐと、2回目の先頭で数点ぶん巻き戻る直線が引かれ、
    // 滑らかな線とは別に「数点飛ばしのカクカクした線」が重なって見える。
    // 時刻が進んでいない点は再配信とみなして捨てる。
    if (typeof pos.t === 'number' && typeof s.lastT === 'number') {
      if (pos.t < s.lastT) return;
      if (pos.t === s.lastT && pos.x === s.lastX && pos.y === s.lastY) return;
    } else if (pos.x === s.lastX && pos.y === s.lastY) {
      return;   // 時刻が取れない場合は、座標が完全に同じものだけ捨てる
    }

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
    if (typeof pos.t === 'number') s.lastT = pos.t;
  }

  // ホーム画面に戻ったら解除する（ペンが使えなくなったときに指へ切り替える逃げ道）
  resetPalmRejection() {
    this.hasSeenPen = false;
    this.touchSnapshot = null;
    this.touchDrawnState = null;
  }

  finishStroke() {
    const s = this.stroke;
    if (!s) return;

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

  stopDrawing(e) {
    if (!this.stroke) return;
    if (e && e.pointerId !== undefined && e.pointerId !== this.stroke.pointerId) return;
    this.finishStroke();
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

// 自己採点時（⭕/❌）に記憶の寿命を更新する。
//
// 同じセッション内で二度目以降に解いた問題は更新しない。
// 間違えた問題はその場のループで必ずもう一度出題されるため、
// そこでの正解まで数えると「数分間覚えていただけ」を長期記憶と誤認してしまう。
// 記録するのは、そのセッションで最初に答えた結果だけ。
function updateSrsMetrics(question, isCorrect) {
  if (answeredThisSession[question.id]) return;
  answeredThisSession[question.id] = true;

  if (isCorrect) {
    question.correct_count = (question.correct_count || 0) + 1;
    const previous = question.lifespan;
    // 正解したら、少なくとも初回間隔ぶんは空ける
    question.lifespan = (previous > 0 && question.last_answered_at)
      ? Math.max(previous * memorySettings.ease, FIRST_INTERVAL_DAYS)
      : FIRST_INTERVAL_DAYS;
  } else {
    question.incorrect_count = (question.incorrect_count || 0) + 1;
    // 間違えたら寿命を数十分まで戻す。次に開いたとき最優先で出てくる
    question.lifespan = memorySettings.failMinutes / (60 * 24);
  }

  question.last_answered_at = new Date().toISOString();
  recordProgress(question);
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

setupSlider('ease-input', 'ease-val', val => {
  memorySettings.ease = parseFloat(val);
  saveMemorySettings();
  return val + ' 倍';
});
setupSlider('fail-input', 'fail-val', val => {
  memorySettings.failMinutes = parseInt(val, 10);
  saveMemorySettings();
  return val + ' 分後';
});
setupSlider('lock-input', 'lock-val', val => {
  memorySettings.lockMinutes = parseInt(val, 10);
  saveMemorySettings();
  return val + ' 分';
});

// 保存してある設定をつまみと表示に反映する
function applyMemorySettingsToUI() {
  const pairs = [
    ['ease-input', 'ease-val', memorySettings.ease, ' 倍'],
    ['fail-input', 'fail-val', memorySettings.failMinutes, ' 分後'],
    ['lock-input', 'lock-val', memorySettings.lockMinutes, ' 分']
  ];
  pairs.forEach(function (p) {
    const input = document.getElementById(p[0]);
    const label = document.getElementById(p[1]);
    if (input) input.value = p[2];
    if (label) label.textContent = p[2] + p[3];
  });
}



// --- 解答履歴 -------------------------------------------------------------
// 問題のIDごとに成績を貯め、非公開リポジトリに書き戻す。
// 1問ごとに通信するとコミットが膨大になるので、区切りでまとめて送る。
// 送る前にアプリが閉じても失わないよう、端末にも控えを置く。

const STORAGE_KEY_PROGRESS = 'flashmemo_progress';

let progressStats = {};      // { 問題ID: { correct, incorrect, lifespan, last_answered_at } }
let progressDirty = false;   // まだ書き戻していない変更があるか
let progressSaving = false;
let progressTimer = null;

function readLocalProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS);
    const j = raw ? JSON.parse(raw) : null;
    return (j && typeof j === 'object') ? j : {};
  } catch (err) { return {}; }
}

function writeLocalProgress() {
  try { localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progressStats)); } catch (err) {}
}

// 同じ問題については、最後に解いた日時が新しい方を残す
function mergeProgress(into, from) {
  Object.keys(from || {}).forEach(function (id) {
    const b = from[id];
    if (!b || typeof b !== 'object') return;
    const a = into[id];
    if (!a) { into[id] = b; return; }
    const ta = a.last_answered_at ? Date.parse(a.last_answered_at) : 0;
    const tb = b.last_answered_at ? Date.parse(b.last_answered_at) : 0;
    if (tb >= ta) into[id] = b;
  });
  return into;
}

async function loadProgress() {
  const local = readLocalProgress();
  try {
    const remote = await api('/api/questions?kind=progress');
    progressStats = mergeProgress({}, (remote && remote.stats) || {});
    // 端末にだけ残っている新しい記録があれば、それを優先して書き戻す対象にする
    const before = JSON.stringify(progressStats);
    mergeProgress(progressStats, local);
    if (JSON.stringify(progressStats) !== before) progressDirty = true;
  } catch (err) {
    if (err.unauthorized) return;
    // 通信できないときは端末の控えだけで続行する
    progressStats = local;
  }
  writeLocalProgress();
  if (progressDirty) saveProgress();
}

function recordProgress(question) {
  if (!question || !question.id) return;
  progressStats[question.id] = {
    correct: question.correct_count || 0,
    incorrect: question.incorrect_count || 0,
    lifespan: question.lifespan || 1.0,
    last_answered_at: question.last_answered_at || new Date().toISOString()
  };
  progressDirty = true;
  writeLocalProgress();

  // 解き続けている間も、しばらく操作が途切れたら書き戻す
  clearTimeout(progressTimer);
  progressTimer = setTimeout(saveProgress, 60000);
}

async function saveProgress() {
  if (!progressDirty || progressSaving) return;
  if (!getPassphrase()) return;
  clearTimeout(progressTimer);
  progressSaving = true;
  try {
    await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'progress', stats: progressStats })
    });
    progressDirty = false;   // 送れたときだけ下ろす。失敗したら次の機会に再送する
  } catch (err) {
    // 失敗しても端末には残っているので、次回の起動時に送り直される
  } finally {
    progressSaving = false;
  }
}

// アプリを閉じたり、別のアプリに切り替えたときにも書き戻す
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') saveProgress();
});

// --- 6. 問題集ライブラリ（非公開リポジトリから読み書きする） -----------------
// 通信はすべて /api/questions を経由する。GitHub のトークンはサーバー側にしかなく、
// ブラウザが持つのは合言葉だけ。

const STORAGE_KEY_PASSPHRASE = 'flashmemo_passphrase';

let libraryIndex = { sets: [] };
let selectedPaths = [];       // 選択中の問題集のパス
let activeTags = [];          // 絞り込みに使っているタグ
let closedFolders = {};       // 閉じているフォルダ（既定は開いた状態）

function getPassphrase() {
  try { return localStorage.getItem(STORAGE_KEY_PASSPHRASE) || ''; } catch (err) { return ''; }
}
function savePassphrase(v) {
  try { localStorage.setItem(STORAGE_KEY_PASSPHRASE, v); } catch (err) {}
}

async function api(path, options) {
  const opts = Object.assign({}, options || {});
  opts.headers = Object.assign({ 'x-passphrase': getPassphrase() }, opts.headers || {});
  const res = await fetch(path, opts);

  let data = {};
  try { data = await res.json(); } catch (err) {}

  if (res.status === 401) {
    askPassphrase('合言葉が違います。もう一度入力してください。');
    const e = new Error('unauthorized');
    e.unauthorized = true;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data.error || ('通信に失敗しました (' + res.status + ')'));
    e.data = data;
    throw e;
  }
  return data;
}

// --- 合言葉の入力 ---
function askPassphrase(message) {
  passphraseError.textContent = message || '';
  passphraseError.classList.toggle('hidden', !message);
  passphraseInput.value = '';
  passphraseModal.classList.remove('hidden');
  setTimeout(function () { passphraseInput.focus(); }, 50);
}

function submitPassphrase() {
  const v = passphraseInput.value.trim();
  if (!v) return;
  savePassphrase(v);
  passphraseModal.classList.add('hidden');
  loadLibrary();
}

btnPassphraseSave.addEventListener('click', submitPassphrase);
passphraseInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') submitPassphrase();
});

// --- 一覧の読み込み ---
function setTreeMessage(text, isError) {
  libraryTree.innerHTML = '';
  const p = document.createElement('p');
  p.className = isError ? 'text-[10px] text-red-600' : 'text-[10px] text-slate-400';
  p.textContent = text;
  libraryTree.appendChild(p);
}

async function loadLibrary() {
  if (!getPassphrase()) {
    setTreeMessage('合言葉を入力してください。');
    askPassphrase('');
    return;
  }
  setTreeMessage('読み込み中…');
  try {
    const data = await api('/api/questions');
    libraryIndex = (data && Array.isArray(data.sets)) ? data : { sets: [] };
    await loadProgress();
    selectedPaths = selectedPaths.filter(function (p) {
      return libraryIndex.sets.some(function (s) { return s.path === p; });
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
    b.className = 'px-2 py-0.5 text-[10px] border focus:outline-none ' +
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
    row.className = 'w-full flex items-center text-left py-0.5 hover:bg-slate-50 focus:outline-none';
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
    const row = document.createElement('label');
    row.className = 'flex items-center py-0.5 cursor-pointer hover:bg-slate-50';
    row.style.paddingLeft = (depth * 12 + 16) + 'px';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedPaths.indexOf(s.path) !== -1;
    box.className = 'mr-2 accent-black';
    box.addEventListener('change', function () {
      const at = selectedPaths.indexOf(s.path);
      if (box.checked) { if (at === -1) selectedPaths.push(s.path); }
      else if (at !== -1) { selectedPaths.splice(at, 1); }
      updateSelectionUI();
    });

    const label = document.createElement('span');
    label.className = 'text-slate-800';
    label.textContent = s.title || s.path.split('/').pop();

    const count = document.createElement('span');
    count.className = 'ml-2 text-[10px] text-slate-400';
    count.textContent = (s.count || 0) + '問';

    const del = document.createElement('button');
    del.className = 'ml-auto px-2 text-[11px] text-slate-300 hover:text-red-600 focus:outline-none';
    del.textContent = '×';
    del.title = 'この問題集を削除';
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      deleteSet(s);
    });

    row.appendChild(box);
    row.appendChild(label);
    row.appendChild(count);
    row.appendChild(del);
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
}

function updateSelectionUI() {
  const chosen = libraryIndex.sets.filter(function (s) {
    return selectedPaths.indexOf(s.path) !== -1;
  });
  const total = chosen.reduce(function (a, s) { return a + (s.count || 0); }, 0);
  librarySelected.textContent = chosen.length === 0
    ? '未選択'
    : (chosen.length + '冊 / ' + total + '問を選択中');
  btnStartSelected.disabled = chosen.length === 0;
}

// --- 選択した問題集で開始 ---
async function startFromSelection() {
  if (selectedPaths.length === 0) return;
  btnStartSelected.disabled = true;
  btnStartSelected.textContent = '読み込み中…';
  try {
    let merged = [];
    for (const p of selectedPaths) {
      const set = await api('/api/questions?path=' + encodeURIComponent(p));
      if (Array.isArray(set.questions)) merged = merged.concat(set.questions);
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
    await api('/api/questions?path=' + encodeURIComponent(set.path), { method: 'DELETE' });
    const at = selectedPaths.indexOf(set.path);
    if (at !== -1) selectedPaths.splice(at, 1);
    await loadLibrary();
  } catch (err) {
    if (!err.unauthorized) alert(err.message);
  }
}

btnStartSelected.addEventListener('click', startFromSelection);
btnLibraryReload.addEventListener('click', loadLibrary);

// --- 問題集の追加 ---
// 前回の入力が残っていると、別の問題集を上書きしかねない。開くたびに空にする。
function resetUploadForm() {
  uploadPath.value = '';
  uploadTags.value = '';
  uploadCsv.value = '';
  uploadMessage.textContent = '';
  uploadMessage.className = 'text-xs';
  updateUploadPreview();
}

btnOpenUpload.addEventListener('click', function () {
  resetUploadForm();
  switchPhase('upload');
});

btnUploadSample.addEventListener('click', function () {
  uploadPath.value = 'サンプル/果物';
  uploadTags.value = 'サンプル';
  uploadCsv.value = sampleQuestionsJSON.map(function (q) {
    return q.question + ',' + q.answer + ',' + q.commentary;
  }).join(String.fromCharCode(10));
  updateUploadPreview();
});
btnUploadBack.addEventListener('click', function () {
  switchPhase('import');
});

function updateUploadPreview() {
  const rows = parseCSV(uploadCsv.value);
  const path = uploadPath.value.trim();

  // スラッシュがそのまま階層になることを、その場で見せる
  const parts = path.split('/').map(function (p) { return p.trim(); }).filter(Boolean);
  uploadPathPreview.textContent = parts.length === 0 ? ''
    : (parts.length === 1 ? '一番上に「' + parts[0] + '」として置かれます'
                          : parts.join('  >  '));
  uploadPreview.textContent = rows.length === 0
    ? '読み取れる問題がありません。'
    : (rows.length + '問を読み取りました。先頭: ' + rows[0].question + ' → ' + rows[0].answer);
  btnUploadSave.disabled = (rows.length === 0 || path.length === 0);
}

uploadCsv.addEventListener('input', updateUploadPreview);
uploadPath.addEventListener('input', updateUploadPreview);

// CSV はファイルからも読み込めるようにする。
// iPad では「ファイル」アプリが開くので、Gemini の出力を保存しておけばそのまま選べる。
btnUploadFile.addEventListener('click', function () { uploadFile.click(); });

uploadFile.addEventListener('change', async function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    uploadCsv.value = await file.text();
    // 保存先が空なら、ファイル名（拡張子を除く）を初期値として入れておく
    if (!uploadPath.value.trim()) {
      uploadPath.value = file.name.replace(/\.[^.]+$/, '');
    }
    uploadMessage.className = 'text-xs text-slate-500';
    uploadMessage.textContent = file.name + ' を読み込みました。';
  } catch (err) {
    uploadMessage.className = 'text-xs text-red-600';
    uploadMessage.textContent = 'ファイルを読めませんでした: ' + err.message;
  }
  uploadFile.value = '';   // 同じファイルを続けて選べるようにする
  updateUploadPreview();
});

async function saveUpload(overwrite) {
  const rows = parseCSV(uploadCsv.value);
  const path = uploadPath.value.trim();
  const payload = {
    path: path,
    title: path.split('/').pop(),
    tags: uploadTags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    questions: rows.map(function (r) {
      return { question: r.question, answer: r.answer, commentary: r.commentary };
    }),
    overwrite: !!overwrite
  };

  btnUploadSave.disabled = true;
  btnUploadSave.textContent = '保存中…';
  uploadMessage.textContent = '';

  try {
    const r = await api('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    uploadMessage.className = 'text-xs text-green-700';
    uploadMessage.textContent = (r.updated ? '上書き保存しました: ' : '保存しました: ') +
                                r.path + '（' + r.count + '問）';
    uploadCsv.value = '';
    await loadLibrary();
  } catch (err) {
    if (err.unauthorized) return;
    if (err.data && err.data.exists && !overwrite) {
      if (confirm('同じ場所に問題集があります。上書きしますか？')) {
        await saveUpload(true);
        return;
      }
      uploadMessage.className = 'text-xs text-slate-500';
      uploadMessage.textContent = '保存を中止しました。';
    } else {
      uploadMessage.className = 'text-xs text-red-600';
      uploadMessage.textContent = err.message;
    }
  } finally {
    btnUploadSave.textContent = '保存する';
    updateUploadPreview();
  }
}

btnUploadSave.addEventListener('click', function () { saveUpload(false); });


// --- 拡大の抑止 -----------------------------------------------------------
// iOS Safari は viewport の user-scalable=no を無視するため、ピンチ操作そのものを止める。
// ホーム画面から起動しているとブラウザのUIが無く、拡大すると戻せなくなるため。
['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
  document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
});

// それでも拡大されてしまった場合の逃げ道。
// 拡大中だけボタンを出し、viewport を入れ直して元に戻す。
function watchZoom() {
  const vv = window.visualViewport;
  if (!vv) return;

  function check() {
    btnResetZoom.classList.toggle('hidden', vv.scale <= 1.01);
  }
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  check();
}

btnResetZoom.addEventListener('click', function () {
  const meta = document.querySelector('meta[name=viewport]');
  if (!meta) return;
  const original = meta.getAttribute('content');
  meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  setTimeout(function () { meta.setAttribute('content', original); }, 300);
  window.scrollTo(0, 0);
  btnResetZoom.classList.add('hidden');
});

window.onload = function() {
  switchPhase('import');
  globalCanvas.resizeCanvas();
  applyMemorySettingsToUI();
  watchZoom();
  loadLibrary();
};
