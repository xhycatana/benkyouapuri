"""公開（プッシュ）の前に、崩れていないかをまとめて確かめる。

  py tools/check.py

確かめること:
  1. 文字化け（NUL 文字）が混ざっていないか
  2. index.html の構造（余分な閉じタグ・閉じ忘れ）
  3. 版番号が、index.html の全部の場所で同じか。個数が README の説明と合っているか
  4. script/*.js が、index.html の読み込みと過不足なく対応しているか
  5. dom.js が参照する id が、index.html にあるか
  6. tailwind.css が、いまの画面（index.html・script/*.js）に合っているか（tools/build_css.py --check）
  7. JS の構文（Chrome か Edge をヘッダーなしで動かして調べる。見つからなければ、この項目だけ省く）

1つでも ✗ があれば、終了コード 1。⚠ は、確認できなかっただけで、失敗にはしない。
"""
import json
import re
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failures = []
warnings = []


def ok(msg):
    print('  ✓ ' + msg)


def ng(msg):
    failures.append(msg)
    print('  ✗ ' + msg)


def warn(msg):
    warnings.append(msg)
    print('  ⚠ ' + msg)


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


def text_files():
    out = [ROOT / 'index.html', ROOT / 'README.md', ROOT / 'style.css', ROOT / 'tailwind.css', ROOT / 'vercel.json',
           ROOT / 'tailwind.config.js', ROOT / 'sw.js']
    out += sorted((ROOT / 'script').glob('*.js')) + sorted((ROOT / 'api').glob('*.js'))
    return [p for p in out if p.exists()]


# ---------------------------------------------------------------------------
def check_nul():
    print('1. 文字化け（NUL 文字）')
    bad = [p.relative_to(ROOT).as_posix() for p in text_files() if '\x00' in p.read_text(encoding='utf-8', errors='replace')]
    if bad:
        ng('NUL 文字が混ざっています: ' + ', '.join(bad))
    else:
        ok('どのファイルにも混ざっていません')


# ---------------------------------------------------------------------------
VOID = {'meta', 'link', 'input', 'br', 'hr', 'img', 'source', 'col', 'area', 'base', 'embed', 'param', 'track', 'wbr'}


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.issues = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
            return
        self.issues.append('行 %d: 対応する開きタグのない </%s>' % (self.getpos()[0], tag))


def check_html():
    print('2. index.html の構造')
    p = Structure()
    p.feed(read('index.html'))
    problems = p.issues[:5] + ['行 %d: 閉じていない <%s>' % (pos[0], tag) for tag, pos in p.stack[:5]]
    if problems:
        for m in problems:
            ng(m)
    else:
        ok('余分な閉じタグも、閉じ忘れもありません')


# ---------------------------------------------------------------------------
def check_versions():
    print('3. 版番号')
    html = read('index.html')
    refs = re.findall(r'(?:src|href)="[^"]+\?v=(\d+\.\d+\.\d+)"', html)
    label = re.findall(r'>v(\d+\.\d+\.\d+)<', html)
    versions = set(refs) | set(label)
    if len(versions) != 1:
        ng('版番号が揃っていません: ' + ', '.join(sorted(versions)) if versions else '版番号が見つかりません')
        return
    ver = versions.pop()
    total = html.count(ver)
    expected = len(refs) + len(label)
    scripts = len(re.findall(r'<script src="script/', html))
    if total != expected:
        ng('版番号 %s の個数が合いません（読み込み %d + 表示 %d = %d、実際は %d）' % (ver, len(refs), len(label), expected, total))
    else:
        ok('版 %s が %d か所で揃っています（読み込み %d、画面下部の表示 %d）' % (ver, total, len(refs), len(label)))
    readme = read('README.md')
    m1 = re.search(r'バージョン文字列は \*\*(\d+) か所\*\*', readme)
    m2 = re.search(r'`script/\*\.js` に(\d+)）', readme)
    if m1 and int(m1.group(1)) != total:
        ng('README の「%s か所」が、実際の %d か所と合いません' % (m1.group(1), total))
    if m2 and int(m2.group(1)) != scripts:
        ng('README の「script/*.js に%s」が、実際の %d 本と合いません' % (m2.group(1), scripts))
    m3 = re.search(r"grep -o '(\d+)\\\.(\d+)\\\.(\d+)' index\.html", readme)
    if m3 and '.'.join(m3.groups()) != ver:
        ng('README の確認コマンドの版（%s）が、index.html の版（%s）と違います' % ('.'.join(m3.groups()), ver))
    elif m3:
        ok('README の説明（個数・確認コマンド）と合っています')


