// 共有する状態。ここで宣言した変数は、後から読み込むファイルすべてから使える。
// ----------------------------------------------------------------------

// --- 2. グローバルデータストア ---
let originalList = [];        // 読み込まれた全データ（JSON構造拡張版）
let currentList = [];         // 現在取り組んでいる対象リスト
let userAnswers = {};         // 手書きの答案。問題ごとに { images: [ページの画像], inked: [ページに書いたか] }
let userHasDrawn = {};        // 描画フラグ（どれか1ページにでも書いたか）

// いま開いている問題の答案のページ。キャンバスは1枚なので、開いていないページは画像で持つ
let answerPages = [null];       // ページごとの画像（白紙は null。開いているページは古いままのことがある）
let answerPageInked = [false];  // ページごとに何か書いたか
let answerPageIndex = 0;        // 開いているページ
let wrongQuestions = [];       // 間違えた問題リスト

let answeredThisSession = {};  // このセッションで既に採点した問題（重複更新の防止）

let currentAnswerItems = [];        // 丸つけ中の答えを「／」で分けたもの（1件なら通常表示）
let currentAnswerItemResults = [];  // 上の各項目の判定。true/false、未判定は undefined
let currentAnswerItemLocked = [];   // 前の周で正解済みなので、今回は判定し直させない項目
// 複数答えの問題が間違って再出題されたとき、前の周で○だった項目を覚えておく（問題IDごと）。
// 再挑戦のたびに全部を判定し直させないための記録。true の項目だけ持ち、消えたら未判定として扱う。
let multiAnswerProgress = {};
let currentPhase = 'import';   // 'import', 'upload', 'help', 'test', 'review'
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

// サンプルデータ（動作確認用）。
// わざと正解数・不正解数・寿命をバラバラに仕込んであり、忘却曲線による並べ替えが
// 効いているかをその場で確認できるようにしてある。「覚える」体験のためのものではない。
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

// 「本当に覚えられるか」を試すためのサンプル（難読漢字の読み方）。
// 上のサンプルと違い、成績はすべて未解答のまっさらな状態から始まる。
function makeSampleKanjiEntry(id, question, answer, commentary) {
  return {
    id: "kanji-sample-" + id,
    question: question,
    answer: answer,
    commentary: commentary,
    correct_count: 0,
    incorrect_count: 0,
    lifespan: 1.0,
    last_answered_at: null,
    is_deleted: false
  };
}

const sampleKanjiJSON = [
  makeSampleKanjiEntry("01", "海豚", "いるか", "哺乳類。水中で暮らす。"),
  makeSampleKanjiEntry("02", "蝙蝠", "こうもり", "空を飛ぶ唯一の哺乳類。"),
  makeSampleKanjiEntry("03", "蜥蜴", "とかげ", "爬虫類。尻尾を切って逃げることがある。"),
  makeSampleKanjiEntry("04", "螺", "にな", "巻き貝の一種。"),
  makeSampleKanjiEntry("05", "雪崩", "なだれ", "積もった雪が崩れ落ちる現象。"),
  makeSampleKanjiEntry("06", "五月雨", "さみだれ", "陰暦五月頃に降り続く長雨。梅雨のこと。"),
  makeSampleKanjiEntry("07", "十六夜", "いざよい", "満月の翌日の夜の月。"),
  makeSampleKanjiEntry("08", "老舗", "しにせ", "代々続く、古くからの店。"),
  makeSampleKanjiEntry("09", "為替", "かわせ", "現金を使わずに送金・決済する仕組み。"),
  makeSampleKanjiEntry("10", "石榴", "ざくろ", "赤い実の中に種が多く詰まった果実。"),
  makeSampleKanjiEntry("11", "山葵", "わさび", "刺身などに添える、辛味のある薬味。"),
  makeSampleKanjiEntry("12", "心太", "ところてん", "テングサを煮て固めた食品。"),
  makeSampleKanjiEntry("13", "海月", "くらげ", "傘のような体を持つ、刺胞動物。"),
  makeSampleKanjiEntry("14", "団扇", "うちわ", "あおいで風を起こす道具。"),
  makeSampleKanjiEntry("15", "木耳", "きくらげ", "きのこの一種。中華料理でよく使われる。"),
  makeSampleKanjiEntry("16", "蝸牛", "かたつむり", "殻を背負った陸生の巻き貝。"),
  makeSampleKanjiEntry("17", "蟷螂", "かまきり", "鎌のような前足を持つ昆虫。"),
  makeSampleKanjiEntry("18", "百足", "むかで", "多数の足を持つ節足動物。"),
  makeSampleKanjiEntry("19", "無花果", "いちじく", "花を咲かせずに実をつけるように見える果実。"),
  makeSampleKanjiEntry("20", "神楽", "かぐら", "神に奉納する歌舞。")
];
