"""Builds dist/ramp-plan.html: the whole app in one file, with the stylesheet and scripts inlined, for static
hosting such as S3. Only the Google Fonts stylesheet stays a link (without it the page falls back to system fonts).

Run after any change: python3 ~/ramp_plan/build_single.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "dist" / "ramp-plan.html"


def inline(match, tag):
    name = match.group(1)
    text = (ROOT / name).read_text(encoding="utf-8")
    if f"</{tag}" in text.lower():
        raise SystemExit(f"{name} contains </{tag}, which would end the inlined <{tag}> early")
    return f"<{tag}>\n{text}\n</{tag}>"


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html, styles = re.subn(r'<link rel="stylesheet" href="([\w.-]+\.css)(?:\?[^"]*)?">', lambda m: inline(m, "style"), html)
    html, scripts = re.subn(r'<script src="([\w.-]+\.js)(?:\?[^"]*)?"></script>', lambda m: inline(m, "script"), html)
    if styles != 1 or scripts < 1 or re.search(r'<script src="(?!https?:)', html):
        raise SystemExit(f"Expected one local stylesheet and the local scripts; inlined {styles} and {scripts}")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, {scripts} scripts inlined)")


if __name__ == "__main__":
    main()
