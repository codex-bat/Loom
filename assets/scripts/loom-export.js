(() => {
  "use strict";

  /* ====================================================
     loom-export.js

     Exports:
       • Project (.json)
       • Storyboard (.png)
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

    .loom-export-capture-bg {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
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

    /* Card inner elements must keep their natural overflow
       so the frame line is clipped by the card's border-radius */
    .loom-export-capture-wrap .card {
      cursor: default !important;
      box-shadow: none !important;
      z-index: auto !important;
      overflow: hidden !important;          /* <-- critical for frame-line clipping */
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

  function cloneBackgroundFromCanvas(bg, liveCanvas) {
    if (!liveCanvas) return;
    const cs = getComputedStyle(liveCanvas);
    bg.style.backgroundColor = cs.backgroundColor;
    bg.style.backgroundImage = cs.backgroundImage;
    bg.style.backgroundSize = cs.backgroundSize;
    bg.style.backgroundPosition = cs.backgroundPosition;
    bg.style.backgroundRepeat = cs.backgroundRepeat;
    bg.style.backgroundAttachment = cs.backgroundAttachment;
    bg.style.backgroundClip = cs.backgroundClip;
    bg.style.backgroundOrigin = cs.backgroundOrigin;
    bg.style.backgroundBlendMode = cs.backgroundBlendMode;
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
        );
      });
  }

  function normalizeBoundsForExport(bounds) {
    if (!bounds) return null;

    const minX = Number(bounds.minX);
    const minY = Number(bounds.minY);
    const maxX = Number(bounds.maxX);
    const maxY = Number(bounds.maxY);

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }

    const left = Math.floor(minX - EXPORT_PADDING);
    const top = Math.floor(minY - EXPORT_PADDING);
    const right = Math.ceil(maxX + EXPORT_PADDING);
    const bottom = Math.ceil(maxY + EXPORT_PADDING);

    return {
      minX: left,
      minY: top,
      maxX: right,
      maxY: bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  /**
   * Builds an off‑screen clone ready for html2canvas.
   * Cards stay in a container that uses a CSS transform
   * (identical to the live #world) so all card styles
   * are captured.  The connection SVGs are taken out of
   * that container and placed directly in the wrapper
   * with their own coordinate translation – this avoids
   * the html2canvas SVG-in-transform bug.
   */
  function buildCaptureClone(bounds) {
    const liveWorld = document.getElementById("world");
    const liveCanvas = document.getElementById("canvas");
    const liveSvgBack = document.getElementById("conn-svg-back");
    const liveSvgFront = document.getElementById("conn-svg");
    const exportBounds = normalizeBoundsForExport(bounds);

    if (!liveWorld || !exportBounds) return null;

    const { minX, minY, width, height } = exportBounds;

    // Wrapper
    const wrap = document.createElement("div");
    wrap.className = "loom-export-capture-wrap";
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;

    // Background layer
    const bg = document.createElement("div");
    bg.className = "loom-export-capture-bg";
    bg.style.width = `${width}px`;
    bg.style.height = `${height}px`;
    cloneBackgroundFromCanvas(bg, liveCanvas);
    wrap.appendChild(bg);

    // --- Card container with a transform ---
    const clone = liveWorld.cloneNode(true);
    clone.removeAttribute("id");
    clone.querySelectorAll("#conn-svg-back, #conn-svg").forEach(el => el.remove());

    // Position so that world (minX, minY) lands at (0,0) in the wrapper
    clone.style.position = "absolute";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.transform = `translate(${-minX}px, ${-minY}px)`;
    clone.style.transformOrigin = "0 0";
    clone.style.overflow = "visible";
    clone.style.zIndex = "1";
    clone.style.pointerEvents = "none";
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.style.isolation = "isolate";

    clearTransientClasses(clone);
    clone.querySelectorAll("input.card-title").forEach((input) => {
      if (String(input.value || "").trim()) return;
      input.placeholder = "";
      input.value = "";
    });

    // --- Back SVG layer (behind cards) ---
    if (liveSvgBack) {
      const svgBack = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgBack.style.position = "absolute";
      svgBack.style.left = "0";
      svgBack.style.top = "0";
      svgBack.style.overflow = "visible";
      svgBack.style.pointerEvents = "none";
      svgBack.style.zIndex = "0";                      // behind cards
      svgBack.setAttribute("width", String(width));
      svgBack.setAttribute("height", String(height));
      svgBack.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svgBack.setAttribute("preserveAspectRatio", "none");

      const offsetGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      offsetGroup.setAttribute("transform", `translate(${-minX}, ${-minY})`);
      // Copy everything except <defs> (filters omitted for export)
      Array.from(liveSvgBack.children).forEach((child) => {
        if (child.tagName.toLowerCase() !== "defs")
          offsetGroup.appendChild(child.cloneNode(true));
      });
      svgBack.appendChild(offsetGroup);
      wrap.appendChild(svgBack);
    }

    // The card container goes on top of the back layer
    wrap.appendChild(clone);

    // --- Front SVG layer (in front of cards) ---
    if (liveSvgFront) {
      const svgFront = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgFront.style.position = "absolute";
      svgFront.style.left = "0";
      svgFront.style.top = "0";
      svgFront.style.overflow = "visible";
      svgFront.style.pointerEvents = "none";
      svgFront.style.zIndex = "2";                      // in front of cards
      svgFront.setAttribute("width", String(width));
      svgFront.setAttribute("height", String(height));
      svgFront.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svgFront.setAttribute("preserveAspectRatio", "none");

      const offsetGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      offsetGroup.setAttribute("transform", `translate(${-minX}, ${-minY})`);
      Array.from(liveSvgFront.children).forEach((child) => {
        if (child.tagName.toLowerCase() !== "defs")
          offsetGroup.appendChild(child.cloneNode(true));
      });
      svgFront.appendChild(offsetGroup);
      wrap.appendChild(svgFront);
    }

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

  window.LoomModules = window.LoomModules || {};
  window.LoomModules.export = true;
})();
