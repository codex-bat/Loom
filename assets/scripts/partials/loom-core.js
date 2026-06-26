/* ====================================================
     CONSTANTS & STATE
     ==================================================== */
var STORAGE_KEY = "loom-storyboard-v1";
var MODE_STORAGE_KEY = "loom-mode-v1";
var SWATCHES = [
  "#6fe3c8",
  "#ffb36b",
  "#ff7b9c",
  "#8fb4ff",
  "#d6b4ff",
  "#f4e07a",
];
var SVG_NS = "http://www.w3.org/2000/svg";
var PANEL_MIN_WIDTH = 180;
var PANEL_MAX_WIDTH = 420;
var PANEL_MIN_CANVAS_WIDTH = 420;
var PANEL_MOBILE_BREAKPOINT = 680;

// Ctrl+Drag frame-alignment snapping
var SNAP_PX = 8; // screen-space snap threshold (converted to world units by zoom)
var ACCENT_VAR = "var(--accent, #6fe3c8)"; // root accent, theme-reactive
var WORLD_ORIGIN = { x: 0, y: 0 };

var DEFAULT_STATE = () => ({
  cards: [],
  connections: [],
  groups: [],
  view: { x: 0, y: 0, scale: 1 },
  layout: { leftPanelWidth: 252, rightPanelWidth: 252 },
  nextNum: 1,
  projectName: "Untitled Storyboard",
});

var state = DEFAULT_STATE();
var selectedId = null;
var selectedIds = new Set();
var pendingImageCardId = null;
var mode = "edit";

// ── History (undo/redo) ──────────────────────────────
var MAX_HISTORY = 60;
var historyStack = [];
var historyIndex = -1;
var historyDebounceTimer = null;

/* ====================================================
     DOM REFS
     ==================================================== */
var $canvas = document.getElementById("canvas");
var $world = document.getElementById("world");
var $leftPanel = document.getElementById("left-panel");
var $rightPanel = document.getElementById("right-panel");
var $zoomReadout = document.getElementById("zoom-readout");
var $frameList = document.getElementById("frame-list");
var $emptyFrames = document.getElementById("empty-frames");
var $inspectorEmpty = document.getElementById("inspector-empty");
var $inspectorContent = document.getElementById("inspector-content");
var $inspTitle = document.getElementById("insp-title");
var $inspSwatches = document.getElementById("insp-swatches");
var $inspX = document.getElementById("insp-x");
var $inspY = document.getElementById("insp-y");
var $inspW = document.getElementById("insp-w");
var $inspH = document.getElementById("insp-h");
var $inspNotes = document.getElementById("insp-notes");
var $inspFrameLine = null;
var $inspFrameLineButtons = [];
var $imageInput = document.getElementById("image-input");
var $importInput = document.getElementById("import-input");
var $toast = document.getElementById("toast");
var $projectTitle = document.getElementById("project-title");
var $tooltip = document.getElementById("tooltip");

var $modeDDBtn = document.getElementById("mode-dropdown-btn");
var $modeDDMenu = document.getElementById("mode-dropdown-menu");
var $modeDDLabel = document.getElementById("mode-dropdown-label");

var $svg = null;
var $svgBack = null;
var $selectionBox = null;
var $connContextMenu = null;

/* ====================================================
     UTILITY
     ==================================================== */
var uid = () => "id" + Math.random().toString(36).slice(2, 10);

