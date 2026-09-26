// 全画面の手書きキャンバスと、ペンの設定。
// ----------------------------------------------------------------------

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

    // リサイズへの反応（横向き固定の適用も含む）は app.js が担当する。
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // 縦向きの間は body を90度回転させて見た目を横向きに保つ（app.js）。
    // window.innerWidth/innerHeight は回転の影響を受けず常に本物（縦向き）の
    // 値を返すので、見た目に合わせてここで幅と高さを入れ替える。
    const landscape = isLandscape();
    const width = Math.max(1, landscape ? window.innerWidth : window.innerHeight);
    const height = Math.max(1, landscape ? window.innerHeight : window.innerWidth);

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
    
    // 元のサイズのまま、左上を基準に置き直す。新旧のキャンバスの大きさに
    // 引き伸ばして合わせると、画面を回転しただけで書いた線の形が変わって
    // しまう（正方形が長方形になる等）。拡大縮小せずに描き直すことで、
    // 回転しても書いた内容の見た目は変わらないようにする。
    if (hasContent && tempCanvas.width > 0 && tempCanvas.height > 0) {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        this.ctx.drawImage(tempCanvas, 0, 0);
      } catch (err) {}
      this.ctx.restore();
    }
  }

  getPointerPos(e) {
    if (isLandscape()) {
      return { x: e.clientX, y: e.clientY, t: e.timeStamp };
    }
    // 縦向き：見た目は90度回転しているので、実際に触れた座標
    // （回転前の物理座標）を、見た目基準の座標へ変換する。
    return { x: e.clientY, y: window.innerWidth - e.clientX, t: e.timeStamp };
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
