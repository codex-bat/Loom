/* ====================================================
   SHARED CARD INTERACTIONS (drag, resize, block reorder,
   connection drawing)
   ==================================================== */

/* ------- Card dragging (single) ------- */
let dragCtx = null;
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
  } catch (_) {}
  window.addEventListener("pointermove", onDragCardMove);
  window.addEventListener("pointerup", onDragCardUp, { once: true });
  window.addEventListener("pointercancel", onDragCardUp, { once: true });
}

function onDragCardMove(e) {
  if (!dragCtx?.active) return;
  const card = getCard(dragCtx.id);
  if (!card) return;
  dragCtx.hasMoved = true;
  let dx = (e.clientX - dragCtx.startScreenX) / state.view.scale;
  let dy = (e.clientY - dragCtx.startScreenY) / state.view.scale;
  let nx = Math.round(dragCtx.startX + dx);
  let ny = Math.round(dragCtx.startY + dy);

  let snapV = null,
    snapH = null;
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
  renderConnections(); // clears snap guides
  if (moved) pushHistory();
  save();
}

/* ------- Group dragging (multi‑select) ------- */
let groupDragCtx = null;
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
  } catch (_) {}
  window.addEventListener("pointermove", onGroupDragMove);
  window.addEventListener("pointerup", onGroupDragUp, { once: true });
  window.addEventListener("pointercancel", onGroupDragUp, { once: true });
}

function onGroupDragMove(e) {
  if (!groupDragCtx?.active) return;
  groupDragCtx.hasMoved = true;
  let dx = (e.clientX - groupDragCtx.startScreenX) / state.view.scale;
  let dy = (e.clientY - groupDragCtx.startScreenY) / state.view.scale;

  let snapDx = 0,
    snapDy = 0,
    snapV = null,
    snapH = null;
  if (e.ctrlKey) {
    const anchorStart = groupDragCtx.cards.get(groupDragCtx.anchorId);
    if (anchorStart?.card) {
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
  renderConnections();
  if (moved) pushHistory();
  save();
}

/* ------- Resize ------- */
let resizeCtx = null;
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
  } catch (_) {}
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

/* ------- Block reorder ------- */
let blockDragCtx = null;
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
  } catch (_) {}
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
  let target = null,
    placeBefore = true;
  for (const sib of siblings) {
    const r = sib.getBoundingClientRect(),
      mid = r.top + r.height / 2;
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
  if (target)
    body.insertBefore(wrap, placeBefore ? target : target.nextSibling);
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

/* ------- Connection drag (from pin button) ------- */
let connDrag = null,
  connAnimId = null;
let belly = { x: 0, y: 0, vx: 0, vy: 0 };
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
  const cardEl = el?.closest(".card");
  const hovId = cardEl ? cardEl.dataset.cardId : null;
  let validTarget = null,
    hoverInvalid = false;
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
  if (connDrag?.targetId) {
    const fromCard = getCard(connDrag.fromId),
      toCard = getCard(connDrag.targetId);
    if (fromCard && toCard) {
      linkedConn = {
        id: uid(),
        fromId: connDrag.fromId,
        toId: connDrag.targetId,
        layer: "front",
      };
      state.connections.push(linkedConn);
      const parentGroup = fromCard.groupId;
      [toCard.id, ...getAllDescendants(toCard.id)].forEach((id) => {
        const c = getCard(id);
        if (c) c.groupId = parentGroup;
      });
      renderFrameList();
      pushHistory();
      save();
    }
  } else if (connDrag?.hoverInvalid) {
    toast("Cannot link — frame already has a parent or would create a cycle");
  }
  const lastBellyX = belly.x,
    lastBellyY = belly.y;
  connDrag = null;
  if (linkedConn) {
    const fromCard = getCard(linkedConn.fromId),
      toCard = getCard(linkedConn.toId);
    if (fromCard && toCard)
      startSettleAnim(linkedConn.id, fromCard, toCard, lastBellyX, lastBellyY);
  }
  renderConnections();
}

function animConnDrag() {
  if (!connDrag) return;
  const fromCard = getCard(connDrag.fromId);
  if (!fromCard) return;
  const fp = getConnPoint(fromCard);
  const { mouseX, mouseY } = connDrag;
  const dx = mouseX - fp.x,
    dy = mouseY - fp.y,
    dist = Math.hypot(dx, dy);
  const targetX = (fp.x + mouseX) / 2;
  const targetY = (fp.y + mouseY) / 2 + dist * 0.28 + 36;
  const k = 0.09,
    grav = 1.5,
    damp = 0.86;
  belly.vx += (targetX - belly.x) * k;
  belly.vy += (targetY - belly.y) * k + grav;
  belly.vx *= damp;
  belly.vy *= damp;
  belly.x += belly.vx;
  belly.y += belly.vy;
  renderConnections();
  connAnimId = requestAnimationFrame(animConnDrag);
}

function startSettleAnim(connId, fromCard, toCard, startX, startY) {
  const fp = getConnPoint(fromCard),
    tp = getConnPoint(toCard);
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

function easeOutBack(t) {
  const c1 = 1.7,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function renderDragString() {
  const fromCard = getCard(connDrag.fromId);
  if (!fromCard) return;
  const fp = getConnPoint(fromCard);
  const { mouseX, mouseY, targetId, hoverInvalid } = connDrag;
  const d = `M ${fp.x} ${fp.y} Q ${belly.x} ${belly.y} ${mouseX} ${mouseY}`;
  const isValid = !!targetId,
    isInvalid = hoverInvalid && !isValid;
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

window.LoomModules = window.LoomModules || {};
window.LoomModules.interactions = true;