/* ====================================================
     VIEW (PAN / ZOOM)
     ==================================================== */
function applyView() {
  $world.style.transform = `translate(${state.view.x}px,${state.view.y}px) scale(${state.view.scale})`;
  var grid = 32 * state.view.scale;
  var gridMajor = 160 * state.view.scale;
  $canvas.style.backgroundSize = `${gridMajor}px ${gridMajor}px, ${grid}px ${grid}px`;
  $canvas.style.backgroundPosition = `${state.view.x}px ${state.view.y}px, ${state.view.x}px ${state.view.y}px`;
  $zoomReadout.textContent = Math.round(state.view.scale * 100) + "%";
  resizeSVG();
}

function screenToWorld(sx, sy) {
  var rect = $canvas.getBoundingClientRect();
  return {
    x: (sx - rect.left - state.view.x) / state.view.scale,
    y: (sy - rect.top - state.view.y) / state.view.scale,
  };
}

function centerView() {
  var rect = $canvas.getBoundingClientRect();
  state.view.x = rect.width / 2;
  state.view.y = rect.height / 2;
  state.view.scale = 1;
  applyView();
}

function zoomAt(sx, sy, factor) {
  var rect = $canvas.getBoundingClientRect();
  var mx = sx - rect.left,
    my = sy - rect.top;
  var worldX = (mx - state.view.x) / state.view.scale;
  var worldY = (my - state.view.y) / state.view.scale;
  var s = Math.min(2.5, Math.max(0.15, state.view.scale * factor));
  state.view.x = mx - worldX * s;
  state.view.y = my - worldY * s;
  state.view.scale = s;
  applyView();
}

function zoomToFit() {
  // Filter out hidden cards
  var visibleCards = state.cards.filter(function (c) {
    return !isCardHidden(c);
  });

  if (visibleCards.length === 0) {
    centerView();
    return;
  }

  var minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  visibleCards.forEach(function (c) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  });

  var rect = $canvas.getBoundingClientRect();
  var pad = 80;
  var s = Math.min(
    (rect.width - pad * 2) / (maxX - minX || 1),
    (rect.height - pad * 2) / (maxY - minY || 1),
    1.4,
  );
  var cs = Math.min(2.5, Math.max(0.15, s));
  state.view.scale = cs;
  state.view.x = rect.width / 2 - (minX + (maxX - minX) / 2) * cs;
  state.view.y = rect.height / 2 - (minY + (maxY - minY) / 2) * cs;
  applyView();
}

/**
 * Pure bounding-box calculation over all cards in world space.
 * Shared by zoomToFit() and the storyboard image exporter
 * (see scripts/loom-export.js) so both "fit everything" features
 * always agree on what the full extent of the board is.
 * Returns null when the board is empty.
 */
function getCardsBounds() {
  if (state.cards.length === 0) return null;
  var minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  state.cards.forEach((c) => {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  });
  return { minX, minY, maxX, maxY };
}

