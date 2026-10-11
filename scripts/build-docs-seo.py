#!/usr/bin/env python3
"""Adds the SEO and internationalisation head tags, and writes sitemap/robots.

The site has no build step, so this runs by hand and its output is committed:

    python3 scripts/build-docs-seo.py

It reads the pages in docs/, and for each one writes into <head>:

  * a canonical URL
  * Open Graph and Twitter card tags
  * a JSON-LD block describing the page
  * reciprocal hreflang links for English and Indonesian
  * a pre-paint theme script, so the stored light/dark choice applies without a
    flash of the wrong theme

It is idempotent: everything it adds sits between the markers below, so a second
run replaces its own output instead of duplicating it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

SITE = "https://khalidinsan.github.io/badami"
REPO = "https://github.com/khalidinsan/badami"
NAME = "Badami"


START = "<!-- seo:start -->"
END = "<!-- seo:end -->"

# The theme script must run before the body paints, so it sits in <head>.
THEME_SCRIPT = """<script>
      // Applies the stored theme before first paint, so there is no flash of the
      // wrong theme. Kept inline and tiny on purpose.
      (function () {
        try {
          var saved = localStorage.getItem("badami-theme");
          var mode = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
          document.documentElement.setAttribute("data-theme", mode);
        } catch (e) {
          document.documentElement.setAttribute("data-theme", "light");
        }
      })();
    </script>"""


def page_url(path: Path) -> str:
    """Absolute URL for a page, in the form the site actually serves.

    Indonesian pages live under /id/, so the same relative path is reused there.
    """
    rel = path.relative_to(DOCS).as_posix()
    if rel.startswith("id/"):
        inner = rel[len("id/"):]
        if inner == "index.html":
            return f"{SITE}/id/"
        if inner == "docs/index.html":
            return f"{SITE}/id/docs/"
        return f"{SITE}/id/{inner}"
    if rel == "index.html":
        return f"{SITE}/"
    if rel == "docs/index.html":
        return f"{SITE}/docs/"
    return f"{SITE}/{rel}"


def counterpart_url(path: Path) -> str:
    """URL of the same page in the other language."""
    rel = path.relative_to(DOCS).as_posix()
    if rel.startswith("id/"):
        inner = rel[len("id/"):]
        if inner == "index.html":
            return f"{SITE}/"
        if inner == "docs/index.html":
            return f"{SITE}/docs/"
        return f"{SITE}/{inner}"
    if rel == "index.html":
        return f"{SITE}/id/"
    if rel == "docs/index.html":
        return f"{SITE}/id/docs/"
    return f"{SITE}/id/{rel}"


def read_head(html: str) -> dict[str, str]:
    def grab(pattern: str) -> str:
        m = re.search(pattern, html, re.S)
        return m.group(1).strip() if m else ""

    return {
        "title": grab(r"<title>(.*?)</title>"),
        "description": grab(r'<meta name="description" content="(.*?)"'),
    }


def build_block(path: Path, head: dict[str, str]) -> str:
    url = page_url(path)
    is_id = path.relative_to(DOCS).as_posix().startswith("id/")
    lang = "id" if is_id else "en"
    title = head["title"]
    description = head["description"]

    # The landing page is the product; every other page is a documentation page.
    is_landing = path == DOCS / "index.html"
    jsonld = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication" if is_landing else "TechArticle",
        "name": NAME,
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "macOS, Windows, Linux",
        "url": url,
        "description": description,
        "license": f"{REPO}/blob/main/LICENSE",
        "codeRepository": REPO,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
    }
    if not is_landing:
        jsonld["headline"] = title
        jsonld["inLanguage"] = lang

    # Each language has its own URL under /id/, so the alternates point at real
    # pages and the canonical stays on the page being served.
    other = counterpart_url(path)
    if path.relative_to(DOCS).as_posix().startswith("id/"):
        en_url, id_url = other, url
    else:
        en_url, id_url = url, other
    canonical = url

    return f"""{START}
    <link rel="canonical" href="{canonical}" />
    <link rel="alternate" hreflang="en" href="{en_url}" />
    <link rel="alternate" hreflang="id" href="{id_url}" />
    <link rel="alternate" hreflang="x-default" href="{en_url}" />
    <meta property="og:type" content="{'website' if is_landing else 'article'}" />
    <meta property="og:site_name" content="{NAME}" />
    <meta property="og:locale" content="{"id_ID" if is_id else "en_US"}" />
    <meta property="og:locale:alternate" content="{"en_US" if is_id else "id_ID"}" />
    <meta property="og:title" content="{title}" />
    <meta property="og:description" content="{description}" />
    <meta property="og:url" content="{canonical}" />
    <meta property="og:image" content="{SITE}/assets/logo.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{title}" />
    <meta name="twitter:description" content="{description}" />
    <meta name="twitter:image" content="{SITE}/assets/logo.png" />
    <meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
    <script type="application/ld+json">
      {json.dumps(jsonld, ensure_ascii=False)}
    </script>
    {THEME_SCRIPT}
    {END}"""


def strip_old_block(html: str) -> str:
    """Removes a previous run, plus any tags it owned before the markers existed."""
    html = re.sub(re.escape(START) + r".*?" + re.escape(END), "", html, flags=re.S)
    # The first version of this script wrote these without markers.
    for pattern in [
        r'\s*<meta property="og:title"[^>]*/>',
        r'\s*<meta property="og:description"[^>]*/>',
        r'\s*<meta property="og:image"[^>]*/>',
    ]:
        html = re.sub(pattern, "", html)
    return html


def insert_block(html: str, block: str) -> str:
    """Puts the block just before </head>."""
    return html.replace("</head>", f"  {block}\n  </head>", 1)


def sitemap(pages: list[Path]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path in pages:
        url = page_url(path)
        priority = "1.0" if path == DOCS / "index.html" else "0.7"
        lines.append("  <url>")
        lines.append(f"    <loc>{url}</loc>")
        lines.append("    <changefreq>weekly</changefreq>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def robots() -> str:
    return (
        "User-agent: *\n"
        "Allow: /\n\n"
        f"Sitemap: {SITE}/sitemap.xml\n"
    )


def main() -> None:
    pages = sorted(DOCS.glob("**/*.html"))
    changed = 0
    for path in pages:
        html = path.read_text(encoding="utf-8")
        head = read_head(html)
        if not head["title"]:
            print(f"skipped (no title): {path.relative_to(ROOT)}")
            continue
        html = strip_old_block(html)
        html = insert_block(html, build_block(path, head))
        path.write_text(html, encoding="utf-8")
        changed += 1

    (DOCS / "sitemap.xml").write_text(sitemap(pages), encoding="utf-8")
    (DOCS / "robots.txt").write_text(robots(), encoding="utf-8")

    print(f"updated {changed} pages, wrote sitemap.xml and robots.txt")


if __name__ == "__main__":
    main()
