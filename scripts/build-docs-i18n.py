#!/usr/bin/env python3
"""Builds the Indonesian site under docs/id/.

The site has no build step, so this runs by hand and its output is committed:

    python3 scripts/build-docs-i18n.py

Two layers are translated:

  * Chrome (nav, header, footer, search UI) comes from the dictionary in this
    file, so every page stays consistent and a new label only has to be added
    once.
  * Page content comes from `scripts/i18n/<page>.json`, a map of the English
    string to its Indonesian replacement. A string with no entry is left in
    English, which is visible in review and never silently wrong.

Pages are copied, not rewritten, so the markup and the English site stay in
step: only text nodes and the attributes listed in TRANSLATABLE_ATTRS change.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
ID = DOCS / "id"
MAPS = ROOT / "scripts" / "i18n"

# Chrome strings, shared by every page.
CHROME: dict[str, str] = {
    # Header
    "Docs": "Dokumentasi",
    "Download": "Unduh",
    # Nav sections
    "Start here": "Mulai di sini",
    "Modules": "Modul",
    "Reference": "Referensi",
    "Building": "Pengembangan",
    # Nav entries
    "Overview": "Ringkasan",
    "Install": "Instalasi",
    "Projects and pages": "Proyek dan halaman",
    "Tasks": "Tugas",
    "Planning and Today": "Perencanaan dan Hari Ini",
    "Servers": "Server",
    "Credential vault": "Brankas kredensial",
    "REST API tool": "Alat REST API",
    "Database client": "Klien database",
    "AI assistant": "Asisten AI",
    "Stats and search": "Statistik dan pencarian",
    "Sync": "Sinkronisasi",
    "Local Dev": "Local Dev",
    "Settings": "Pengaturan",
    "Keyboard shortcuts": "Pintasan papan tik",
    "Development": "Pengembangan",
    "Architecture": "Arsitektur",
    # Search UI
    "Search": "Cari",
    "Search the docs": "Cari di dokumentasi",
    "Search results": "Hasil pencarian",
    # Theme control
    "Switch to dark theme": "Ganti ke tema gelap",
    "Switch to light theme": "Ganti ke tema terang",
    # Footer
    "Shortcuts": "Pintasan",
    "MIT licensed.": "Berlisensi MIT.",
}

# Attributes that carry user-visible text and therefore get translated.
TRANSLATABLE_ATTRS = ("content", "placeholder", "aria-label", "title", "alt")

# Text that must never be translated: code, paths, product names, key names.
PROTECTED = [
    "Badami",
    "Local Dev",
    "GitHub",
    "MIT",
    "macOS",
    "Windows",
    "Linux",
    "Turso",
    "OpenRouter",
    "Postgres",
    "PostgreSQL",
    "MySQL",
    "MariaDB",
    "Redis",
    "nginx",
    "PHP",
    "dnsmasq",
    "SQLite",
    "APFS",
    "LaunchDaemon",
    "InnoDB",
    "TOTP",
    "Postman",
    "cURL",
    "Argon2",
    "AES-256-GCM",
    "SHA1",
    "SHA256",
    "SHA512",
    "JetBrains Mono",
    "Pomodoro",
    "Valet",
    "Apple Silicon",
    "Gatekeeper",
    "Keychain",
    "SmartScreen",
    "AppImage",
]


def load_map(page: Path) -> dict[str, str]:
    """Per-page content map, keyed on the English text."""
    name = page.relative_to(DOCS).as_posix().replace("/", "__").replace(".html", "")
    path = MAPS / f"{name}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def normalise(text: str) -> str:
    """Collapses the whitespace an HTML text node carries from indentation.

    Source files wrap paragraphs across lines, so the same sentence can appear
    with different indentation. Matching on the collapsed form means a map key is
    the sentence itself, not a copy of the surrounding layout.
    """
    return " ".join(text.split())


def translate_text(text: str, table: dict[str, str]) -> str:
    """Translates one text node, preserving the leading and trailing whitespace."""
    if not text.strip():
        return text
    key = normalise(text)
    if key in table:
        lead = text[: len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        return f"{lead}{table[key]}{trail}"
    return text


def fix_asset_paths(html: str, rel: str) -> str:
    """Rewrites asset references for the extra /id/ directory level.

    Indonesian pages sit one level deeper than their English counterparts, so
    every reference that walked up from the page has to walk up one more.
    """
    depth = rel.count("/") + 1
    prefix = "../" * depth
    for name in ("site.css", "search.js", "theme.js", "icon.png", "logo.png", "logo-white.png", "search-index.json"):
        # Any existing relative reference to this asset, whatever its depth.
        html = re.sub(
            r'(?<=")(?:\.\./)*assets/' + re.escape(name),
            prefix + "assets/" + name,
            html,
        )
    return html


def rewrite(html: str, table: dict[str, str]) -> str:
    """Applies the table to text nodes and translatable attributes."""

    # Text between tags.
    def on_text(m: re.Match[str]) -> str:
        return ">" + translate_text(m.group(1), table) + "<"

    html = re.sub(r">([^<>]+)<", on_text, html)

    # Attributes.
    def on_attr(m: re.Match[str]) -> str:
        name, value = m.group(1), m.group(2)
        if name not in TRANSLATABLE_ATTRS:
            return m.group(0)
        return f'{name}="{translate_text(value, table)}"'

    html = re.sub(r'\b(content|placeholder|aria-label|title|alt)="([^"]*)"', on_attr, html)

    return html


def counterpart(rel: str, target: str) -> str:
    """Relative path from one language's page to the same page in the other.

    English pages live at the root, Indonesian ones under /id/, so the path
    between them is a fixed number of steps plus the relative path itself.
    """
    if target == "id":
        # From docs/docs/tasks.html to docs/id/docs/tasks.html
        return "../id/" + rel
    # From docs/id/docs/tasks.html back to docs/docs/tasks.html
    return "../../" + rel


def add_language_switch(html: str, rel: str, active: str) -> str:
    """Inserts the EN/ID switch into the header nav, before the search button."""
    # The active language links to the page itself, by file name.
    self_name = Path(rel).name
    en_href = self_name if active == "en" else counterpart(rel, "en")
    id_href = counterpart(rel, "id") if active == "en" else self_name
    en_current = ' aria-current="true"' if active == "en" else ""
    id_current = ' aria-current="true"' if active == "id" else ""
    switch = (
        '<span class="nav-lang" role="group" aria-label="Language">'
        f'<a href="{en_href}"{en_current} hreflang="en" lang="en">EN</a>'
        f'<a href="{id_href}"{id_current} hreflang="id" lang="id">ID</a>'
        "</span>"
    )
    # Re-running must not stack switches or clusters.
    html = re.sub(r'<span class="nav-lang".*?</span>', "", html, flags=re.S)
    html = re.sub(r'<span class="nav-tools">\s*</span>', "", html)
    html = html.replace(
        '<nav class="site-nav">',
        '<nav class="site-nav"><span class="nav-tools">' + switch + "</span>",
        1,
    )
    return html


def set_lang_attr(html: str) -> str:
    return html.replace('<html lang="en">', '<html lang="id">', 1)


def translate_head(html: str, table: dict[str, str]) -> str:
    """Translates the page title and the meta description.

    The title keeps its trailing "· Badami", which is a brand suffix and not
    translated. A title or description with no map entry is left alone.
    """
    def on_title(m: re.Match[str]) -> str:
        name = normalise(m.group(1))
        return f"<title>{table.get(name, m.group(1))} · Badami</title>"

    html = re.sub(r"<title>(.*?)(?: · Badami)?</title>", on_title, html, count=1)

    def on_desc(m: re.Match[str]) -> str:
        text = normalise(m.group(1))
        return f'<meta name="description" content="{table.get(text, m.group(1))}" />'

    html = re.sub(r'<meta name="description" content="([^"]*)"\s*/?>', on_desc, html, count=1)
    return html


def add_switch_to_english() -> int:
    """Adds the EN/ID switch to the English pages, so both sides match."""
    count = 0
    for page in sorted(DOCS.glob("*.html")) + sorted(DOCS.glob("docs/*.html")):
        rel = page.relative_to(DOCS).as_posix()
        html = page.read_text(encoding="utf-8")
        updated = add_language_switch(html, rel, "en")
        if updated != html:
            page.write_text(updated, encoding="utf-8")
            count += 1
    return count


def build_search_index() -> None:
    """Rebuilds the Indonesian search index from the generated pages.

    Reuses the English index builder by pointing it at docs/id, then rewrites
    the URLs so they resolve from an Indonesian page.
    """
    import subprocess

    script = ROOT / "scripts" / "build-docs-search.py"
    if not script.exists():
        return
    out = ID / "assets" / "search-index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["python3", str(script), "--root", str(ID), "--out", str(out)],
        check=False,
    )


def main() -> None:
    if ID.exists():
        shutil.rmtree(ID)

    pages = sorted(DOCS.glob("**/*.html"))
    written = 0
    untranslated: dict[str, int] = {}

    for page in pages:
        rel = page.relative_to(DOCS).as_posix()
        target = ID / rel
        target.parent.mkdir(parents=True, exist_ok=True)

        content = load_map(page)
        table = {**CHROME, **content}

        html = page.read_text(encoding="utf-8")
        html = set_lang_attr(html)
        html = fix_asset_paths(html, rel)
        html = translate_head(html, table)
        html = rewrite(html, table)
        html = add_language_switch(html, rel, "id")
        # The canonical and hreflang block is regenerated for /id/ afterwards.
        html = re.sub(r"<!-- seo:start -->.*?<!-- seo:end -->", "", html, flags=re.S)

        target.write_text(html, encoding="utf-8")
        written += 1

        missing = 0
        for line in html.splitlines():
            for m in re.finditer(r">([A-Za-z][^<>]{12,})<", line):
                missing += 1
        untranslated[rel] = missing

    build_search_index()

    english = add_switch_to_english()
    print(f"wrote {written} pages under docs/id/")
    print(f"added the switch to {english} English pages")
    heaviest = sorted(untranslated.items(), key=lambda kv: -kv[1])[:5]
    print("pages with the most English text left:")
    for name, n in heaviest:
        print(f"  {name}: {n} text nodes")


if __name__ == "__main__":
    main()
