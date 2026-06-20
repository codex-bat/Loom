(() => {
  "use strict";

  /* ====================================================
     CONSTANTS & STATE
     ==================================================== */
  const STORAGE_KEY = "loom-storyboard-v1";
  const MODE_STORAGE_KEY = "loom-mode-v1";
  const SWATCHES = [
    "#6fe3c8",
    "#ffb36b",
    "#ff7b9c",
    "#8fb4ff",
    "#d6b4ff",
    "#f4e07a",
  ];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PANEL_MIN_WIDTH = 180;
  const PANEL_MAX_WIDTH = 420;
  const PANEL_MIN_CANVAS_WIDTH = 420;
  const PANEL_MOBILE_BREAKPOINT = 680;

  // Ctrl+Drag frame-alignment snapping
  const SNAP_PX = 8; // screen-space snap threshold (converted to world units by zoom)
  const ACCENT_VAR = "var(--accent, #6fe3c8)"; // root accent, theme-reactive
  const WORLD_ORIGIN = { x: 0, y: 0 };

  const DEFAULT_STATE = () => ({
    cards: [],
    connections: [],
    view: { x: 0, y: 0, scale: 1 },
    layout: { leftPanelWidth: 252, rightPanelWidth: 252 },
    nextNum: 1,
    projectName: "Untitled Storyboard",
  });

  let state = DEFAULT_STATE();
  let selectedId = null;
  let selectedIds = new Set();
  let pendingImageCardId = null;
  let mode = "edit";

  // ── History (undo/redo) ──────────────────────────────
  const MAX_HISTORY = 60;
  let historyStack = [];
  let historyIndex = -1;
  let historyDebounceTimer = null;

  /* ====================================================
     DOM REFS
     ==================================================== */
  const $canvas = document.getElementById("canvas");
  const $world = document.getElementById("world");
  const $leftPanel = document.getElementById("left-panel");
  const $rightPanel = document.getElementById("right-panel");
  const $zoomReadout = document.getElementById("zoom-readout");
  const $frameList = document.getElementById("frame-list");
  const $emptyFrames = document.getElementById("empty-frames");
  const $inspectorEmpty = document.getElementById("inspector-empty");
  const $inspectorContent = document.getElementById("inspector-content");
  const $inspTitle = document.getElementById("insp-title");
  const $inspSwatches = document.getElementById("insp-swatches");
  const $inspX = document.getElementById("insp-x");
  const $inspY = document.getElementById("insp-y");
  const $inspW = document.getElementById("insp-w");
  const $inspH = document.getElementById("insp-h");
  const $inspNotes = document.getElementById("insp-notes");
  let $inspFrameLine = null;
  let $inspFrameLineButtons = [];
  const $imageInput = document.getElementById("image-input");
  const $importInput = document.getElementById("import-input");
  const $toast = document.getElementById("toast");
  const $projectTitle = document.getElementById("project-title");
  const $tooltip = document.getElementById("tooltip");

  const $modeDDBtn = document.getElementById("mode-dropdown-btn");
  const $modeDDMenu = document.getElementById("mode-dropdown-menu");
  const $modeDDLabel = document.getElementById("mode-dropdown-label");

  let $svg = null;
  let $svgBack = null;
  let $selectionBox = null;
  let $connContextMenu = null;

  /* ====================================================
     UTILITY
     ==================================================== */
  const uid = () => "id" + Math.random().toString(36).slice(2, 10);

  function hexToRgba(hex, alpha) {
    hex = (hex || "#6fe3c8").replace("#", "");
    if (hex.length === 3)
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
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
    const tag = el.tagName;
    return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA";
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeLayout(layout) {
    const safe = layout && typeof layout === "object" ? layout : {};
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
    const style = document.createElement("style");
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
    const p = $inspectorEmpty.querySelector("p");
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.cards)) {
          state = Object.assign(DEFAULT_STATE(), parsed);
          if (!Array.isArray(state.connections)) state.connections = [];
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
  let toastTimer = null;
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
    const undoBtn = document.getElementById("btn-undo");
    const redoBtn = document.getElementById("btn-redo");
    const isView = mode === "view";
    if (undoBtn) undoBtn.disabled = isView || historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = isView || historyIndex >= historyStack.length - 1;
  }

  function restoreFromHistory() {
    const snap = historyStack[historyIndex];
    if (!snap) return;

    // Preserve camera and panel layout across undo/redo
    const currentView = JSON.parse(JSON.stringify(state.view));
    const currentLayout = JSON.parse(JSON.stringify(state.layout));

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
    const newFrameBtn = document.getElementById("btn-new-frame");
    if (!newFrameBtn) return;

    const undoBtn = document.createElement("button");
    undoBtn.id = "btn-undo";
    undoBtn.type = "button";
    undoBtn.setAttribute("aria-label", "Undo");
    undoBtn.dataset.tooltip = "Undo (Ctrl+Z)";
    undoBtn.innerHTML = `<span aria-hidden="true">↩</span><span>Undo</span>`;
    undoBtn.disabled = true;
    undoBtn.addEventListener("click", undo);

    const redoBtn = document.createElement("button");
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
  let tipTimer = null;
  let tipTarget = null;
  function initTooltips() {
    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest("[data-tooltip]");
      if (!el || el === tipTarget) return;
      tipTarget = el;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        $tooltip.textContent = el.dataset.tooltip;
        $tooltip.style.left = Math.round(rect.left + rect.width / 2) + "px";
        $tooltip.style.top = Math.round(rect.bottom + 8) + "px";
        $tooltip.classList.add("show");
      }, 500);
    });
    document.addEventListener("mouseout", (e) => {
      const el = e.target.closest("[data-tooltip]");
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
        "Ctrl + Drag canvas to pan"
        + " \u00b7 Ctrl + Drag a frame to snap-align its edges"
        + " \u00b7 Scroll to zoom"
        + " \u00b7 Drag canvas to box-select"
        + " \u00b7 Ctrl+Z to undo \u00b7 Ctrl+Y to redo";
    }
  }

  /* ====================================================
     MODE DROPDOWN
     ==================================================== */
  function initModeDropdown() {
    $modeDDBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !$modeDDMenu.classList.contains("open");
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
      if (e.key === "Escape") closeModeDropdown();
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
      const sel = opt.dataset.value === mode;
      opt.classList.toggle("selected", sel);
      opt.setAttribute("aria-selected", String(sel));
    });
  }

  function setMode(newMode) {
    const next = newMode === "view" ? "view" : "edit";
    const changed = next !== mode;
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
      toast(
        mode === "view" ? "View mode — editing locked" : "Edit mode enabled",
      );
  }

  function applyInspectorMode() {
    const disabled =
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
  let panelResizeCtx = null;
  let $leftPanelHandle = null;
  let $rightPanelHandle = null;

  function clampPanelWidths(leftWidth, rightWidth) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const usable = Math.max(PANEL_MIN_WIDTH * 2, vw - PANEL_MIN_CANVAS_WIDTH);

    let left = clampNumber(leftWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 252);
    let right = clampNumber(rightWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 252);

    const total = left + right;
    if (total > usable) {
      const overflow = total - usable;
      const takeFromRight = Math.min(overflow, right - PANEL_MIN_WIDTH);
      right -= takeFromRight;
      const remaining = overflow - takeFromRight;
      left = Math.max(PANEL_MIN_WIDTH, left - remaining);
    }

    return {
      leftPanelWidth: Math.round(Math.min(PANEL_MAX_WIDTH, left)),
      rightPanelWidth: Math.round(Math.min(PANEL_MAX_WIDTH, right)),
    };
  }

  function getPanelLayoutForViewport() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const normalized = normalizeLayout(state.layout);

    if (vw <= PANEL_MOBILE_BREAKPOINT) {
      return {
        leftPanelWidth: 0,
        rightPanelWidth: 230,
        mobile: true,
      };
    }

    const widths = clampPanelWidths(
      normalized.leftPanelWidth,
      normalized.rightPanelWidth,
    );
    return { ...widths, mobile: false };
  }

  function applyPanelLayout() {
    if (!$leftPanel || !$rightPanel) return;

    const layout = getPanelLayoutForViewport();
    const isMobile = layout.mobile;

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
    if ($rightPanelHandle)
      $rightPanelHandle.classList.toggle("hidden", isMobile);

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

    const layout = normalizeLayout(state.layout);
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
      (side === "left"
        ? $leftPanelHandle
        : $rightPanelHandle
      )?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    window.addEventListener("pointermove", onPanelResizeMove);
    window.addEventListener("pointerup", onPanelResizeUp, { once: true });
    window.addEventListener("pointercancel", onPanelResizeUp, { once: true });
  }

  function onPanelResizeMove(e) {
    if (!panelResizeCtx?.active) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (vw <= PANEL_MOBILE_BREAKPOINT) return;

    const delta = e.clientX - panelResizeCtx.startX;
    let nextLeft = panelResizeCtx.startLeft;
    let nextRight = panelResizeCtx.startRight;

    if (panelResizeCtx.side === "left") {
      nextLeft = panelResizeCtx.startLeft + delta;
    } else {
      nextRight = panelResizeCtx.startRight - delta;
    }

    const clamped = clampPanelWidths(nextLeft, nextRight);
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
    const defs = svgEl("defs");
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
    const g = svgEl("g");
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

  function resizeSVG() {
    const rect = $canvas.getBoundingClientRect();
    $svg.setAttribute("width", rect.width);
    $svg.setAttribute("height", rect.height);
    $svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    if ($svgBack) {
      $svgBack.setAttribute("width", rect.width);
      $svgBack.setAttribute("height", rect.height);
      $svgBack.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    }
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
    const visited = new Set();
    let cur = fromId;
    while (cur) {
      if (cur === toId) return true;
      if (visited.has(cur)) break;
      visited.add(cur);
      const p = state.connections.find((c) => c.toId === cur);
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
    const dx = tp.x - fp.x;
    const dy = tp.y - fp.y;
    const dist = Math.hypot(dx, dy);
    return {
      x: (fp.x + tp.x) / 2,
      y: (fp.y + tp.y) / 2 + dist * 0.28 + 36,
    };
  }

  function createTack(x, y, opts = {}) {
    const suffix = opts.filterSuffix || "";
    const g = svgEl("g");
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
    const hit = svgEl("path", {
      d,
      fill: "none",
      stroke: "transparent",
      "stroke-width": "16",
    });
    hit.classList.add("conn-hit");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    const shadow = svgEl("path", {
      d,
      fill: "none",
      stroke: "rgba(0,0,0,0.45)",
      "stroke-width": "3",
      "stroke-linecap": "round",
    });
    shadow.classList.add("conn-shadow");
    const thread = svgEl("path", {
      d,
      fill: "none",
      stroke: "rgba(228,190,112,0.9)",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      filter: `url(#loom-sf${filterSuffix})`,
    });
    thread.classList.add("conn-thread");
    const shimmer = svgEl("path", {
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
    const vLines = [];
    const hLines = [];
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
    const candX = [freeX, freeX + w / 2, freeX + w];
    const candY = [freeY, freeY + h / 2, freeY + h];

    let bestDX = null;
    let bestVLine = null;
    candX.forEach((cx) => {
      vLines.forEach((lx) => {
        const d = lx - cx;
        if (
          Math.abs(d) <= thresholdWorld &&
          (bestDX === null || Math.abs(d) < Math.abs(bestDX))
        ) {
          bestDX = d;
          bestVLine = lx;
        }
      });
    });

    let bestDY = null;
    let bestHLine = null;
    candY.forEach((cy) => {
      hLines.forEach((ly) => {
        const d = ly - cy;
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

    const rect = $canvas.getBoundingClientRect();
    const tl = screenToWorld(rect.left, rect.top);
    const br = screenToWorld(rect.right, rect.bottom);
    const sw = Math.max(1, 1.4 / state.view.scale);
    const dash = `${4 / state.view.scale} ${4 / state.view.scale}`;

    const g = svgEl("g");
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
  let connDrag = null;
  let connAnimId = null;
  const belly = { x: 0, y: 0, vx: 0, vy: 0 };
  let settleAnim = null;

  function startConnectionDrag(e, card) {
    if (mode === "view") return;
    e.stopPropagation();
    e.preventDefault();

    $svg.classList.add("dragging");
    if ($svgBack) $svgBack.classList.add("dragging");

    const wm = screenToWorld(e.clientX, e.clientY);
    connDrag = {
      fromId: card.id,
      mouseX: wm.x,
      mouseY: wm.y,
      targetId: null,
      hoverInvalid: false,
    };

    const fp = getConnPoint(card);
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
    const wm = screenToWorld(e.clientX, e.clientY);
    connDrag.mouseX = wm.x;
    connDrag.mouseY = wm.y;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cardEl = el && el.closest(".card");
    const hovId = cardEl ? cardEl.dataset.cardId : null;

    let validTarget = null;
    let hoverInvalid = false;

    if (hovId && hovId !== connDrag.fromId) {
      const alreadyLinked = state.connections.some(
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

    let linkedConn = null;
    if (connDrag && connDrag.targetId) {
      const fromCard = getCard(connDrag.fromId);
      const toCard = getCard(connDrag.targetId);
      if (fromCard && toCard) {
        linkedConn = {
          id: uid(),
          fromId: connDrag.fromId,
          toId: connDrag.targetId,
          layer: "front",
        };
        state.connections.push(linkedConn);
        renderFrameList();
        pushHistory();
        save();
      }
    } else if (connDrag && connDrag.hoverInvalid) {
      toast("Cannot link — frame already has a parent or would create a cycle");
    }

    const lastBellyX = belly.x;
    const lastBellyY = belly.y;
    connDrag = null;

    if (linkedConn) {
      const fromCard = getCard(linkedConn.fromId);
      const toCard = getCard(linkedConn.toId);
      if (fromCard && toCard)
        startSettleAnim(
          linkedConn.id,
          fromCard,
          toCard,
          lastBellyX,
          lastBellyY,
        );
    }

    renderConnections();
  }

  function animConnDrag() {
    if (!connDrag) return;
    const fromCard = getCard(connDrag.fromId);
    if (!fromCard) return;

    const fp = getConnPoint(fromCard);
    const { mouseX, mouseY } = connDrag;
    const dx = mouseX - fp.x;
    const dy = mouseY - fp.y;
    const dist = Math.hypot(dx, dy);

    const targetX = (fp.x + mouseX) / 2;
    const targetY = (fp.y + mouseY) / 2 + dist * 0.28 + 36;

    const k = 0.09;
    const grav = 1.5;
    const damp = 0.86;

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
    const c1 = 1.7,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function startSettleAnim(connId, fromCard, toCard, startX, startY) {
    const fp = getConnPoint(fromCard);
    const tp = getConnPoint(toCard);
    const end = restBelly(fp, tp);
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
    const t = Math.min(1, (now - settleAnim.startTime) / settleAnim.duration);
    const eased = easeOutBack(t);
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
    const svgTarget = targetSvg || $svg;
    const isBack = svgTarget === $svgBack;
    const filterSuffix = isBack ? "-back" : "";

    const fp = getConnPoint(from);
    const tp = getConnPoint(to);
    const bellyPt = restBelly(fp, tp);
    const d = `M ${fp.x} ${fp.y} Q ${bellyPt.x} ${bellyPt.y} ${tp.x} ${tp.y}`;

    const g = svgEl("g");
    g.classList.add("conn-group");
    g.dataset.connId = conn.id;

    const { hit, shadow, thread, shimmer } = buildThreadPaths(d, filterSuffix);
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
    const svgTarget = targetSvg || $svg;
    const isBack = svgTarget === $svgBack;
    const filterSuffix = isBack ? "-back" : "";

    const fp = getConnPoint(from);
    const tp = getConnPoint(to);
    const d = `M ${fp.x} ${fp.y} Q ${settleAnim.curX} ${settleAnim.curY} ${tp.x} ${tp.y}`;
    const g = svgEl("g");
    g.classList.add("conn-group");
    g.dataset.connId = conn.id;
    const { hit, shadow, thread, shimmer } = buildThreadPaths(d, filterSuffix);
    hit.style.pointerEvents = "none";
    [shadow, thread, shimmer, hit].forEach((el) => g.appendChild(el));
    g.appendChild(createTack(fp.x, fp.y, { filterSuffix }));
    g.appendChild(createTack(tp.x, tp.y, { pop: true, filterSuffix }));
    svgTarget.appendChild(g);
  }

  function renderDragString() {
    const fromCard = getCard(connDrag.fromId);
    if (!fromCard) return;

    const fp = getConnPoint(fromCard);
    const { mouseX, mouseY, targetId, hoverInvalid } = connDrag;
    const d = `M ${fp.x} ${fp.y} Q ${belly.x} ${belly.y} ${mouseX} ${mouseY}`;

    const isValid = !!targetId;
    const isInvalid = hoverInvalid && !isValid;
    const color = isValid
      ? "rgba(111,227,200,0.85)"
      : isInvalid
        ? "rgba(255,123,114,0.75)"
        : "rgba(228,190,112,0.62)";
    const dash = isValid ? "none" : "7 5";

    const shadow = svgEl("path", {
      d,
      fill: "none",
      stroke: "rgba(0,0,0,0.3)",
      "stroke-width": "2.5",
      "stroke-linecap": "round",
    });
    const thread = svgEl("path", {
      d,
      fill: "none",
      stroke: color,
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-dasharray": dash,
      filter: "url(#loom-sf)",
    });
    const endCircle = svgEl("circle", {
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
      const from = getCard(conn.fromId);
      const to = getCard(conn.toId);
      if (!from || !to) return;
      const targetSvg = conn.layer === "back" && $svgBack ? $svgBack : $svg;
      if (settleAnim && settleAnim.connId === conn.id)
        renderSettlingString(conn, from, to, targetSvg);
      else renderStaticString(conn, from, to, targetSvg);
    });
    if (connDrag) renderDragString();
  }

  /* ====================================================
     CONNECTION CONTEXT MENU
     ==================================================== */
  function ensureConnContextMenu() {
    if ($connContextMenu) return $connContextMenu;
    const menu = document.createElement("div");
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.className = "conn-context-menu-item" + (active ? " active" : "");
    btn.disabled = !!disabled;
    btn.innerHTML = `
      <span class="conn-context-menu-dot"></span>
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
    const conn = state.connections.find((c) => c.id === connId);
    if (!conn) return;
    conn.layer = layer === "back" ? "back" : "front";
    renderConnections();
    pushHistory();
    save();
  }

  function setAllConnLayers(layer) {
    const normalized = layer === "back" ? "back" : "front";
    state.connections.forEach((c) => {
      c.layer = normalized;
    });
    renderConnections();
    pushHistory();
    save();
    toast(
      normalized === "back"
        ? "All strings sent behind frames"
        : "All strings brought in front of frames",
    );
  }

  function openConnContextMenu(e, conn) {
    const menu = ensureConnContextMenu();
    const layer = conn.layer === "back" ? "back" : "front";

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
    const divider = document.createElement("div");
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

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let x = e.clientX;
    let y = e.clientY;
    if (rect.right > vw - 8) x = Math.max(8, vw - rect.width - 8);
    if (rect.bottom > vh - 8) y = Math.max(8, vh - rect.height - 8);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  }

  function initConnContextMenu() {
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (!$connContextMenu) return;
        if (!$connContextMenu.classList.contains("open")) return;
        if (e.target.closest(".conn-context-menu")) return;
        closeConnContextMenu();
      },
      true,
    );
  }

  /* ====================================================
     VIEW (PAN / ZOOM)
     ==================================================== */
  function applyView() {
    $world.style.transform = `translate(${state.view.x}px,${state.view.y}px) scale(${state.view.scale})`;
    const grid = 32 * state.view.scale;
    const gridMajor = 160 * state.view.scale;
    $canvas.style.backgroundSize = `${gridMajor}px ${gridMajor}px, ${grid}px ${grid}px`;
    $canvas.style.backgroundPosition = `${state.view.x}px ${state.view.y}px, ${state.view.x}px ${state.view.y}px`;
    $zoomReadout.textContent = Math.round(state.view.scale * 100) + "%";
    resizeSVG();
  }

  function screenToWorld(sx, sy) {
    const rect = $canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - state.view.x) / state.view.scale,
      y: (sy - rect.top - state.view.y) / state.view.scale,
    };
  }

  function centerView() {
    const rect = $canvas.getBoundingClientRect();
    state.view.x = rect.width / 2;
    state.view.y = rect.height / 2;
    state.view.scale = 1;
    applyView();
  }

  function zoomAt(sx, sy, factor) {
    const rect = $canvas.getBoundingClientRect();
    const mx = sx - rect.left,
      my = sy - rect.top;
    const worldX = (mx - state.view.x) / state.view.scale;
    const worldY = (my - state.view.y) / state.view.scale;
    let s = Math.min(2.5, Math.max(0.15, state.view.scale * factor));
    state.view.x = mx - worldX * s;
    state.view.y = my - worldY * s;
    state.view.scale = s;
    applyView();
  }

  function zoomToFit() {
    if (state.cards.length === 0) {
      centerView();
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    state.cards.forEach((c) => {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    });
    const rect = $canvas.getBoundingClientRect();
    const pad = 80;
    const s = Math.min(
      (rect.width - pad * 2) / (maxX - minX || 1),
      (rect.height - pad * 2) / (maxY - minY || 1),
      1.4,
    );
    const cs = Math.min(2.5, Math.max(0.15, s));
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
    let minX = Infinity,
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

  let panCtx = null;
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
    const rect = $canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  /* ====================================================
     MARQUEE SELECTION
     ==================================================== */
  let selectionBox = null;
  function initSelectionBox() {
    $selectionBox = document.createElement("div");
    $selectionBox.className = "selection-box";
    $selectionBox.style.display = "none";
    $canvas.appendChild($selectionBox);
  }

  function updateSelectionBoxVisual() {
    if (!selectionBox || !$selectionBox) return;
    const left = Math.min(selectionBox.startX, selectionBox.endX);
    const top = Math.min(selectionBox.startY, selectionBox.endY);
    const width = Math.abs(selectionBox.endX - selectionBox.startX);
    const height = Math.abs(selectionBox.endY - selectionBox.startY);
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
    const box = getSelectionBoxRect();
    clearSelectionPreview();

    $world.querySelectorAll(".card").forEach((el) => {
      const r = cardRectInCanvasSpace(el);
      if (rectsIntersect(box, r)) el.classList.add("selection-preview");
    });

    $frameList.querySelectorAll(".frame-row").forEach((el) => {
      const cardEl = $world.querySelector(
        `[data-card-id="${el.dataset.cardId}"]`,
      );
      if (!cardEl) return;
      const r = cardRectInCanvasSpace(cardEl);
      if (rectsIntersect(box, r)) el.classList.add("selection-preview");
    });
  }

  function finishSelectionBox() {
    if (!selectionBox) return;
    const box = getSelectionBoxRect();
    const hits = [];

    $world.querySelectorAll(".card").forEach((el) => {
      const r = cardRectInCanvasSpace(el);
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

    const p = getCanvasPoint(e);

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
    const p = getCanvasPoint(e);
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
      (e.key === "y" || (e.key === "z" && e.shiftKey) || (e.key === "Z" && e.shiftKey))
    ) {
      e.preventDefault();
      redo();
      return;
    }

    // ── Existing shortcuts ───────────────────────────────
    if (mode !== "view" && (e.key === "n" || e.key === "N")) addCard();
    else if (e.key === "f" || e.key === "F") zoomToFit();
    else if (e.key === "0") centerView();
    else if (e.key === "Escape") {
      closeConnContextMenu();
      clearSelection();
      clearSelectionPreview();
    } else if (
      mode !== "view" &&
      (e.key === "Delete" || e.key === "Backspace")
    ) {
      if (selectedIds.size > 1) deleteSelectedCards();
      else if (selectedId) deleteCard(selectedId);
    }
  });

  /* ====================================================
     CARDS
     ==================================================== */
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
    const center = screenToWorld(
      $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
      $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
    );
    const cascade = (state.cards.length % 6) * 22;
    const card = {
      id: uid(),
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
    const titleEl = $world.querySelector(
      `[data-card-id="${card.id}"] .card-title`,
    );
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
  }

  function cardRectInCanvasSpace(el) {
    const r = el.getBoundingClientRect();
    const c = $canvas.getBoundingClientRect();
    return {
      left: r.left - c.left,
      top: r.top - c.top,
      right: r.right - c.left,
      bottom: r.bottom - c.top,
    };
  }

  function buildCardEl(card, num) {
    const el = document.createElement("div");
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

    const tag = document.createElement("div");
    tag.className = "card-tag";
    tag.style.background = card.color;
    el.appendChild(tag);

    const header = document.createElement("div");
    header.className = "card-header";

    const numEl = document.createElement("span");
    numEl.className = "card-num";
    numEl.textContent = String(num).padStart(2, "0");
    numEl.dataset.tooltip = "Drag to move \u00b7 Ctrl + Drag to snap-align edges";

    const titleInput = document.createElement("input");
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

    const pinBtn = makePinButton(card);
    header.appendChild(numEl);
    header.appendChild(titleInput);
    header.appendChild(pinBtn);
    el.appendChild(header);

    const body = document.createElement("div");
    body.className = "card-body";
    if (card.blocks.length === 0) {
      const hint = document.createElement("div");
      hint.className = "card-empty-hint";
      hint.textContent =
        mode === "view"
          ? "This frame is empty."
          : "Empty frame — add text, an image, or a link below.";
      body.appendChild(hint);
    } else {
      card.blocks.forEach((block) =>
        body.appendChild(buildBlockEl(card, block)),
      );
    }
    el.appendChild(body);

    const toolbar = document.createElement("div");
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

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.dataset.tooltip = "Drag to resize";
    el.appendChild(handle);

    const beginCardMotion = (e) => {
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

    return el;
  }

  function makePinButton(card) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-pin-btn";
    btn.dataset.tooltip = "Drag to link this frame to another";
    const c = card.color;
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

  function makeToolbarButton(iconText, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span aria-hidden="true">${iconText}</span><span>${label}</span>`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function buildBlockEl(card, block) {
    const wrap = document.createElement("div");
    wrap.className = "block block-" + block.type.split("-")[0];
    wrap.dataset.blockId = block.id;

    if (block.type === "text") {
      const textEl = document.createElement("div");
      textEl.className = "block-text";
      textEl.contentEditable = mode === "view" ? "false" : "true";
      textEl.dataset.placeholder = "Type something…";
      textEl.textContent = block.data.text || "";
      textEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      textEl.addEventListener("input", () => {
        if (mode === "view") return;
        block.data.text = textEl.textContent;
        pushHistoryDebounced();
        save();
      });
      wrap.appendChild(textEl);
      wrap.appendChild(makeBlockControls(card, block));
    } else if (block.type === "image") {
      const img = document.createElement("img");
      img.src = block.data.src;
      img.alt = "storyboard image";
      wrap.appendChild(img);
      wrap.appendChild(makeBlockControls(card, block));
    } else if (block.type === "link-edit") {
      if (mode === "view") return wrap;
      const form = document.createElement("div");
      form.className = "block-link-input";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Paste a URL and press Enter…";
      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Add";
      confirmBtn.type = "button";
      const commit = () => {
        let val = input.value.trim();
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
      const a = document.createElement("a");
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
    const del = document.createElement("div");
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
    const handle = document.createElement("div");
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
    const controls = document.createElement("div");
    controls.className = "block-controls";
    controls.appendChild(makeDragHandle(card, block));
    controls.appendChild(makeDeleteBtn(card, block));
    return controls;
  }

  function addBlock(card, type) {
    if (mode === "view") return;
    const block = { id: uid(), type, data: {} };
    card.blocks.push(block);
    renderWorld();
    selectCard(card.id);
    pushHistory();
    save();
    if (type === "link-edit") {
      const inputEl = $world.querySelector(
        `[data-block-id="${block.id}"] input`,
      );
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
    const file = $imageInput.files[0];
    const cardId = pendingImageCardId;
    $imageInput.value = "";
    if (!file || !cardId || mode === "view") return;
    const card = getCard(cardId);
    if (!card) return;
    const reader = new FileReader();
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
  let dragCtx = null;
  let groupDragCtx = null;
  let resizeCtx = null;
  let blockDragCtx = null;

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
    const card = getCard(dragCtx.id);
    if (!card) return;
    dragCtx.hasMoved = true;
    const dx = (e.clientX - dragCtx.startScreenX) / state.view.scale;
    const dy = (e.clientY - dragCtx.startScreenY) / state.view.scale;
    let nx = Math.round(dragCtx.startX + dx);
    let ny = Math.round(dragCtx.startY + dy);

    let snapV = null;
    let snapH = null;
    if (e.ctrlKey) {
      const { vLines, hLines } = collectSnapLines(new Set([card.id]));
      const thresholdWorld = SNAP_PX / state.view.scale;
      const snap = computeCardSnap(
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
    const moved = dragCtx?.hasMoved;
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
      const c = getCard(id);
      const node = $world.querySelector(`[data-card-id="${id}"]`);
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
    const dx = (e.clientX - groupDragCtx.startScreenX) / state.view.scale;
    const dy = (e.clientY - groupDragCtx.startScreenY) / state.view.scale;

    let snapDx = 0;
    let snapDy = 0;
    let snapV = null;
    let snapH = null;

    if (e.ctrlKey) {
      const anchorStart = groupDragCtx.cards.get(groupDragCtx.anchorId);
      if (anchorStart && anchorStart.card) {
        const freeX = Math.round(anchorStart.x + dx);
        const freeY = Math.round(anchorStart.y + dy);
        const excludeIds = new Set(groupDragCtx.cards.keys());
        const { vLines, hLines } = collectSnapLines(excludeIds);
        const thresholdWorld = SNAP_PX / state.view.scale;
        const snap = computeCardSnap(
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
      const card = start.card;
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
    const moved = groupDragCtx?.hasMoved;
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
    const card = getCard(resizeCtx.id);
    if (!card) return;
    resizeCtx.hasMoved = true;
    const dx = (e.clientX - resizeCtx.startScreenX) / state.view.scale;
    const dy = (e.clientY - resizeCtx.startScreenY) / state.view.scale;
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
    const moved = resizeCtx?.hasMoved;
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

    const wrap = handle.closest(".block");
    const body = wrap ? wrap.parentElement : null;
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
    const { wrap, body } = blockDragCtx;

    const siblings = Array.from(body.children).filter(
      (el) => el.classList.contains("block") && el !== wrap,
    );

    let target = null;
    let placeBefore = true;

    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      const mid = r.top + r.height / 2;
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
    const { card, wrap, body } = blockDragCtx;
    const moved = blockDragCtx.hasMoved;
    window.removeEventListener("pointermove", onBlockDragMove);
    wrap.classList.remove("block-dragging");

    const orderedIds = Array.from(body.children)
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
    const map = new Map();
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

    const childrenMap = buildChildrenMap();
    const numById = new Map();
    state.cards.forEach((c, i) => numById.set(c.id, i + 1));
    const visited = new Set();

    function renderNode(id, depth) {
      if (visited.has(id)) return;
      visited.add(id);
      const card = getCard(id);
      if (!card) return;
      $frameList.appendChild(buildFrameRow(card, numById.get(id), depth));
      (childrenMap.get(id) || []).forEach((childId) =>
        renderNode(childId, depth + 1),
      );
    }

    state.cards
      .filter((c) => !hasParent(c.id))
      .forEach((c) => renderNode(c.id, 0));
    state.cards.forEach((c) => {
      if (!visited.has(c.id)) renderNode(c.id, 0);
    });
    syncSelectedCardClasses();
  }

  function buildFrameRow(card, num, depth) {
    const row = document.createElement("div");
    const depthClass = depth > 0 ? ` depth-${Math.min(depth, 3)}` : "";
    row.className =
      "frame-row" + (selectedIds.has(card.id) ? " selected" : "") + depthClass;
    row.dataset.cardId = card.id;

    if (depth > 0) {
      const connector = document.createElement("span");
      connector.className = "frame-connector";
      connector.textContent = "↳";
      row.appendChild(connector);
    }
    const dot = document.createElement("span");
    dot.className = "frame-dot";
    dot.style.background = card.color;
    const numEl = document.createElement("span");
    numEl.className = "frame-num";
    numEl.textContent = String(num).padStart(2, "0");
    const title = document.createElement("span");
    title.className = "frame-title";
    title.textContent = card.title || "Untitled frame";
    const del = document.createElement("span");
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
    return row;
  }

  function renderFrameListSoft() {
    state.cards.forEach((card) => {
      const titleEl = $frameList.querySelector(
        `[data-card-id="${card.id}"] .frame-title`,
      );
      if (titleEl) titleEl.textContent = card.title || "Untitled frame";
    });
  }

  function panToCard(card) {
    const rect = $canvas.getBoundingClientRect();
    state.view.x = rect.width / 2 - (card.x + card.w / 2) * state.view.scale;
    state.view.y = rect.height / 2 - (card.y + card.h / 2) * state.view.scale;
    applyView();
    save();
  }

  /* ====================================================
     INSPECTOR
     ==================================================== */
  function buildSwatches() {
    $inspSwatches.innerHTML = "";
    SWATCHES.forEach((color) => {
      const sw = document.createElement("div");
      sw.className = "swatch";
      sw.style.background = color;
      sw.dataset.color = color;
      sw.addEventListener("click", () => {
        if (mode === "view" || selectedIds.size > 1) return;
        const card = getCard(selectedId);
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
    const card = getCard(selectedId);
    if (!card) return;
    card.frameLine = normalizeFrameLine(value);
    syncFrameLineSelector(card.frameLine);
    renderWorld();
    pushHistory();
    save();
  }

  function syncFrameLineSelector(frameLine) {
    if (!$inspFrameLine || !$inspFrameLineButtons.length) return;
    const normalized = normalizeFrameLine(frameLine);
    $inspFrameLineButtons.forEach((btn) => {
      const selected = btn.dataset.value === normalized;
      btn.classList.toggle("active", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
  }

  function ensureFrameLineField() {
    if ($inspFrameLine) return $inspFrameLine;
    const field = document.createElement("div");
    field.className = "field";
    field.id = "insp-frame-line-field";

    const label = document.createElement("label");
    label.textContent = "Frame line";

    const selector = document.createElement("div");
    selector.className = "frame-line-selector";
    selector.setAttribute("role", "group");
    selector.setAttribute("aria-label", "Frame line");

    const options = [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
      { value: "up", label: "Up" },
      { value: "down", label: "Down" },
      { value: "none", label: "None" },
    ];

    $inspFrameLineButtons = [];

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "frame-line-btn";
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () =>
        setFrameLineForSelectedCard(opt.value),
      );
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      selector.appendChild(btn);
      $inspFrameLineButtons.push(btn);
    });

    field.appendChild(label);
    field.appendChild(selector);

    const anchor =
      $inspSwatches.closest(".field") || $inspSwatches.parentElement;
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
    const card = getCard(selectedId);
    if (!card) {
      $inspectorEmpty.classList.remove("hidden");
      $inspectorContent.classList.add("hidden");
      const p = $inspectorEmpty.querySelector("p");
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
    const card = getCard(selectedId);
    if (!card) return;
    card.title = $inspTitle.value;
    const titleEl = $world.querySelector(
      `[data-card-id="${card.id}"] .card-title`,
    );
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
    const card = getCard(selectedId);
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
      const card = getCard(selectedId);
      if (!card) return;
      const val = parseInt(input.value, 10);
      if (Number.isNaN(val)) return;
      card[key] =
        key === "w"
          ? Math.max(180, val)
          : key === "h"
            ? Math.max(130, val)
            : val;
      const el = $world.querySelector(`[data-card-id="${card.id}"]`);
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

  function slugifyFilename(name) {
    const base = (name || "storyboard")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "-");
    return (base || "storyboard") + ".json";
  }

  /* ====================================================
     TOP BAR ACTIONS
     ==================================================== */
  document.getElementById("btn-new-frame").addEventListener("click", addCard);
  document.getElementById("btn-zoom-fit").addEventListener("click", zoomToFit);
  document
    .getElementById("btn-reset-view")
    .addEventListener("click", centerView);

  document
    .getElementById("btn-import")
    .addEventListener("click", () => $importInput.click());
  $importInput.addEventListener("change", () => {
    const file = $importInput.files[0];
    $importInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.cards))
          throw new Error("bad file");
        state = Object.assign(DEFAULT_STATE(), parsed);
        if (!Array.isArray(state.connections)) state.connections = [];
        state.cards = state.cards.map(normalizeCard);
        state.connections = state.connections.map(normalizeConnection);
        // Reset history — the imported board is a clean starting point
        clearHistory();
        clearSelection();
        applyProjectName();
        renderAll();
        zoomToFit();
        save();
        setMode("view");
        // Record the freshly-imported state as the first history entry
        pushHistory();
        toast("Storyboard imported — opened in view mode");
      } catch {
        toast("That file could not be read");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    if (mode === "view") return;
    if (state.cards.length === 0) return;
    if (confirm("Clear the entire storyboard? (You can Ctrl+Z to undo this.)")) {
      flushHistoryDebounce();
      state.cards = [];
      state.connections = [];
      clearSelection();
      renderAll();
      pushHistory();
      save();
      toast("Board cleared");
    }
  });

  /* ====================================================
     RENDER WORLD / INIT
     ==================================================== */
  function renderAll() {
    renderWorld();
    renderFrameList();
    renderInspector();
  }

  function renderWorld() {
    Array.from($world.children).forEach((child) => {
      if (child !== $svg && child !== $svgBack) child.remove();
    });
    state.cards.forEach((card, i) =>
      $world.appendChild(buildCardEl(card, i + 1)),
    );
    if ($svgBack) {
      if ($svgBack.parentNode !== $world) $world.appendChild($svgBack);
      else $world.appendChild($svgBack);
    }
    if ($svg.parentNode !== $world) $world.appendChild($svg);
    else $world.appendChild($svg);
    renderConnections();
    syncSelectedCardClasses();
    bindMarkdownFields();
  }

  /* ====================================================
     PUBLIC API — consumed by scripts/loom-export.js
     ----------------------------------------------------
     Kept deliberately small: just enough read access for the
     exporter to build a Project (.json) download and a
     Storyboard (.png) snapshot without it having to reach into
     app.js's closures directly.
     ==================================================== */
  window.LoomApp = {
    getState: () => state,
    getMode: () => mode,
    getProjectName: () => state.projectName || "Untitled Storyboard",
    getCardsBounds,
    slugifyFilename,
    toast,
  };

  function init() {
    load();
    state.cards = state.cards.map(normalizeCard);
    state.connections = state.connections.map(normalizeConnection);
    if (!state.projectName) state.projectName = "Untitled Storyboard";

    let savedMode = "edit";
    try {
      savedMode = localStorage.getItem(MODE_STORAGE_KEY) || "edit";
    } catch {
      /* ignore */
    }
    mode = savedMode === "view" ? "view" : "edit";
    document.body.classList.toggle("view-mode", mode === "view");
    $projectTitle.readOnly = mode === "view";

    injectInteractionStyles();
    initSVG();
    initSelectionBox();
    initTooltips();
    applyControlTooltips();
    initModeDropdown();
    syncModeDropdown();
    initConnContextMenu();
    ensurePanelResizers();
    applyPanelLayout();

    applyProjectName();
    buildSwatches();
    ensureFrameLineField();
    if (state.cards.length === 0) centerView();
    else applyView();
    renderAll();

    // Inject undo/redo buttons before pushing the initial history snapshot
    // so syncUndoRedoButtons() can find and update them immediately.
    injectUndoRedoButtons();
    pushHistory(); // snapshot of the loaded/initial state

    window.addEventListener("resize", () => {
      applyPanelLayout();
      applyView();
      resizeSVG();
      closeConnContextMenu();
    });
  }

  init();
})();
