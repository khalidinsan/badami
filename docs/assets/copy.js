/* Copy control.
   Every code block gets a copy button so a command can be lifted without
   selecting text by hand. The label follows the page language, the way the
   theme control does, because the button is created here and never passes
   through the translation step. */

(function () {
  "use strict";

  var LABELS = {
    en: { copy: "Copy", done: "Copied", failed: "Select all", label: "Copy this code block" },
    id: { copy: "Salin", done: "Tersalin", failed: "Pilih semua", label: "Salin blok kode ini" },
  };

  function lang() {
    var l = document.documentElement.lang || "en";
    return l.indexOf("id") === 0 ? "id" : "en";
  }

  /* execCommand is deprecated but remains the only route in non-secure
     contexts, which is where a local file:// preview lands. */
  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function write(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function decorate(pre) {
    if (pre.parentNode && pre.parentNode.className === "code-wrap") return;
    var code = pre.querySelector("code");
    if (!code) return;

    var labels = LABELS[lang()];
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = labels.copy;
    button.setAttribute("aria-label", labels.label);

    // A terminal block already has a title bar, so the control belongs at the
    // end of it rather than floating over the first command.
    var bar = pre.parentNode && pre.parentNode.querySelector(":scope > .terminal-bar");
    if (bar) {
      bar.appendChild(button);
    } else {
      var wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      wrap.appendChild(button);
    }

    var timer = null;
    button.addEventListener("click", function () {
      write(code.textContent).then(function (ok) {
        var L = LABELS[lang()];
        button.textContent = ok ? L.done : L.failed;
        button.setAttribute("aria-label", ok ? L.done : L.failed);
        button.setAttribute("data-state", ok ? "done" : "failed");
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.textContent = L.copy;
          button.setAttribute("aria-label", L.label);
          button.removeAttribute("data-state");
        }, 1800);
      });
    });
  }

  function init() {
    var blocks = document.querySelectorAll("pre");
    for (var i = 0; i < blocks.length; i++) decorate(blocks[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
