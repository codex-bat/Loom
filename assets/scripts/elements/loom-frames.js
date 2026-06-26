// ============================================================
//   LOOM ELEMENT: FRAME
//   Registers itself globally on window.LoomElements.
//   All internal functions remain unchanged.
// ============================================================

/* ====================================================
     CARDS
     ==================================================== */

// variables
var previewAll = false; // start with normal edit view
var frameListDrag = null;
var $groupContextMenu = null;
var previewCardIds = new Set();

function toggleAllPreviews() {
  var visibleCards = $world.querySelectorAll(".card");
  var anyPreview = false;

  // check if any visible card currently has preview
  visibleCards.forEach(function (el) {
    if (el.classList.contains("card-preview")) anyPreview = true;
  });

  if (anyPreview) {
    // turn all visible previews off
    visibleCards.forEach(function (el) {
      el.classList.remove("card-preview");
      previewCardIds.delete(el.dataset.cardId);
    });
    previewAll = false;
    toast("Preview mode OFF for all visible frames");
  } else {
    // turn all visible previews on
    visibleCards.forEach(function (el) {
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
    type: "frame",        // <-- added type
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
  // remove preview ids for deleted cards (if any)
  selectedIds.forEach(function(id) { previewCardIds.delete(id); });
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

function createGroup() {
  if (mode === "view") return;

  var group = {
    id: uid(),
    name: "New Group",
    collapsed: false,
    hidden: false,
    showBorder: false,
    color: null,
    order: state.groups.length,
  };

  state.groups.push(group);
  renderFrameList();
  pushHistory();
  save();
  toast("Group added");
}

function deleteGroup(groupId) {
  if (mode === "view") return;
  flushHistoryDebounce();
  state.groups = state.groups.filter((g) => g.id !== groupId);
  state.cards.forEach((c) => {
    if (c.groupId === groupId) c.groupId = null;
  });
  renderFrameList();
  pushHistory();
  save();
  toast("Group deleted");
}

function renameGroup(groupId, newName) {
  if (mode === "view") return;
  var group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.name = newName;
  pushHistoryDebounced();
  save();
}

function toggleGroupCollapse(groupId) {
  var group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  renderFrameList();
  // no history push needed for UI state
  save();
}

function setGroupColor(groupId, color) {
  var group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.color = color || null;
  renderFrameList();
  pushHistory();
  save();
}

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
  numEl.dataset.tooltip = "Drag to move \u00b7 Ctrl + Drag to snap-align edges";

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
  header.appendChild(numEl);
  header.appendChild(titleInput);
  header.appendChild(pinBtn);

  var previewToggle = makePreviewToggle(card);
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

  var beginCardMotion = (e) => {
    if (e.button === 1) {
      startPanning(e, el);
      return;
    }
    if (e.target.closest(".resize-handle")) return;
    if (isCardDragBlockedTarget(e.target)) return;
    if (selectedIds.size > 1 && selectedIds.has(card.id)) {
      startGroupDrag(e, card, el);
    } else {
      startDragCard(e, card, el);
    }
  };

  el.addEventListener("pointerdown", beginCardMotion);

  header.addEventListener("click", () => selectCard(card.id));
  handle.addEventListener("pointerdown", (e) => startResizeCard(e, card, el));

  if (previewCardIds.has(card.id)) {
    el.classList.add("card-preview");
  }

  return el;
}

function makePinButton(card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card-pin-btn";
  btn.dataset.tooltip = "Drag to link this frame to another";
  var c = card.color;
  btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <ellipse cx="7.4" cy="9.4" rx="3.3" ry="1.1" fill="rgba(0,0,0,0.32)"/>
        <circle cx="6.4" cy="6.2" r="5" fill="${hexToRgba(c, 0.35)}"/>
        <circle cx="6.4" cy="6.2" r="4.1" fill="${c}"/>
        <circle cx="4.9" cy="4.7" r="1.25" fill="rgba(255,255,255,0.65)"/>
      </svg>`;
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
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="3" fill="currentColor"/>
    <path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" fill="none"/>
  </svg>`;
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    var cardEl = e.target.closest(".card");
    if (!cardEl) return;
    var id = cardEl.dataset.cardId;
    var hasPreview = cardEl.classList.toggle("card-preview");
    if (hasPreview) {
      previewCardIds.add(id);
    } else {
      previewCardIds.delete(id);
    }
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
    a.innerHTML = `
        <span class="link-icon">↗</span>
        <span class="link-text">
          <span class="link-title">${escapeHtml(block.data.label)}</span>
          <span class="link-url">${escapeHtml(block.data.url)}</span>
        </span>`;
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
  handle.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <rect x="1" y="1.4" width="10" height="1.6" rx="0.8" fill="currentColor"/>
        <rect x="1" y="5.2" width="10" height="1.6" rx="0.8" fill="currentColor"/>
        <rect x="1" y="9" width="10" height="1.6" rx="0.8" fill="currentColor"/>
      </svg>`;
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
  var file = $imageInput.files[0];
  var cardId = pendingImageCardId;
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

/* ====================================================
     DRAG CARD / GROUP DRAG / RESIZE / FRAME-ELEMENTS
     ----------------------------------------------------
     hasMoved guards on each drag context prevent a plain
     click-without-drag from pushing a no-op history entry.
     ==================================================== */
var dragCtx = null;
var groupDragCtx = null;
var resizeCtx = null;
var blockDragCtx = null;

function startDragCard(e, card, el) {
  if (mode === "view") return;
  e.stopPropagation();
  e.preventDefault();
  setFrameDragActive(true);
  if (selectedIds.size > 1 && selectedIds.has(card.id)) {
    startGroupDrag(e, card, el);
    return;
  }
  selectCard(card.id);
  dragCtx = {
    id: card.id,
    el,
    startScreenX: e.clientX,
    startScreenY: e.clientY,
    startX: card.x,
    startY: card.y,
    pointerId: e.pointerId,
    active: true,
    hasMoved: false,
  };
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onDragCardMove);
  window.addEventListener("pointerup", onDragCardUp, { once: true });
  window.addEventListener("pointercancel", onDragCardUp, { once: true });
}

function onDragCardMove(e) {
  if (!dragCtx?.active) return;
  var card = getCard(dragCtx.id);
  if (!card) return;
  dragCtx.hasMoved = true;
  var dx = (e.clientX - dragCtx.startScreenX) / state.view.scale;
  var dy = (e.clientY - dragCtx.startScreenY) / state.view.scale;
  var nx = Math.round(dragCtx.startX + dx);
  var ny = Math.round(dragCtx.startY + dy);

  var snapV = null;
  var snapH = null;
  if (e.ctrlKey) {
    var { vLines, hLines } = collectSnapLines(new Set([card.id]));
    var thresholdWorld = SNAP_PX / state.view.scale;
    var snap = computeCardSnap(
      nx,
      ny,
      card.w,
      card.h,
      vLines,
      hLines,
      thresholdWorld,
    );
    nx += snap.dx;
    ny += snap.dy;
    snapV = snap.vLine;
    snapH = snap.hLine;
  }

  card.x = nx;
  card.y = ny;
  dragCtx.el.style.left = card.x + "px";
  dragCtx.el.style.top = card.y + "px";
  if (card.id === selectedId) {
    $inspX.value = card.x;
    $inspY.value = card.y;
  }
  renderConnections();
  if (e.ctrlKey) drawSnapGuides(snapV, snapH);
}

function onDragCardUp() {
  window.removeEventListener("pointermove", onDragCardMove);
  var moved = dragCtx?.hasMoved;
  if (dragCtx) dragCtx.active = false;
  dragCtx = null;
  setFrameDragActive(false);
  renderConnections(); // clears any leftover snap-guide lines
  if (moved) pushHistory();
  save();
}

function startGroupDrag(e, card, el) {
  if (mode === "view") return;
  e.stopPropagation();
  e.preventDefault();
  setFrameDragActive(true);
  groupDragCtx = {
    active: true,
    pointerId: e.pointerId,
    anchorId: card.id,
    startScreenX: e.clientX,
    startScreenY: e.clientY,
    cards: new Map(),
    hasMoved: false,
  };
  selectedIds.forEach((id) => {
    var c = getCard(id);
    var node = $world.querySelector(`[data-card-id="${id}"]`);
    if (c && node)
      groupDragCtx.cards.set(id, { x: c.x, y: c.y, node, card: c });
  });
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onGroupDragMove);
  window.addEventListener("pointerup", onGroupDragUp, { once: true });
  window.addEventListener("pointercancel", onGroupDragUp, { once: true });
}

function onGroupDragMove(e) {
  if (!groupDragCtx?.active) return;
  groupDragCtx.hasMoved = true;
  var dx = (e.clientX - groupDragCtx.startScreenX) / state.view.scale;
  var dy = (e.clientY - groupDragCtx.startScreenY) / state.view.scale;

  var snapDx = 0;
  var snapDy = 0;
  var snapV = null;
  var snapH = null;

  if (e.ctrlKey) {
    var anchorStart = groupDragCtx.cards.get(groupDragCtx.anchorId);
    if (anchorStart && anchorStart.card) {
      var freeX = Math.round(anchorStart.x + dx);
      var freeY = Math.round(anchorStart.y + dy);
      var excludeIds = new Set(groupDragCtx.cards.keys());
      var { vLines, hLines } = collectSnapLines(excludeIds);
      var thresholdWorld = SNAP_PX / state.view.scale;
      var snap = computeCardSnap(
        freeX,
        freeY,
        anchorStart.card.w,
        anchorStart.card.h,
        vLines,
        hLines,
        thresholdWorld,
      );
      snapDx = snap.dx;
      snapDy = snap.dy;
      snapV = snap.vLine;
      snapH = snap.hLine;
    }
  }

  groupDragCtx.cards.forEach((start, id) => {
    var card = start.card;
    if (!card) return;
    card.x = Math.round(start.x + dx + snapDx);
    card.y = Math.round(start.y + dy + snapDy);
    start.node.style.left = card.x + "px";
    start.node.style.top = card.y + "px";
    if (id === selectedId) {
      $inspX.value = card.x;
      $inspY.value = card.y;
    }
  });
  renderConnections();
  if (e.ctrlKey) drawSnapGuides(snapV, snapH);
}

function onGroupDragUp() {
  window.removeEventListener("pointermove", onGroupDragMove);
  var moved = groupDragCtx?.hasMoved;
  if (groupDragCtx) groupDragCtx.active = false;
  groupDragCtx = null;
  setFrameDragActive(false);
  renderConnections(); // clears any leftover snap-guide lines
  if (moved) pushHistory();
  save();
}

function startResizeCard(e, card, el) {
  if (mode === "view") return;
  e.stopPropagation();
  e.preventDefault();
  setFrameDragActive(false);
  selectCard(card.id);
  resizeCtx = {
    id: card.id,
    el,
    startScreenX: e.clientX,
    startScreenY: e.clientY,
    startW: card.w,
    startH: card.h,
    active: true,
    hasMoved: false,
  };
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeUp, { once: true });
  window.addEventListener("pointercancel", onResizeUp, { once: true });
}

function onResizeMove(e) {
  if (!resizeCtx?.active) return;
  var card = getCard(resizeCtx.id);
  if (!card) return;
  resizeCtx.hasMoved = true;
  var dx = (e.clientX - resizeCtx.startScreenX) / state.view.scale;
  var dy = (e.clientY - resizeCtx.startScreenY) / state.view.scale;
  card.w = Math.max(180, Math.round(resizeCtx.startW + dx));
  card.h = Math.max(130, Math.round(resizeCtx.startH + dy));
  resizeCtx.el.style.width = card.w + "px";
  resizeCtx.el.style.height = card.h + "px";
  if (card.id === selectedId) {
    $inspW.value = card.w;
    $inspH.value = card.h;
  }
  renderConnections();
}

function onResizeUp() {
  window.removeEventListener("pointermove", onResizeMove);
  var moved = resizeCtx?.hasMoved;
  if (resizeCtx) resizeCtx.active = false;
  resizeCtx = null;
  setFrameDragActive(false);
  if (moved) pushHistory();
  save();
}

function startBlockDrag(e, card, block, handle) {
  if (mode === "view") return;
  e.stopPropagation();
  e.preventDefault();

  var wrap = handle.closest(".block");
  var body = wrap ? wrap.parentElement : null;
  if (!wrap || !body) return;

  wrap.classList.add("block-dragging");
  blockDragCtx = { active: true, card, wrap, body, hasMoved: false };

  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }

  window.addEventListener("pointermove", onBlockDragMove);
  window.addEventListener("pointerup", onBlockDragUp, { once: true });
  window.addEventListener("pointercancel", onBlockDragUp, { once: true });
}

function onBlockDragMove(e) {
  if (!blockDragCtx?.active) return;
  blockDragCtx.hasMoved = true;
  var { wrap, body } = blockDragCtx;

  var siblings = Array.from(body.children).filter(
    (el) => el.classList.contains("block") && el !== wrap,
  );

  var target = null;
  var placeBefore = true;

  for (var sib of siblings) {
    var r = sib.getBoundingClientRect();
    var mid = r.top + r.height / 2;
    if (e.clientY < mid) {
      target = sib;
      placeBefore = true;
      break;
    }
  }
  if (!target && siblings.length) {
    target = siblings[siblings.length - 1];
    placeBefore = false;
  }

  if (target) {
    body.insertBefore(wrap, placeBefore ? target : target.nextSibling);
  }
}

function onBlockDragUp() {
  if (!blockDragCtx?.active) return;
  var { card, wrap, body } = blockDragCtx;
  var moved = blockDragCtx.hasMoved;
  window.removeEventListener("pointermove", onBlockDragMove);
  wrap.classList.remove("block-dragging");

  var orderedIds = Array.from(body.children)

    .filter((el) => el.classList.contains("block"))
    .map((el) => el.dataset.blockId);

  card.blocks.sort(
    (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id),
  );

  blockDragCtx = null;
  if (moved) pushHistory();
  save();
}

/* ====================================================
     FRAME LIST
     ==================================================== */
function buildChildrenMap() {
  var map = new Map();
  state.cards.forEach((c) => map.set(c.id, []));
  state.connections.forEach((conn) => {
    if (map.has(conn.fromId) && map.has(conn.toId))
      map.get(conn.fromId).push(conn.toId);
  });
  return map;
}

function renderFrameList() {
  $frameList.innerHTML = "";
  $emptyFrames.classList.toggle("show", state.cards.length === 0);

  // ── Add group button ─────────────────
  if (mode === "view") addGroupBtn.disabled = true;
  var header = document.createElement("div");
  header.className = "frame-list-header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between"; // keeps label left, button right

  var label = document.createElement("span");
  label.className = "panel-label"; // reuse the existing label style
  label.textContent = "Frames";

  var addGroupBtn = document.createElement("button");
  addGroupBtn.className = "frame-group-add-btn";
  addGroupBtn.innerHTML = "+";
  addGroupBtn.dataset.tooltip = "Create new group";
  addGroupBtn.addEventListener("click", createGroup);

  header.appendChild(label);
  header.appendChild(addGroupBtn);
  $frameList.appendChild(header);

  header.addEventListener("dragover", (e) => e.preventDefault());
  header.addEventListener("drop", (e) => {
    e.preventDefault();
    var cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    var rootCard = getCard(cardId);
    if (!rootCard) return;
    // Remove incoming connection and set groupId = null for all descendants
    state.connections = state.connections.filter((c) => c.toId !== cardId);
    var descendantIds = getAllDescendants(cardId);
    [cardId, ...descendantIds].forEach((id) => {
      var c = getCard(id);
      if (c) c.groupId = null;
    });
    renderFrameList();
    renderConnections();
    pushHistory();
    save();
    toast("Frames removed from group");
  });

  // ── Build helpers ────────────────────
  var childrenMap = buildChildrenMap();
  var numById = new Map();
  state.cards.forEach((c, i) => numById.set(c.id, i + 1));
  var visited = new Set();

  function renderCards(ids, depth) {
    ids.forEach((id) => renderNode(id, depth));
  }

  function renderNode(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    var card = getCard(id);
    if (!card) return;
    $frameList.appendChild(buildFrameRow(card, numById.get(id), depth));
    (childrenMap.get(id) || []).forEach((childId) =>
      renderNode(childId, depth + 1),
    );
  }

  // ── Groups ───────────────────────────
  state.groups
    .sort((a, b) => a.order - b.order)
    .forEach((group) => {
      var groupCards = state.cards.filter((c) => c.groupId === group.id);
      var groupTopCards = groupCards.filter((c) => !hasParent(c.id));

      var groupRow = buildGroupRow(group, groupCards.length);
      $frameList.appendChild(groupRow);

      if (!group.collapsed) {
        // Expanded: render the frames
        groupTopCards.forEach((c) => renderNode(c.id, 1));
        // ensure any missed ones are rendered
        groupTopCards.forEach((c) => {
          if (!visited.has(c.id)) renderNode(c.id, 1);
        });
      } else {
        // so they are not rendered later as ungrouped.
        // collapsed OR hidden: mark all as visited so they don't appear later
        var allIds = [];
        groupTopCards.forEach((c) => {
          allIds.push(c.id);
          allIds.push(...getAllDescendants(c.id));
        });
        allIds.forEach((id) => visited.add(id));
      }
    });

  // ── Ungrouped frames (group null) ────
  var ungrouped = state.cards.filter((c) => !c.groupId && !hasParent(c.id));
  ungrouped.forEach((c) => renderNode(c.id, 0));
  ungrouped.forEach((c) => {
    if (!visited.has(c.id)) renderNode(c.id, 0);
    ``;
  });

  // ── Any remaining visited? (disconnected) ─
  state.cards.forEach((c) => {
    if (!visited.has(c.id)) renderNode(c.id, 0);
  });

  syncSelectedCardClasses();
}

function buildFrameRow(card, num, depth) {
  var row = document.createElement("div");
  // Remove depthClass variable and class assignment
  // var depthClass = depth > 0 ? ` depth-${Math.min(depth, 3)}` : "";
  // row.className = "frame-row" + (selectedIds.has(card.id) ? " selected" : "") + depthClass;

  row.className = "frame-row" + (selectedIds.has(card.id) ? " selected" : "");
  row.dataset.cardId = card.id;

  // Set indentation dynamically (base left padding is 8px, add 12px per depth level)
  row.style.paddingLeft = 8 + depth * 12 + "px";

  // Only show the connector if the card has a parent in the connection tree
  if (depth > 0 && hasParent(card.id)) {
    var connector = document.createElement("span");
    connector.className = "frame-connector";
    connector.textContent = "↳";
    row.appendChild(connector);
  }
  var dot = document.createElement("span");
  dot.className = "frame-dot";
  dot.style.background = card.color;
  var numEl = document.createElement("span");
  numEl.className = "frame-num";
  numEl.textContent = String(num).padStart(2, "0");
  var title = document.createElement("span");
  title.className = "frame-title";
  title.textContent = card.title || "Untitled frame";
  var del = document.createElement("span");
  del.className = "frame-del";
  del.innerHTML = "×";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteCard(card.id);
  });

  row.appendChild(dot);
  row.appendChild(numEl);
  row.appendChild(title);
  row.appendChild(del);
  row.addEventListener("click", () => {
    selectCard(card.id);
    panToCard(card);
  });

  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", card.id);
    row.classList.add("dragging");
    frameListDrag = { cardId: card.id };
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    frameListDrag = null;
  });

  return row;
}

/**
 * Return all card IDs that are direct or indirect children
 * of `cardId` via the connection tree (fromId → toId).
 * Cycles are impossible because wouldCreateCycle prevents them.
 */
function getAllDescendants(cardId) {
  var result = [];
  var stack = [cardId];
  while (stack.length) {
    var id = stack.pop();
    state.connections
      .filter(function (c) {
        return c.fromId === id;
      })
      .forEach(function (c) {
        result.push(c.toId);
        stack.push(c.toId);
      });
  }
  return result;
}

function buildGroupRow(group, count) {
  var row = document.createElement("div");
  row.className = "frame-group-row" + (group.hidden ? " group-hidden" : "");
  row.dataset.groupId = group.id;
  row.draggable = false;

  // Collapse toggle
  var toggle = document.createElement("span");
  toggle.className = "group-collapse-toggle";
  toggle.setAttribute("aria-hidden", "true");
  toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  if (group.collapsed) toggle.classList.add("collapsed");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGroupCollapse(group.id);
  });

  // if hidden also add the collapsed class
  if (group.collapsed || group.hidden) toggle.classList.add("collapsed");

  // Drag handle
  var dragHandle = document.createElement("span");
  dragHandle.className = "group-drag-handle";
  dragHandle.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="1.4" width="10" height="1.6" rx="0.8" fill="currentColor"/>
      <rect x="1" y="5.2" width="10" height="1.6" rx="0.8" fill="currentColor"/>
      <rect x="1" y="9" width="10" height="1.6" rx="0.8" fill="currentColor"/>
    </svg>`;
  dragHandle.setAttribute("aria-label", "Drag to reorder group");
  dragHandle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    row.draggable = true;
  });
  dragHandle.addEventListener("pointerup", () => {
    row.draggable = false;
  });

  // Name input
  var nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "group-name-input";
  nameInput.value = group.name;
  nameInput.placeholder = "Group name";
  nameInput.readOnly = mode === "view";
  nameInput.addEventListener("input", () =>
    renameGroup(group.id, nameInput.value),
  );
  nameInput.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Count
  var countSpan = document.createElement("span");
  countSpan.className = "group-count";
  countSpan.textContent = count;

  // ---- New buttons (replace delete button) ----
  // ── Border toggle button (styled like topbar icon button) ──
  var borderBtn = document.createElement("button");
  borderBtn.type = "button";
  borderBtn.className = "group-action-btn";
  borderBtn.dataset.tooltip = "Toggle group border highlight";
  borderBtn.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
  </svg>`;
  borderBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    group.showBorder = !group.showBorder;
    pushHistory();
    save();
    renderAll();
  });

  // ── Hide / Show toggle button (eye icon with slash when visible, eye only when hidden) ──
  var hideBtn = document.createElement("button");
  hideBtn.type = "button";
  hideBtn.className = "group-action-btn";
  hideBtn.dataset.tooltip = group.hidden
    ? "Show group frames"
    : "Hide group frames";
  hideBtn.innerHTML = group.hidden
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  hideBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    group.hidden = !group.hidden;
    if (group.hidden) {
      group.collapsed = true;
      group.showBorder = false;
    } else {
      group.collapsed = false;
    }
    pushHistory();
    save();
    renderAll();
  });

  // Assemble row (note: delete button is gone)
  row.appendChild(toggle);
  row.appendChild(dragHandle);
  row.appendChild(nameInput);
  row.appendChild(countSpan);
  row.appendChild(borderBtn);
  row.appendChild(hideBtn);

  // ---- Right‑click context menu ----
  row.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (mode === "view") return;
    if (group.hidden) return;
    openGroupContextMenu(e, group);
  });

  // Drag‑and‑drop for reordering`
  row.addEventListener("dragstart", (e) => {
    if (group.hidden) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("application/loom-group", group.id);
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    row.draggable = false;
  });

  // Frame drop onto group row
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drag-over");
  });
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    var cardId = e.dataTransfer.getData("text/plain");
    if (cardId) {
      e.stopPropagation();
      row.classList.remove("drag-over");
      var rootCard = getCard(cardId);
      if (!rootCard) return;
      if (rootCard.groupId === group.id) {
        toast("Frame already belongs to this group");
        return;
      }
      state.connections = state.connections.filter(function (c) {
        return c.toId !== cardId;
      });
      var descendantIds = getAllDescendants(cardId);
      [cardId].concat(descendantIds).forEach(function (id) {
        var c = getCard(id);
        if (c) c.groupId = group.id;
      });
      renderFrameList();
      renderConnections();
      pushHistory();
      save();
      var movedCount = 1 + descendantIds.length;
      toast(
        "Moved " +
          movedCount +
          " frame" +
          (movedCount > 1 ? "s" : "") +
          ' to "' +
          group.name +
          '"',
      );
    }
  });

  if (group.hidden) {
    // collapse toggle – no clicks, visually dim
    toggle.style.pointerEvents = "none";
    toggle.style.opacity = "0.3";

    // drag handle – no drag
    dragHandle.style.pointerEvents = "none";
    row.draggable = false;

    // name input – read‑only
    nameInput.readOnly = true;
    nameInput.style.pointerEvents = "none";

    // border button – disabled
    borderBtn.disabled = true;
    borderBtn.style.pointerEvents = "none";
    borderBtn.classList.add("disabled");

    // hide button remains active (do nothing to it)
  }

  return row;
}