function hexToRgba(hex, alpha) {
  hex = (hex || "#6fe3c8").replace("#", "");
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  var r = parseInt(hex.slice(0, 2), 16);
  var g = parseInt(hex.slice(2, 4), 16);
  var b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  var d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isEditableTarget(el) {
  if (!el) return false;
  var tag = el.tagName;
  return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA";
}

function svgEl(tag, attrs = {}) {
  var el = document.createElementNS(SVG_NS, tag);
  for (var [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function clampNumber(value, min, max, fallback) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeLayout(layout) {
  var safe = layout && typeof layout === "object" ? layout : {};
  return {
    leftPanelWidth: clampNumber(
      safe.leftPanelWidth,
      PANEL_MIN_WIDTH,
      PANEL_MAX_WIDTH,
      252,
    ),
    rightPanelWidth: clampNumber(
      safe.rightPanelWidth,
      PANEL_MIN_WIDTH,
      PANEL_MAX_WIDTH,
      252,
    ),
  };
}

function normalizeFrameLine(value) {
  return ["left", "right", "up", "down", "none"].includes(value)
    ? value
    : "left";
}

function normalizeCard(card) {
  if (!card || typeof card !== "object") return card;
  card.frameLine = normalizeFrameLine(card.frameLine);
  card.groupId = card.groupId || null;
  card.type = card.type || "frame";
  return card;
}

function normalizeConnection(conn) {
  if (!conn || typeof conn !== "object") return conn;
  conn.layer = conn.layer === "back" ? "back" : "front";
  return conn;
}

function isCardDragBlockedTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest(
    "input, textarea, button, a, [contenteditable='true'], .card-pin-btn, .card-toolbar, .resize-handle, .block-link-input, .block-link, .block-controls, .block-drag-handle, .block-del",
  );
}

function setFrameDragActive(active) {
  $canvas.classList.toggle("dragging-frame", !!active);
}

function injectInteractionStyles() {
  var style = document.createElement("style");
  style.textContent = `
      #canvas.panning { cursor: grabbing; }
      #canvas.dragging-frame { cursor: grabbing; }
      #canvas.dragging-frame .card,
      #canvas.dragging-frame .card-header,
      #canvas.dragging-frame .card-body {
        cursor: grabbing;
      }
      body.panel-resizing,
      body.panel-resizing * {
        user-select: none !important;
        cursor: col-resize !important;
      }
      #left-panel,
      #right-panel {
        position: relative;
      }
      .panel-resize-handle {
        position: absolute;
        top: 0;
        width: 10px;
        height: 100%;
        z-index: 40;
        cursor: col-resize;
        touch-action: none;
        background: transparent;
      }
      .panel-resize-handle::before {
        content: "";
        position: absolute;
        top: 10px;
        bottom: 10px;
        left: 50%;
        width: 1px;
        transform: translateX(-50%);
        background: rgba(255,255,255,0.12);
        opacity: 0;
        transition: opacity .12s ease;
      }
      .panel-resize-handle:hover::before,
      .panel-resize-handle.active::before {
        opacity: 1;
      }
      #left-panel .panel-resize-handle {
        right: -5px;
      }
      #right-panel .panel-resize-handle {
        left: -5px;
      }
      .panel-resize-handle.hidden {
        display: none;
      }
      #btn-undo:disabled,
      #btn-redo:disabled {
        opacity: 0.35;
        pointer-events: none;
      }
    `;
  document.head.appendChild(style);
}

function getSelectedIdsArray() {
  return [...selectedIds];
}

function syncSelectedCardClasses() {
  $world.querySelectorAll(".card").forEach((el) => {
    el.classList.toggle("selected", selectedIds.has(el.dataset.cardId));
  });
  $frameList.querySelectorAll(".frame-row").forEach((el) => {
    el.classList.toggle("selected", selectedIds.has(el.dataset.cardId));
  });
}

function clearSelectionPreview() {
  $world
    .querySelectorAll(".card.selection-preview")
    .forEach((el) => el.classList.remove("selection-preview"));
  $frameList
    .querySelectorAll(".frame-row.selection-preview")
    .forEach((el) => el.classList.remove("selection-preview"));
}

function updateInspectorLockMessage(msg) {
  var p = $inspectorEmpty.querySelector("p");
  if (p) p.textContent = msg;
  $inspectorEmpty.classList.toggle("multi-lock", !!msg);
}

/* ====================================================
     MARKDOWN PREVIEW SYNC HOOKS
     ==================================================== */
function bindMarkdownFields() {
  if (
    window.LoomMarkdown &&
    typeof window.LoomMarkdown.syncAll === "function"
  ) {
    window.LoomMarkdown.syncAll();
  }
}

function syncMarkdownPreviews() {
  if (
    window.LoomMarkdown &&
    typeof window.LoomMarkdown.refreshAll === "function"
  ) {
    window.LoomMarkdown.refreshAll();
  }
}

/* ====================================================
     NEW GROUP FUNCTIONALY (BORDERS, UNLOAD)
     ========================================================== */
function getGroup(id) {
  return state.groups.find((g) => g.id === id);
}

function isCardHidden(card) {
  if (!card.groupId) return false;
  var group = getGroup(card.groupId);
  return group ? !!group.hidden : false;
}

function getGroupCardsBounds(group) {
  var cards = state.cards.filter((c) => c.groupId === group.id);
  if (cards.length === 0) return null;
  var minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  cards.forEach(function (c) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  });
  return { minX, minY, maxX, maxY };
}

/* ====================================================
     PERSIST
     ==================================================== */
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("Could not save — storage may be full");
  }
}

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.cards)) {
        state = Object.assign(DEFAULT_STATE(), parsed);
        if (!Array.isArray(state.connections)) state.connections = [];
        if (!Array.isArray(state.groups)) state.groups = [];
        if (Array.isArray(state.groups)) {
          state.groups.forEach(function (g) {
            g.hidden = g.hidden === true;
            g.showBorder = g.showBorder === true;
          });
        }
        state.cards = state.cards.map(normalizeCard);
        state.connections = state.connections.map(normalizeConnection);
        state.layout = normalizeLayout(state.layout);
      }
    }
  } catch {
    /* ignore */
  }
}

/* ====================================================
     TOAST
     ==================================================== */
var toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2400);
}

/* ====================================================
     UNDO / REDO
     ----------------------------------------------------
     Snapshot-based history. Each call to pushHistory()
     captures the complete current state (minus view/layout,
     which are kept as-is on restore so the camera doesn't
     jump). Debounced variants are used for rapid-fire text
     input so every keystroke doesn't create a history entry.

     Keyboard shortcuts:
       Ctrl+Z          – undo
       Ctrl+Y          – redo
       Ctrl+Shift+Z    – redo (alternate)
     ==================================================== */
function cloneStateForHistory() {
  return JSON.parse(JSON.stringify(state));
}

function pushHistory() {
  // Flush and cancel any pending debounced push
  clearTimeout(historyDebounceTimer);
  historyDebounceTimer = null;

  // Discard future states (redo branch)
  historyStack = historyStack.slice(0, historyIndex + 1);

  // Snapshot current state
  historyStack.push(cloneStateForHistory());

  // Enforce size limit (remove oldest, keep index pointing at newest)
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
    // historyIndex stays the same — we removed from the front, added to the back
  } else {
    historyIndex = historyStack.length - 1;
  }

  syncUndoRedoButtons();
}

function pushHistoryDebounced() {
  clearTimeout(historyDebounceTimer);
  historyDebounceTimer = setTimeout(() => {
    historyDebounceTimer = null;
    pushHistory();
  }, 700);
}

/**
 * If a debounced push is pending, flush it immediately so that a
 * subsequent destructive action (delete, clear, etc.) is recorded
 * as a SEPARATE undo step rather than merging into the next push.
 */
function flushHistoryDebounce() {
  if (historyDebounceTimer !== null) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;
    pushHistory();
  }
}

function clearHistory() {
  clearTimeout(historyDebounceTimer);
  historyDebounceTimer = null;
  historyStack = [];
  historyIndex = -1;
  syncUndoRedoButtons();
}

function syncUndoRedoButtons() {
  var undoBtn = document.getElementById("btn-undo");
  var redoBtn = document.getElementById("btn-redo");
  var isView = mode === "view";
  if (undoBtn) undoBtn.disabled = isView || historyIndex <= 0;
  if (redoBtn)
    redoBtn.disabled = isView || historyIndex >= historyStack.length - 1;
}

function restoreFromHistory() {
  var snap = historyStack[historyIndex];
  if (!snap) return;

  // Preserve camera and panel layout across undo/redo
  var currentView = JSON.parse(JSON.stringify(state.view));
  var currentLayout = JSON.parse(JSON.stringify(state.layout));

  state = JSON.parse(JSON.stringify(snap));
  state.view = currentView;
  state.layout = currentLayout;
  state.cards = state.cards.map(normalizeCard);
  state.connections = state.connections.map(normalizeConnection);

  clearSelection();
  applyProjectName();
  applyView();
  renderAll();
  save();
  syncUndoRedoButtons();
}

