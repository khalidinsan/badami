#!/usr/bin/env python3
"""Builds the docs search index.

The site has no build step, so this runs by hand and its output is committed:

    python3 scripts/build-docs-search.py

It walks docs/**/*.html, splits each page into its sections, and writes
docs/assets/search-index.json. The browser then only has to fetch one file and
filter it in memory, which keeps search working on a static host with no
service behind it.
"""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "assets" / "search-index.json"

# Tags whose text belongs in the index.
TEXT_TAGS = {"p", "li", "td", "th", "h1", "h2", "h3", "h4", "code", "strong", "em"}

# Sections longer than this are cut; a result only needs enough to recognise.
MAX_SECTION_CHARS = 420


class SectionExtractor(HTMLParser):
    """Collects the heading structure and the text under each heading.

    Only the site's own markup is parsed, and the site keeps its content inside
    `main .docs-body`, so a light parser is enough and avoids a dependency.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_main = 0
        self.in_skip = 0
        self.sections: list[dict[str, str]] = []
        self.page_title = ""
        self._current: dict[str, str] | None = None
        self._buffer: list[str] = []
        self._heading_tag = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "main":
            self.in_main += 1
        if self.in_main == 0:
            return
        # Nav, header, and footer are chrome, not content.
        if tag in {"nav", "header", "footer", "script", "style"}:
            self.in_skip += 1
            return
        if self.in_skip:
            return
        if tag in {"h1", "h2", "h3"}:
            self._flush()
            self._heading_tag = tag
            self._buffer = []
        elif tag == "a" and attr.get("class") == "feature":
            # Card links repeat the section list; skip to avoid duplicate hits.
            self.in_skip += 1

    def handle_endtag(self, tag: str) -> None:
        if self.in_skip and tag in {"nav", "header", "footer", "script", "style", "a"}:
            self.in_skip = max(0, self.in_skip - 1)
            return
        if tag == "main":
            self.in_main = max(0, self.in_main - 1)
            self._flush()
            return
        if self.in_skip:
            return
        if tag in {"h1", "h2", "h3"} and self._heading_tag == tag:
            text = " ".join("".join(self._buffer).split())
            if tag == "h1" and not self.page_title:
                self.page_title = text
            else:
                self._start_section(text)
            self._heading_tag = ""
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self.in_main and not self.in_skip and self._heading_tag or (
            self.in_main and not self.in_skip and self._current is not None
        ):
            self._buffer.append(data)

    def _start_section(self, title: str) -> None:
        if not title:
            return
        self._current = {"heading": title, "text": ""}
        self.sections.append(self._current)

    def _flush(self) -> None:
        if self._current is None:
            return
        text = " ".join("".join(self._buffer).split())
        if text:
            existing = self._current["text"]
            self._current["text"] = (existing + " " + text).strip()[:MAX_SECTION_CHARS]
        self._buffer = []


def page_url(path: Path) -> str:
    rel = path.relative_to(DOCS).as_posix()
    if rel == "index.html":
        return ""
    if rel == "docs/index.html":
        return "docs/"
    return rel


def anchor_for(heading: str, used: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    slug = slug or "section"
    candidate = slug
    n = 2
    while candidate in used:
        candidate = f"{slug}-{n}"
        n += 1
    used.add(candidate)
    return candidate


def build() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for path in sorted(DOCS.glob("**/*.html")):
        parser = SectionExtractor()
        parser.feed(path.read_text(encoding="utf-8"))
        url = page_url(path)
        page_name = parser.page_title or path.stem
        used: set[str] = set()
        for section in parser.sections:
            entries.append(
                {
                    "url": url,
                    "page": page_name,
                    "heading": section["heading"],
                    "anchor": anchor_for(section["heading"], used),
                    "text": section["text"],
                }
            )
        if not parser.sections:
            # A page with no subsections still needs one entry.
            entries.append(
                {"url": url, "page": page_name, "heading": page_name, "anchor": "", "text": ""}
            )
    return entries


def main() -> None:
    global DOCS, OUT
    parser = argparse.ArgumentParser(description="Build the docs search index.")
    parser.add_argument("--root", default=str(DOCS), help="directory holding the pages")
    parser.add_argument("--out", default=str(OUT), help="index file to write")
    args = parser.parse_args()
    DOCS = Path(args.root)
    OUT = Path(args.out)

    entries = build()
    OUT.write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = OUT.stat().st_size
    try:
        shown = OUT.relative_to(ROOT)
    except ValueError:
        shown = OUT
    print(f"wrote {shown} with {len(entries)} sections ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
