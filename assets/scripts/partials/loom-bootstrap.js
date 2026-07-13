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
    <span class="new-element-icon new-element-icon-${id}" style="flex-shrink:0; width:20px; text-align:center; font-size:13px;">
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
   FRAME LIST (moved from loom-frames.js)
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

function getAllDescendants(cardId) {
  var result = [],
    stack = [cardId];
  while (stack.length) {
    var id = stack.pop();
    state.connections
      .filter((c) => c.fromId === id)
      .forEach((c) => {
        result.push(c.toId);
        stack.push(c.toId);
      });
  }
  return result;
}

function renderFrameList() {
  $frameList.innerHTML = "";
  $emptyFrames.classList.toggle("show", state.cards.length === 0);

  var header = document.createElement("div");
  header.className = "frame-list-header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  var label = document.createElement("span");
  label.className = "panel-label";
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

  state.groups
    .sort((a, b) => a.order - b.order)
    .forEach((group) => {
      var groupCards = state.cards.filter((c) => c.groupId === group.id);
      var groupTopCards = groupCards.filter((c) => !hasParent(c.id));
      var groupRow = buildGroupRow(group, groupCards.length);
      $frameList.appendChild(groupRow);
      if (!group.collapsed) {
        groupTopCards.forEach((c) => renderNode(c.id, 1));
        groupTopCards.forEach((c) => {
          if (!visited.has(c.id)) renderNode(c.id, 1);
        });
      } else {
        var allIds = [];
        groupTopCards.forEach((c) => {
          allIds.push(c.id);
          allIds.push(...getAllDescendants(c.id));
        });
        allIds.forEach((id) => visited.add(id));
      }
    });

  var ungrouped = state.cards.filter((c) => !c.groupId && !hasParent(c.id));
  ungrouped.forEach((c) => renderNode(c.id, 0));
  ungrouped.forEach((c) => {
    if (!visited.has(c.id)) renderNode(c.id, 0);
  });
  state.cards.forEach((c) => {
    if (!visited.has(c.id)) renderNode(c.id, 0);
  });
  syncSelectedCardClasses();
}

/* Helper: return a human-readable placeholder based on the element type */
function getElementPlaceholder(card) {
  var def = window.LoomElements && window.LoomElements[card.type];
  var name = def && def.name ? def.name : "element";
  return "Untitled " + name.toLowerCase();
}