var panCtx = null;
function startPanning(e, captureEl) {
  if (mode === "view" && e.button === 0) {
    // still allow ctrl/middle pan in view mode
  }
  setFrameDragActive(false);
  panCtx = {
    active: true,
    pointerId: e.pointerId,
    captureEl,
    startX: e.clientX,
    startY: e.clientY,
    viewX: state.view.x,
    viewY: state.view.y,
  };
  $canvas.classList.add("panning");
  try {
    captureEl.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", onPanUp, { once: true });
  window.addEventListener("pointercancel", onPanUp, { once: true });
  clearSelectionPreview();
}

function onPanMove(e) {
  if (!panCtx?.active) return;
  state.view.x = panCtx.viewX + (e.clientX - panCtx.startX);
  state.view.y = panCtx.viewY + (e.clientY - panCtx.startY);
  applyView();
}

function onPanUp() {
  if (!panCtx?.active) return;
  window.removeEventListener("pointermove", onPanMove);
  panCtx.active = false;
  panCtx = null;
  $canvas.classList.remove("panning");
  save();
}

function getCanvasPoint(e) {
  var rect = $canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/* ====================================================
     MARQUEE SELECTION
     ==================================================== */
var selectionBox = null;
function initSelectionBox() {
  $selectionBox = document.createElement("div");
  $selectionBox.className = "selection-box";
  $selectionBox.style.display = "none";
  $canvas.appendChild($selectionBox);
}

function updateSelectionBoxVisual() {
  if (!selectionBox || !$selectionBox) return;
  var left = Math.min(selectionBox.startX, selectionBox.endX);
  var top = Math.min(selectionBox.startY, selectionBox.endY);
  var width = Math.abs(selectionBox.endX - selectionBox.startX);
  var height = Math.abs(selectionBox.endY - selectionBox.startY);
  Object.assign($selectionBox.style, {
    display: "block",
    left: left + "px",
    top: top + "px",
    width: width + "px",
    height: height + "px",
  });
}

function hideSelectionBox() {
  if ($selectionBox) $selectionBox.style.display = "none";
}

function getSelectionBoxRect() {
  return {
    left: Math.min(selectionBox.startX, selectionBox.endX),
    top: Math.min(selectionBox.startY, selectionBox.endY),
    right: Math.max(selectionBox.startX, selectionBox.endX),
    bottom: Math.max(selectionBox.startY, selectionBox.endY),
  };
}

function rectsIntersect(a, b) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function updateSelectionPreview() {
  if (!selectionBox) return;
  var box = getSelectionBoxRect();
  clearSelectionPreview();

  $world.querySelectorAll(".card").forEach((el) => {
    var r = cardRectInCanvasSpace(el);
    if (rectsIntersect(box, r)) el.classList.add("selection-preview");
  });

  $frameList.querySelectorAll(".frame-row").forEach((el) => {
    var cardEl = $world.querySelector(`[data-card-id="${el.dataset.cardId}"]`);
    if (!cardEl) return;
    var r = cardRectInCanvasSpace(cardEl);
    if (rectsIntersect(box, r)) el.classList.add("selection-preview");
  });
}

function finishSelectionBox() {
  if (!selectionBox) return;
  var box = getSelectionBoxRect();
  var hits = [];

  $world.querySelectorAll(".card").forEach((el) => {
    var r = cardRectInCanvasSpace(el);
    if (rectsIntersect(box, r)) hits.push(el.dataset.cardId);
  });

  if (selectionBox.additive) {
    getSelectedIdsArray().forEach((id) => {
      if (!hits.includes(id)) hits.push(id);
    });
  }

  selectCards(hits);
  clearSelectionPreview();
  hideSelectionBox();
  selectionBox = null;
}

$canvas.addEventListener("pointerdown", (e) => {
  if (e.target !== $canvas && e.target !== $world) return;
  if (e.ctrlKey || e.button === 1) {
    startPanning(e, $canvas);
    return;
  }
  if (e.button !== 0) return;
  if (mode === "view") return;

  var p = getCanvasPoint(e);

  selectionBox = {
    startX: p.x,
    startY: p.y,
    endX: p.x,
    endY: p.y,
    additive: e.shiftKey,
  };

  if (!selectionBox.additive) clearSelection();
  clearSelectionPreview();
  $canvas.classList.add("selecting");
  updateSelectionBoxVisual();

  try {
    $canvas.setPointerCapture(e.pointerId);
  } catch {}
  window.addEventListener("pointermove", onCanvasSelectionMove);
  window.addEventListener("pointerup", onCanvasSelectionUp, { once: true });
  window.addEventListener("pointercancel", onCanvasSelectionUp, {
    once: true,
  });
});

function onCanvasSelectionMove(e) {
  if (!selectionBox) return;
  var p = getCanvasPoint(e);
  selectionBox.endX = p.x;
  selectionBox.endY = p.y;
  updateSelectionBoxVisual();
  updateSelectionPreview();
}

function onCanvasSelectionUp() {
  window.removeEventListener("pointermove", onCanvasSelectionMove);
  $canvas.classList.remove("selecting");
  finishSelectionBox();
  save();
}

$canvas.addEventListener("pointermove", (e) => {
  if (selectionBox) updateSelectionBoxVisual();
});

$canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !isEditableTarget(document.activeElement))
    $canvas.classList.add("space-down");
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") $canvas.classList.remove("space-down");
});

window.addEventListener("keydown", (e) => {
  if (isEditableTarget(document.activeElement)) return;

  // ── Undo / Redo ──────────────────────────────────────
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "y" ||
      (e.key === "z" && e.shiftKey) ||
      (e.key === "Z" && e.shiftKey))
  ) {
    e.preventDefault();
    redo();
    return;
  }

  // ── Toggle preview all frames ─────────────────────────
  if (
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    e.key === "P" &&
    mode === "edit"
  ) {
    e.preventDefault();
    toggleAllPreviews();
    return;
  }

  // ── Select all frames ──────────────────────────────
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "a" || e.key === "A") &&
    mode !== "view"
  ) {
    e.preventDefault();
    var allIds = state.cards
      .filter(function (c) {
        return !isCardHidden(c);
      })
      .map(function (c) {
        return c.id;
      });
    selectCards(allIds);
    toast("All visible frames selected");
    return;
  }

  // ── Existing shortcuts ───────────────────────────────
  if (mode !== "view" && (e.key === "n" || e.key === "N")) addCard();
  else if (e.key === "f" || e.key === "F") zoomToFit();
  else if (e.key === "0") centerView();
  else if (e.key === "Escape") {
    closeConnContextMenu();
    closeGroupContextMenu();
    clearSelection();
    clearSelectionPreview();
  } else if (mode !== "view" && (e.key === "Delete" || e.key === "Backspace")) {
    if (selectedIds.size > 1) deleteSelectedCards();
    else if (selectedId) deleteCard(selectedId);
  }
});

window.LoomModules = window.LoomModules || {};
window.LoomModules.graphics = true;
