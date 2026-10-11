/* Theme control.
   The stored choice is applied by an inline script in each page's head, before
   first paint, so there is no flash of the wrong theme. This file only wires the
   button and keeps the icon in step. */

(function () {
  "use strict";

  var KEY = "badami-theme";

  function current() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  var ICONS = {
    light:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2' +
      'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  var LABELS = {
    en: { light: "Switch to dark theme", dark: "Switch to light theme" },
    id: { light: "Ganti ke tema gelap", dark: "Ganti ke tema terang" },
  };

  function lang() {
    var l = document.documentElement.lang || "en";
    return l.indexOf("id") === 0 ? "id" : "en";
  }

  function paint(button) {
    var mode = current();
    button.innerHTML = mode === "dark" ? ICONS.dark : ICONS.light;
    button.setAttribute("aria-label", LABELS[lang()][mode]);
    button.setAttribute("title", LABELS[lang()][mode]);
  }

  function init() {
    var nav = document.querySelector(".site-nav");
    if (!nav) return;

    // The cluster is created by search.js, which may not have run yet, so this
    // creates it too if needed and the two agree on the class name.
    var tools = nav.querySelector(".nav-tools");
    if (!tools) {
      tools = document.createElement("span");
      tools.className = "nav-tools";
      nav.insertBefore(tools, nav.firstChild);
    }

    var button = document.createElement("button");
    button.type = "button";
    button.className = "nav-icon";
    paint(button);
    button.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* Private mode: the choice applies for this page only. */
      }
      paint(button);
    });

    tools.insertBefore(button, tools.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