function buildFrameRow(card, num, depth) {
  var row = document.createElement("div");
  row.className = "frame-row" + (selectedIds.has(card.id) ? " selected" : "");
  row.dataset.cardId = card.id;
  row.style.paddingLeft = 8 + depth * 12 + "px";
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
  title.textContent = card.title || getElementPlaceholder(card);
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

function panToCard(card) {
  var rect = $canvas.getBoundingClientRect();
  state.view.x = rect.width / 2 - (card.x + card.w / 2) * state.view.scale;
  state.view.y = rect.height / 2 - (card.y + card.h / 2) * state.view.scale;
  applyView();
  save();
}

function renderFrameListSoft() {
  state.cards.forEach((card) => {
    var titleEl = $frameList.querySelector(
      `[data-card-id="${card.id}"] .frame-title`,
    );
    if (titleEl)
      titleEl.textContent = card.title || getElementPlaceholder(card);
  });
}

/* ------- Group row & context menu ------- */
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

function buildGroupRow(group, count) {
  var row = document.createElement("div");
  row.className = "frame-group-row" + (group.hidden ? " group-hidden" : "");
  row.dataset.groupId = group.id;
  row.draggable = false;

  var toggle = document.createElement("span");
  toggle.className = "group-collapse-toggle";
  toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (group.collapsed) toggle.classList.add("collapsed");
  if (group.hidden) toggle.classList.add("collapsed");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGroupCollapse(group.id);
  });

  var dragHandle = document.createElement("span");
  dragHandle.className = "group-drag-handle";
  dragHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1.4" width="10" height="1.6" rx="0.8"/><rect x="1" y="5.2" width="10" height="1.6" rx="0.8"/><rect x="1" y="9" width="10" height="1.6" rx="0.8"/></svg>`;
  dragHandle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    row.draggable = true;
  });
  dragHandle.addEventListener("pointerup", () => {
    row.draggable = false;
  });

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

  var countSpan = document.createElement("span");
  countSpan.className = "group-count";
  countSpan.textContent = count;

  var borderBtn = document.createElement("button");
  borderBtn.type = "button";
  borderBtn.className = "group-action-btn";
  borderBtn.dataset.tooltip = "Toggle group border highlight";
  borderBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/></svg>`;
  borderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    group.showBorder = !group.showBorder;
    pushHistory();
    save();
    renderAll();
  });

  var hideBtn = document.createElement("button");
  hideBtn.type = "button";
  hideBtn.className = "group-action-btn";
  hideBtn.dataset.tooltip = group.hidden
    ? "Show group frames"
    : "Hide group frames";
  hideBtn.innerHTML = group.hidden
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  hideBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    group.hidden = !group.hidden;
    if (group.hidden) {
      group.collapsed = true;
      group.showBorder = false;
    } else group.collapsed = false;
    pushHistory();
    save();
    renderAll();
  });

  row.appendChild(toggle);
  row.appendChild(dragHandle);
  row.appendChild(nameInput);
  row.appendChild(countSpan);
  row.appendChild(borderBtn);
  row.appendChild(hideBtn);

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === "view" || group.hidden) return;
    openGroupContextMenu(e, group);
  });

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
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    var cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    e.stopPropagation();
    row.classList.remove("drag-over");
    var rootCard = getCard(cardId);
    if (!rootCard) return;
    if (rootCard.groupId === group.id) {
      toast("Frame already belongs to this group");
      return;
    }
    state.connections = state.connections.filter((c) => c.toId !== cardId);
    var descendantIds = getAllDescendants(cardId);
    [cardId, ...descendantIds].forEach((id) => {
      var c = getCard(id);
      if (c) c.groupId = group.id;
    });
    renderFrameList();
    renderConnections();
    pushHistory();
    save();
    toast(
      `Moved ${1 + descendantIds.length} frame${descendantIds.length ? "s" : ""} to "${group.name}"`,
    );
  });

  if (group.hidden) {
    toggle.style.pointerEvents = "none";
    toggle.style.opacity = "0.3";
    dragHandle.style.pointerEvents = "none";
    row.draggable = false;
    nameInput.readOnly = true;
    nameInput.style.pointerEvents = "none";
    borderBtn.disabled = true;
    borderBtn.style.pointerEvents = "none";
    borderBtn.classList.add("disabled");
  }
  return row;
}

var $groupContextMenu = null;
function ensureGroupContextMenu() {
  if (!$groupContextMenu) {
    var menu = document.createElement("div");
    menu.className = "group-context-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(menu);
    $groupContextMenu = menu;
  }
  return $groupContextMenu;
}
function openGroupContextMenu(e, group) {
  var menu = ensureGroupContextMenu();
  menu.innerHTML = "";
  menu.appendChild(
    buildGroupMenuItem({
      label: group.hidden ? "Show Frames" : "Hide Frames",
      onClick: () => {
        group.hidden = !group.hidden;
        if (group.hidden) {
          group.collapsed = true;
          group.showBorder = false;
        } else group.collapsed = false;
        pushHistory();
        save();
        renderAll();
      },
    }),
  );
  menu.appendChild(
    buildGroupMenuItem({
      label: group.showBorder ? "Hide Borders" : "Show Borders",
      onClick: () => {
        group.showBorder = !group.showBorder;
        pushHistory();
        save();
        renderAll();
      },
    }),
  );
  var divider = document.createElement("div");
  divider.className = "group-context-menu-divider";
  menu.appendChild(divider);
  menu.appendChild(
    buildGroupMenuItem({
      label: "Delete Group",
      danger: true,
      onClick: () => deleteGroup(group.id),
    }),
  );
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.classList.add("open");
  var rect = menu.getBoundingClientRect(),
    vw = window.innerWidth,
    vh = window.innerHeight,
    x = e.clientX,
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
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
    closeGroupContextMenu();
  });
  return btn;
}
function closeGroupContextMenu() {
  if ($groupContextMenu) $groupContextMenu.classList.remove("open");
}

/* ====================================================
   INSPECTOR (moved from loom-frames.js, now dynamic)
   ==================================================== */

// Wrap existing inspector children (except the delete button) so they can be hidden/shown
function wrapDefaultInspector() {
  var wrap = document.createElement("div");
  wrap.id = "insp-default-wrap";

  // Move all children of $inspectorContent EXCEPT the delete button into the wrap
  var children = Array.from($inspectorContent.children);
  children.forEach(function (child) {
    if (child.id !== "btn-delete-frame") {
      wrap.appendChild(child);
    }
  });

  // Insert the wrap at the very beginning (before any remaining child, like the delete button)
  $inspectorContent.insertBefore(wrap, $inspectorContent.firstChild);
}

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
  if (anchor?.parentElement) anchor.insertAdjacentElement("afterend", field);
  else $inspectorContent.appendChild(field);
  $inspFrameLine = selector;
  return $inspFrameLine;
}

function renderInspector() {
  var defaultWrap = document.getElementById("insp-default-wrap");

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

  var def = window.LoomElements && window.LoomElements[card.type];
  var hasCustom = def && typeof def.renderInspector === "function";

  // Show/hide default fields
  if (defaultWrap) {
    defaultWrap.style.display = hasCustom ? "none" : "";
  }

  // Hide all element‑specific custom wrappers
  var customWrappers = $inspectorContent.querySelectorAll("[id^='insp-wrap-']");
  customWrappers.forEach(function (w) {
    w.style.display = "none";
  });

  if (hasCustom) {
    var wrapId = "insp-wrap-" + card.type;
    var customWrap = document.getElementById(wrapId);

    // Create the wrapper once and fill it
    if (!customWrap) {
      customWrap = document.createElement("div");
      customWrap.id = wrapId;
      customWrap.style.display = "none"; // will be shown below

      var content = def.renderInspector(card);
      if (content) {
        customWrap.appendChild(content);
      }

      // Insert before the delete button (which is always a direct child)
      var deleteBtn = document.getElementById("btn-delete-frame");
      if (deleteBtn && deleteBtn.parentNode === $inspectorContent) {
        $inspectorContent.insertBefore(customWrap, deleteBtn);
      } else {
        $inspectorContent.appendChild(customWrap);
      }
    } else {
      // Update the existing custom inspector content (re‑render)
      customWrap.innerHTML = "";
      var updatedContent = def.renderInspector(card);
      if (updatedContent) {
        customWrap.appendChild(updatedContent);
      }
    }

    customWrap.style.display = "";
  }

  // If using default inspector, fill its fields
  if (!hasCustom) {
    $inspTitle.value = card.title;
    $inspX.value = card.x;
    $inspY.value = card.y;
    $inspW.value = card.w;
    $inspH.value = card.h;
    $inspNotes.value = card.notes || "";

    if (card.hasOwnProperty("frameLine")) {
      ensureFrameLineField();
      syncFrameLineSelector(card.frameLine);
      var ff = document.getElementById("insp-frame-line-field");
      if (ff) ff.style.display = "";
    } else {
      var ff = document.getElementById("insp-frame-line-field");
      if (ff) ff.style.display = "none";
    }

    $inspSwatches.querySelectorAll(".swatch").forEach(function (sw) {
      sw.classList.toggle("active", sw.dataset.color === card.color);
    });
    syncMarkdownPreviews();
  }

  $inspectorEmpty.classList.add("hidden");
  $inspectorContent.classList.remove("hidden");
  applyInspectorMode();
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

/* Project title (unchanged) */
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

/* ====================================================
   INIT
   ==================================================== */
function init() {
  load();
  state.cards = state.cards.map(normalizeCard);
  state.connections = state.connections.map(normalizeConnection);
  if (!state.projectName) state.projectName = "Untitled Storyboard";
  var savedMode = "edit";
  try {
    savedMode = localStorage.getItem(MODE_STORAGE_KEY) || "edit";
  } catch (_) {}
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

  wrapDefaultInspector();

  if (state.cards.length === 0) centerView();
  else applyView();
  renderAll();
  injectUndoRedoButtons();
  setupNewElementDropdown();
  pushHistory();
  window.addEventListener("resize", () => {
    applyPanelLayout();
    applyView();
    resizeSVG();
    closeConnContextMenu();
  });

  $frameList.addEventListener("dragover", (e) => {
    var groupRow = e.target.closest(".frame-group-row");
    if (!groupRow) return;
    if (!e.dataTransfer.types.includes("application/loom-group")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    var draggingRow = $frameList.querySelector(".frame-group-row.dragging");
    if (draggingRow && draggingRow !== groupRow)
      groupRow.classList.add("drag-over");
  });
  $frameList.addEventListener("dragleave", (e) => {
    var groupRow = e.target.closest(".frame-group-row");
    if (groupRow) groupRow.classList.remove("drag-over");
  });
  $frameList.addEventListener("drop", (e) => {
    e.preventDefault();
    var groupId = e.dataTransfer.getData("application/loom-group");
    if (groupId) {
      var draggedGroup = state.groups.find((g) => g.id === groupId);
      if (!draggedGroup) return;
      var targetRow = e.target.closest(".frame-group-row");
      if (targetRow) {
        var targetGroupId = targetRow.dataset.groupId,
          targetGroup = state.groups.find((g) => g.id === targetGroupId);
        if (targetGroup && targetGroup.id !== groupId) {
          var rect = targetRow.getBoundingClientRect(),
            midY = rect.top + rect.height / 2,
            insertBefore = e.clientY < midY;
          var currentOrder = state.groups.map((g) => g.id),
            fromIndex = currentOrder.indexOf(groupId),
            toIndex = currentOrder.indexOf(targetGroupId);
          if (fromIndex === -1 || toIndex === -1) return;
          currentOrder.splice(fromIndex, 1);
          if (toIndex > fromIndex) toIndex--;
          if (!insertBefore) toIndex++;
          currentOrder.splice(toIndex, 0, groupId);
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
      return;
    }
    var cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    var rootCard = getCard(cardId);
    if (!rootCard) return;
    if (rootCard.groupId !== null) {
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
      toast(
        "Removed frame" + (descendantIds.length ? "s" : "") + " from group",
      );
    }
  });
}

window.LoomInit = init;
window.LoomModules = window.LoomModules || {};
window.LoomModules.bootstrap = true;
