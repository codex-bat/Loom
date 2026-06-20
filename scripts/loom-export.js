(() => {
  "use strict";

  /* ====================================================
     loom-export.js

     Exports:
       • Project (.json)
       • Storyboard (.png)

     The storyboard export captures the rendered board in
     view mode so text, markdown, images, theme details, and
     any other view-only presentation are preserved as closely
     as possible.
     ==================================================== */

  const HTML2CANVAS_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  const EXPORT_PADDING = 90;
  const MAX_EXPORT_DIMENSION = 8000;

  let html2canvasPromise = null;

  function getApp() {
    return window.LoomApp || null;
  }

  function slugifyFilename(name, ext) {
    const safeBase = String(name || "storyboard")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "-");
    return `${safeBase || "storyboard"}.${ext}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function waitForFonts() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return document.fonts.ready.catch(() => undefined);
  }

  async function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        if (typeof img.decode === "function") {
          return img.decode().catch(() => undefined);
        }
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  }

  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;

    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HTML2CANVAS_SRC;
      script.async = true;
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () =>
        reject(new Error("Could not load the image-export library"));
      document.head.appendChild(script);
    });

    return html2canvasPromise;
  }

  function getCurrentMode() {
    const app = getApp();
    if (app && typeof app.getMode === "function") {
      return app.getMode() === "view" ? "view" : "edit";
    }
    return document.body.classList.contains("view-mode") ? "view" : "edit";
  }

  function triggerModeChange(nextMode) {
    const opt = document.querySelector(
      `#mode-dropdown-menu .mode-dropdown-option[data-value="${nextMode}"]`,
    );
    if (!opt) return false;
    opt.click();
    return true;
  }

  async function ensureMode(nextMode) {
    if (getCurrentMode() === nextMode) return true;
    if (!triggerModeChange(nextMode)) return false;
    await nextFrame();
    await nextFrame();
    await nextFrame();
    return getCurrentMode() === nextMode;
  }


  function ensureCaptureStyles() {
    if (document.getElementById("loom-export-capture-styles")) return;

    const style = document.createElement("style");
    style.id = "loom-export-capture-styles";
    style.textContent = `
      .loom-export-capture-wrap {
        position: fixed;
        left: -100000px;
        top: 0;
        pointer-events: none;
        overflow: visible;
        background: transparent;
      }

      .loom-export-capture-wrap .card-toolbar,
      .loom-export-capture-wrap .resize-handle,
      .loom-export-capture-wrap .block-controls,
      .loom-export-capture-wrap .block-link-input,
      .loom-export-capture-wrap .block-del,
      .loom-export-capture-wrap .block-drag-handle,
      .loom-export-capture-wrap .conn-hit,
      .loom-export-capture-wrap .selection-box,
      .loom-export-capture-wrap .toast,
      .loom-export-capture-wrap .tooltip,
      .loom-export-capture-wrap .conn-context-menu,
      .loom-export-capture-wrap .mode-dropdown-menu,
      .loom-export-capture-wrap .export-dropdown-menu {
        display: none !important;
      }

      .loom-export-capture-wrap .card {
        cursor: default !important;
        box-shadow: none !important;
      }

      .loom-export-capture-wrap .card.selected,
      .loom-export-capture-wrap .card.conn-target,
      .loom-export-capture-wrap .card.conn-invalid,
      .loom-export-capture-wrap .card.selection-preview,
      .loom-export-capture-wrap .card.dragging,
      .loom-export-capture-wrap .card.block-dragging {
        outline: none !important;
        box-shadow: none !important;
      }

      .loom-export-capture-wrap .card-pin-btn {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      .loom-export-capture-wrap .card-title-static {
        display: inline-block;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font: inherit;
        color: inherit;
      }

      .loom-export-capture-wrap .card-title-static.placeholder {
        opacity: 0.65;
      }

      .loom-export-capture-wrap input.card-title::placeholder {
        color: transparent !important;
        opacity: 0 !important;
      }

      .loom-export-capture-wrap svg {
        overflow: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  function copyCanvasStyles(sourceCanvas, targetCanvas) {
    if (!sourceCanvas || !targetCanvas) return;
    const cs = getComputedStyle(sourceCanvas);
    [
      "backgroundColor",
      "backgroundImage",
      "backgroundSize",
      "backgroundPosition",
      "backgroundRepeat",
      "backgroundAttachment",
      "backgroundClip",
      "backgroundOrigin",
      "backgroundBlendMode",
      "borderRadius",
      "boxShadow",
    ].forEach((prop) => {
      targetCanvas.style[prop] = cs[prop];
    });
  }

  function svgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("version", "1.1");
    const serialized = new XMLSerializer().serializeToString(clone);
    const bytes = new TextEncoder().encode(serialized);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function replaceSvgWithImage(svg, width, height) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "eager";
    img.src = svgToDataUrl(svg);

    const cs = getComputedStyle(svg);
    img.style.position = cs.position || "absolute";
    img.style.left = cs.left || "0px";
    img.style.top = cs.top || "0px";
    img.style.width = cs.width || `${width}px`;
    img.style.height = cs.height || `${height}px`;
    img.style.zIndex = cs.zIndex || "0";
    img.style.pointerEvents = cs.pointerEvents || "none";
    img.style.overflow = "visible";
    img.style.display = cs.display || "block";
    img.style.transform = cs.transform || "none";
    img.style.transformOrigin = cs.transformOrigin || "0 0";
    img.style.opacity = cs.opacity || "1";

    svg.replaceWith(img);
    return img;
  }

  function clearTransientClasses(root) {
    root
      .querySelectorAll(
        [
          ".selected",
          ".conn-target",
          ".conn-invalid",
          ".selection-preview",
          ".dragging",
          ".block-dragging",
          ".active",
          ".panning",
          ".selecting",
          ".space-down",
        ].join(","),
      )
      .forEach((el) => {
        el.classList.remove(
          "selected",
          "conn-target",
          "conn-invalid",
          "selection-preview",
          "dragging",
          "block-dragging",
          "active",
          "panning",
          "selecting",
          "space-down",
        );
      });
  }

  function normalizeSvgForCapture(svg, width, height) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("overflow", "visible");
    svg.style.overflow = "visible";
  }

  function buildCaptureClone(bounds) {
    const liveCanvas = document.getElementById("canvas");
    const liveWorld = document.getElementById("world");
    if (!liveCanvas || !liveWorld) return null;

    const width = Math.ceil(bounds.maxX - bounds.minX + EXPORT_PADDING * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + EXPORT_PADDING * 2);

    const wrap = document.createElement("div");
    wrap.className = "loom-export-capture-wrap";
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;

    const cloneCanvas = liveCanvas.cloneNode(true);
    cloneCanvas.id = liveCanvas.id;
    cloneCanvas.setAttribute("data-export-clone", "true");
    cloneCanvas.style.position = "absolute";
    cloneCanvas.style.left = "0";
    cloneCanvas.style.top = "0";
    cloneCanvas.style.pointerEvents = "none";
    cloneCanvas.style.width = `${width}px`;
    cloneCanvas.style.height = `${height}px`;
    cloneCanvas.style.overflow = "hidden";
    cloneCanvas.style.transform = "none";
    cloneCanvas.style.zIndex = "0";

    copyCanvasStyles(liveCanvas, cloneCanvas);

    const cloneWorld = cloneCanvas.querySelector("#world");
    if (!cloneWorld) return null;

    cloneWorld.id = liveWorld.id;
    cloneWorld.setAttribute("data-export-clone", "true");
    cloneWorld.style.position = "absolute";
    cloneWorld.style.left = "0";
    cloneWorld.style.top = "0";
    cloneWorld.style.transform = `translate(${Math.round(
      EXPORT_PADDING - bounds.minX,
    )}px, ${Math.round(EXPORT_PADDING - bounds.minY)}px) scale(1)`;
    cloneWorld.style.transformOrigin = "0 0";
    cloneWorld.style.pointerEvents = "none";

    clearTransientClasses(cloneCanvas);

    cloneCanvas.querySelectorAll("input.card-title").forEach((input) => {
      if (String(input.value || "").trim()) return;
      input.placeholder = "";
      input.value = "";
    });

    cloneCanvas.querySelectorAll("#conn-svg-back, #conn-svg").forEach((svg) => {
      normalizeSvgForCapture(svg, width, height);
      replaceSvgWithImage(svg, width, height);
    });

    wrap.appendChild(cloneCanvas);
    document.body.appendChild(wrap);
    return { wrap, width, height };
  }

  async function exportProject() {
    const app = getApp();
    if (!app) return;

    const state = app.getState ? app.getState() : null;
    if (!state) return;

    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });

    const projectName =
      typeof app.getProjectName === "function"
        ? app.getProjectName()
        : "Untitled Storyboard";

    const filename = app.slugifyFilename
      ? app.slugifyFilename(projectName)
      : slugifyFilename(projectName, "json");

    downloadBlob(blob, filename);
    if (typeof app.toast === "function") app.toast("Project exported");
  }

  async function exportStoryboard() {
    const app = getApp();
    if (!app) return;

    const state = app.getState ? app.getState() : null;
    if (!state || !Array.isArray(state.cards) || state.cards.length === 0) {
      if (typeof app.toast === "function") {
        app.toast("Nothing to export yet — add a frame first");
      }
      return;
    }

    const bounds =
      typeof app.getCardsBounds === "function" ? app.getCardsBounds() : null;
    if (!bounds) {
      if (typeof app.toast === "function") {
        app.toast("Nothing to export yet — add a frame first");
      }
      return;
    }

    const originalMode = getCurrentMode();
    const changedMode = originalMode !== "view";

    if (typeof app.toast === "function") {
      app.toast("Rendering storyboard image…");
    }

    try {
      if (changedMode) {
        const switched = await ensureMode("view");
        if (!switched) {
          if (typeof app.toast === "function") {
            app.toast("Could not switch to view mode for export");
          }
          return;
        }
      }

      await waitForFonts();
      await nextFrame();
      await nextFrame();
      await nextFrame();

      const liveWorld = document.getElementById("world");
      if (liveWorld) {
        await waitForImages(liveWorld);
      }

      ensureCaptureStyles();

      const built = buildCaptureClone(bounds);
      if (!built) {
        if (typeof app.toast === "function") {
          app.toast("Could not generate the image");
        }
        return;
      }

      const { wrap, width, height } = built;

      try {
        await waitForImages(wrap);
        const html2canvas = await loadHtml2Canvas();

        let scale = Math.min(2, window.devicePixelRatio || 1.5);
        const longestEdge = Math.max(width, height);
        if (longestEdge * scale > MAX_EXPORT_DIMENSION) {
          scale = Math.max(1, MAX_EXPORT_DIMENSION / longestEdge);
        }

        const canvas = await html2canvas(wrap, {
          backgroundColor: null,
          width,
          height,
          scale,
          useCORS: true,
          logging: false,
          removeContainer: true,
          scrollX: 0,
          scrollY: 0,
          foreignObjectRendering: false,
        });

        await new Promise((resolve) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                if (typeof app.toast === "function") {
                  app.toast("Could not generate the image");
                }
                resolve();
                return;
              }

              const projectName =
                typeof app.getProjectName === "function"
                  ? app.getProjectName()
                  : "Untitled Storyboard";

              downloadBlob(
                blob,
                slugifyFilename(`${projectName}-storyboard`, "png"),
              );

              if (typeof app.toast === "function") {
                app.toast("Storyboard image exported");
              }
              resolve();
            },
            "image/png",
            1,
          );
        });
      } finally {
        wrap.remove();
      }
    } catch {
      if (typeof app.toast === "function") {
        app.toast("Could not generate the storyboard image");
      }
    } finally {
      if (changedMode) {
        await ensureMode(originalMode);
      }
    }
  }

  function closeDropdown(root, btn, menu) {
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    root.classList.remove("open");
  }

  function toggleDropdown(root, btn, menu) {
    const open = !menu.classList.contains("open");
    menu.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    root.classList.toggle("open", open);
  }

  function initExportDropdown() {
    const root = document.getElementById("export-dropdown");
    const btn = document.getElementById("btn-export");
    const menu = document.getElementById("export-dropdown-menu");
    if (!root || !btn || !menu) return;

    const close = () => closeDropdown(root, btn, menu);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown(root, btn, menu);
    });

    menu.querySelectorAll(".export-dropdown-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        close();
        if (opt.dataset.value === "project") {
          exportProject();
        } else if (opt.dataset.value === "storyboard") {
          exportStoryboard();
        }
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#export-dropdown")) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initExportDropdown, {
      once: true,
    });
  } else {
    initExportDropdown();
  }
})();