function renderFrameListSoft() {
  state.cards.forEach((card) => {
    var titleEl = $frameList.querySelector(
      `[data-card-id="${card.id}"] .frame-title`,
    );
    if (titleEl) titleEl.textContent = card.title || "Untitled frame";
  });
}

function panToCard(card) {
  var rect = $canvas.getBoundingClientRect();
  state.view.x = rect.width / 2 - (card.x + card.w / 2) * state.view.scale;
  state.view.y = rect.height / 2 - (card.y + card.h / 2) * state.view.scale;
  applyView();
  save();
}

function ensureGroupContextMenu() {
  if ($groupContextMenu) return $groupContextMenu;
  var menu = document.createElement("div");
  menu.className = "group-context-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.appendChild(menu);
  $groupContextMenu = menu;
  return menu;
}

function openGroupContextMenu(e, group) {
  var menu = ensureGroupContextMenu();
  menu.innerHTML = "";

  // Hide / Show frames
  menu.appendChild(
    buildGroupMenuItem({
      label: group.hidden ? "Show Frames" : "Hide Frames",
      onClick: function () {
        group.hidden = !group.hidden;
        if (group.hidden) {
          group.collapsed = true;
          group.showBorder = false;
        } else {
          group.collapsed = false;
        }
        pushHistory();
        save();
        renderAll();
      },
    }),
  );

  // Toggle borders
  menu.appendChild(
    buildGroupMenuItem({
      label: group.showBorder ? "Hide Borders" : "Show Borders",
      onClick: function () {
        group.showBorder = !group.showBorder;
        pushHistory();
        save();
        renderAll();
      },
    }),
  );

  // Divider
  var divider = document.createElement("div");
  divider.className = "group-context-menu-divider";
  menu.appendChild(divider);

  // Delete – reddish colour
  menu.appendChild(
    buildGroupMenuItem({
      label: "Delete Group",
      danger: true,
      onClick: function () {
        deleteGroup(group.id);
      },
    }),
  );

  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.classList.add("open");

  // Keep inside viewport
  var rect = menu.getBoundingClientRect();
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var x = e.clientX,
    y = e.clientY;
  if (rect.right > vw - 8) x = Math.max(8, vw - rect.width - 8);
  if (rect.bottom > vh - 8) y = Math.max(8, vh - rect.height - 8);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function buildGroupMenuItem({ label, danger, onClick }) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "group-context-menu-item" + (danger ? " danger" : "");
  btn.setAttribute("role", "menuitem");
  btn.innerHTML = "<span>" + escapeHtml(label) + "</span>";
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    onClick();
    closeGroupContextMenu();
  });
  return btn;
}

