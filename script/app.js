// 起動処理と、拡大の抑止。読み込み順の最後に置く。
// ----------------------------------------------------------------------

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


// --- 横向き固定（見た目だけ） ------------------------------------------------
// iPad の Safari には、ネイティブアプリのような画面回転の禁止機能が無い
// （screen.orientation.lock() は Fullscreen API とセットでないと使えず、
// iOS Safari は動画以外に Fullscreen API を提供していない）。
// そこで、縦向きになったら body を90度回転させ、見た目だけ常に横向きのまま
// になるようにする。window.innerWidth/innerHeight は回転の影響を受けず、
// 常に本物（縦向き）の値を返すので、キャンバスのサイズ計算とポインタ座標は
// 別途、回転後の見た目に合わせて変換する（canvas.js 側）。
function isLandscape() {
  return window.innerWidth >= window.innerHeight;
}

function applyOrientationLock() {
  const b = document.body;
  if (isLandscape()) {
    b.style.width = '';
    b.style.height = '';
    b.style.position = '';
    b.style.top = '';
    b.style.left = '';
    b.style.transformOrigin = '';
    b.style.transform = '';
  } else {
    // 縦向きの実サイズを取り、横向きに見えるよう90度回転させる。
    // width/height を入れ替えた箱を用意し、その左上を軸に回すことで
    // ちょうど画面いっぱいに重なる（透けたり余ったりしない）。
    b.style.width = window.innerHeight + 'px';
    b.style.height = window.innerWidth + 'px';
    b.style.position = 'fixed';
    b.style.top = '0';
    b.style.left = '100%';
    b.style.transformOrigin = 'top left';
    b.style.transform = 'rotate(90deg)';
  }
}

let orientationResizeTimeout = null;
function handleOrientationResize() {
  applyOrientationLock();
  clearTimeout(orientationResizeTimeout);
  orientationResizeTimeout = setTimeout(function () { globalCanvas.resizeCanvas(); }, 100);
}

window.addEventListener('resize', handleOrientationResize);
window.addEventListener('orientationchange', handleOrientationResize);


window.onload = function() {
  switchPhase('import');
  applyOrientationLock();
  globalCanvas.resizeCanvas();
  applyMemorySettingsToUI();
  watchZoom();
  loadLibrary();
};