# ---------------------------------------------------------------------------
def check_scripts():
    print('4. script/*.js と index.html の読み込み')
    html = read('index.html')
    loaded = re.findall(r'<script src="script/([^"?]+)', html)
    on_disk = sorted(p.name for p in (ROOT / 'script').glob('*.js'))
    missing = sorted(set(loaded) - set(on_disk))
    unused = sorted(set(on_disk) - set(loaded))
    dup = sorted({x for x in loaded if loaded.count(x) > 1})
    if missing:
        ng('index.html が読み込むのに、ファイルがありません: ' + ', '.join(missing))
    if unused:
        ng('ファイルがあるのに、index.html が読み込みません: ' + ', '.join(unused))
    if dup:
        ng('同じファイルを2回読み込んでいます: ' + ', '.join(dup))
    if not (missing or unused or dup):
        ok('%d 本とも、過不足なく対応しています' % len(loaded))


# ---------------------------------------------------------------------------
def check_dom_ids():
    print('5. dom.js が参照する id')
    html = read('index.html')
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    wanted = re.findall(r"getElementById\('([^']+)'\)", read('script/dom.js'))
    missing = sorted({w for w in wanted if w not in ids})
    if missing:
        ng('index.html に無い id を、dom.js が参照しています: ' + ', '.join(missing))
    else:
        ok('%d 個とも、index.html にあります' % len(wanted))


# ---------------------------------------------------------------------------
def check_css():
    print('6. tailwind.css')
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_css.py'), '--check'], capture_output=True)
    out = (r.stdout + r.stderr).decode('cp932', errors='replace') + (r.stdout + r.stderr).decode('utf-8', errors='replace')
    if r.returncode == 0:
        ok('いまの画面に合っています')
    elif '見つかりません' in out or 'Tailwind' in out and 'ツール' in out and r.returncode != 1:
        warn('Tailwind の公式ツールがないので、確認できません（tools/bin/ に置くと確認できます）')
    else:
        ng('tailwind.css が古いです。py tools/build_css.py で作り直してください')


# ---------------------------------------------------------------------------
def find_browser():
    for c in [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
              '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:
        if Path(c).exists():
            return c
    return None


def check_js_syntax():
    print('7. JS の構文')
    files = sorted((ROOT / 'script').glob('*.js')) + sorted((ROOT / 'api').glob('*.js')) + [p for p in [ROOT / 'sw.js'] if p.exists()]
    browser = find_browser()
    if not browser:
        warn('Chrome か Edge が見つからないので、構文は確認できません')
        return
    sources = {p.relative_to(ROOT).as_posix(): p.read_text(encoding='utf-8') for p in files}
    page = ('<!doctype html><meta charset="utf-8"><body><pre id="o"></pre><script>\n'
            'var src = ' + json.dumps(sources).replace('</', '<\\/') + ';\n'
            'var bad = [];\n'
            'Object.keys(src).forEach(function (k) { try { new Function(src[k]); } catch (e) { bad.push(k + ": " + e.message); } });\n'
            'document.getElementById("o").textContent = "RESULT:" + JSON.stringify(bad) + ":END";\n'
            '</script>')
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'syntax.html'
        f.write_text(page, encoding='utf-8')
        try:
            r = subprocess.run([browser, '--headless', '--disable-gpu', '--no-sandbox', '--user-data-dir=' + str(Path(d) / 'profile'),
                                '--virtual-time-budget=5000', '--dump-dom', f.as_uri()], capture_output=True, timeout=120)
        except Exception as e:  # noqa: BLE001
            warn('ブラウザを動かせなかったので、構文は確認できません（%s）' % e)
            return
    m = re.search(r'RESULT:(\[.*?\]):END', r.stdout.decode('utf-8', errors='replace'), re.S)
    if not m:
        warn('構文の確認の結果を受け取れませんでした')
        return
    bad = json.loads(m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
    if bad:
        for b in bad:
            ng('構文エラー: ' + b)
    else:
        ok('%d ファイルとも、構文エラーはありません' % len(files))


def main():
    for fn in (check_nul, check_html, check_versions, check_scripts, check_dom_ids, check_css, check_js_syntax):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            ng('%s の確認中にエラー: %s' % (fn.__name__, e))
    print()
    if failures:
        print('✗ %d 件の問題があります。公開する前に直してください。' % len(failures))
        sys.exit(1)
    print('✓ すべて問題ありません。' + (' （確認できなかった項目が %d 件あります）' % len(warnings) if warnings else ''))


if __name__ == '__main__':
    main()
