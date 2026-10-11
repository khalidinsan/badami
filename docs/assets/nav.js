/* Header menu.
   Below 760px the header cannot hold six controls in one row without the gaps
   turning uneven, so the links and the preference controls collapse behind a
   button. Above that width the button is hidden and the nav lays out as usual. */

(function () {
  "use strict";

  var LABELS = {
    en: { open: "Open menu", close: "Close menu" },
    id: { open: "Buka menu", close: "Tutup menu" },
  };

  var ICONS = {
    open:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  function lang() {
    var l = document.documentElement.lang || "en";
    return l.indexOf("id") === 0 ? "id" : "en";
  }

  function init() {
    var wrap = document.querySelector(".site-header .wrap");
    var nav = document.querySelector(".site-nav");
    if (!wrap || !nav) return;

    if (!nav.id) nav.id = "site-nav-menu";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "nav-menu-btn";
    button.setAttribute("aria-controls", nav.id);
    button.setAttribute("aria-expanded", "false");

    // Both icons ship in the markup and CSS picks one. Swapping innerHTML on
    // toggle would detach the clicked node, and the click-outside check below
    // would then read the detached node as being outside the header and close
    // the panel on the same click that opened it.
    button.innerHTML =
      '<span class="nav-menu-icon" data-icon="open">' +
      ICONS.open +
      '</span><span class="nav-menu-icon" data-icon="close">' +
      ICONS.close +
      "</span>";

    function paint(open) {
      var L = LABELS[lang()];
      button.setAttribute("aria-label", open ? L.close : L.open);
      button.setAttribute("title", open ? L.close : L.open);
    }

    function set(open) {
      nav.setAttribute("data-open", open ? "true" : "false");
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("data-open", open ? "true" : "false");
      paint(open);
    }

    paint(false);
    nav.setAttribute("data-open", "false");

    button.addEventListener("click", function () {
      set(nav.getAttribute("data-open") !== "true");
    });

    // Escape closes the panel, matching the search overlay.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.getAttribute("data-open") === "true") {
        set(false);
        button.focus();
      }
    });

    // A click outside the header closes it, so the panel never sits open over
    // the page while the reader works.
    document.addEventListener("click", function (event) {
      if (nav.getAttribute("data-open") !== "true") return;
      if (wrap.contains(event.target)) return;
      set(false);
    });

    // Returning to the desktop layout must not leave a hidden panel behind.
    var wide = window.matchMedia("(min-width: 761px)");
    function sync(event) {
      if (event.matches) set(false);
    }
    if (wide.addEventListener) wide.addEventListener("change", sync);
    else if (wide.addListener) wide.addListener(sync);

    // The menu button sits beside the search button when there is one, so the
    // first row reads brand, search, menu.
    var search = wrap.querySelector(".nav-search");
    var anchor = search || wrap.querySelector(".brand");
    if (anchor && anchor.nextSibling) {
      wrap.insertBefore(button, anchor.nextSibling);
    } else if (anchor) {
      anchor.parentNode.appendChild(button);
    } else {
      wrap.appendChild(button);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
