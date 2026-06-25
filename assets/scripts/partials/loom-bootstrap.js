/* ====================================================
     TOP BAR ACTIONS
     ==================================================== */
document.getElementById("btn-new-frame").addEventListener("click", addCard);
document.getElementById("btn-zoom-fit").addEventListener("click", zoomToFit);
document.getElementById("btn-reset-view").addEventListener("click", centerView);

document
  .getElementById("btn-import")
  .addEventListener("click", () => $importInput.click());
$importInput.addEventListener("change", () => {
  var file = $importInput.files[0];
  $importInput.value = "";
  if (!file) return;
  var reader = new FileReader();
  reader.onload = () => {
    try {
      var parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.cards)) throw new Error("bad file");
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

  var savedMode = "edit";
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

  // ── Group reorder drag handlers ──────────────────────
  $frameList.addEventListener("dragover", (e) => {
    var groupRow = e.target.closest(".frame-group-row");
    if (!groupRow) return;
    // Only interested in group drags
    if (!e.dataTransfer.types.includes("application/loom-group")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Highlight drop target
    var draggingRow = $frameList.querySelector(".frame-group-row.dragging");
    if (draggingRow && draggingRow !== groupRow) {
      groupRow.classList.add("drag-over");
    }
  });

  $frameList.addEventListener("dragleave", (e) => {
    var groupRow = e.target.closest(".frame-group-row");
    if (groupRow) groupRow.classList.remove("drag-over");
  });

  $frameList.addEventListener("drop", (e) => {
    e.preventDefault();

    // --- Handle group reorder ---
    var groupId = e.dataTransfer.getData("application/loom-group");
    if (groupId) {
      var draggedGroup = state.groups.find((g) => g.id === groupId);
      if (!draggedGroup) return;

      // Determine which group row the drop is on (if any)
      var targetRow = e.target.closest(".frame-group-row");
      if (targetRow) {
        var targetGroupId = targetRow.dataset.groupId;
        var targetGroup = state.groups.find((g) => g.id === targetGroupId);
        if (targetGroup && targetGroup.id !== groupId) {
          // Reorder: move draggedGroup before or after targetGroup based on mouse Y
          var rect = targetRow.getBoundingClientRect();
          var midY = rect.top + rect.height / 2;
          var insertBefore = e.clientY < midY;
          var currentOrder = state.groups.map((g) => g.id);
          var fromIndex = currentOrder.indexOf(groupId);
          var toIndex = currentOrder.indexOf(targetGroupId);
          if (fromIndex === -1 || toIndex === -1) return;
          // Remove dragged from its current position
          currentOrder.splice(fromIndex, 1);
          // Recalculate toIndex after removal
          if (toIndex > fromIndex) toIndex--;
          if (!insertBefore) toIndex++;
          currentOrder.splice(toIndex, 0, groupId);
          // Update order property
          currentOrder.forEach((id, idx) => {
            var g = state.groups.find((g) => g.id === id);
            if (g) g.order = idx;
          });
          renderFrameList();
          pushHistory();
          save();
          toast("Group reordered");
        }
      }
      return; // stop processing frame drops
    }

    // --- Handle frame drop ---
    var cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    var rootCard = getCard(cardId);
    if (!rootCard) return;
    if (rootCard.groupId !== null) {
      // 1. Remove any incoming connection (parent → this frame)
      state.connections = state.connections.filter(function (c) {
        return c.toId !== cardId;
      });

      // 2. Move the whole subtree out of the group
      var descendantIds = getAllDescendants(cardId);
      [cardId].concat(descendantIds).forEach(function (id) {
        var c = getCard(id);
        if (c) c.groupId = null;
      });

      renderFrameList();
      renderConnections();
      pushHistory();
      save();
      toast(
        "Removed frame" + (descendantIds.length ? "s" : "") + " from group",
      );
    }
  });
}

init();

window.LoomModules = window.LoomModules || {};
window.LoomModules.bootstrap = true;