function undo() {
  if (mode === "view") return;
  // Flush any pending text edit so it becomes its own history entry
  flushHistoryDebounce();
  if (historyIndex <= 0) {
    toast("Nothing to undo");
    return;
  }
  historyIndex--;
  restoreFromHistory();
  toast("Undone");
}

function redo() {
  if (mode === "view") return;
  if (historyIndex >= historyStack.length - 1) {
    toast("Nothing to redo");
    return;
  }
  historyIndex++;
  restoreFromHistory();
  toast("Redone");
}

/**
 * Inject Undo / Redo buttons into the top bar, right after
 * #btn-new-frame. Safe to call multiple times (no-op if already done).
 */
function injectUndoRedoButtons() {
  if (document.getElementById("btn-undo")) return;
  var newFrameBtn = document.getElementById("btn-new-frame");
  if (!newFrameBtn) return;

  var undoBtn = document.createElement("button");
  undoBtn.id = "btn-undo";
  undoBtn.type = "button";
  undoBtn.setAttribute("aria-label", "Undo");
  undoBtn.dataset.tooltip = "Undo (Ctrl+Z)";
  undoBtn.innerHTML = `<span aria-hidden="true">↩</span><span>Undo</span>`;
  undoBtn.disabled = true;
  undoBtn.addEventListener("click", undo);

  var redoBtn = document.createElement("button");
  redoBtn.id = "btn-redo";
  redoBtn.type = "button";
  redoBtn.setAttribute("aria-label", "Redo");
  redoBtn.dataset.tooltip = "Redo (Ctrl+Y / Ctrl+Shift+Z)";
  redoBtn.innerHTML = `<span aria-hidden="true">↪</span><span>Redo</span>`;
  redoBtn.disabled = true;
  redoBtn.addEventListener("click", redo);

  // Insert both buttons immediately after the New Frame button
  newFrameBtn.after(undoBtn, redoBtn);
}

/* ====================================================
     CUSTOM TOOLTIP
     ==================================================== */
var tipTimer = null;
var tipTarget = null;
function initTooltips() {
  document.addEventListener("mouseover", (e) => {
    var el = e.target.closest("[data-tooltip]");
    if (!el || el === tipTarget) return;
    tipTarget = el;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      var rect = el.getBoundingClientRect();
      $tooltip.textContent = el.dataset.tooltip;
      $tooltip.style.left = Math.round(rect.left + rect.width / 2) + "px";
      $tooltip.style.top = Math.round(rect.bottom + 8) + "px";
      $tooltip.classList.add("show");
    }, 500);
  });
  document.addEventListener("mouseout", (e) => {
    var el = e.target.closest("[data-tooltip]");
    if (!el) return;
    tipTarget = null;
    clearTimeout(tipTimer);
    $tooltip.classList.remove("show");
  });
  document.addEventListener(
    "click",
    () => {
      clearTimeout(tipTimer);
      $tooltip.classList.remove("show");
      tipTarget = null;
    },
    true,
  );
}

/* ====================================================
     CONTROL TOOLTIPS
     ----------------------------------------------------
     Ctrl+Drag has two distinct behaviours depending on what
     you're dragging:
       • Canvas background → pan the viewport
       • A frame           → drag with snap-alignment to other
                             frames' edges/centres and the
                             world origin

     Space is no longer used for panning (legacy label fixed).
     Undo/Redo shortcuts are also surfaced here so the canvas
     tooltip acts as a quick-reference for all key controls.

     NOTE: If your app has a separate HTML "Controls" modal or
     help panel that lists keyboard shortcuts, update it to
     match this text — particularly replacing any "Space + Drag"
     labels with "Ctrl + Drag canvas" for panning.
     ==================================================== */
function applyControlTooltips() {
  if ($canvas) {
    $canvas.dataset.tooltip =
      "Ctrl + Drag canvas to pan" +
      " \u00b7 Ctrl + Drag a frame to snap-align its edges" +
      " \u00b7 Scroll to zoom" +
      " \u00b7 Drag canvas to box-select" +
      " \u00b7 Ctrl+Z to undo \u00b7 Ctrl+Y to redo" +
      " \u00b7 Ctrl+Shift+P to toggle frame previews";
  }
}

/* ====================================================
     MODE DROPDOWN
     ==================================================== */
function initModeDropdown() {
  $modeDDBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    var open = !$modeDDMenu.classList.contains("open");
    $modeDDMenu.classList.toggle("open", open);
    $modeDDBtn.setAttribute("aria-expanded", String(open));
  });
  $modeDDMenu.querySelectorAll(".mode-dropdown-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      setMode(opt.dataset.value);
      closeModeDropdown();
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#mode-dropdown")) closeModeDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModeDropdown();
      closeGroupContextMenu();
    }
  });
}

function closeModeDropdown() {
  $modeDDMenu.classList.remove("open");
  $modeDDBtn.setAttribute("aria-expanded", "false");
}

function syncModeDropdown() {
  $modeDDLabel.textContent = mode === "view" ? "View Mode" : "Edit Mode";
  $modeDDBtn.dataset.mode = mode;
  $modeDDMenu.querySelectorAll(".mode-dropdown-option").forEach((opt) => {
    var sel = opt.dataset.value === mode;
    opt.classList.toggle("selected", sel);
    opt.setAttribute("aria-selected", String(sel));
  });
}

function setMode(newMode) {
  closeModeDropdown();
  var next = newMode === "view" ? "view" : "edit";
  var changed = next !== mode;
  mode = next;
  document.body.classList.toggle("view-mode", mode === "view");
  syncModeDropdown();
  $projectTitle.readOnly = mode === "view";
  renderWorld();
  renderFrameList();
  renderInspector();
  // Undo/redo is locked in view mode
  syncUndoRedoButtons();
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  if (changed)
    toast(mode === "view" ? "View mode — editing locked" : "Edit mode enabled");
}

function applyInspectorMode() {
  var disabled =
    mode === "view" ||
    selectedIds.size > 1 ||
    !!selectionBox ||
    !!panCtx?.active ||
    !!groupDragCtx?.active;
  $inspTitle.disabled = disabled;
  $inspNotes.disabled = disabled;
  if ($inspFrameLine) {
    $inspFrameLineButtons.forEach((btn) => {
      btn.disabled = disabled;
    });
    $inspFrameLine.dataset.disabled = String(disabled);
  }
  $inspX.disabled = disabled;
  $inspY.disabled = disabled;
  $inspW.disabled = disabled;
  $inspH.disabled = disabled;
}

