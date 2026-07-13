// ============================================================
//   LOOM ELEMENT: FRAME
// ============================================================

/* Preview state */
var previewAll = false;
var frameListDrag = null;
var previewCardIds = new Set();

function toggleAllPreviews() {
  var visibleCards = $world.querySelectorAll(".card");
  var anyPreview = false;
  visibleCards.forEach((el) => {
    if (el.classList.contains("card-preview")) anyPreview = true;
  });
  if (anyPreview) {
    visibleCards.forEach((el) => {
      el.classList.remove("card-preview");
      previewCardIds.delete(el.dataset.cardId);
    });
    previewAll = false;
    toast("Preview mode OFF for all visible frames");
  } else {
    visibleCards.forEach((el) => {
      el.classList.add("card-preview");
      previewCardIds.add(el.dataset.cardId);
    });
    previewAll = true;
    toast("Preview mode ON for all visible frames");
  }
}

function getCard(id) {
  return state.cards.find((c) => c.id === id);
}
function selectedIdFromSet() {
  return getSelectedIdsArray()[0] || null;
}

function selectCards(ids) {
  selectedIds = new Set((ids || []).filter(Boolean));
  selectedId = selectedIdFromSet();
  syncSelectedCardClasses();
  renderFrameList();
  renderInspector();
}
function selectCard(id) {
  if (!id) {
    clearSelection();
    return;
  }
  selectCards([id]);
}
function clearSelection() {
  selectedIds = new Set();
  selectedId = null;
  syncSelectedCardClasses();
  renderFrameList();
  renderInspector();
}

function addCard() {
  if (mode === "view") return;
  var center = screenToWorld(
    $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
    $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
  );
  var cascade = (state.cards.length % 6) * 22;
  var card = {
    id: uid(),
    type: "frame",
    x: Math.round(center.x - 140 + cascade),
    y: Math.round(center.y - 100 + cascade),
    w: 280,
    h: 210,
    title: "",
    color: SWATCHES[state.cards.length % SWATCHES.length],
    notes: "",
    frameLine: "left",
    blocks: [],
  };
  state.cards.push(card);
  state.nextNum++;
  renderAll();
  selectCard(card.id);
  pushHistory();
  save();
  var titleEl = $world.querySelector(`[data-card-id="${card.id}"] .card-title`);
  if (titleEl) setTimeout(() => titleEl.focus(), 30);
}

function deleteCard(id) {
  if (mode === "view") return;
  flushHistoryDebounce();
  state.cards = state.cards.filter((c) => c.id !== id);
  state.connections = state.connections.filter(
    (c) => c.fromId !== id && c.toId !== id,
  );
  if (selectedId === id) clearSelection();
  renderAll();
  pushHistory();
  save();
  previewCardIds.delete(id);
}
function deleteSelectedCards() {
  if (mode === "view") return;
  if (selectedIds.size === 0) return;
  flushHistoryDebounce();
  state.cards = state.cards.filter((c) => !selectedIds.has(c.id));
  state.connections = state.connections.filter(
    (c) => !selectedIds.has(c.fromId) && !selectedIds.has(c.toId),
  );
  clearSelection();
  renderAll();
  pushHistory();
  save();
  selectedIds.forEach((id) => previewCardIds.delete(id));
}

