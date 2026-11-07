// HTML の要素への参照。副作用は持たない。
// ----------------------------------------------------------------------

// --- DOM要素 ---
const appBody = document.getElementById('app-body');
const phaseImport = document.getElementById('phase-import');
const phaseTest = document.getElementById('phase-test');
const phaseReview = document.getElementById('phase-review');
const phaseUpload = document.getElementById('phase-upload');
const phaseHelp = document.getElementById('phase-help');
const phaseManage = document.getElementById('phase-manage');
const phaseEdit = document.getElementById('phase-edit');
const phaseStudyTime = document.getElementById('phase-study-time');
const phaseContainer = document.getElementById('phase-container');
const ruledLines = document.getElementById('ruled-lines');

const libraryShortcuts = document.getElementById('library-shortcuts');
const libraryLegend = document.getElementById('library-legend');
const libraryNotice = document.getElementById('library-notice');
const shortcutActions = document.getElementById('shortcut-actions');
const manageShortcuts = document.getElementById('manage-shortcuts');
const libraryTree = document.getElementById('library-tree');
const librarySelected = document.getElementById('library-selected');
const btnLibraryReload = document.getElementById('btn-library-reload');
const btnOpenUpload = document.getElementById('btn-open-upload');
const btnStartSelected = document.getElementById('btn-start-selected');
const btnOpenManage = document.getElementById('btn-open-manage');

const btnManageBack = document.getElementById('btn-manage-back');
const moveModal = document.getElementById('move-modal');
const moveTitle = document.getElementById('move-title');
const moveForm = document.getElementById('move-form');
const moveProgress = document.getElementById('move-progress');
const moveProgressText = document.getElementById('move-progress-text');
const moveProgressElapsed = document.getElementById('move-progress-elapsed');
const moveProgressCurrent = document.getElementById('move-progress-current');
const moveList = document.getElementById('move-list');
const moveNewFolder = document.getElementById('move-newfolder');
const movePreview = document.getElementById('move-preview');
const moveMessage = document.getElementById('move-message');
const btnMoveCancel = document.getElementById('btn-move-cancel');
const btnMoveOk = document.getElementById('btn-move-ok');
const manageTree = document.getElementById('manage-tree');
const manageMessage = document.getElementById('manage-message');

const btnEditBack = document.getElementById('btn-edit-back');
const btnEditScrollTop = document.getElementById('btn-edit-scroll-top');
const btnEditScrollBottom = document.getElementById('btn-edit-scroll-bottom');
const editSubtitle = document.getElementById('edit-subtitle');
const editTitle = document.getElementById('edit-title');
const editAllowSwap = document.getElementById('edit-allow-swap');
const editHeadings = document.getElementById('edit-headings');
const editSearch = document.getElementById('edit-search');
const editAddHeading = document.getElementById('edit-add-heading');
const editAddNewHeading = document.getElementById('edit-add-newheading');
const editAddQuestion = document.getElementById('edit-add-question');
const editAddAnswer = document.getElementById('edit-add-answer');
const editAddCommentary = document.getElementById('edit-add-commentary');
const btnEditAdd = document.getElementById('btn-edit-add');
const editCount = document.getElementById('edit-count');
const editList = document.getElementById('edit-list');
const btnEditResetAll = document.getElementById('btn-edit-reset-all');
const btnEditSave = document.getElementById('btn-edit-save');
const editMessage = document.getElementById('edit-message');

const uploadPath = document.getElementById('upload-path');
const uploadAllowSwap = document.getElementById('upload-allow-swap');
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
const btnPassphraseSkip = document.getElementById('btn-passphrase-skip');
const leftControlsContainer = document.getElementById('left-controls-container');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const checkSrsSort = document.getElementById('check-srs-sort');
const checkRandom = document.getElementById('check-random');
const inputGroupSize = document.getElementById('input-group-size');
const inputQuestionLimit = document.getElementById('input-question-limit');
const inputMaxProbability = document.getElementById('input-max-probability');
const questionFontInput = document.getElementById('question-font-input');
const questionFontVal = document.getElementById('question-font-val');
const checkRuledLines = document.getElementById('check-ruled-lines');
const checkDiag = document.getElementById('check-diag');
const checkExpA = document.getElementById('check-exp-a');
const checkExpB = document.getElementById('check-exp-b');

const btnUseSample = document.getElementById('btn-use-sample');
const btnUseSampleKanji = document.getElementById('btn-use-sample-kanji');

const btnShowHelp = document.getElementById('btn-show-help');
const btnHelpBack = document.getElementById('btn-help-back');
const penTestPad = document.getElementById('pen-test-pad');
const penTestStats = document.getElementById('pen-test-stats');
const btnPenTestClear = document.getElementById('btn-pen-test-clear');