/* ====================================================
     SIDE PANEL RESIZING
     ==================================================== */
var panelResizeCtx = null;
var $leftPanelHandle = null;
var $rightPanelHandle = null;

function clampPanelWidths(leftWidth, rightWidth) {
  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var usable = Math.max(PANEL_MIN_WIDTH * 2, vw - PANEL_MIN_CANVAS_WIDTH);

  var left = clampNumber(leftWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 252);
  var right = clampNumber(rightWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 252);

  var total = left + right;
  if (total > usable) {
    var overflow = total - usable;
    var takeFromRight = Math.min(overflow, right - PANEL_MIN_WIDTH);
    right -= takeFromRight;
    var remaining = overflow - takeFromRight;
    left = Math.max(PANEL_MIN_WIDTH, left - remaining);
  }

  return {
    leftPanelWidth: Math.round(Math.min(PANEL_MAX_WIDTH, left)),
    rightPanelWidth: Math.round(Math.min(PANEL_MAX_WIDTH, right)),
  };
}

function getPanelLayoutForViewport() {
  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var normalized = normalizeLayout(state.layout);

  if (vw <= PANEL_MOBILE_BREAKPOINT) {
    return {
      leftPanelWidth: 0,
      rightPanelWidth: 230,
      mobile: true,
    };
  }

  var widths = clampPanelWidths(
    normalized.leftPanelWidth,
    normalized.rightPanelWidth,
  );
  return { ...widths, mobile: false };
}

function applyPanelLayout() {
  if (!$leftPanel || !$rightPanel) return;

  var layout = getPanelLayoutForViewport();
  var isMobile = layout.mobile;

  if (isMobile) {
    $leftPanel.style.display = "none";
    $leftPanel.style.width = "";
    $leftPanel.style.flexBasis = "";
    $rightPanel.style.display = "";
    $rightPanel.style.width = "230px";
    $rightPanel.style.flexBasis = "230px";
    $rightPanel.style.flexShrink = "0";
  } else {
    $leftPanel.style.display = "";
    $rightPanel.style.display = "";
    $leftPanel.style.width = layout.leftPanelWidth + "px";
    $leftPanel.style.flexBasis = layout.leftPanelWidth + "px";
    $rightPanel.style.width = layout.rightPanelWidth + "px";
    $rightPanel.style.flexBasis = layout.rightPanelWidth + "px";
    $leftPanel.style.flexShrink = "0";
    $rightPanel.style.flexShrink = "0";
    state.layout = {
      leftPanelWidth: layout.leftPanelWidth,
      rightPanelWidth: layout.rightPanelWidth,
    };
  }

  if ($leftPanelHandle) $leftPanelHandle.classList.toggle("hidden", isMobile);
  if ($rightPanelHandle) $rightPanelHandle.classList.toggle("hidden", isMobile);

  if (panelResizeCtx?.active && isMobile) {
    endPanelResize();
  }

  resizeSVG();
}

function ensurePanelResizers() {
  if ($leftPanel && !$leftPanelHandle) {
    $leftPanelHandle = document.createElement("div");
    $leftPanelHandle.className = "panel-resize-handle";
    $leftPanelHandle.dataset.side = "left";
    $leftPanelHandle.setAttribute("aria-hidden", "true");
    $leftPanel.appendChild($leftPanelHandle);
    $leftPanelHandle.addEventListener("pointerdown", (e) =>
      startPanelResize("left", e),
    );
  }

  if ($rightPanel && !$rightPanelHandle) {
    $rightPanelHandle = document.createElement("div");
    $rightPanelHandle.className = "panel-resize-handle";
    $rightPanelHandle.dataset.side = "right";
    $rightPanelHandle.setAttribute("aria-hidden", "true");
    $rightPanel.appendChild($rightPanelHandle);
    $rightPanelHandle.addEventListener("pointerdown", (e) =>
      startPanelResize("right", e),
    );
  }

  applyPanelLayout();
}

function startPanelResize(side, e) {
  if (mode === "view") return;
  if ((window.innerWidth || 0) <= PANEL_MOBILE_BREAKPOINT) return;
  if (!side || panelResizeCtx?.active) return;

  e.preventDefault();
  e.stopPropagation();

  var layout = normalizeLayout(state.layout);
  panelResizeCtx = {
    active: true,
    side,
    startX: e.clientX,
    startLeft: layout.leftPanelWidth,
    startRight: layout.rightPanelWidth,
  };

  document.body.classList.add("panel-resizing");
  if (side === "left" && $leftPanelHandle)
    $leftPanelHandle.classList.add("active");
  if (side === "right" && $rightPanelHandle)
    $rightPanelHandle.classList.add("active");

  try {
    (side === "left" ? $leftPanelHandle : $rightPanelHandle)?.setPointerCapture(
      e.pointerId,
    );
  } catch {
    /* ignore */
  }

  window.addEventListener("pointermove", onPanelResizeMove);
  window.addEventListener("pointerup", onPanelResizeUp, { once: true });
  window.addEventListener("pointercancel", onPanelResizeUp, { once: true });
}

function onPanelResizeMove(e) {
  if (!panelResizeCtx?.active) return;
  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  if (vw <= PANEL_MOBILE_BREAKPOINT) return;

  var delta = e.clientX - panelResizeCtx.startX;
  var nextLeft = panelResizeCtx.startLeft;
  var nextRight = panelResizeCtx.startRight;

  if (panelResizeCtx.side === "left") {
    nextLeft = panelResizeCtx.startLeft + delta;
  } else {
    nextRight = panelResizeCtx.startRight - delta;
  }

  var clamped = clampPanelWidths(nextLeft, nextRight);
  state.layout.leftPanelWidth = clamped.leftPanelWidth;
  state.layout.rightPanelWidth = clamped.rightPanelWidth;
  applyPanelLayout();
}

function endPanelResize() {
  window.removeEventListener("pointermove", onPanelResizeMove);
  document.body.classList.remove("panel-resizing");
  if ($leftPanelHandle) $leftPanelHandle.classList.remove("active");
  if ($rightPanelHandle) $rightPanelHandle.classList.remove("active");
  panelResizeCtx = null;
}

