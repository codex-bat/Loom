// ============================================================
//   LOOM ELEMENT: CODEBLOCK
//   (now with frame styling toggle – colour & line)
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

  // --- Frame line tag (if not "none") ---
  var frameLine = normalizeFrameLine(card.frameLine);
  if (frameLine !== "none") {
    el.dataset.frameLine = frameLine;
    var tag = document.createElement("div");
    tag.className = "card-tag";
    tag.style.background = color;
    el.appendChild(tag);
  }

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

  // Language + line count badge
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

  // --- Buttons ---
  var pinBtn = makePinButton(card);
  var previewToggle = makePreviewToggle(card);
  var expandBtn = makeExpandButton(card);

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

  // Drag / interaction
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

  modal.addEventListener("click", function (e) {
    if (e.target === modal) document.body.removeChild(modal);
  });

  function onKey(e) {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      window.removeEventListener("keydown", onKey);
    }
  }
  window.addEventListener("keydown", onKey);
}

// Custom inspector – with frame styling toggle
function renderCodeblockInspector(card) {
  var container = document.createElement("div");

  // --- Frame styling block (hidden) ---
  var stylingWrap = document.createElement("div");
  stylingWrap.style.display = "none";

  // Tag color
  var colorField = document.createElement("div");
  colorField.className = "field";
  var colorLabel = document.createElement("label");
  colorLabel.textContent = "Tag color";
  var swatchRow = document.createElement("div");
  swatchRow.className = "swatch-row";
  SWATCHES.forEach(function (swColor) {
    var sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = swColor;
    sw.dataset.color = swColor;
    if (swColor === card.color) sw.classList.add("active");
    sw.addEventListener("click", function () {
      if (mode === "view" || selectedIds.size > 1) return;
      card.color = swColor;
      swatchRow.querySelectorAll(".swatch").forEach(function (s) {
        s.classList.toggle("active", s.dataset.color === swColor);
      });
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    });
    swatchRow.appendChild(sw);
  });
  colorField.appendChild(colorLabel);
  colorField.appendChild(swatchRow);
  stylingWrap.appendChild(colorField);

  // Frame line
  var lineField = document.createElement("div");
  lineField.className = "field";
  var lineLabel = document.createElement("label");
  lineLabel.textContent = "Frame line";
  var selector = document.createElement("div");
  selector.className = "frame-line-selector";
  var options = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "up", label: "Up" },
    { value: "down", label: "Down" },
    { value: "none", label: "None" },
  ];
  options.forEach(function (opt) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-line-btn";
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    if (normalizeFrameLine(card.frameLine) === opt.value)
      btn.classList.add("active");
    btn.addEventListener("click", function () {
      if (mode === "view" || selectedIds.size > 1) return;
      var newValue = opt.value;
      card.frameLine = newValue;
      selector.querySelectorAll(".frame-line-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.value === newValue);
      });
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    });
    selector.appendChild(btn);
  });
  lineField.appendChild(lineLabel);
  lineField.appendChild(selector);
  stylingWrap.appendChild(lineField);

  // --- Title field with inline toggle button ---
  var titleField = document.createElement("div");
  titleField.className = "field";

  var titleLabel = document.createElement("label");
  titleLabel.textContent = "Title";
  titleField.appendChild(titleLabel);

  var titleRow = document.createElement("div");
  titleRow.className = "videoclip-file-row"; // reusing existing flex row class

  var titleInp = document.createElement("input");
  titleInp.type = "text";
  titleInp.value = card.title || "";
  titleInp.placeholder = "Codeblock title";
  titleInp.style.flex = "1";
  titleInp.style.minWidth = "0";
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
  titleRow.appendChild(titleInp);

  // Small square toggle button
  var stylingToggleBtn = document.createElement("button");
  stylingToggleBtn.type = "button";
  stylingToggleBtn.className = "videoclip-file-clear";
  stylingToggleBtn.innerHTML = "▸";
  stylingToggleBtn.dataset.tooltip = "Frame styling";
  stylingToggleBtn.addEventListener("click", function () {
    var isOpen = stylingWrap.style.display !== "none";
    stylingWrap.style.display = isOpen ? "none" : "";
    stylingToggleBtn.innerHTML = isOpen ? "▸" : "▾";
  });
  titleRow.appendChild(stylingToggleBtn);
  titleField.appendChild(titleRow);

  container.appendChild(titleField);
  container.appendChild(stylingWrap);

  // --- Position grid ---
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

// Helper to refresh the card element (needed after colour/line change)
function refreshCardEl(card) {
  var el = $world.querySelector(`[data-card-id="${card.id}"]`);
  if (!el) return;
  if (el.parentNode) {
    var num = parseInt(el.querySelector(".card-num").textContent, 10);
    var newEl = buildCodeblockEl(card, num);
    el.parentNode.replaceChild(newEl, el);
  }
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
      frameLine: "none", // default – line hidden
    };
  },
  render: function (card, num) {
    return buildCodeblockEl(card, num);
  },
  renderInspector: renderCodeblockInspector,
};