const fcChart = document.getElementById('fc-chart');
const fcEaseInput = document.getElementById('fc-ease');
const fcEaseOut = document.getElementById('fc-ease-out');
const fcLapseInput = document.getElementById('fc-lapse');
const fcLapseOut = document.getElementById('fc-lapse-out');
const fcToolCorrect = document.getElementById('fc-tool-correct');
const fcToolIncorrect = document.getElementById('fc-tool-incorrect');
const fcReset = document.getElementById('fc-reset');

const btnShowTrend = document.getElementById('btn-show-trend');
const btnTrendBack = document.getElementById('btn-trend-back');
const phaseTrend = document.getElementById('phase-trend');
const trendTiles = document.getElementById('trend-tiles');
const trendRange = document.getElementById('trend-range');
const trendChartKnowledge = document.getElementById('trend-chart-knowledge');
const trendChartAverage = document.getElementById('trend-chart-average');
const trendTable = document.getElementById('trend-table');
const trendMessage = document.getElementById('trend-message');

const btnShowStudyTime = document.getElementById('btn-show-study-time');
const btnStudyTimeBack = document.getElementById('btn-study-time-back');
const studyTimeCumulative = document.getElementById('study-time-cumulative');
const studyTimeTotal = document.getElementById('study-time-total');
const studyInkList = document.getElementById('study-ink-list');
const studyInkRuler = document.getElementById('study-ink-ruler');
const studyTimeChart = document.getElementById('study-time-chart');
const studyTimeChartGrid = document.getElementById('study-time-chart-grid');
const studyTimeList = document.getElementById('study-time-list');

const settingsModal = document.getElementById('settings-modal');
const btnToggleSpread = document.getElementById('btn-toggle-spread');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnOpenSettingsHome = document.getElementById('btn-open-settings-home');
const btnCloseSettings = document.getElementById('btn-close-settings');
const appHeader = document.getElementById('app-header');

const testQuestion = document.getElementById('test-question');
const testQuestionBox = document.getElementById('test-question-box');
const reviewInfoBox = document.getElementById('review-info-box');
const pageDivider = document.getElementById('page-divider');
const testProgressHeader = document.getElementById('test-progress-header');
const reviewProgressHeader = document.getElementById('review-progress-header');
const testProbIndicator = document.getElementById('test-prob-indicator');
const btnReviewNow = document.getElementById('btn-review-now');
const btnEditQuestionTest = document.getElementById('btn-edit-question-test');
const btnEditQuestionReview = document.getElementById('btn-edit-question-review');
const questionEditModal = document.getElementById('question-edit-modal');
const qeditHeadings = document.getElementById('qedit-headings');
const qeditQuestion = document.getElementById('qedit-question');
const qeditAnswer = document.getElementById('qedit-answer');
const qeditAnswerHint = document.getElementById('qedit-answer-hint');
const qeditCommentary = document.getElementById('qedit-commentary');
const qeditMessage = document.getElementById('qedit-message');
const btnQeditCancel = document.getElementById('btn-qedit-cancel');
const btnQeditSave = document.getElementById('btn-qedit-save');
const btnQeditDelete = document.getElementById('btn-qedit-delete');
const reviewProbIndicator = document.getElementById('review-prob-indicator');
const testAnswerCountHint = document.getElementById('test-answer-count-hint');
const reviewAnswerCountHint = document.getElementById('review-answer-count-hint');
const btnClearTestCanvas = document.getElementById('btn-clear-test-canvas');
const btnSubmitTest = document.getElementById('btn-submit-test');

const btnBackToImport = document.getElementById('btn-back-to-import');

const testGroupBarContainer = document.getElementById('test-group-bar-container');
const testGroupTextContainer = document.getElementById('test-group-text-container');
const testGroupBarCurrent = document.getElementById('test-group-bar-current');
const testGroupBarConfirmed = document.getElementById('test-group-bar-confirmed');
const testGroupText = document.getElementById('test-group-text');

const testProgressBarCurrent = document.getElementById('test-progress-bar-current');
const testProgressBarConfirmed = document.getElementById('test-progress-bar-confirmed');
const testProgressText = document.getElementById('test-progress-text');

const reviewQuestion = document.getElementById('review-question');
const reviewModelAnswerSingle = document.getElementById('review-model-answer-single');
const reviewModelAnswer = document.getElementById('review-model-answer');
const reviewModelAnswerList = document.getElementById('review-model-answer-list');
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
const btnReviewNext = document.getElementById('btn-review-next');
const btnClearReviewCanvas = document.getElementById('btn-clear-review-canvas');
const btnReviewUndo = document.getElementById('btn-review-undo');

const sizePickerButtons = document.querySelectorAll('.size-picker-btn');
const colorPickerButtons = document.querySelectorAll('.color-picker-btn');
