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

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
