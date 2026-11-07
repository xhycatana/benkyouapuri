"""Tailwind の CSS（tailwind.css）を作り直す。

画面の HTML（index.html）や、JS の中のクラス名（script/*.js）を変えたら、これを実行して、tailwind.css を作り直す。
忘れると、新しく足したクラスの見た目が、画面に出ない。

  py tools/build_css.py            tailwind.css を作り直す
  py tools/build_css.py --check    作り直さずに、今の tailwind.css が最新かだけを確かめる（古ければ終了コード 1）

Tailwind の公式ツール（standalone CLI、バージョン 3.4.17）が要る。リポジトリには入れない（tools/bin/ は .gitignore）。
初めて使うとき（Windows）:
  1. https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.17/tailwindcss-windows-x64.exe を、
     tools/bin/tailwindcss.exe という名前で保存する
  2. 同じ場所の sha256sums.txt と、sha256sum（または certutil -hashfile ... SHA256）で、ファイルの値を照合する
     （tailwindcss-windows-x64.exe の値は 67f1c5e3f5a03406a7bf5badf5ada09b79f3ae78ec43450c15f7e983068da346）
Mac / Linux では、同じリリースの tailwindcss-macos-arm64 などを、tools/bin/tailwindcss という名前で置く。
"""
import filecmp
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tailwind.css'
CANDIDATES = [ROOT / 'tools' / 'bin' / 'tailwindcss.exe', ROOT / 'tools' / 'bin' / 'tailwindcss']


def find_cli():
    for c in CANDIDATES:
        if c.exists():
            return c
    sys.exit('Tailwind の公式ツールが見つかりません。このファイルの先頭の手順で、tools/bin/ に置いてください。')


def build(cli, out):
    cmd = [str(cli), '-c', 'tailwind.config.js', '-i', 'tools/tailwind-input.css', '-o', str(out), '--minify']
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('ビルドに失敗しました:\n' + r.stdout + r.stderr)


def main():
    cli = find_cli()
    if '--check' in sys.argv:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d) / 'tailwind.css'
            build(cli, tmp)
            if OUT.exists() and filecmp.cmp(str(tmp), str(OUT), shallow=False):
                print('OK: tailwind.css は最新です。')
                return
        print('古い: tailwind.css が、いまの index.html・script/*.js と合っていません。py tools/build_css.py で作り直してください。')
        sys.exit(1)
    build(cli, OUT)
    print('作り直しました: tailwind.css（%d バイト）' % OUT.stat().st_size)


if __name__ == '__main__':
    main()
