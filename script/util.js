// 入力の変換など、どこからでも使う小さな道具。
// ----------------------------------------------------------------------

// --- UUID生成 ---
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


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

// JSON（見出し付きの入れ子）を問題データに変換する。
//
// {
//   "次の英単語の意味を答えなさい。": { "banana": "バナナ" },
//   "次の英単語の類義語を答えなさい。": { "look": "see" }
// }
//
// のように、値がオブジェクトならまだ見出し（さらに深く辿る）、
// 値が文字列か [答え, 解説] の配列なら、そこが問題そのもの
// （鍵＝問題文の最後の断片、値＝答え）とみなす。深さの制限はない。
// 表示するときは、通った見出しをすべて改行でつなげる。これにより
// 「banana」だけでは意味を聞かれているのか類義語を聞かれているのか
// わからない、という取り違えを防ぐ。
function parseQuestionJSON(root) {
  const result = [];

  function addLeaf(path, value) {
    let answer, commentary = '';
    if (Array.isArray(value)) {
      answer = String(value[0] || '').trim();
      commentary = String(value[1] || '').trim();
    } else if (typeof value === 'string' || typeof value === 'number') {
      answer = String(value).trim();
    } else {
      return; // 値の型が想定外。読み飛ばす
    }
    const question = path.join('\n').trim();
    if (!question || !answer) return;
    result.push({
      id: generateUUID(),
      question: question,
      answer: answer,
      commentary: commentary,
      correct_count: 0,
      incorrect_count: 0,
      lifespan: 1.0,
      last_answered_at: null,
      is_deleted: false
    });
  }

  function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    Object.keys(node).forEach(function (key) {
      const value = node[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path.concat([key]));
      } else {
        addLeaf(path.concat([key]), value);
      }
    });
  }

  walk(root, []);
  return result;
}

// JSON が複数続けて貼られている場合（Gemini が長い問題集をパートに分けて出力したときなど）に、
// 1つずつに切り分ける。文字列の中の { } は数えない。
// JSON と JSON の間に置けるのは空白と改行だけ。
function splitJSONObjects(text) {
  const parts = [];
  let depth = 0, inString = false, escaped = false, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (depth > 0 && c === '"') { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) parts.push(text.slice(start, i + 1));
      continue;
    }
    if (depth === 0 && !/\s/.test(c)) {
      return { parts: parts, error: 'JSON の外に余計な文字があります: 「' + text.slice(i, i + 15) + '」' };
    }
  }
  if (depth !== 0) {
    return { parts: parts, error: 'JSON が途中で終わっています。Gemini の出力が途切れていないか確認してください。' };
  }
  return { parts: parts, error: null };
}

// 貼り付け欄・ファイルの中身が JSON（見出し付きの入れ子オブジェクト）なら
// 上の形式として、そうでなければ CSV として読み取る。
// JSON かどうかは先頭が「{」かどうかだけで判定する。
// JSON が複数並んでいれば、それぞれを読んで問題をつなげる。
function parseUploadText(text) {
  const trimmed = text.trim();
  const looksLikeJSON = trimmed.charAt(0) === '{';
  if (!looksLikeJSON) {
    return { rows: parseCSV(text), error: null, format: 'csv', parts: 1 };
  }
  const split = splitJSONObjects(trimmed);
  if (split.error) {
    return { rows: [], error: split.error, format: 'json', parts: split.parts.length };
  }
  let rows = [];
  for (let n = 0; n < split.parts.length; n++) {
    let parsed;
    try {
      parsed = JSON.parse(split.parts[n]);
    } catch (err) {
      const which = split.parts.length > 1 ? ((n + 1) + 'つ目の') : '';
      return { rows: [], error: which + 'JSON の形式が正しくありません: ' + err.message, format: 'json', parts: split.parts.length };
    }
    rows = rows.concat(parseQuestionJSON(parsed));
  }
  return { rows: rows, error: null, format: 'json', parts: split.parts.length };
}

// 答えを「／」で複数の答えに分ける（意味を複数答えさせる問題など）。
// 「／」を含む答えを書きたい場合は「／／」と重ねると、区切りではなく
// そのまま「／」1文字として扱う（CSVの "" と同じ、重ねてエスケープする方式）。
// 区切りが1つも無ければ、答え全体を1件だけの配列で返す。
function splitAnswers(answerText) {
  const text = String(answerText || '');
  const result = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i], nextChar = text[i + 1];
    if (char === '／') {
      if (nextChar === '／') { cell += '／'; i++; }
      else { result.push(cell.trim()); cell = ''; }
    } else {
      cell += char;
    }
  }
  result.push(cell.trim());
  return result.filter(function (s) { return s.length > 0; });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