function onPanelResizeUp() {
  if (!panelResizeCtx?.active) return;
  endPanelResize();
  save();
}

/* ====================================================
     SVG LAYER
     ==================================================== */
function buildConnDefs(suffix) {
  var defs = svgEl("defs");

  defs.innerHTML = `
      <filter id="loom-sf${suffix}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur"/>
        <feFlood flood-color="#c89040" flood-opacity="0.45" result="gc"/>
        <feComposite in="gc" in2="blur" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="loom-pf${suffix}" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur"/>
        <feFlood flood-color="#e89a42" flood-opacity="0.55" result="gc"/>
        <feComposite in="gc" in2="blur" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    `;
  return defs;
}

function buildOriginOrb() {
  var g = svgEl("g");
  g.classList.add("world-origin-orb");
  g.style.pointerEvents = "none";
  g.appendChild(
    svgEl("circle", {
      cx: WORLD_ORIGIN.x,
      cy: WORLD_ORIGIN.y,
      r: 22,
      fill: ACCENT_VAR,
      opacity: "0.06",
    }),
  );
  g.appendChild(
    svgEl("circle", {
      cx: WORLD_ORIGIN.x,
      cy: WORLD_ORIGIN.y,
      r: 10,
      fill: ACCENT_VAR,
      opacity: "0.14",
    }),
  );
  g.appendChild(
    svgEl("circle", {
      cx: WORLD_ORIGIN.x,
      cy: WORLD_ORIGIN.y,
      r: 3.5,
      fill: ACCENT_VAR,
      opacity: "0.55",
    }),
  );
  return g;
}

function initSVG() {
  $svgBack = svgEl("svg");
  $svgBack.id = "conn-svg-back";
  $svgBack.style.position = "absolute";
  $svgBack.style.left = "0";
  $svgBack.style.top = "0";
  $svgBack.style.overflow = "visible";
  $svgBack.style.pointerEvents = "none";
  $svgBack.style.zIndex = "-1";
  $svgBack.appendChild(buildConnDefs("-back"));
  $svgBack.appendChild(buildOriginOrb());

  $svg = svgEl("svg");
  $svg.id = "conn-svg";
  $svg.style.position = "absolute";
  $svg.style.left = "0";
  $svg.style.top = "0";
  $svg.style.overflow = "visible";
  $svg.style.pointerEvents = "none";
  $svg.style.zIndex = "50";
  $svg.appendChild(buildConnDefs(""));

  $world.prepend($svg);
  $world.prepend($svgBack);
  resizeSVG();
}

/**
 * Size both SVG layers so their viewBox covers the full card area in
 * world coordinates, then position the SVG elements to match.
 *
 * WHY: connection paths are drawn in world-space coordinates.  The old
 * approach used a screen-sized viewBox (0 0 canvasW canvasH) and relied
 * on overflow:visible to show paths outside that region.  Browsers are
 * fine with that, but html2canvas clips SVG content to the declared
 * viewBox, so anything outside the top-left screen-sized chunk of the
 * board simply disappeared in exports.  By making the viewBox match the
 * actual card extent the paths are always inside it — no overflow needed.
 *
 * The CSS left/top of each SVG element is set to (minX-pad, minY-pad)
 * so that SVG coordinate (x, y) maps to world position (x, y) regardless
 * of where the viewBox origin sits.  overflow:visible is kept so snap
 * guides and the origin orb can still extend beyond the card region.
 */
function resizeSVG() {
  if (!$svg) return;
  var bounds = getCardsBounds();
  var vbX, vbY, vbW, vbH;

  if (bounds) {
    var pad = 120;
    vbX = bounds.minX - pad;
    vbY = bounds.minY - pad;
    vbW = bounds.maxX - bounds.minX + pad * 2;
    vbH = bounds.maxY - bounds.minY + pad * 2;
  } else {
    // No cards yet — fall back to screen dimensions at the origin.
    var rect = $canvas.getBoundingClientRect();
    vbX = 0;
    vbY = 0;
    vbW = rect.width;
    vbH = rect.height;
  }

  [$svg, $svgBack].forEach(function (s) {
    if (!s) return;
    s.setAttribute("width", vbW);
    s.setAttribute("height", vbH);
    s.setAttribute("viewBox", vbX + " " + vbY + " " + vbW + " " + vbH);
    s.style.left = vbX + "px";
    s.style.top = vbY + "px";
  });
}

/* ====================================================
     CONNECTION HELPERS
     ==================================================== */
function getConnPoint(card) {
  return { x: card.x + card.w / 2, y: card.y + 8 };
}

function hasParent(cardId) {
  return state.connections.some((c) => c.toId === cardId);
}

function wouldCreateCycle(fromId, toId) {
  var visited = new Set();
  var cur = fromId;
  while (cur) {
    if (cur === toId) return true;
    if (visited.has(cur)) break;
    visited.add(cur);
    var p = state.connections.find((c) => c.toId === cur);
    cur = p ? p.fromId : null;
  }
  return false;
}

function deleteConnection(id) {
  flushHistoryDebounce();
  state.connections = state.connections.filter((c) => c.id !== id);
  renderFrameList();
  renderConnections();
  pushHistory();
  save();
  toast("Connection removed");
}

function restBelly(fp, tp) {
  var dx = tp.x - fp.x;
  var dy = tp.y - fp.y;
  var dist = Math.hypot(dx, dy);
  return {
    x: (fp.x + tp.x) / 2,
    y: (fp.y + tp.y) / 2 + dist * 0.28 + 36,
  };
}

function createTack(x, y, opts = {}) {
  var suffix = opts.filterSuffix || "";
  var g = svgEl("g");
  if (opts.pop) g.classList.add("tack-pop");
  g.appendChild(
    svgEl("circle", {
      cx: x,
      cy: y,
      r: "5.5",
      fill: "#a06828",
      filter: `url(#loom-pf${suffix})`,
    }),
  );
  g.appendChild(
    svgEl("circle", {
      cx: x,
      cy: y,
      r: "4.5",
      fill: "#d4893c",
      stroke: "rgba(255,255,255,0.5)",
      "stroke-width": "1",
    }),
  );
  g.appendChild(
    svgEl("circle", {
      cx: x - 1.3,
      cy: y - 1.3,
      r: "1.6",
      fill: "rgba(255,255,255,0.42)",
    }),
  );
  return g;
}

