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
//
// 配列（[{question, answer, commentary}, ...]）を渡した場合は、
// 見出し無しの一覧としてそのまま受け取る。
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
    if (Array.isArray(node)) {
      node.forEach(function (item) {
        if (item && typeof item === 'object' && item.question && item.answer) {
          result.push({
            id: item.id || generateUUID(),
            question: String(item.question).trim(),
            answer: String(item.answer).trim(),
            commentary: String(item.commentary || '').trim(),
            correct_count: 0,
            incorrect_count: 0,
            lifespan: 1.0,
            last_answered_at: null,
            is_deleted: false
          });
        }
      });
      return;
    }
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

// 貼り付け欄・ファイルの中身が JSON なら上の入れ子形式として、
// そうでなければ CSV として読み取る。書式は先頭の文字だけで判定する。
function parseUploadText(text) {
  const trimmed = text.trim();
  const looksLikeJSON = trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[';
  if (!looksLikeJSON) {
    return { rows: parseCSV(text), error: null, format: 'csv' };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { rows: [], error: 'JSON の形式が正しくありません: ' + err.message, format: 'json' };
  }
  return { rows: parseQuestionJSON(parsed), error: null, format: 'json' };
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
