#!/usr/bin/env python3
# prompts/src/ の部品を結合して、配布用のプロンプト（prompts/*.md）を作る。
#
#   python tools/build_prompts.py          作り直す
#   python tools/build_prompts.py --check  配布用が最新かだけを調べる（古ければ終了コード1）
#
# 配布用のファイルは、GitHub の「Copy raw file」でそのまま貼れるよう、プロンプト本文だけにしてある。
# 直すのは prompts/src/ の方だけ。配布用を直接直しても、次のビルドで上書きされる。

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "prompts" / "src"
OUT = ROOT / "prompts"

# 配布用のファイル名 → 結合する部品（上から順に）。
# モードごとに必要な部品だけを入れて、1回に貼る文章を短くしている。
BUILDS = {
    "transcribe.md": ["transcribe.md"],
    "mode1-textbook.md": ["common-rules.md", "mode1.md", "question-craft.md", "output-format.md", "fill-in.md", "multi-answer.md"],
    "mode2-theme.md": ["common-rules.md", "mode2.md", "question-craft.md", "output-format.md", "fill-in.md", "multi-answer.md"],
    "mode3-workbook.md": ["common-rules.md", "mode3.md", "output-format.md", "fill-in.md", "multi-answer.md"],
}


def build_text(parts):
    chunks = []
    for name in parts:
        path = SRC / name
        if not path.exists():
            sys.exit("部品が見つかりません: " + str(path))
        chunks.append(path.read_text(encoding="utf-8").strip())
    return "\n\n".join(chunks) + "\n"


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for out_name, parts in BUILDS.items():
        text = build_text(parts)
        target = OUT / out_name
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current != text:
            stale.append(out_name)
            if not check:
                target.write_text(text, encoding="utf-8", newline="\n")
        print("%-20s %6d 文字" % (out_name, len(text)))
    if check and stale:
        print("古いまま: " + ", ".join(stale) + "（python tools/build_prompts.py で作り直してください）")
        sys.exit(1)
    if not check and stale:
        print("更新: " + ", ".join(stale))


if __name__ == "__main__":
    main()
