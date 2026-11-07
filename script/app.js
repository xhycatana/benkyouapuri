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


// 通信は、ページの読み込み（外部の CSS・スクリプトの到着）を待たずに、HTML の読み込みが済んだ時点で始める。
// モバイル通信では、外部の読み込みが終わるまでに数秒かかることがあり、その間も通信を待たせないため。
document.addEventListener('DOMContentLoaded', function () {
  // 余白も、読み込みの終わりを待たずに揃える。待つと、先に幅の狭い（max-w-3xl の）画面が見えてから広がってしまう
  fitScreenMargins();
  loadLibrary(true);   // 起動直後は、合言葉が無くても勝手に入力欄を出さない
  loadHistoryPending();
  loadStudyTimePending();
});

window.onload = function() {
  switchPhase('import');
  globalCanvas.resizeCanvas();
  applyMemorySettingsToUI();
  applyDisplaySettingsToUI();
  watchZoom();
};
