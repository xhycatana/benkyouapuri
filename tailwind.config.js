// Tailwind の設定。CSS の作り方は README の「Tailwind の CSS を作り直す」を参照。
// Play CDN（以前使っていたもの）と同じ、標準の設定。画面の HTML と、JS の中で組み立てるクラス名を調べる。
module.exports = {
  content: ['./index.html', './script/**/*.js'],
  theme: { extend: {} },
  plugins: []
};