function cardRectInCanvasSpace(el) {
  var r = el.getBoundingClientRect();
  var c = $canvas.getBoundingClientRect();
  return {
    left: r.left - c.left,
    top: r.top - c.top,
    right: r.right - c.left,
    bottom: r.bottom - c.top,
  };
}
/* ---- Build the frame DOM element ---- */
function buildCardEl(card, num) {
  var el = document.createElement("div");
  el.className = "card" + (selectedIds.has(card.id) ? " selected" : "");
  el.dataset.cardId = card.id;
  el.style.left = card.x + "px";
  el.style.top = card.y + "px";
  el.style.width = card.w + "px";
  el.style.height = card.h + "px";
  el.style.setProperty("--card-color", card.color);
  el.style.setProperty("--card-color-dim", hexToRgba(card.color, 0.4));
  el.style.setProperty("--card-color-mid", hexToRgba(card.color, 0.7));
  el.style.setProperty("--card-color-glow", hexToRgba(card.color, 0.22));
  el.dataset.frameLine = normalizeFrameLine(card.frameLine);

  var tag = document.createElement("div");
  tag.className = "card-tag";
  tag.style.background = card.color;
  el.appendChild(tag);

  var header = document.createElement("div");
  header.className = "card-header";
  var numEl = document.createElement("span");
  numEl.className = "card-num";
  numEl.textContent = String(num).padStart(2, "0");
  numEl.dataset.tooltip = "Drag to move · Ctrl + Drag to snap-align edges";
  var titleInput = document.createElement("input");
  titleInput.className = "card-title";
  titleInput.type = "text";
  titleInput.placeholder = "Untitled frame";
  titleInput.value = card.title;
  titleInput.maxLength = 60;
  titleInput.readOnly = mode === "view";
  titleInput.addEventListener("pointerdown", (e) => e.stopPropagation());
  titleInput.addEventListener("input", () => {
    if (mode === "view") return;
    card.title = titleInput.value;
    if (card.id === selectedId) {
      $inspTitle.value = card.title;
      syncMarkdownPreviews();
    }
    renderFrameListSoft();
    pushHistoryDebounced();
    save();
  });

  var pinBtn = makePinButton(card);
  var previewToggle = makePreviewToggle(card);
  header.appendChild(numEl);
  header.appendChild(titleInput);
  header.appendChild(pinBtn);
  header.appendChild(previewToggle);
  el.appendChild(header);

  var body = document.createElement("div");
  body.className = "card-body";
  if (card.blocks.length === 0) {
    var hint = document.createElement("div");
    hint.className = "card-empty-hint";
    hint.textContent =
      mode === "view"
        ? "This frame is empty."
        : "Empty frame — add text, an image, or a link below.";
    body.appendChild(hint);
  } else {
    card.blocks.forEach((block) => body.appendChild(buildBlockEl(card, block)));
  }
  el.appendChild(body);

  var toolbar = document.createElement("div");
  toolbar.className = "card-toolbar";
  toolbar.appendChild(
    makeToolbarButton("Aa", "Text", () => {
      if (mode !== "view") addBlock(card, "text");
    }),
  );
  toolbar.appendChild(
    makeToolbarButton("▢", "Image", () => {
      if (mode === "view") return;
      pendingImageCardId = card.id;
      $imageInput.click();
    }),
  );
  toolbar.appendChild(
    makeToolbarButton("🔗", "Link", () => {
      if (mode !== "view") addBlock(card, "link-edit");
    }),
  );
  toolbar.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.appendChild(toolbar);

  var handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.dataset.tooltip = "Drag to resize";
  el.appendChild(handle);

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
  header.addEventListener("click", () => selectCard(card.id));
  handle.addEventListener("pointerdown", (e) => startResizeCard(e, card, el));

  if (previewCardIds.has(card.id)) el.classList.add("card-preview");
  return el;
}

function makePinButton(card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card-pin-btn";
  btn.dataset.tooltip = "Drag to link this frame to another";
  var c = card.color;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><ellipse cx="7.4" cy="9.4" rx="3.3" ry="1.1" fill="rgba(0,0,0,0.32)"/><circle cx="6.4" cy="6.2" r="5" fill="${hexToRgba(c, 0.35)}"/><circle cx="6.4" cy="6.2" r="4.1" fill="${c}"/><circle cx="4.9" cy="4.7" r="1.25" fill="rgba(255,255,255,0.65)"/></svg>`;
  btn.addEventListener("click", (e) => e.stopPropagation());
  btn.addEventListener("pointerdown", (e) => {
    if (mode === "view") return;
    if (e.ctrlKey || e.button === 1) {
      startPanning(e, btn);
      return;
    }
    startConnectionDrag(e, card);
  });
  return btn;
}

function makePreviewToggle(card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card-preview-toggle";
  btn.dataset.tooltip = "Toggle frame preview";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" fill="currentColor"/><path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    var cardEl = e.target.closest(".card");
    if (!cardEl) return;
    var id = cardEl.dataset.cardId,
      hasPreview = cardEl.classList.toggle("card-preview");
    if (hasPreview) previewCardIds.add(id);
    else previewCardIds.delete(id);
  });
  return btn;
}

function makeToolbarButton(iconText, label, onClick) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML = `<span aria-hidden="true">${iconText}</span><span>${label}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

function buildBlockEl(card, block) {
  var wrap = document.createElement("div");
  wrap.className = "block block-" + block.type.split("-")[0];
  wrap.dataset.blockId = block.id;
  if (block.type === "text") {
    var textEl = document.createElement("div");
    textEl.className = "block-text";
    textEl.contentEditable = mode === "view" ? "false" : "true";
    textEl.dataset.placeholder = "Type something…";
    textEl.textContent = block.data.text || "";
    textEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    textEl.addEventListener("input", () => {
      if (mode === "view") return;
      block.data.text =
        "innerText" in textEl ? textEl.innerText : textEl.textContent;
      pushHistoryDebounced();
      save();
    });
    wrap.appendChild(textEl);
    wrap.appendChild(makeBlockControls(card, block));
  } else if (block.type === "image") {
    var img = document.createElement("img");
    img.src = block.data.src;
    img.alt = "storyboard image";
    wrap.appendChild(img);
    wrap.appendChild(makeBlockControls(card, block));
  } else if (block.type === "link-edit") {
    if (mode === "view") return wrap;
    var form = document.createElement("div");
    form.className = "block-link-input";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Paste a URL and press Enter…";
    var confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Add";
    confirmBtn.type = "button";
    var commit = () => {
      var val = input.value.trim();
      if (!val) {
        removeBlock(card, block);
        return;
      }
      if (!/^https?:\/\//i.test(val)) val = "https://" + val;
      block.type = "link";
      block.data = { url: val, label: hostnameOf(val) };
      renderWorld();
      pushHistory();
      save();
    };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") removeBlock(card, block);
    });
    confirmBtn.addEventListener("click", commit);
    form.appendChild(input);
    form.appendChild(confirmBtn);
    wrap.appendChild(form);
    wrap.appendChild(makeDeleteBtn(card, block, { standalone: true }));
  } else if (block.type === "link") {
    var a = document.createElement("a");
    a.className = "block-link";
    a.href = block.data.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("pointerdown", (e) => e.stopPropagation());
    a.innerHTML = `<span class="link-icon">↗</span><span class="link-text"><span class="link-title">${escapeHtml(block.data.label)}</span><span class="link-url">${escapeHtml(block.data.url)}</span></span>`;
    wrap.appendChild(a);
    wrap.appendChild(makeBlockControls(card, block));
  }
  return wrap;
}