function buildThreadPaths(d, filterSuffix = "") {
  var hit = svgEl("path", {
    d,
    fill: "none",
    stroke: "transparent",
    "stroke-width": "16",
  });
  hit.classList.add("conn-hit");
  hit.style.pointerEvents = "stroke";
  hit.style.cursor = "pointer";
  var shadow = svgEl("path", {
    d,
    fill: "none",
    stroke: "rgba(0,0,0,0.45)",
    "stroke-width": "3",
    "stroke-linecap": "round",
  });
  shadow.classList.add("conn-shadow");
  var thread = svgEl("path", {
    d,
    fill: "none",
    stroke: "rgba(228,190,112,0.9)",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    filter: `url(#loom-sf${filterSuffix})`,
  });
  thread.classList.add("conn-thread");
  var shimmer = svgEl("path", {
    d,
    fill: "none",
    stroke: "rgba(255,242,190,0.28)",
    "stroke-width": "0.7",
    "stroke-dasharray": "2 14",
    "stroke-linecap": "round",
  });
  shimmer.classList.add("conn-shimmer");
  return { hit, shadow, thread, shimmer };
}

/* ====================================================
     FRAME SNAPPING (Ctrl + Drag a frame)
     ==================================================== */
function collectSnapLines(excludeIds) {
  var vLines = [];
  var hLines = [];
  state.cards.forEach((c) => {
    if (excludeIds.has(c.id)) return;
    vLines.push(c.x, c.x + c.w / 2, c.x + c.w);
    hLines.push(c.y, c.y + c.h / 2, c.y + c.h);
  });
  vLines.push(WORLD_ORIGIN.x);
  hLines.push(WORLD_ORIGIN.y);
  return { vLines, hLines };
}

function computeCardSnap(freeX, freeY, w, h, vLines, hLines, thresholdWorld) {
  var candX = [freeX, freeX + w / 2, freeX + w];
  var candY = [freeY, freeY + h / 2, freeY + h];

  var bestDX = null;
  var bestVLine = null;
  candX.forEach((cx) => {
    vLines.forEach((lx) => {
      var d = lx - cx;
      if (
        Math.abs(d) <= thresholdWorld &&
        (bestDX === null || Math.abs(d) < Math.abs(bestDX))
      ) {
        bestDX = d;
        bestVLine = lx;
      }
    });
  });

  var bestDY = null;
  var bestHLine = null;
  candY.forEach((cy) => {
    hLines.forEach((ly) => {
      var d = ly - cy;
      if (
        Math.abs(d) <= thresholdWorld &&
        (bestDY === null || Math.abs(d) < Math.abs(bestDY))
      ) {
        bestDY = d;
        bestHLine = ly;
      }
    });
  });

  return {
    dx: bestDX || 0,
    dy: bestDY || 0,
    vLine: bestVLine,
    hLine: bestHLine,
  };
}

function drawSnapGuides(vLine, hLine) {
  if (!$svg) return;
  if (vLine === null && hLine === null) return;

  var rect = $canvas.getBoundingClientRect();
  var tl = screenToWorld(rect.left, rect.top);
  var br = screenToWorld(rect.right, rect.bottom);
  var sw = Math.max(1, 1.4 / state.view.scale);
  var dash = `${4 / state.view.scale} ${4 / state.view.scale}`;

  var g = svgEl("g");
  g.classList.add("snap-guides");
  g.style.pointerEvents = "none";

  if (vLine !== null) {
    g.appendChild(
      svgEl("line", {
        x1: vLine,
        y1: tl.y - 4000,
        x2: vLine,
        y2: br.y + 4000,
        stroke: ACCENT_VAR,
        "stroke-width": sw,
        "stroke-dasharray": dash,
        opacity: "0.85",
      }),
    );
  }
  if (hLine !== null) {
    g.appendChild(
      svgEl("line", {
        x1: tl.x - 4000,
        y1: hLine,
        x2: br.x + 4000,
        y2: hLine,
        stroke: ACCENT_VAR,
        "stroke-width": sw,
        "stroke-dasharray": dash,
        opacity: "0.85",
      }),
    );
  }

  $svg.appendChild(g);
}

/* ====================================================
     CONNECTING DRAG STATE
     ==================================================== */
var connDrag = null;
var connAnimId = null;
var belly = { x: 0, y: 0, vx: 0, vy: 0 };
var settleAnim = null;

function startConnectionDrag(e, card) {
  if (mode === "view") return;
  e.stopPropagation();
  e.preventDefault();

  $svg.classList.add("dragging");
  if ($svgBack) $svgBack.classList.add("dragging");

  var wm = screenToWorld(e.clientX, e.clientY);
  connDrag = {
    fromId: card.id,
    mouseX: wm.x,
    mouseY: wm.y,
    targetId: null,
    hoverInvalid: false,
  };

  var fp = getConnPoint(card);
  belly.x = fp.x;
  belly.y = fp.y;
  belly.vx = 0;
  belly.vy = 0;

  window.addEventListener("pointermove", onConnDragMove);
  window.addEventListener("pointerup", onConnDragUp, { once: true });
  window.addEventListener("pointercancel", onConnDragUp, { once: true });

  cancelAnimationFrame(connAnimId);
  connAnimId = requestAnimationFrame(animConnDrag);
}

function onConnDragMove(e) {
  if (!connDrag) return;
  var wm = screenToWorld(e.clientX, e.clientY);
  connDrag.mouseX = wm.x;
  connDrag.mouseY = wm.y;

  var el = document.elementFromPoint(e.clientX, e.clientY);
  var cardEl = el && el.closest(".card");
  var hovId = cardEl ? cardEl.dataset.cardId : null;

  var validTarget = null;
  var hoverInvalid = false;

  if (hovId && hovId !== connDrag.fromId) {
    var alreadyLinked = state.connections.some(
      (c) => c.fromId === connDrag.fromId && c.toId === hovId,
    );
    if (
      alreadyLinked ||
      hasParent(hovId) ||
      wouldCreateCycle(connDrag.fromId, hovId)
    )
      hoverInvalid = true;
    else validTarget = hovId;
  }

  connDrag.targetId = validTarget;
  connDrag.hoverInvalid = hoverInvalid;

  $world.querySelectorAll(".card").forEach((c) => {
    c.classList.toggle("conn-target", c.dataset.cardId === validTarget);
    c.classList.toggle(
      "conn-invalid",
      hoverInvalid && c.dataset.cardId === hovId,
    );
  });
}

