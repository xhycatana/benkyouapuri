// 全画面の手書きキャンバスと、ペンの設定。
// ----------------------------------------------------------------------

// --- 線の描き方（本番のキャンバスと、使い方画面の試し書きで共通） ---

// 1回の pointermove に含まれるサンプル点を取り出す。
// ペンは getCoalescedEvents() で間引かれる前の高頻度サンプル（240Hz）をすべて拾う。
// ただしこのAPIは HTTPS でないと使えないので、ローカルのHTTPでは60Hz相当に落ちる。
function pointerSamples(e, toPos) {
  if (e.pointerType !== 'pen') return [toPos(e)];
  // 空配列が返ることがある（空配列は truthy なので || では拾えない）
  let coalesced = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  if (coalesced.length === 0) coalesced = [e];
  return coalesced.map(toPos);
}

// サンプル点をそのまま直線で結ぶと折れ線になって角が見えるため、
// 「直前の点を制御点、隣り合う2点の中点を通過点」とする2次ベジェ曲線でつなぐ。
// s は { lastX, lastY, lastT, midX, midY } を持つストロークの状態。
// 描いたら true、重複として捨てたら false を返す。
function extendSmoothStroke(ctx, s, pos) {
  // Safari は同じ pointermove を2回発火させ、getCoalescedEvents() が
  // まったく同じ点の並びを返してくることがある（実機で確認）。
  // そのまま繋ぐと、2回目の先頭で数点ぶん巻き戻る直線が引かれ、
  // 滑らかな線とは別に「数点飛ばしのカクカクした線」が重なって見える。
  // 時刻が進んでいない点は再配信とみなして捨てる。
  if (typeof pos.t === 'number' && typeof s.lastT === 'number') {
    if (pos.t < s.lastT) return false;
    if (pos.t === s.lastT && pos.x === s.lastX && pos.y === s.lastY) return false;
  } else if (pos.x === s.lastX && pos.y === s.lastY) {
    return false;   // 時刻が取れない場合は、座標が完全に同じものだけ捨てる
  }

  const midX = (s.lastX + pos.x) / 2;
  const midY = (s.lastY + pos.y) / 2;

  ctx.beginPath();
  ctx.moveTo(s.midX, s.midY);
  ctx.quadraticCurveTo(s.lastX, s.lastY, midX, midY);
  ctx.stroke();

  s.midX = midX;
  s.midY = midY;
  s.lastX = pos.x;
  s.lastY = pos.y;
  if (typeof pos.t === 'number') s.lastT = pos.t;
  return true;
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

    // 書いた内容を新しい大きさいっぱいに引き伸ばして描き直す。回転すると線は縦横に
    // 伸び縮みするが、アプリの切り替えなどで途中の大きさを何度経由しても、
    // 書いた内容が画面の外へはみ出して欠けたり、位置がずれたままになったりしない。
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
        setReviewCorrectButtonsEnabled(false);
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

    for (const pos of pointerSamples(e, ev => this.getPointerPos(ev))) this.extendStroke(pos);

    if (currentList[currentIndex]) {
      userHasDrawn[currentList[currentIndex].id] = true;
      if (currentPhase === 'review') {
        setReviewCorrectButtonsEnabled(true);
      }
    }
  }

  extendStroke(pos) {
    extendSmoothStroke(this.ctx, this.stroke, pos);
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


// --- 使い方画面の試し書き ---
// 本番と同じ描き方（extendSmoothStroke）とペンの太さで描き、
// 入力を1秒あたり何点受け取れているかを表示する。Apple Pencil の 240Hz が
// 実機で本当に出ているかを、その場で確かめるためのもの。
const penTest = {
  ctx: penTestPad.getContext('2d'),
  stroke: null,
  sawPen: false,
  points: 0,       // 描いたサンプル点の数（重複は除く。書いている間だけ数える）
  events: 0,       // pointermove の回数
  activeMs: 0,     // ペンが画面に触れていた合計時間
  strokeStartT: 0
};

// 表示された大きさに合わせてキャンバスの解像度を決める（隠れている間は大きさが0なので、開くたびに呼ぶ）
function sizePenTestPad() {
  const dpr = window.devicePixelRatio || 1;
  const rect = penTestPad.getBoundingClientRect();
  if (rect.width === 0) return;
  penTestPad.width = Math.round(rect.width * dpr);
  penTestPad.height = Math.round(rect.height * dpr);
  penTest.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  penTest.ctx.lineCap = 'round';
  penTest.ctx.lineJoin = 'round';
}

function penTestPos(e) {
  const rect = penTestPad.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
}

function updatePenTestStats() {
  if (penTest.activeMs <= 0 || penTest.events === 0) return;
  const perSecond = Math.round(penTest.points / (penTest.activeMs / 1000));
  const perEvent = (penTest.points / penTest.events).toFixed(1);
  const coalesced = ('getCoalescedEvents' in PointerEvent.prototype) ? '対応' : '非対応';
  penTestStats.textContent = '約 ' + perSecond + ' 点/秒（1回の通知に平均 ' + perEvent + ' 点）' +
    ' ・ HTTPS: ' + (window.isSecureContext ? 'はい' : 'いいえ') +
    ' ・ 高頻度入力: ' + coalesced;
}

penTestPad.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen') penTest.sawPen = true;
  if (e.pointerType === 'touch' && penTest.sawPen) return;   // 本番と同じく、ペンを使ったら指は無視
  e.preventDefault();
  if (penTestPad.width === 0) sizePenTestPad();
  const pos = penTestPos(e);
  penTest.stroke = { pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, lastT: pos.t, midX: pos.x, midY: pos.y };
  penTest.strokeStartT = pos.t;
  penTest.ctx.strokeStyle = currentPenColor;
  penTest.ctx.lineWidth = currentPenWidth;
  try { penTestPad.setPointerCapture(e.pointerId); } catch (err) {}
});

penTestPad.addEventListener('pointermove', (e) => {
  const s = penTest.stroke;
  if (!s || s.pointerId !== e.pointerId) return;
  e.preventDefault();
  penTest.events++;
  // 重複として捨てた点は数えない（同じ点を2回受け取っても、見かけの頻度が上がらないように）
  for (const pos of pointerSamples(e, penTestPos)) {
    if (extendSmoothStroke(penTest.ctx, s, pos)) penTest.points++;
  }
});

function endPenTestStroke(e) {
  const s = penTest.stroke;
  if (!s || s.pointerId !== e.pointerId) return;
  penTest.ctx.beginPath();
  penTest.ctx.moveTo(s.midX, s.midY);
  penTest.ctx.lineTo(s.lastX, s.lastY);
  penTest.ctx.stroke();
  penTest.activeMs += Math.max(0, e.timeStamp - penTest.strokeStartT);
  penTest.stroke = null;
  updatePenTestStats();
}
penTestPad.addEventListener('pointerup', endPenTestStroke);
penTestPad.addEventListener('pointercancel', endPenTestStroke);

btnPenTestClear.addEventListener('click', () => {
  penTest.ctx.clearRect(0, 0, penTestPad.width, penTestPad.height);
  penTest.points = 0;
  penTest.events = 0;
  penTest.activeMs = 0;
  penTestStats.textContent = 'ペンで書くと、入力を1秒あたり何点受け取れているかが出ます。';
});

window.addEventListener('resize', () => { if (currentPhase === 'help') sizePenTestPad(); });

// スライダー設定
