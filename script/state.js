// 共有する状態。ここで宣言した変数は、後から読み込むファイルすべてから使える。
// ----------------------------------------------------------------------

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
let settingQuestionLimit = 0;  // 出題する上限。0 なら全部
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
