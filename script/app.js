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


window.onload = function() {
  switchPhase('import');
  globalCanvas.resizeCanvas();
  applyMemorySettingsToUI();
  applyDisplaySettingsToUI();
  watchZoom();
  loadLibrary();
  loadHistoryPending();
};
