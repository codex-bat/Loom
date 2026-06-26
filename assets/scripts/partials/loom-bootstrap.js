/* ====================================================
     TOP BAR ACTIONS
     ==================================================== */
// document.getElementById("btn-new-frame").addEventListener("click", addCard); - no longer used. we have the new system for any and all elements now
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
  // Clear all child elements except SVGs
  Array.from($world.children).forEach((child) => {
    if (child !== $svg && child !== $svgBack) child.remove();
  });

  // Render each card using its element definition
  state.cards.forEach(function (card, i) {
    if (isCardHidden(card)) return;

    const def = window.LoomElements && window.LoomElements[card.type];
    if (def && typeof def.render === "function") {
      $world.appendChild(def.render(card, i + 1));
    } else {
      // fallback: use the frame renderer (if available)
      const fallback = window.LoomElements && window.LoomElements["frame"];
      if (fallback && typeof fallback.render === "function") {
        $world.appendChild(fallback.render(card, i + 1));
      } else {
        console.warn("No renderer found for card type:", card.type);
      }
    }
  });

  // Re-append SVG layers (they are already in $world or need to be moved)
  if ($svgBack) {
    if ($svgBack.parentNode !== $world) $world.appendChild($svgBack);
    else $world.appendChild($svgBack);
  }
  if ($svg) {
    if ($svg.parentNode !== $world) $world.appendChild($svg);
    else $world.appendChild($svg);
  }

  renderConnections();
  syncSelectedCardClasses();
  bindMarkdownFields();
}

function setupNewElementDropdown() {
  const oldBtn = document.getElementById("btn-new-frame");
  if (!oldBtn) return;

  // Wrapper (relative container)
  const dropdown = document.createElement("div");
  dropdown.className = "new-element-dropdown";
  dropdown.style.position = "relative";
  dropdown.style.display = "inline-flex";
  dropdown.style.alignItems = "center";

  // Trigger button – keep the original ID so the accent style still works
  const trigger = document.createElement("button");
  trigger.id = "btn-new-frame";
  trigger.className = "tbtn";
  trigger.dataset.tooltip = "Create new element";
  trigger.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg><span>New</span>`;

  // Menu – use the existing dropdown classes so transitions / styles work
  const menu = document.createElement("ul");
  menu.className = "mode-dropdown-menu";
  menu.setAttribute("role", "menu");
  menu.style.minWidth = "180px"; // a little wider than the default

  // Toggle open/close on trigger click
  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    const isOpen = menu.classList.contains("open");
    menu.classList.toggle("open", !isOpen);
    trigger.setAttribute("aria-expanded", String(!isOpen));
  });

  dropdown.appendChild(trigger);
  dropdown.appendChild(menu);

  // Replace the old static button with this dropdown
  oldBtn.parentNode.replaceChild(dropdown, oldBtn);

  // ---------- populate the menu when elements are ready ----------
  function populateMenu() {
    const registry = window.LoomElements || {};
    const entries = Object.entries(registry);

    if (entries.length === 0) {
      const item = document.createElement("li");
      item.className = "mode-dropdown-option";
      item.textContent = "No elements loaded";
      item.style.color = "var(--ink-faint)";
      item.style.pointerEvents = "none";
      menu.appendChild(item);
      return;
    }

    entries.forEach(([id, def]) => {
      const li = document.createElement("li");
      li.className = "mode-dropdown-option";
      li.setAttribute("role", "menuitem");
      li.innerHTML = `
        <span class="new-element-icon" style="flex-shrink:0; width:20px; text-align:center; font-size:13px;">
          ${def.icon || ""}
        </span>
        <span class="option-label">${def.name || id}</span>
      `;
      li.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof def.factory === "function") {
          const card = def.factory();
          state.cards.push(card);
          renderAll();
          selectCard(card.id);
          pushHistory();
          save();
          toast(`Added ${def.name || id}`);
        } else {
          toast("This element cannot be created");
        }
        menu.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      });
      menu.appendChild(li);
    });
  }

  // Close menu on outside click or Escape
  document.addEventListener("click", function (e) {
    if (!dropdown.contains(e.target)) {
      menu.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  // Populate now or wait for the elements‑ready event
  if (window.LoomElements && Object.keys(window.LoomElements).length > 0) {
    populateMenu();
  } else {
    document.addEventListener("loom-elements-ready", function onReady() {
      populateMenu();
      document.removeEventListener("loom-elements-ready", onReady);
    });
  }
}

/* ====================================================
     PUBLIC API — consumed by scripts/loom-export.js
     ----------------------------------------------------
     Kept deliberately small: just enough read access for the
     exporter to build a Project (.json) download and a
     Storyboard (.png) snapshot without it having to reach into
     app.js's closures directly.
     ==================================================== */

function slugifyFilename(name) {
  var base = (name || "storyboard")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-");
  return (base || "storyboard") + ".json";
}

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

  setupNewElementDropdown();

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

// Expose the init function globally – app.js will call it after everything is ready
window.LoomInit = init;

window.LoomModules = window.LoomModules || {};
window.LoomModules.bootstrap = true;
