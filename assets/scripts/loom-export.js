(() => {
  "use strict";

  const MARKDOWN_STATE_CLASS = "view-mode";
  const SOURCE_MARKER = "loom-md-source";
  const PREVIEW_MARKER = "loom-md-preview";
  const TITLE_PREVIEW_MARKER = "loom-md-title-preview";
  const NOTES_PREVIEW_MARKER = "loom-md-notes-preview";
  const BLOCK_PREVIEW_MARKER = "loom-md-block-preview";

  // Stash placeholders for inline code spans use control characters (\x00…\x01)
  // so that the italic/bold regexes — which scan for _ and * — can never
  // accidentally match or corrupt them.  The old @@LOOM_CODE_N@@ form contained
  // two underscores (LOOM_CODE_) that the italic pattern _…_ would eat.
  const STASH_OPEN  = "\x00";
  const STASH_CLOSE = "\x01";
  const STASH_RE    = /\x00(\d+)\x01/g;

  const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  function normalizeText(src) {
    return String(src ?? "").replace(/\r\n?/g, "\n");
  }

  function isViewMode() {
    return document.body.classList.contains(MARKDOWN_STATE_CLASS);
  }

  function isBlockquote(line) {
    return /^>\s?/.test(line);
  }

  function isUnorderedList(line) {
    return /^\s*[-*+]\s+/.test(line);
  }

  function isOrderedList(line) {
    return /^\s*\d+\.\s+/.test(line);
  }

  function sanitizeUrl(raw) {
    const candidate = String(raw ?? "").trim();
    if (!candidate) return null;
    try {
      const url = new URL(candidate, window.location.href);
      if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function renderInline(raw) {
    let text = escapeHtml(normalizeText(raw)).replace(/\n/g, "<br>");

    // ── Stash inline code spans ────────────────────────────────────────────
    // Must happen BEFORE bold/italic so the content inside backticks is never
    // processed as markdown.  Placeholder uses non-printing control chars so
    // the italic regex (_…_) cannot match characters inside the key.
    const stash = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      stash.push(`<code>${code}</code>`);
      return `${STASH_OPEN}${stash.length - 1}${STASH_CLOSE}`;
    });

    // ── Links ──────────────────────────────────────────────────────────────
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = sanitizeUrl(href);
      if (!safe) return `${label} (${href})`;
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    // ── Emphasis ───────────────────────────────────────────────────────────
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([\s\S]+?)__/g,      "<strong>$1</strong>");
    text = text.replace(/~~([\s\S]+?)~~/g,       "<del>$1</del>");
    text = text.replace(/\*([\S][\s\S]*?[\S])\*/g, "<em>$1</em>");
    text = text.replace(/_([\S][\s\S]*?[\S])_/g,   "<em>$1</em>");

    // ── Restore stashed code spans ─────────────────────────────────────────
    text = text.replace(STASH_RE, (_, i) => stash[Number(i)] ?? "");

    return text;
  }

  function renderMarkdownInline(raw) {
    return renderInline(raw);
  }

  function renderBlocks(raw) {
    const src = normalizeText(raw).trim();
    if (!src) return "";

    const lines = src.split("\n");
    const out = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];
    let inCodeFence = false;
    let codeFenceLang = "";
    let codeFenceLines = [];
    let inQuote = false;
    let quoteLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
      paragraph = [];
    }

    function flushList() {
      if (!listType || !listItems.length) return;
      const tag = listType === "ol" ? "ol" : "ul";
      out.push(
        `<${tag}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`,
      );
      listType = null;
      listItems = [];
    }

    function flushQuote() {
      if (!inQuote || !quoteLines.length) return;
      out.push(
        `<blockquote>${quoteLines.map(renderInline).join("<br>")}</blockquote>`,
      );
      inQuote = false;
      quoteLines = [];
    }

    function flushCode() {
      if (!inCodeFence) return;
      const code = escapeHtml(codeFenceLines.join("\n"));
      const lang = codeFenceLang
        ? ` class="language-${escapeHtml(codeFenceLang)}"`
        : "";
      out.push(`<pre><code${lang}>${code}</code></pre>`);
      inCodeFence = false;
      codeFenceLang = "";
      codeFenceLines = [];
    }

    for (const line of lines) {
      const trimmed = line.trimEnd();

      if (inCodeFence) {
        if (/^```/.test(trimmed)) {
          flushCode();
        } else {
          codeFenceLines.push(line);
        }
        continue;
      }

      const fenceMatch = trimmed.match(/^```(\w+)?\s*$/);
      if (fenceMatch) {
        flushParagraph();
        flushList();
        flushQuote();
        inCodeFence = true;
        codeFenceLang = fenceMatch[1] || "";
        continue;
      }

      if (!trimmed.trim()) {
        flushParagraph();
        flushList();
        flushQuote();
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        flushQuote();
        const level = headingMatch[1].length;
        out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
        continue;
      }

      if (isBlockquote(trimmed)) {
        flushParagraph();
        flushList();
        inQuote = true;
        quoteLines.push(trimmed.replace(/^>\s?/, ""));
        continue;
      }

      const ulMatch = trimmed.match(/^\s*[-*+]\s+(.*)$/);
      const olMatch = trimmed.match(/^\s*(\d+)\.\s+(.*)$/);

      if (ulMatch || olMatch) {
        flushParagraph();
        flushQuote();
        const type = ulMatch ? "ul" : "ol";
        const item = (ulMatch ? ulMatch[1] : olMatch[2]).trim();
        if (listType && listType !== type) flushList();
        listType = type;
        listItems.push(item);
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    flushQuote();
    flushCode();

    return out.join("");
  }

  function renderMarkdown(raw) {
    return renderBlocks(raw);
  }

  /* ====================================================
     SOURCE <-> PREVIEW BINDING
     ==================================================== */

  const registry = [];

  function register(sourceEl, update) {
    registry.push({ el: sourceEl, update });
  }

  function pruneRegistry() {
    for (let i = registry.length - 1; i >= 0; i--) {
      if (!document.body.contains(registry[i].el)) registry.splice(i, 1);
    }
  }

  function refreshAll() {
    pruneRegistry();
    registry.forEach(({ el, update }) => {
      if (document.body.contains(el)) update();
    });
  }

  function ensurePreviewAfter(sourceEl, markerClass) {
    let preview = sourceEl.nextElementSibling;

    if (!preview || !preview.classList.contains(PREVIEW_MARKER)) {
      preview = document.createElement("div");
      sourceEl.insertAdjacentElement("afterend", preview);
    }

    preview.className =
      `${PREVIEW_MARKER} ${markerClass} ` +
      [...sourceEl.classList].filter((c) => c !== SOURCE_MARKER).join(" ");

    preview.classList.add("loom-md-rendered");

    return preview;
  }

  function syncTitleField(input, markerClass) {
    if (!input || input.classList.contains(PREVIEW_MARKER)) return;
    if (input.dataset.loomMarkdownBound === "1") return;
    input.dataset.loomMarkdownBound = "1";
    input.classList.add(SOURCE_MARKER);

    const preview = ensurePreviewAfter(input, markerClass);

    const update = () => {
      preview.innerHTML = renderMarkdownInline(input.value);
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);
    register(input, update);
    update();
  }

  function syncNotesField(textarea) {
    if (!textarea || textarea.classList.contains(PREVIEW_MARKER)) return;
    if (textarea.dataset.loomMarkdownBound === "1") return;
    textarea.dataset.loomMarkdownBound = "1";
    textarea.classList.add(SOURCE_MARKER);

    const preview = ensurePreviewAfter(textarea, NOTES_PREVIEW_MARKER);

    const update = () => {
      preview.innerHTML = renderMarkdown(textarea.value);
    };

    textarea.addEventListener("input", update);
    textarea.addEventListener("change", update);
    register(textarea, update);
    update();
  }

  // ── Extract the visible text from a contenteditable element ───────────────
  // contenteditable stores new lines as <br> or wrapped <div>/<p> elements.
  // el.textContent collapses all of these into one unbroken string, losing
  // every newline the user typed.  el.innerText reconstructs the visual
  // rendering (honouring <br> and block boundaries) so we get real \n chars.
  // We fall back to a manual extraction if innerText is somehow unavailable.
  function getEditableText(el) {
    if ("innerText" in el) return el.innerText;
    // Manual fallback: clone the node and substitute \n for breaks/blocks.
    const clone = el.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) =>
      br.replaceWith(document.createTextNode("\n")),
    );
    clone.querySelectorAll("div, p").forEach((block) => {
      if (block !== clone) block.prepend(document.createTextNode("\n"));
    });
    return clone.textContent;
  }

  function syncBlockText(el) {
    if (!el || el.classList.contains(PREVIEW_MARKER)) return;
    if (el.dataset.loomMarkdownBound === "1") return;
    el.dataset.loomMarkdownBound = "1";
    el.classList.add(SOURCE_MARKER);

    const preview = ensurePreviewAfter(el, BLOCK_PREVIEW_MARKER);

    // The source element's raw text is the single source of truth —
    // we only ever *read* it, never write to it here.
    const update = () => {
      preview.innerHTML = renderMarkdown(getEditableText(el));
    };

    el.addEventListener("input", update);
    el.addEventListener("blur", update);
    register(el, update);
    update();
  }

  function applyModeVisibility() {
    const visible = isViewMode();

    document.querySelectorAll(`.${PREVIEW_MARKER}`).forEach((preview) => {
      const source = preview.previousElementSibling;

      if (!source || !source.classList.contains(SOURCE_MARKER)) return;

      if (visible) {
        source.style.position    = "absolute";
        source.style.opacity     = "0";
        source.style.pointerEvents = "none";
        source.style.width       = "0";
        source.style.height      = "0";
        source.style.overflow    = "hidden";

        preview.style.display = "";
      } else {
        source.style.position    = "";
        source.style.opacity     = "";
        source.style.pointerEvents = "";
        source.style.width       = "";
        source.style.height      = "";
        source.style.overflow    = "";

        preview.style.display = "none";
      }
    });
  }

  function syncAll() {
    document.querySelectorAll("input.card-title").forEach((input) => {
      syncTitleField(input, TITLE_PREVIEW_MARKER);
    });

    const inspTitle = document.getElementById("insp-title");
    if (inspTitle) syncTitleField(inspTitle, TITLE_PREVIEW_MARKER);

    const notes = document.getElementById("insp-notes");
    if (notes) syncNotesField(notes);

    document.querySelectorAll("[contenteditable].block-text").forEach((el) => {
      syncBlockText(el);
    });

    pruneRegistry();
    applyModeVisibility();
  }

  let scheduled = false;
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncAll();
    });
  }

  function observe() {
    const mo = new MutationObserver(scheduleSync);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    scheduleSync();
  }

  window.LoomMarkdown = {
    escapeHtml,
    render: renderMarkdown,
    renderInline: renderMarkdownInline,
    syncAll,
    scheduleSync,
    refreshAll,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe, { once: true });
  } else {
    observe();
  }
})();