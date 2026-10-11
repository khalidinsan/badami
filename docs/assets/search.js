/* Docs search.
   Loads a static index once and filters it in memory. There is no server and
   no external library, so search works from a plain static host. */

(function () {
  "use strict";

  var MAX_RESULTS = 12;
  var indexUrl = null;
  var entries = null;
  var loading = null;

  /** Resolves the index path for pages at the root and one level down. */
  function resolveIndexUrl() {
    if (indexUrl) return indexUrl;
    var path = window.location.pathname;
    // A page under /docs/ needs to step up one directory.
    var inDocs = /\/docs\/[^/]*$/.test(path);
    indexUrl = inDocs ? "../assets/search-index.json" : "assets/search-index.json";
    return indexUrl;
  }

  function loadIndex() {
    if (entries) return Promise.resolve(entries);
    if (loading) return loading;
    loading = fetch(resolveIndexUrl())
      .then(function (r) {
        if (!r.ok) throw new Error("index " + r.status);
        return r.json();
      })
      .then(function (data) {
        entries = data;
        return entries;
      })
      .catch(function () {
        entries = [];
        return entries;
      });
    return loading;
  }

  /** Scores an entry against the query. Higher is better, 0 means no match. */
  function score(entry, terms) {
    var heading = entry.heading.toLowerCase();
    var page = entry.page.toLowerCase();
    var text = entry.text.toLowerCase();
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var s = 0;
      if (heading === t) s = 60;
      else if (heading.indexOf(t) === 0) s = 40;
      else if (heading.indexOf(t) !== -1) s = 25;
      else if (page.indexOf(t) !== -1) s = 12;
      if (s === 0 && text.indexOf(t) !== -1) s = 6;
      if (s === 0) return 0; // every term must appear somewhere
      total += s;
    }
    return total;
  }

  function search(entries, query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var hits = [];
    for (var i = 0; i < entries.length; i++) {
      var s = score(entries[i], terms);
      if (s > 0) hits.push({ entry: entries[i], score: s });
    }
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.heading.length - b.entry.heading.length;
    });
    return hits.slice(0, MAX_RESULTS).map(function (h) {
      return h.entry;
    });
  }

  /** Builds the link for a result, correct from either directory depth. */
  function resultHref(entry) {
    var path = window.location.pathname;
    var inDocs = /\/docs\/[^/]*$/.test(path);
    var base = entry.url; // "" | "docs/" | "docs/tasks.html"
    var href;
    if (inDocs) {
      href = base === "" ? "../index.html" : base.replace(/^docs\//, "");
      if (href === "") href = "index.html";
    } else {
      href = base === "" ? "index.html" : base;
    }
    return entry.anchor ? href + "#" + entry.anchor : href;
  }

  var dialog, input, list, status, trigger;
  var results = [];
  var active = -1;

  function build() {
    dialog = document.createElement("div");
    dialog.className = "search-overlay";
    dialog.hidden = true;
    dialog.innerHTML =
      '<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the docs">' +
      '<div class="search-field">' +
      '<input type="search" id="docs-search-input" placeholder="Search the docs" ' +
      'autocomplete="off" spellcheck="false" aria-controls="docs-search-results" ' +
      'aria-expanded="false" role="combobox" />' +
      '<kbd class="search-esc">esc</kbd>' +
      "</div>" +
      '<ul class="search-results" id="docs-search-results" role="listbox" ' +
      'aria-label="Search results"></ul>' +
      '<p class="search-status" role="status" aria-live="polite"></p>' +
      "</div>";

    // Appended to the body, not the header: the sticky header is its own
    // stacking context, which would paint the panel behind the article.
    document.body.appendChild(dialog);

    input = dialog.querySelector("#docs-search-input");
    list = dialog.querySelector("#docs-search-results");
    status = dialog.querySelector(".search-status");

    input.addEventListener("input", function () {
      render(input.value);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        // Read the highlight from the DOM rather than the `active` variable:
        // re-rendering the list resets that variable, which would send Enter to
        // the wrong result after the user moved the selection.
        var highlighted = list.querySelector('li[aria-selected="true"] a');
        if (highlighted) {
          window.location.href = highlighted.getAttribute("href");
        } else if (results.length) {
          window.location.href = resultHref(results[0]);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) close();
    });

    document.addEventListener("keydown", function (event) {
      var mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dialog.hidden ? open() : close();
        return;
      }
      // "/" opens search when focus is not already in a field.
      if (event.key === "/" && dialog.hidden) {
        var tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          event.preventDefault();
          open();
        }
      }
    });
  }

  function open() {
    dialog.hidden = false;
    trigger = document.activeElement;
    input.value = "";
    render("");
    input.focus();
    loadIndex();
  }

  function close() {
    dialog.hidden = true;
    if (trigger && trigger.focus) trigger.focus();
  }

  function move(delta) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    paintActive();
  }

  function paintActive() {
    var items = list.querySelectorAll("li");
    for (var i = 0; i < items.length; i++) {
      var on = i === active;
      items[i].setAttribute("aria-selected", on ? "true" : "false");
      if (on) items[i].scrollIntoView({ block: "nearest" });
    }
  }

  function render(query) {
    active = -1;
    list.innerHTML = "";

    if (!entries) {
      status.textContent = "Loading the index…";
      loadIndex().then(function () {
        render(query);
      });
      return;
    }

    var q = query.trim();
    if (!q) {
      status.textContent =
        entries.length + " sections indexed. Type to search, or press / anywhere.";
      input.setAttribute("aria-expanded", "false");
      return;
    }

    results = search(entries, q);
    input.setAttribute("aria-expanded", results.length ? "true" : "false");

    if (!results.length) {
      status.textContent = 'No match for "' + q + '".';
      return;
    }

    status.textContent = results.length + (results.length === 1 ? " result" : " results");
    active = 0;

    results.forEach(function (entry, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === 0 ? "true" : "false");
      var a = document.createElement("a");
      a.href = resultHref(entry);
      var where = document.createElement("span");
      where.className = "search-where";
      where.textContent = entry.page;
      var head = document.createElement("span");
      head.className = "search-heading";
      head.textContent = entry.heading;
      a.appendChild(where);
      a.appendChild(head);
      if (entry.text) {
        var snippet = document.createElement("span");
        snippet.className = "search-snippet";
        snippet.textContent = entry.text;
        a.appendChild(snippet);
      }
      li.appendChild(a);
      li.addEventListener("mouseenter", function () {
        active = i;
        paintActive();
      });
      list.appendChild(li);
    });
  }

  function init() {
    build();
    var nav = document.querySelector(".site-nav");
    if (!nav) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "nav-search";
    button.setAttribute("aria-label", "Search the docs");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/>' +
      '<path d="M20 20l-3.5-3.5"/></svg>' +
      "<span>Search</span><kbd>" +
      (navigator.platform.indexOf("Mac") === 0 ? "⌘K" : "Ctrl K") +
      "</kbd>";
    button.addEventListener("click", open);

    // Search sits beside the brand rather than in the link row: it is the
    // primary action here, and the link row is already the busiest part of the
    // header.
    var wrap = document.querySelector(".site-header .wrap");
    var brand = wrap && wrap.querySelector(".brand");
    if (wrap && brand && brand.nextSibling) {
      wrap.insertBefore(button, brand.nextSibling);
    } else if (wrap) {
      wrap.appendChild(button);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