function closeGroupContextMenu() {
  if ($groupContextMenu) $groupContextMenu.classList.remove("open");
}

function renderGroupBorders() {
  if (!$svgBack) return;
  // Remove old borders
  $svgBack.querySelectorAll(".group-border").forEach(function (el) {
    el.remove();
  });

  state.groups.forEach(function (group) {
    if (!group.showBorder) return;
    var bounds = getGroupCardsBounds(group);
    if (!bounds) return;
    var pad = 12;
    var x = bounds.minX - pad;
    var y = bounds.minY - pad;
    var w = bounds.maxX - bounds.minX + pad * 2;
    var h = bounds.maxY - bounds.minY + pad * 2;
    var color = group.color || "var(--accent)";

    var g = svgEl("g");
    g.classList.add("group-border");
    g.setAttribute("data-group-id", group.id);
    g.appendChild(
      svgEl("rect", {
        x: x,
        y: y,
        width: w,
        height: h,
        rx: 12,
        ry: 12,
        fill: "none",
        stroke: color,
        "stroke-width": "2",
        "stroke-dasharray": "8 4",
        "stroke-opacity": "0.55",
        "pointer-events": "none",
      }),
    );
    $svgBack.appendChild(g);
  });
}

/* ====================================================
     INSPECTOR
     ==================================================== */
