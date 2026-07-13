// ============================================================
//   LOOM ELEMENT: CODEBLOCK
// ============================================================

function buildCodeblockEl(card, num) {
  var el = document.createElement("div");
  el.className =
    "card codeblock-card" + (selectedIds.has(card.id) ? " selected" : "");
  el.dataset.cardId = card.id;
  el.style.left = card.x + "px";
  el.style.top = card.y + "px";
  el.style.width = card.w + "px";
  el.style.height = card.h + "px";

  var color = card.color || "#6fe3c8";
  el.style.setProperty("--card-color", color);
  el.style.setProperty("--card-color-dim", hexToRgba(color, 0.4));
  el.style.setProperty("--card-color-mid", hexToRgba(color, 0.7));
  el.style.setProperty("--card-color-glow", hexToRgba(color, 0.22));

  // --- Header left group (num, title, meta) ---
  var headerLeft = document.createElement("div");
  headerLeft.className = "codeblock-header-left";

  var numEl = document.createElement("span");
  numEl.className = "card-num";
  numEl.textContent = String(num).padStart(2, "0");
  numEl.dataset.tooltip = "Drag to move · Ctrl + Drag to snap-align edges";

  var titleInput = document.createElement("input");
  titleInput.className = "card-title";
  titleInput.type = "text";
  titleInput.placeholder = "Untitled codeblock";
  titleInput.value = card.title || "";
  titleInput.maxLength = 60;
  titleInput.readOnly = mode === "view";
  titleInput.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  titleInput.addEventListener("input", function () {
    if (mode === "view") return;
    card.title = titleInput.value;
    if (card.id === selectedId) $inspTitle.value = card.title;
    renderFrameListSoft();
    pushHistoryDebounced();
    save();
  });

  // Language + line count badge – now inside the left group
  var meta = document.createElement("span");
  meta.className = "codeblock-meta";
  var lang =
    window.LoomSyntax && card.code
      ? LoomSyntax.detectLanguage(card.code)
      : "js";
  var langName =
    window.LoomSyntax && window.LoomSyntax.LANGUAGES
      ? window.LoomSyntax.LANGUAGES[lang]?.name || lang
      : lang;
  var lines = (card.code || "").split(/\r?\n/).length;
  meta.textContent =
    langName + " · " + lines + " line" + (lines !== 1 ? "s" : "");
  meta.style.pointerEvents = "none";

  headerLeft.appendChild(numEl);
  headerLeft.appendChild(titleInput);
  headerLeft.appendChild(meta);

  // --- Buttons (right side) ---
  var pinBtn = makePinButton(card);
  var previewToggle = makePreviewToggle(card);
  var expandBtn = makeExpandButton(card);

  // --- Assemble header ---
  var header = document.createElement("div");
  header.className = "card-header";
  header.appendChild(headerLeft);
  header.appendChild(pinBtn);
  header.appendChild(previewToggle);
  header.appendChild(expandBtn);
  el.appendChild(header);

  // Body – code preview
  var body = document.createElement("div");
  body.className = "card-body";

  var codePreview = document.createElement("pre");
  codePreview.className = "codeblock-preview";
  if (window.LoomSyntax && card.code) {
    codePreview.innerHTML = LoomSyntax.highlight(card.code);
  } else {
    codePreview.textContent = card.code || "";
  }
  body.appendChild(codePreview);
  el.appendChild(body);

  // Resize handle
  var handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.dataset.tooltip = "Drag to resize";
  el.appendChild(handle);

  // Drag / interaction (same as frames)
  el.addEventListener("pointerdown", function (e) {
    if (e.button === 1) {
      startPanning(e, el);
      return;
    }
    if (e.target.closest(".resize-handle")) return;
    if (isCardDragBlockedTarget(e.target)) return;
    if (selectedIds.size > 1 && selectedIds.has(card.id))
      startGroupDrag(e, card, el);
    else startDragCard(e, card, el);
  });

  header.addEventListener("click", function () {
    selectCard(card.id);
  });
  handle.addEventListener("pointerdown", function (e) {
    startResizeCard(e, card, el);
  });

  if (previewCardIds.has(card.id)) {
    el.classList.add("card-preview");
  }

  return el;
}

function makeExpandButton(card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "codeblock-expand-btn";
  btn.dataset.tooltip = "Open code viewer";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (mode === "view") return; // still allow viewing
    openCodeModal(card);
  });
  btn.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  return btn;
}