function onConnDragUp() {
  $svg.classList.remove("dragging");
  if ($svgBack) $svgBack.classList.remove("dragging");
  window.removeEventListener("pointermove", onConnDragMove);
  cancelAnimationFrame(connAnimId);
  connAnimId = null;

  $world
    .querySelectorAll(".card.conn-target, .card.conn-invalid")
    .forEach((c) => c.classList.remove("conn-target", "conn-invalid"));

  var linkedConn = null;
  if (connDrag && connDrag.targetId) {
    var fromCard = getCard(connDrag.fromId);
    var toCard = getCard(connDrag.targetId);
    if (fromCard && toCard) {
      linkedConn = {
        id: uid(),
        fromId: connDrag.fromId,
        toId: connDrag.targetId,
        layer: "front",
      };
      state.connections.push(linkedConn);

      // Inherit group from parent to child and descendants
      if (fromCard && toCard) {
        var parentGroup = fromCard.groupId;
        var childAndDescendants = [toCard.id, ...getAllDescendants(toCard.id)];
        childAndDescendants.forEach(function (id) {
          var c = getCard(id);
          if (c) c.groupId = parentGroup;
        });
      }

      renderFrameList();
      pushHistory();
      save();
    }
  } else if (connDrag && connDrag.hoverInvalid) {
    toast("Cannot link — frame already has a parent or would create a cycle");
  }

  var lastBellyX = belly.x;
  var lastBellyY = belly.y;
  connDrag = null;

  if (linkedConn) {
    var fromCard = getCard(linkedConn.fromId);
    var toCard = getCard(linkedConn.toId);
    if (fromCard && toCard)
      startSettleAnim(linkedConn.id, fromCard, toCard, lastBellyX, lastBellyY);
  }

  renderConnections();
}

function animConnDrag() {
  if (!connDrag) return;
  var fromCard = getCard(connDrag.fromId);
  if (!fromCard) return;

  var fp = getConnPoint(fromCard);
  var { mouseX, mouseY } = connDrag;
  var dx = mouseX - fp.x;
  var dy = mouseY - fp.y;
  var dist = Math.hypot(dx, dy);

  var targetX = (fp.x + mouseX) / 2;
  var targetY = (fp.y + mouseY) / 2 + dist * 0.28 + 36;

  var k = 0.09;
  var grav = 1.5;
  var damp = 0.86;

  belly.vx += (targetX - belly.x) * k;
  belly.vy += (targetY - belly.y) * k + grav;
  belly.vx *= damp;
  belly.vy *= damp;
  belly.x += belly.vx;
  belly.y += belly.vy;

  renderConnections();
  connAnimId = requestAnimationFrame(animConnDrag);
}

function easeOutBack(t) {
  var c1 = 1.7,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function startSettleAnim(connId, fromCard, toCard, startX, startY) {
  var fp = getConnPoint(fromCard);
  var tp = getConnPoint(toCard);
  var end = restBelly(fp, tp);
  settleAnim = {
    connId,
    startX,
    startY,
    endX: end.x,
    endY: end.y,
    curX: startX,
    curY: startY,
    startTime: performance.now(),
    duration: 380,
  };
  requestAnimationFrame(stepSettleAnim);
}

function stepSettleAnim(now) {
  if (!settleAnim) return;
  var t = Math.min(1, (now - settleAnim.startTime) / settleAnim.duration);
  var eased = easeOutBack(t);
  settleAnim.curX =
    settleAnim.startX + (settleAnim.endX - settleAnim.startX) * eased;
  settleAnim.curY =
    settleAnim.startY + (settleAnim.endY - settleAnim.startY) * eased;
  renderConnections();
  if (t < 1) requestAnimationFrame(stepSettleAnim);
  else {
    settleAnim = null;
    renderConnections();
  }
}

function renderStaticString(conn, from, to, targetSvg) {
  var svgTarget = targetSvg || $svg;
  var isBack = svgTarget === $svgBack;
  var filterSuffix = isBack ? "-back" : "";

  var fp = getConnPoint(from);
  var tp = getConnPoint(to);
  var bellyPt = restBelly(fp, tp);
  var d = `M ${fp.x} ${fp.y} Q ${bellyPt.x} ${bellyPt.y} ${tp.x} ${tp.y}`;

  var g = svgEl("g");
  g.classList.add("conn-group");
  g.dataset.connId = conn.id;

  var { hit, shadow, thread, shimmer } = buildThreadPaths(d, filterSuffix);
  if (mode !== "view") {
    hit.setAttribute(
      "data-tooltip",
      "Click to cut \u00b7 Right-click for options",
    );
  }

  hit.addEventListener("click", (e) => {
    e.stopPropagation();
    if (mode === "view") return;
    deleteConnection(conn.id);
  });
  hit.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === "view") return;
    openConnContextMenu(e, conn);
  });

  [hit, shadow, thread, shimmer].forEach((el) => g.appendChild(el));
  g.appendChild(createTack(fp.x, fp.y, { filterSuffix }));
  g.appendChild(createTack(tp.x, tp.y, { filterSuffix }));
  svgTarget.appendChild(g);
}

function renderSettlingString(conn, from, to, targetSvg) {
  var svgTarget = targetSvg || $svg;
  var isBack = svgTarget === $svgBack;
  var filterSuffix = isBack ? "-back" : "";

  var fp = getConnPoint(from);
  var tp = getConnPoint(to);
  var d = `M ${fp.x} ${fp.y} Q ${settleAnim.curX} ${settleAnim.curY} ${tp.x} ${tp.y}`;
  var g = svgEl("g");
  g.classList.add("conn-group");
  g.dataset.connId = conn.id;
  var { hit, shadow, thread, shimmer } = buildThreadPaths(d, filterSuffix);
  hit.style.pointerEvents = "none";
  [shadow, thread, shimmer, hit].forEach((el) => g.appendChild(el));
  g.appendChild(createTack(fp.x, fp.y, { filterSuffix }));
  g.appendChild(createTack(tp.x, tp.y, { pop: true, filterSuffix }));
  svgTarget.appendChild(g);
}