function buildSwatches() {
  $inspSwatches.innerHTML = "";
  SWATCHES.forEach((color) => {
    var sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = color;
    sw.dataset.color = color;
    sw.addEventListener("click", () => {
      if (mode === "view" || selectedIds.size > 1) return;
      var card = getCard(selectedId);
      if (!card) return;
      card.color = color;
      renderInspector();
      renderWorld();
      renderFrameList();
      pushHistory();
      save();
    });
    $inspSwatches.appendChild(sw);
  });
}

function setFrameLineForSelectedCard(value) {
  if (mode === "view" || selectedIds.size > 1) return;
  var card = getCard(selectedId);
  if (!card) return;
  card.frameLine = normalizeFrameLine(value);
  syncFrameLineSelector(card.frameLine);
  renderWorld();
  pushHistory();
  save();
}

function syncFrameLineSelector(frameLine) {
  if (!$inspFrameLine || !$inspFrameLineButtons.length) return;
  var normalized = normalizeFrameLine(frameLine);
  $inspFrameLineButtons.forEach((btn) => {
    var selected = btn.dataset.value === normalized;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
}

function ensureFrameLineField() {
  if ($inspFrameLine) return $inspFrameLine;
  var field = document.createElement("div");
  field.className = "field";
  field.id = "insp-frame-line-field";

  var label = document.createElement("label");
  label.textContent = "Frame line";

  var selector = document.createElement("div");
  selector.className = "frame-line-selector";
  selector.setAttribute("role", "group");
  selector.setAttribute("aria-label", "Frame line");

  var options = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "up", label: "Up" },
    { value: "down", label: "Down" },
    { value: "none", label: "None" },
  ];

  $inspFrameLineButtons = [];

  options.forEach((opt) => {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "frame-line-btn";
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => setFrameLineForSelectedCard(opt.value));
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    selector.appendChild(btn);
    $inspFrameLineButtons.push(btn);
  });

  field.appendChild(label);
  field.appendChild(selector);

  var anchor = $inspSwatches.closest(".field") || $inspSwatches.parentElement;
  if (anchor && anchor.parentElement) {
    anchor.insertAdjacentElement("afterend", field);
  } else {
    $inspectorContent.appendChild(field);
  }

  $inspFrameLine = selector;
  return $inspFrameLine;
}