function makeDeleteBtn(card, block, opts = {}) {
  var del = document.createElement("div");
  del.className = "block-del" + (opts.standalone ? " standalone" : "");
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", "Delete block");
  del.dataset.tooltip = "Delete";
  del.textContent = "×";
  del.addEventListener("pointerdown", (e) => e.stopPropagation());
  del.addEventListener("click", () => removeBlock(card, block));
  return del;
}
function makeDragHandle(card, block) {
  var handle = document.createElement("div");
  handle.className = "block-drag-handle";
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Reorder block");
  handle.dataset.tooltip = "Drag to reorder";
  handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1.4" width="10" height="1.6" rx="0.8"/><rect x="1" y="5.2" width="10" height="1.6" rx="0.8"/><rect x="1" y="9" width="10" height="1.6" rx="0.8"/></svg>`;
  handle.addEventListener("pointerdown", (e) =>
    startBlockDrag(e, card, block, handle),
  );
  return handle;
}
function makeBlockControls(card, block) {
  var controls = document.createElement("div");
  controls.className = "block-controls";
  controls.appendChild(makeDragHandle(card, block));
  controls.appendChild(makeDeleteBtn(card, block));
  return controls;
}

function addBlock(card, type) {
  if (mode === "view") return;
  var block = { id: uid(), type, data: {} };
  card.blocks.push(block);
  renderWorld();
  selectCard(card.id);
  pushHistory();
  save();
  if (type === "link-edit") {
    var inputEl = $world.querySelector(`[data-block-id="${block.id}"] input`);
    if (inputEl) setTimeout(() => inputEl.focus(), 30);
  }
}
function removeBlock(card, block) {
  if (mode === "view") return;
  flushHistoryDebounce();
  card.blocks = card.blocks.filter((b) => b.id !== block.id);
  renderWorld();
  selectCard(card.id);
  pushHistory();
  save();
}

$imageInput.addEventListener("change", () => {
  var file = $imageInput.files[0],
    cardId = pendingImageCardId;
  $imageInput.value = "";
  if (!file || !cardId || mode === "view") return;
  var card = getCard(cardId);
  if (!card) return;
  var reader = new FileReader();
  reader.onload = () => {
    card.blocks.push({
      id: uid(),
      type: "image",
      data: { src: reader.result },
    });
    renderWorld();
    selectCard(card.id);
    pushHistory();
    save();
  };
  reader.onerror = () => toast("Could not read that image");
  reader.readAsDataURL(file);
});

// ============================================================
//   ELEMENT REGISTRATION
// ============================================================
window.LoomElements = window.LoomElements || {};
window.LoomElements["frame"] = {
  id: "frame",
  name: "Frame",
  description: "A standard storyboard frame with a title, notes, and blocks.",
  icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><line x1="1.5" y1="5" x2="14.5" y2="5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  factory: function () {
    var center = screenToWorld(
      $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
      $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
    );
    var cascade = (state.cards.length % 6) * 22;
    return {
      id: uid(),
      type: "frame",
      x: Math.round(center.x - 140 + cascade),
      y: Math.round(center.y - 100 + cascade),
      w: 280,
      h: 210,
      title: "",
      color: SWATCHES[state.cards.length % SWATCHES.length],
      notes: "",
      frameLine: "left",
      blocks: [],
    };
  },
  render: function (card, num) {
    return buildCardEl(card, num);
  },
  // Optional custom inspector – if present, it will be used instead of the default fields
  renderInspector: null, // (could be a function returning a DOM element)
};
