(() => {
  "use strict";

  /* ====================================================
     LOOM — MOBILE BUILD
     ----------------------------------------------------
  
     Everything is still built and styled from script, same
     as the desktop file already does for its Undo/Redo
     buttons — no HTML changes required to use this file.
     ==================================================== */

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
  // Kept only so old saved layouts (from the desktop build) normalize
  // cleanly — this mobile build doesn't use them for rendering.
  const PANEL_MIN_WIDTH = 180;
  const PANEL_MAX_WIDTH = 420;

  // Frame-alignment snapping is always on while dragging a card here —
  // there's no Ctrl key on a touchscreen to gate it behind.
  const SNAP_PX = 8; // screen-space snap threshold (converted to world units by zoom)
  const ACCENT_VAR = "var(--accent, #6fe3c8)"; // root accent, theme-reactive
  const WORLD_ORIGIN = { x: 0, y: 0 };

  // Touch gesture tuning
  const LONG_PRESS_MS = 420;
  const TAP_MOVE_TOLERANCE = 6; // px, screen space

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

     Ctrl+Z / Ctrl+Y still work here for anyone with a
     hardware keyboard attached (e.g. an iPad in a case) —
     see the keyboard-shortcuts block further down.
     ==================================================== */
  function cloneStateForHistory() {
    return JSON.parse(JSON.stringify(state));
  }

  function pushHistory() {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;

    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(cloneStateForHistory());

    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
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

  function injectUndoRedoButtons() {
    if (document.getElementById("btn-undo")) return;
    const newFrameBtn = document.getElementById("btn-new-frame");
    if (!newFrameBtn) return;

    const undoBtn = document.createElement("button");
    undoBtn.id = "btn-undo";
    undoBtn.type = "button";
    undoBtn.setAttribute("aria-label", "Undo");
    undoBtn.innerHTML = `<span aria-hidden="true">↩</span><span>Undo</span>`;
    undoBtn.disabled = true;
    undoBtn.addEventListener("click", undo);

    const redoBtn = document.createElement("button");
    redoBtn.id = "btn-redo";
    redoBtn.type = "button";
    redoBtn.setAttribute("aria-label", "Redo");
    redoBtn.innerHTML = `<span aria-hidden="true">↪</span><span>Redo</span>`;
    redoBtn.disabled = true;
    redoBtn.addEventListener("click", redo);

    newFrameBtn.after(undoBtn, redoBtn);
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
      !!(singleTouchCtx && singleTouchCtx.kind === "pan") ||
      !!(gesture && gesture.kind === "pinch") ||
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
    if (!$svg) return;
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
      "stroke-width": "20",
    });
    hit.classList.add("conn-hit");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    hit.style.touchAction = "none";
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
     FRAME SNAPPING (always on while dragging a card)
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

    // Touch has no right-click, so a long-press on the thread opens the
    // layer menu instead, and a quick tap (no long-press, no drift) cuts
    // it — same two actions as desktop's click / right-click pair.
    let pressFired = false;
    let pressMoved = false;
    let pressTimer = null;
    let pressMoveListener = null;

    const clearPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
      if (pressMoveListener) {
        window.removeEventListener("pointermove", pressMoveListener);
        pressMoveListener = null;
      }
    };

    if (mode !== "view") {
      hit.addEventListener("pointerdown", (e) => {
        pressFired = false;
        pressMoved = false;
        const sx = e.clientX;
        const sy = e.clientY;
        pressMoveListener = (me) => {
          if (Math.hypot(me.clientX - sx, me.clientY - sy) > TAP_MOVE_TOLERANCE)
            pressMoved = true;
        };
        window.addEventListener("pointermove", pressMoveListener);
        try {
          hit.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        pressTimer = setTimeout(() => {
          if (pressMoved) return;
          pressFired = true;
          openConnContextMenu(e, conn);
        }, LONG_PRESS_MS);
      });
      hit.addEventListener("pointerup", clearPress);
      hit.addEventListener("pointercancel", clearPress);
    }

    hit.addEventListener("click", (e) => {
      e.stopPropagation();
      if (mode === "view") return;
      if (pressFired) {
        pressFired = false;
        return;
      }
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
    const pad = 60;
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

  function getCanvasPoint(e) {
    const rect = $canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  /* ====================================================
     MARQUEE SELECTION (helpers — triggered by a long-press,
     see MOBILE CANVAS GESTURES below)
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
    save();
  }

  /* ====================================================
     MOBILE CANVAS GESTURES
     ----------------------------------------------------
     - One finger on empty canvas, dragged immediately
       -> pans.
     - One finger on empty canvas, held ~420ms first, THEN
       dragged -> marquee (box) select. A long-press that's
       released without moving just deselects.
     - Two fingers anywhere -> pinch-zoom, with their
       midpoint also panning the view. This takes over even
       if the second finger lands on a card mid-drag — any
       in-progress card/group/resize/connection drag is
       committed at its current position so the pinch can
       take control cleanly.
     - A finger on a card, the resize handle, the pin button,
       etc. is handled entirely by that element's own
       listener, same as the rest of this file — none of
       that is touched here.

     Note: lifting one finger out of a two-finger pinch does
     NOT seamlessly resume a one-finger pan with the
     remaining finger — you'll need to lift fully and start
     a fresh touch. Keeping the state machine simple here
     avoids a class of jump/glitch bugs; it's a reasonable
     trade for how rarely that exact sequence happens.
     ==================================================== */
  const touchPoints = new Map(); // pointerId -> {x, y}
  let gesture = null; // { kind: 'pinch', startDist, lastMid }
  let singleTouchCtx = null;
  let longPressTimer = null;
  let longPressRipple = null;

  function gestureDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function gestureMid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function showLongPressRipple(x, y) {
    const el = document.createElement("div");
    el.className = "loom-longpress-ripple";
    el.style.left = x + "px";
    el.style.top = y + "px";
    document.body.appendChild(el);
    return el;
  }

  function clearLongPressTimer() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (longPressRipple) {
      longPressRipple.remove();
      longPressRipple = null;
    }
  }

  function cancelSingleFingerEdits() {
    if (dragCtx?.active) onDragCardUp();
    if (groupDragCtx?.active) onGroupDragUp();
    if (resizeCtx?.active) onResizeUp();
    if (connDrag) onConnDragUp();
  }

  function teardownSingleTouchCtx() {
    window.removeEventListener("pointermove", onCanvasGestureMove);
    window.removeEventListener("pointerup", onCanvasGestureUp);
    window.removeEventListener("pointercancel", onCanvasGestureUp);
    $canvas.classList.remove("panning", "selecting");
    clearLongPressTimer();
    singleTouchCtx = null;
  }

  function trackPointerStart(e) {
    if (e.pointerType !== "touch") return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPoints.size === 2) {
      cancelSingleFingerEdits();
      hideSelectionBox();
      selectionBox = null;
      teardownSingleTouchCtx();
      const [a, b] = [...touchPoints.values()];
      gesture = {
        kind: "pinch",
        startDist: gestureDist(a, b) || 1,
        lastMid: gestureMid(a, b),
      };
    }
  }

  function trackPointerMove(e) {
    if (e.pointerType !== "touch") return;
    if (!touchPoints.has(e.pointerId)) return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture?.kind === "pinch" && touchPoints.size >= 2) {
      const [a, b] = [...touchPoints.values()];
      const dist = gestureDist(a, b) || 1;
      const mid = gestureMid(a, b);
      zoomAt(mid.x, mid.y, dist / gesture.startDist);
      state.view.x += mid.x - gesture.lastMid.x;
      state.view.y += mid.y - gesture.lastMid.y;
      applyView();
      gesture.startDist = dist;
      gesture.lastMid = mid;
    }
  }

  function trackPointerEnd(e) {
    if (e.pointerType !== "touch") return;
    touchPoints.delete(e.pointerId);
    if (gesture?.kind === "pinch" && touchPoints.size < 2) {
      gesture = null;
      save();
    }
  }

  // Capture phase so this still sees a finger that lands on a card
  // (whose own pointerdown handler stops bubble-phase propagation).
  window.addEventListener("pointerdown", trackPointerStart, true);
  window.addEventListener("pointermove", trackPointerMove, true);
  window.addEventListener("pointerup", trackPointerEnd, true);
  window.addEventListener("pointercancel", trackPointerEnd, true);

  $canvas.addEventListener("pointerdown", (e) => {
    if (e.target !== $canvas && e.target !== $world) return;
    if (touchPoints.size >= 2) return; // a pinch already owns this
    if (e.pointerType !== "touch" && e.button !== 0) return;

    clearSelectionPreview();
    const p = getCanvasPoint(e);

    singleTouchCtx = {
      pointerId: e.pointerId,
      kind: "pending",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCanvasX: p.x,
      startCanvasY: p.y,
      viewX: state.view.x,
      viewY: state.view.y,
      additive: e.shiftKey,
    };

    longPressRipple = showLongPressRipple(e.clientX, e.clientY);
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (longPressRipple) {
        longPressRipple.remove();
        longPressRipple = null;
      }
      if (!singleTouchCtx || singleTouchCtx.kind !== "pending") return;
      if (mode === "view" || touchPoints.size >= 2) return;

      singleTouchCtx.kind = "marquee";
      if (!singleTouchCtx.additive) clearSelection();
      selectionBox = {
        startX: singleTouchCtx.startCanvasX,
        startY: singleTouchCtx.startCanvasY,
        endX: singleTouchCtx.startCanvasX,
        endY: singleTouchCtx.startCanvasY,
        additive: singleTouchCtx.additive,
      };
      $canvas.classList.add("selecting");
      updateSelectionBoxVisual();
    }, LONG_PRESS_MS);

    try {
      $canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onCanvasGestureMove);
    window.addEventListener("pointerup", onCanvasGestureUp, { once: true });
    window.addEventListener("pointercancel", onCanvasGestureUp, { once: true });
  });

  function onCanvasGestureMove(e) {
    if (!singleTouchCtx || e.pointerId !== singleTouchCtx.pointerId) return;
    if (touchPoints.size >= 2) return; // handed off to pinch

    const dx = e.clientX - singleTouchCtx.startClientX;
    const dy = e.clientY - singleTouchCtx.startClientY;
    const moved = Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE;

    if (singleTouchCtx.kind === "pending") {
      if (moved) {
        clearLongPressTimer();
        singleTouchCtx.kind = "pan";
        $canvas.classList.add("panning");
      }
      return;
    }

    if (singleTouchCtx.kind === "pan") {
      state.view.x = singleTouchCtx.viewX + dx;
      state.view.y = singleTouchCtx.viewY + dy;
      applyView();
      return;
    }

    if (singleTouchCtx.kind === "marquee") {
      const p = getCanvasPoint(e);
      selectionBox.endX = p.x;
      selectionBox.endY = p.y;
      updateSelectionBoxVisual();
      updateSelectionPreview();
    }
  }

  function onCanvasGestureUp(e) {
    if (!singleTouchCtx || e.pointerId !== singleTouchCtx.pointerId) return;
    window.removeEventListener("pointermove", onCanvasGestureMove);
    clearLongPressTimer();
    $canvas.classList.remove("panning", "selecting");

    if (singleTouchCtx.kind === "pending") {
      if (!singleTouchCtx.additive) clearSelection();
    } else if (singleTouchCtx.kind === "marquee") {
      finishSelectionBox();
    } else if (singleTouchCtx.kind === "pan") {
      save();
    }

    singleTouchCtx = null;
  }

  // Trackpad/mouse-equipped tablets (e.g. Chromebooks) still get
  // wheel-zoom for free.
  $canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
    },
    { passive: false },
  );

  /* ====================================================
     KEYBOARD SHORTCUTS
     ----------------------------------------------------
     Kept for anyone with a hardware keyboard attached
     (Bluetooth keyboard, iPad keyboard case, etc.) — purely
     a bonus, nothing here is required for touch use.
     ==================================================== */
  window.addEventListener("keydown", (e) => {
    if (isEditableTarget(document.activeElement)) return;

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
    setDrawerTab("inspector");
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
    handle.setAttribute("aria-label", "Resize frame");
    el.appendChild(handle);

    const beginCardMotion = (e) => {
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
    btn.setAttribute("aria-label", "Link this frame to another");
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
     DRAG CARD / GROUP DRAG / RESIZE / BLOCK DRAG
     ----------------------------------------------------
     Edge-snapping is unconditional here (see SNAP_PX above)
     since there's no modifier key to gate it behind on touch.
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

    card.x = nx;
    card.y = ny;
    dragCtx.el.style.left = card.x + "px";
    dragCtx.el.style.top = card.y + "px";
    if (card.id === selectedId) {
      $inspX.value = card.x;
      $inspY.value = card.y;
    }
    renderConnections();
    drawSnapGuides(snap.vLine, snap.hLine);
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
    drawSnapGuides(snapV, snapH);
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

  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slugifyFilename(state.projectName);
    a.click();
    URL.revokeObjectURL(url);
    toast("Storyboard exported");
  });

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
        clearHistory();
        clearSelection();
        applyProjectName();
        renderAll();
        zoomToFit();
        save();
        setMode("view");
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
     MOBILE CHROME
     ----------------------------------------------------
     Built purely from script — same pattern this file
     already uses for the Undo/Redo buttons. Reuses the
     existing #left-panel (Frames) and #right-panel
     (Inspector) elements, just repositioned into a single
     bottom sheet with tabs, plus a floating "+" button as
     the primary action in place of the topbar's (hidden)
     New Frame button.
     ==================================================== */
  let drawerTab = "frames";
  let drawerCollapsed = false;

  function setDrawerTab(tab) {
    drawerTab = tab === "inspector" ? "inspector" : "frames";
    document.body.dataset.mobileTab = drawerTab;
    document.querySelectorAll(".mobile-drawer-tab").forEach((btn) => {
      const active = btn.dataset.tab === drawerTab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (drawerCollapsed) setDrawerCollapsed(false);
  }

  function setDrawerCollapsed(collapsed) {
    drawerCollapsed = collapsed;
    document.body.classList.toggle("mobile-drawer-collapsed", collapsed);
    const handle = document.getElementById("mobile-drawer-handle");
    if (handle) handle.setAttribute("aria-expanded", String(!collapsed));
    resizeSVG();
    setTimeout(resizeSVG, 220); // after the CSS transition settles
  }

  function toggleDrawerCollapsed() {
    setDrawerCollapsed(!drawerCollapsed);
  }

  function initMobileDrawer() {
    if (document.getElementById("mobile-drawer-bar")) return;

    if ($leftPanel) $leftPanel.setAttribute("role", "tabpanel");
    if ($rightPanel) $rightPanel.setAttribute("role", "tabpanel");

    const bar = document.createElement("div");
    bar.id = "mobile-drawer-bar";

    const handle = document.createElement("button");
    handle.type = "button";
    handle.id = "mobile-drawer-handle";
    handle.setAttribute(
      "aria-label",
      "Collapse or expand the frames and inspector panel",
    );
    handle.setAttribute("aria-expanded", "true");
    handle.addEventListener("click", toggleDrawerCollapsed);
    bar.appendChild(handle);

    const tabs = document.createElement("div");
    tabs.id = "mobile-drawer-tabs";
    tabs.setAttribute("role", "tablist");
    [
      { tab: "frames", label: "Frames" },
      { tab: "inspector", label: "Inspector" },
    ].forEach(({ tab, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-drawer-tab";
      btn.dataset.tab = tab;
      btn.textContent = label;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => setDrawerTab(tab));
      tabs.appendChild(btn);
    });
    bar.appendChild(tabs);

    document.body.appendChild(bar);
    setDrawerTab("frames");
  }

  function initMobileFab() {
    if (document.getElementById("mobile-fab")) return;
    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "mobile-fab";
    fab.setAttribute("aria-label", "New frame");
    fab.textContent = "+";
    fab.addEventListener("click", addCard);
    document.body.appendChild(fab);
  }

  function ensureViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    if (!/viewport-fit/.test(meta.content || "")) {
      meta.content =
        "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
    }
  }

  function injectMobileStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --mobile-drawer-h: clamp(240px, 42vh, 380px);
        --mobile-bar-h: 46px;
        --mobile-sheet-h: calc(var(--mobile-drawer-h) + var(--mobile-bar-h));
      }
      html, body { overscroll-behavior: none; }
      #canvas { touch-action: none; }
      #tooltip { display: none !important; }
      button, .frame-row, .swatch, .card-pin-btn,
      .mode-dropdown-option, .conn-context-menu-item,
      .mobile-drawer-tab, #mobile-drawer-handle, #mobile-fab {
        touch-action: manipulation;
      }

      .card-pin-btn, .block-controls, .frame-del { opacity: 1; }
      .frame-del { opacity: 0.55; }
      .frame-row:active .frame-del { opacity: 1; }
      .card-pin-btn { width: 30px; height: 30px; }
      .swatch { width: 28px; height: 28px; }
      .block-drag-handle, .block-del { width: 26px; height: 26px; }
      .resize-handle { width: 26px; height: 26px; }
      .card { max-width: 92vw; }
      kbd { display: none; }

      .field input[type=text], .field input[type=number], .field textarea,
      .field select, .project-title-input, .block-link-input input, .card-title {
        font-size: 16px;
      }

      #topbar {
        padding-top: env(safe-area-inset-top);
        height: calc(50px + env(safe-area-inset-top));
        padding-left: 8px;
        padding-right: 8px;
        gap: 4px;
      }
      .brand-sub { display: none; }
      #btn-new-frame { display: none; }
      .tbtn span, #btn-undo span:last-child, #btn-redo span:last-child { display: none; }
      .tbtn, #btn-undo, #btn-redo { padding: 8px; min-width: 34px; justify-content: center; }
      .mode-dropdown-btn { min-width: 0; padding: 8px 9px; font-size: 11.5px; }
      .mode-dropdown-menu { max-width: calc(100vw - 16px); }
      .panel-resize-handle { display: none !important; }

      #canvas { margin-bottom: var(--mobile-sheet-h); transition: margin-bottom 0.18s ease; }
      body.mobile-drawer-collapsed #canvas { margin-bottom: var(--mobile-bar-h); }

      #mobile-drawer-bar {
        position: fixed;
        left: 0; right: 0;
        bottom: var(--mobile-drawer-h);
        height: var(--mobile-bar-h);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        background: var(--panel-solid);
        border-top: 1px solid var(--panel-border);
        border-bottom: 1px solid var(--panel-border);
        z-index: 65;
        transition: bottom 0.18s ease;
      }
      body.mobile-drawer-collapsed #mobile-drawer-bar { bottom: 0; }

      #mobile-drawer-handle {
        width: 34px;
        height: 5px;
        border-radius: 3px;
        background: var(--ink-faint);
        opacity: 0.6;
        border: none;
        padding: 0;
        flex-shrink: 0;
      }

      #mobile-drawer-tabs { display: flex; gap: 4px; flex: 1; }
      .mobile-drawer-tab {
        flex: 1;
        background: transparent;
        border: 1px solid transparent;
        color: var(--ink-dim);
        font-family: var(--font-body);
        font-size: 12px;
        font-weight: 600;
        padding: 7px 0;
        border-radius: var(--radius-sm);
      }
      .mobile-drawer-tab.active {
        background: var(--accent-dim);
        color: var(--accent);
        border-color: rgba(var(--accent-rgb), 0.3);
      }

      #left-panel, #right-panel {
        display: flex !important;
        position: fixed !important;
        left: 0; right: 0;
        bottom: 0;
        top: auto;
        width: 100% !important;
        height: var(--mobile-drawer-h);
        padding-bottom: env(safe-area-inset-bottom);
        background: var(--panel-solid);
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.45);
        border: none;
        z-index: 60;
        transition: bottom 0.18s ease;
      }
      body.mobile-drawer-collapsed #left-panel,
      body.mobile-drawer-collapsed #right-panel {
        bottom: calc(-1 * var(--mobile-drawer-h));
      }
      body[data-mobile-tab="frames"] #right-panel { display: none !important; }
      body[data-mobile-tab="inspector"] #left-panel { display: none !important; }
      .panel-section .panel-label {
        position: sticky;
        top: 0;
        background: var(--panel-solid);
        z-index: 1;
      }

      #mobile-fab {
        position: fixed;
        right: 16px;
        bottom: calc(var(--mobile-sheet-h) + 16px);
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--accent);
        color: #11211c;
        font-size: 26px;
        font-weight: 700;
        line-height: 1;
        border: none;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
        z-index: 70;
        transition: bottom 0.18s ease, transform 0.1s ease;
      }
      #mobile-fab:active { transform: scale(0.92); }
      body.mobile-drawer-collapsed #mobile-fab { bottom: calc(var(--mobile-bar-h) + 16px); }
      body.view-mode #mobile-fab { display: none; }

      .conn-context-menu { min-width: 220px; }
      .conn-context-menu-item { padding: 11px 12px; }

      #toast {
        bottom: calc(var(--mobile-sheet-h) + 14px);
        max-width: calc(100vw - 32px);
        text-align: center;
        transition: bottom 0.18s ease, opacity 0.2s ease, transform 0.2s ease;
      }
      body.mobile-drawer-collapsed #toast { bottom: calc(var(--mobile-bar-h) + 14px); }

      .loom-longpress-ripple {
        position: fixed;
        width: 36px;
        height: 36px;
        margin-left: -18px;
        margin-top: -18px;
        border-radius: 50%;
        border: 2px solid var(--accent);
        pointer-events: none;
        z-index: 90;
        animation: loomLongPressGrow ${LONG_PRESS_MS}ms ease forwards;
      }
      @keyframes loomLongPressGrow {
        from { transform: scale(0.3); opacity: 0; }
        to { transform: scale(1); opacity: 0.9; }
      }

      @media (max-width: 380px) {
        .brand-name { display: none; }
        #zoom-readout { display: none; }
        #mode-dropdown-label { display: none; }
        .mode-dropdown-btn { min-width: 0; gap: 0; padding: 8px; }
      }

      @media (prefers-reduced-motion: reduce) {
        #left-panel, #right-panel, #toast, #mobile-drawer-bar,
        #mobile-fab, #canvas, .loom-longpress-ripple {
          transition: none !important;
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function initMobileChrome() {
    ensureViewportMeta();
    injectMobileStyles();
    initMobileDrawer();
    initMobileFab();
  }

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
    initMobileChrome();
    initSVG();
    initSelectionBox();
    initModeDropdown();
    syncModeDropdown();
    initConnContextMenu();

    applyProjectName();
    buildSwatches();
    ensureFrameLineField();
    if (state.cards.length === 0) centerView();
    else applyView();
    renderAll();

    injectUndoRedoButtons();
    pushHistory(); // snapshot of the loaded/initial state

    window.addEventListener("resize", () => {
      applyView();
      resizeSVG();
      closeConnContextMenu();
    });
  }

  init();
})();