function renderInspector() {
  if (selectedIds.size > 1) {
    $inspectorEmpty.classList.remove("hidden");
    $inspectorContent.classList.add("hidden");
    updateInspectorLockMessage(
      `${selectedIds.size} frames selected — locked. Drag one selected frame to move them together.`,
    );
    applyInspectorMode();
    return;
  }

  updateInspectorLockMessage("");
  var card = getCard(selectedId);
  if (!card) {
    $inspectorEmpty.classList.remove("hidden");
    $inspectorContent.classList.add("hidden");
    var p = $inspectorEmpty.querySelector("p");
    if (p) p.textContent = "Select a frame to edit its details";
    return;
  }

  $inspectorEmpty.classList.add("hidden");
  $inspectorContent.classList.remove("hidden");
  $inspTitle.value = card.title;
  $inspX.value = card.x;
  $inspY.value = card.y;
  $inspW.value = card.w;
  $inspH.value = card.h;
  $inspNotes.value = card.notes || "";
  ensureFrameLineField();
  syncFrameLineSelector(card.frameLine);
  $inspSwatches.querySelectorAll(".swatch").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.color === card.color);
  });
  applyInspectorMode();
  syncMarkdownPreviews();
}

$inspTitle.addEventListener("input", () => {
  if (mode === "view" || selectedIds.size > 1) return;
  var card = getCard(selectedId);
  if (!card) return;
  card.title = $inspTitle.value;
  var titleEl = $world.querySelector(`[data-card-id="${card.id}"] .card-title`);
  if (titleEl) {
    titleEl.value = card.title;
    syncMarkdownPreviews();
  }
  renderFrameListSoft();
  pushHistoryDebounced();
  save();
});