function renderDragString() {
  var fromCard = getCard(connDrag.fromId);
  if (!fromCard) return;

  var fp = getConnPoint(fromCard);
  var { mouseX, mouseY, targetId, hoverInvalid } = connDrag;
  var d = `M ${fp.x} ${fp.y} Q ${belly.x} ${belly.y} ${mouseX} ${mouseY}`;

  var isValid = !!targetId;
  var isInvalid = hoverInvalid && !isValid;
  var color = isValid
    ? "rgba(111,227,200,0.85)"
    : isInvalid
      ? "rgba(255,123,114,0.75)"
      : "rgba(228,190,112,0.62)";
  var dash = isValid ? "none" : "7 5";

  var shadow = svgEl("path", {
    d,
    fill: "none",
    stroke: "rgba(0,0,0,0.3)",
    "stroke-width": "2.5",
    "stroke-linecap": "round",
  });
  var thread = svgEl("path", {
    d,
    fill: "none",
    stroke: color,
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-dasharray": dash,
    filter: "url(#loom-sf)",
  });
  var endCircle = svgEl("circle", {
    cx: mouseX,
    cy: mouseY,
    r: "5",
    fill: isValid
      ? "rgba(111,227,200,0.55)"
      : isInvalid
        ? "rgba(255,123,114,0.45)"
        : "rgba(228,190,112,0.4)",
    stroke: "rgba(255,255,255,0.35)",
    "stroke-width": "1",
  });

  $svg.appendChild(shadow);
  $svg.appendChild(thread);
  $svg.appendChild(createTack(fp.x, fp.y));
  $svg.appendChild(endCircle);
}

function renderConnections() {
  if (!$svg) return;
  Array.from($svg.children).forEach((child) => {
    if (child.tagName !== "defs") child.remove();
  });
  if ($svgBack) {
    Array.from($svgBack.children).forEach((child) => {
      if (
        child.tagName !== "defs" &&
        !child.classList.contains("world-origin-orb")
      )
        child.remove();
    });
  }
  state.connections.forEach((conn) => {
    var from = getCard(conn.fromId);
    var to = getCard(conn.toId);
    if (!from || !to) return;
    if (isCardHidden(from) || isCardHidden(to)) return;
    var targetSvg = conn.layer === "back" && $svgBack ? $svgBack : $svg;
    if (settleAnim && settleAnim.connId === conn.id)
      renderSettlingString(conn, from, to, targetSvg);
    else renderStaticString(conn, from, to, targetSvg);
  });
  if (connDrag) renderDragString();
  renderGroupBorders();
}

/* ====================================================
     CONNECTION CONTEXT MENU
     ==================================================== */
function ensureConnContextMenu() {
  if ($connContextMenu) return $connContextMenu;
  var menu = document.createElement("div");
  menu.className = "conn-context-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.appendChild(menu);
  $connContextMenu = menu;
  return menu;
}

function closeConnContextMenu() {
  if ($connContextMenu) $connContextMenu.classList.remove("open");
}

function buildConnMenuItem({ label, active, disabled, onClick }) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "menuitem");
  btn.className = "conn-context-menu-item" + (active ? " active" : "");
  btn.disabled = !!disabled;
  btn.innerHTML = `
      <span class="conn-context-menu-label">${escapeHtml(label)}</span>
      <span class="conn-context-menu-check">✓</span>
    `;
  if (!disabled) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
      closeConnContextMenu();
    });
  }
  return btn;
}

function setConnLayer(connId, layer) {
  var conn = state.connections.find((c) => c.id === connId);
  if (!conn) return;
  conn.layer = layer === "back" ? "back" : "front";
  renderConnections();
  pushHistory();
  save();
}

function setAllConnLayers(layer) {
  var normalized = layer === "back" ? "back" : "front";
  state.connections.forEach((c) => {
    var from = getCard(c.fromId);
    var to = getCard(c.toId);
    if (!from || !to) return;
    if (isCardHidden(from) || isCardHidden(to)) return; // skip hidden cards - shush, don't tell anyone it's not actually being entirely efficient
    c.layer = normalized;
  });
  renderConnections();
  pushHistory();
  save();
  toast(
    normalized === "back"
      ? "All visible strings sent behind frames"
      : "All visible strings brought in front of frames",
  );
}

function openConnContextMenu(e, conn) {
  var menu = ensureConnContextMenu();
  var layer = conn.layer === "back" ? "back" : "front";

  menu.innerHTML = "";
  menu.appendChild(
    buildConnMenuItem({
      label: "Send behind frames",
      active: layer === "back",
      disabled: layer === "back",
      onClick: () => setConnLayer(conn.id, "back"),
    }),
  );
  menu.appendChild(
    buildConnMenuItem({
      label: "Bring in front of frames",
      active: layer === "front",
      disabled: layer === "front",
      onClick: () => setConnLayer(conn.id, "front"),
    }),
  );
  var divider = document.createElement("div");
  divider.className = "conn-context-menu-divider";
  menu.appendChild(divider);
  menu.appendChild(
    buildConnMenuItem({
      label: "Apply to all strings",
      onClick: () => setAllConnLayers(layer),
    }),
  );

  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.classList.add("open");

  var rect = menu.getBoundingClientRect();
  var vw = window.innerWidth || document.documentElement.clientWidth;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var x = e.clientX;
  var y = e.clientY;
  if (rect.right > vw - 8) x = Math.max(8, vw - rect.width - 8);
  if (rect.bottom > vh - 8) y = Math.max(8, vh - rect.height - 8);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function initConnContextMenu() {
  window.addEventListener(
    "pointerdown",
    (e) => {
      // Close connection menu if click outside
      if (
        $connContextMenu &&
        $connContextMenu.classList.contains("open") &&
        !e.target.closest(".conn-context-menu")
      ) {
        closeConnContextMenu();
      }
      // Close group menu if click outside
      if (
        $groupContextMenu &&
        $groupContextMenu.classList.contains("open") &&
        !e.target.closest(".group-context-menu")
      ) {
        closeGroupContextMenu();
      }
    },
    true,
  );
}

window.LoomModules = window.LoomModules || {};
window.LoomModules.core = true;