function openCodeModal(card) {
  var modal = document.createElement("div");
  modal.className = "codeblock-modal";

  var content = document.createElement("div");
  content.className = "codeblock-modal-content";

  // Header
  var modalHeader = document.createElement("div");
  modalHeader.className = "codeblock-modal-header";

  var title = document.createElement("span");
  title.className = "codeblock-modal-title";
  title.textContent = (card.title || "Codeblock") + "  ";
  modalHeader.appendChild(title);

  var modalMeta = document.createElement("span");
  modalMeta.className = "codeblock-modal-meta";
  var lang2 =
    window.LoomSyntax && card.code
      ? LoomSyntax.detectLanguage(card.code)
      : "js";
  var langName2 =
    window.LoomSyntax && window.LoomSyntax.LANGUAGES
      ? window.LoomSyntax.LANGUAGES[lang2]?.name || lang2
      : lang2;
  var lines2 = (card.code || "").split(/\r?\n/).length;
  modalMeta.textContent =
    langName2 + " · " + lines2 + " line" + (lines2 !== 1 ? "s" : "");
  modalHeader.appendChild(modalMeta);

  var closeBtn = document.createElement("button");
  closeBtn.className = "codeblock-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", function () {
    document.body.removeChild(modal);
  });
  modalHeader.appendChild(closeBtn);
  content.appendChild(modalHeader);

  // Modal body
  var modalBody = document.createElement("div");
  modalBody.className = "codeblock-modal-body";
  var pre = document.createElement("pre");
  pre.className = "codeblock-modal-pre";
  if (window.LoomSyntax && card.code) {
    pre.innerHTML = LoomSyntax.highlight(card.code);
  } else {
    pre.textContent = card.code || "";
  }
  modalBody.appendChild(pre);
  content.appendChild(modalBody);

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener("click", function (e) {
    if (e.target === modal) document.body.removeChild(modal);
  });

  // Close on Escape
  function onKey(e) {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      window.removeEventListener("keydown", onKey);
    }
  }
  window.addEventListener("keydown", onKey);
}

// Custom inspector – replaces the default one
function renderCodeblockInspector(card) {
  var container = document.createElement("div");

  // Title
  var titleField = document.createElement("div");
  titleField.className = "field";
  var titleLabel = document.createElement("label");
  titleLabel.textContent = "Title";
  var titleInp = document.createElement("input");
  titleInp.type = "text";
  titleInp.value = card.title || "";
  titleInp.addEventListener("input", function () {
    card.title = titleInp.value;
    var titleEl = $world.querySelector(
      `[data-card-id="${card.id}"] .card-title`,
    );
    if (titleEl) titleEl.value = card.title;
    renderFrameListSoft();
    pushHistoryDebounced();
    save();
  });
  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInp);
  container.appendChild(titleField);

  // Position grid
  var grid = document.createElement("div");
  grid.className = "field-grid";

  function makeCoordField(label, key, minVal) {
    var f = document.createElement("div");
    f.className = "field";
    var lbl = document.createElement("label");
    lbl.textContent = label;
    var inp = document.createElement("input");
    inp.type = "number";
    inp.value = card[key];
    inp.addEventListener("input", function () {
      var val = parseInt(inp.value, 10);
      if (Number.isNaN(val)) return;
      if (key === "w") val = Math.max(180, val);
      if (key === "h") val = Math.max(130, val);
      card[key] = val;
      var el = $world.querySelector(`[data-card-id="${card.id}"]`);
      if (el) {
        el.style.left = card.x + "px";
        el.style.top = card.y + "px";
        el.style.width = card.w + "px";
        el.style.height = card.h + "px";
      }
      renderConnections();
      pushHistoryDebounced();
      save();
    });
    f.appendChild(lbl);
    f.appendChild(inp);
    return f;
  }

  grid.appendChild(makeCoordField("X", "x"));
  grid.appendChild(makeCoordField("Y", "y"));
  grid.appendChild(makeCoordField("W", "w", true));
  grid.appendChild(makeCoordField("H", "h", true));
  container.appendChild(grid);

  // Notes
  var notesField = document.createElement("div");
  notesField.className = "field";
  var notesLabel = document.createElement("label");
  notesLabel.textContent = "Creator’s note";
  var notesTextarea = document.createElement("textarea");
  notesTextarea.value = card.notes || "";
  notesTextarea.rows = 3;
  notesTextarea.addEventListener("input", function () {
    card.notes = notesTextarea.value;
    pushHistoryDebounced();
    save();
  });
  notesField.appendChild(notesLabel);
  notesField.appendChild(notesTextarea);
  container.appendChild(notesField);

  // Code
  var codeField = document.createElement("div");
  codeField.className = "field";
  var codeLabel = document.createElement("label");
  codeLabel.textContent = "Code";
  var codeTextarea = document.createElement("textarea");
  codeTextarea.className = "codeblock-inspector-code";
  codeTextarea.value = card.code || "";
  codeTextarea.rows = 8;
  codeTextarea.style.fontFamily = "var(--font-mono)";
  codeTextarea.style.fontSize = "12px";
  codeTextarea.addEventListener("input", function () {
    card.code = codeTextarea.value;
    var preEl = $world.querySelector(
      `[data-card-id="${card.id}"] .codeblock-preview`,
    );
    if (preEl) preEl.textContent = card.code;
    pushHistoryDebounced();
    save();
  });
  codeField.appendChild(codeLabel);
  codeField.appendChild(codeTextarea);
  container.appendChild(codeField);

  return container;
}

// Registration
window.LoomElements = window.LoomElements || {};
window.LoomElements["codeblock"] = {
  id: "codeblock",
  name: "Codeblock",
  description: "A code snippet with a full‑screen viewer.",
  icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 2L1 6l4 4M11 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  factory: function () {
    var center = screenToWorld(
      $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
      $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
    );
    var cascade = (state.cards.length % 6) * 22;
    return {
      id: uid(),
      type: "codeblock",
      x: Math.round(center.x - 140 + cascade),
      y: Math.round(center.y - 100 + cascade),
      w: 300,
      h: 220,
      title: "",
      color: SWATCHES[state.cards.length % SWATCHES.length],
      notes: "",
      code: "",
    };
  },
  render: function (card, num) {
    return buildCodeblockEl(card, num);
  },
  renderInspector: renderCodeblockInspector,
};