$inspNotes.addEventListener("input", () => {
  if (mode === "view" || selectedIds.size > 1) return;
  var card = getCard(selectedId);
  if (!card) return;
  card.notes = $inspNotes.value;
  pushHistoryDebounced();
  save();
});

[
  ["x", $inspX],
  ["y", $inspY],
  ["w", $inspW],
  ["h", $inspH],
].forEach(([key, input]) => {
  input.addEventListener("input", () => {
    if (mode === "view" || selectedIds.size > 1) return;
    var card = getCard(selectedId);
    if (!card) return;
    var val = parseInt(input.value, 10);
    if (Number.isNaN(val)) return;
    card[key] =
      key === "w" ? Math.max(180, val) : key === "h" ? Math.max(130, val) : val;
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
});

document.getElementById("btn-delete-frame").addEventListener("click", () => {
  if (selectedIds.size > 1) deleteSelectedCards();
  else if (selectedId) deleteCard(selectedId);
});

/* ====================================================
     PROJECT TITLE
     ==================================================== */
function applyProjectName() {
  $projectTitle.value = state.projectName || "";
  document.title = (state.projectName || "Untitled Storyboard") + " — Loom";
}

$projectTitle.addEventListener("input", () => {
  if (mode === "view") return;
  state.projectName = $projectTitle.value;
  document.title = ($projectTitle.value || "Untitled Storyboard") + " — Loom";
  pushHistoryDebounced();
  save();
});

$projectTitle.addEventListener("blur", () => {
  if (mode === "view") return;
  if (!$projectTitle.value.trim()) {
    state.projectName = "Untitled Storyboard";
    $projectTitle.value = state.projectName;
    save();
  }
});

// ============================================================
//   REGISTER THE ELEMENT GLOBALLY
//   (slugifyFilename is now defined in loom-bootstrap.js)
// ============================================================
window.LoomElements = window.LoomElements || {};
window.LoomElements['frame'] = {
  id: 'frame',
  name: 'Frame',
  description: 'A standard storyboard frame with a title, notes, and blocks.',
  icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="1.5" y1="5" x2="14.5" y2="5" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,

  factory: function() {
    var center = screenToWorld(
      $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
      $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
    );
    var cascade = (state.cards.length % 6) * 22;
    return {
      id: uid(),
      type: 'frame',
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

  render: function(card, num) {
    return buildCardEl(card, num);
  }
};
