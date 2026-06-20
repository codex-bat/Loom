(() => {
  "use strict";

  const THEME_STORAGE_KEY = "loom-theme-active-v1";
  const CUSTOM_THEMES_STORAGE_KEY = "loom-theme-custom-v1";
  const LINK_ID = "loom-theme-override-link";
  const ACCENT_OVERRIDE_LINK_ID = "loom-theme-accent-override";
  const UI_STYLESHEET_ID = "loom-theme-ui-css";
  const UI_STYLESHEET_HREF = "themes/loom-theme-ui.css";

  const BUILTIN_THEMES = [
    { id: "default", name: "Default", href: null, accent: "#6fe3c8" },
    {
      id: "legacy",
      name: "Legacy",
      href: "themes/legacy.css",
      accent: "#181818",
    },
    {
      id: "bright",
      name: "Bright",
      href: "themes/bright.css",
      accent: "#f9e8ff",
    },
    {
      id: "wooden",
      name: "Wooden",
      href: "themes/chopped.css",
      accent: "#c48e47",
    },
  ];

  let customThemes = [];
  let activeThemeId = "default";
  let blobUrlInUse = null;
  let accentBlobUrlInUse = null;

  let importDialogResolve = null;

  let colorProbe = null;

  /* ---------------- storage ---------------- */
  function loadCustomThemes() {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((theme) => ({
        ...theme,
        accent: theme.accent || extractAccent(theme.css) || "#8b93a6",
      }));
    } catch {
      return [];
    }
  }

  function saveCustomThemes() {
    try {
      localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(customThemes),
      );
    } catch {
      /* ignore */
    }
  }

  function loadActiveThemeId() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || "default";
    } catch {
      return "default";
    }
  }

  function saveActiveThemeId(id) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  /* ---------------- color helpers ---------------- */
  function ensureColorProbe() {
    if (colorProbe) return colorProbe;

    colorProbe = document.createElement("div");
    colorProbe.style.position = "absolute";
    colorProbe.style.left = "-9999px";
    colorProbe.style.top = "-9999px";
    colorProbe.style.width = "1px";
    colorProbe.style.height = "1px";
    colorProbe.style.visibility = "hidden";

    (document.body || document.documentElement).appendChild(colorProbe);
    return colorProbe;
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => Number(n).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function expandShortHex(hex) {
    const h = hex.replace("#", "").trim();
    if (h.length === 3) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    if (h.length === 4) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return hex;
  }

  function cssColorToHex(color) {
    if (!color || typeof color !== "string") return null;

    const value = color.trim();

    if (/^#[0-9a-f]{3,4}$/i.test(value) || /^#[0-9a-f]{6}$/i.test(value)) {
      return expandShortHex(value).toLowerCase();
    }

    if (/^#[0-9a-f]{8}$/i.test(value)) {
      return value.slice(0, 7).toLowerCase();
    }

    const probe = ensureColorProbe();
    probe.style.color = "";
    probe.style.color = value;

    const computed = getComputedStyle(probe).color;
    const match = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) return null;

    return rgbToHex(match[1], match[2], match[3]).toLowerCase();
  }

  function hexToRgb(hex) {
    const normalized = cssColorToHex(hex);
    if (!normalized) return null;

    const clean = normalized.replace("#", "");
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  function buildAccentOverrideCSS(accentHex) {
    const rgb = hexToRgb(accentHex);
    if (!rgb) return "";

    return `
:root {
  --accent: ${accentHex};
  --accent-rgb: ${rgb.r}, ${rgb.g}, ${rgb.b};
  --accent-dim: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16);
}
`.trim();
  }

  function extractAccentCandidates(cssText) {
    const candidates = [];
    const seen = new Set();

    const rootBlocks =
      String(cssText || "").match(/:root\b[^{]*\{[\s\S]*?\}/gi) || [];
    for (const block of rootBlocks) {
      const re = /--[\w-]*accent[\w-]*\s*:\s*([^;]+);/gi;
      let match;
      while ((match = re.exec(block))) {
        const raw = match[1].trim();
        const hex = cssColorToHex(raw) || raw;
        const key = hex.toLowerCase();
        if (
          (!seen.has(key) && /^#?[0-9a-f]{3,8}$/i.test(key.replace("#", ""))) ||
          /^rgba?\(/i.test(raw) ||
          /^hsla?\(/i.test(raw) ||
          /^#[0-9a-f]{6}$/i.test(raw)
        ) {
          seen.add(key);
          candidates.push(cssColorToHex(raw) || raw);
        }
      }
    }

    return candidates.filter(Boolean);
  }

  function extractAccent(cssText) {
    const candidates = extractAccentCandidates(cssText);
    return candidates[0] || null;
  }

  function smartThemeName(fileName) {
    const base = String(fileName || "")
      .replace(/\.css$/i, "")
      .trim();

    if (!base) return "Custom Theme";

    return base
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((word) =>
        word ? word.charAt(0).toUpperCase() + word.slice(1) : word,
      )
      .join(" ");
  }

  function colorVarScore(varName) {
    const n = String(varName || "").toLowerCase();

    if (/(^|[-_])(accent|primary|brand|highlight)([-_]|$)/.test(n)) return 0;
    if (/(^|[-_])(color|ink|text|foreground|fg)([-_]|$)/.test(n)) return 1;
    if (
      /(^|[-_])(amber|orange|gold|yellow|lime|green|teal|cyan|blue|red|danger|warning)([-_]|$)/.test(
        n,
      )
    )
      return 2;

    return 3;
  }

  function extractRootColorCandidates(cssText) {
    const candidates = [];
    const seen = new Set();

    const rootBlocks =
      String(cssText || "").match(/:root\b[^{]*\{[\s\S]*?\}/gi) || [];

    for (const block of rootBlocks) {
      const re = /--([\w-]+)\s*:\s*([^;]+);/gi;
      let match;

      while ((match = re.exec(block))) {
        const varName = match[1].trim();
        const rawValue = match[2].trim();
        const hex = cssColorToHex(rawValue);

        if (!hex) continue;

        const key = `${varName.toLowerCase()}::${hex.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          name: varName,
          value: hex,
          score: colorVarScore(varName),
        });
      }
    }

    candidates.sort(
      (a, b) => a.score - b.score || a.name.localeCompare(b.name),
    );
    return candidates;
  }

  function extractAccentCandidates(cssText) {
    return extractRootColorCandidates(cssText).map((c) => c.value);
  }

  function extractAccent(cssText) {
    return extractRootColorCandidates(cssText)[0]?.value || null;
  }

  /* ---------------- theme application ---------------- */
  function findTheme(id) {
    return (
      BUILTIN_THEMES.find((t) => t.id === id) ||
      customThemes.find((t) => t.id === id) ||
      BUILTIN_THEMES[0]
    );
  }

  function ensureOverrideLink() {
    let link = document.getElementById(LINK_ID);
    if (!link) {
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    return link;
  }

  function clearOverrideLink() {
    const link = document.getElementById(LINK_ID);
    if (link) link.remove();
  }

  function ensureAccentOverrideLink() {
    let link = document.getElementById(ACCENT_OVERRIDE_LINK_ID);
    if (!link) {
      link = document.createElement("link");
      link.id = ACCENT_OVERRIDE_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    return link;
  }

  function clearAccentOverrideLink() {
    const link = document.getElementById(ACCENT_OVERRIDE_LINK_ID);
    if (link) link.remove();
  }

  function applyTheme(id, opts = {}) {
    const theme = findTheme(id);

    if (blobUrlInUse) {
      URL.revokeObjectURL(blobUrlInUse);
      blobUrlInUse = null;
    }

    if (accentBlobUrlInUse) {
      URL.revokeObjectURL(accentBlobUrlInUse);
      accentBlobUrlInUse = null;
    }

    if (theme.css) {
      const blob = new Blob([theme.css], { type: "text/css" });
      blobUrlInUse = URL.createObjectURL(blob);
      ensureOverrideLink().href = blobUrlInUse;

      if (theme.accent) {
        const accentCss = buildAccentOverrideCSS(theme.accent);
        if (accentCss) {
          const accentBlob = new Blob([accentCss], { type: "text/css" });
          accentBlobUrlInUse = URL.createObjectURL(accentBlob);
          ensureAccentOverrideLink().href = accentBlobUrlInUse;
        } else {
          clearAccentOverrideLink();
        }
      } else {
        clearAccentOverrideLink();
      }
    } else if (theme.href) {
      ensureOverrideLink().href = theme.href;
      clearAccentOverrideLink();
    } else {
      clearOverrideLink();
      clearAccentOverrideLink();
    }

    activeThemeId = theme.id;
    if (!opts.skipSave) saveActiveThemeId(activeThemeId);
    syncThemeList();
  }

  /* ---------------- UI stylesheet ---------------- */
  function ensureThemeStylesheet() {
    if (document.getElementById(UI_STYLESHEET_ID)) return;

    const link = document.createElement("link");
    link.id = UI_STYLESHEET_ID;
    link.rel = "stylesheet";
    link.href = UI_STYLESHEET_HREF;
    document.head.appendChild(link);
  }

  /* ---------------- import dialog ---------------- */
  function ensureImportDialog() {
    let dialog = document.getElementById("loom-theme-import-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "loom-theme-import-dialog";
    dialog.className = "loom-theme-import-dialog";

    dialog.innerHTML = `
    <form class="loom-theme-import-panel" method="dialog">
      <div class="loom-theme-import-title">Review custom theme</div>
      <div class="loom-theme-import-subtitle">
        Pick a name and accent before saving it to your list.
      </div>

      <label class="loom-theme-import-field">
        <span>Name</span>
        <input type="text" data-theme-name autocomplete="off" spellcheck="false" />
      </label>

      <div class="loom-theme-import-section">
        <div class="loom-theme-import-label">Detected colours from :root</div>
        <div class="loom-theme-import-swatches" data-accent-swatches></div>
      </div>

      <label class="loom-theme-import-field">
        <span>Accent colour</span>
        <div class="loom-theme-import-color-row">
          <input type="color" data-theme-color />
          <span class="loom-theme-import-color-value" data-theme-color-value></span>
        </div>
      </label>

      <div class="loom-theme-import-preview">
        <span class="loom-theme-import-preview-dot" data-theme-preview-dot></span>
        <span class="loom-theme-import-preview-text">Accent preview</span>
      </div>

      <div class="loom-theme-import-actions">
        <button type="button" class="loom-theme-import-btn secondary" data-import-cancel>Cancel</button>
        <button type="button" class="loom-theme-import-btn primary" data-import-save>Save theme</button>
      </div>
    </form>
  `;

    document.body.appendChild(dialog);

    const cancelBtn = dialog.querySelector("[data-import-cancel]");
    const saveBtn = dialog.querySelector("[data-import-save]");
    const nameInput = dialog.querySelector("[data-theme-name]");
    const colorInput = dialog.querySelector("[data-theme-color]");
    const colorValue = dialog.querySelector("[data-theme-color-value]");
    const swatches = dialog.querySelector("[data-accent-swatches]");
    const previewDot = dialog.querySelector("[data-theme-preview-dot]");

    const updatePreview = () => {
      const value = colorInput.value || "#8b93a6";
      previewDot.style.background = value;
      colorValue.textContent = value.toUpperCase();
    };

    const selectAccent = (hex) => {
      const normalized = cssColorToHex(hex) || "#8b93a6";
      colorInput.value = normalized;
      updatePreview();

      swatches.querySelectorAll(".loom-theme-import-swatch").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.accent === normalized);
      });
    };

    colorInput.addEventListener("input", () => {
      updatePreview();
      swatches.querySelectorAll(".loom-theme-import-swatch").forEach((btn) => {
        btn.classList.remove("active");
      });
    });

    swatches.addEventListener("click", (e) => {
      const target = e.target.closest(".loom-theme-import-swatch");
      if (!target) return;
      selectAccent(target.dataset.accent);
    });

    cancelBtn.addEventListener("click", () => closeImportDialog(null));

    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim() || "Custom Theme";
      const accent = cssColorToHex(colorInput.value) || "#8b93a6";
      closeImportDialog({ name, accent });
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeImportDialog(null);
    });

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeImportDialog(null);
    });

    return dialog;
  }

  function openImportDialog({ fileName, cssText }) {
    const dialog = ensureImportDialog();

    const nameInput = dialog.querySelector("[data-theme-name]");
    const colorInput = dialog.querySelector("[data-theme-color]");
    const colorValue = dialog.querySelector("[data-theme-color-value]");
    const swatches = dialog.querySelector("[data-accent-swatches]");
    const previewDot = dialog.querySelector("[data-theme-preview-dot]");

    const candidates = extractRootColorCandidates(cssText);
    const initialAccent = candidates[0]?.value || "#8b93a6";

    nameInput.value = smartThemeName(fileName);
    colorInput.value = cssColorToHex(initialAccent) || "#8b93a6";
    colorValue.textContent = colorInput.value.toUpperCase();
    previewDot.style.background = colorInput.value;

    swatches.innerHTML = "";

    if (candidates.length) {
      candidates.forEach((candidate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "loom-theme-import-swatch";
        button.dataset.accent = candidate.value;
        button.style.background = candidate.value;
        button.title = `--${candidate.name}: ${candidate.value.toUpperCase()}`;
        button.setAttribute(
          "aria-label",
          `${candidate.name} ${candidate.value.toUpperCase()}`,
        );
        swatches.appendChild(button);
      });
    } else {
      const hint = document.createElement("div");
      hint.className = "loom-theme-import-no-swatches";
      hint.textContent = "No colour variables were detected in :root.";
      swatches.appendChild(hint);
    }

    const activeSwatch = swatches.querySelector(
      `.loom-theme-import-swatch[data-accent="${colorInput.value}"]`,
    );
    if (activeSwatch) activeSwatch.classList.add("active");

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    nameInput.focus();
    nameInput.select();

    return new Promise((resolve) => {
      importDialogResolve = resolve;
    });
  }

  function openImportDialog({ fileName, cssText }) {
    const dialog = ensureImportDialog();

    const nameInput = dialog.querySelector("[data-theme-name]");
    const colorInput = dialog.querySelector("[data-theme-color]");
    const colorValue = dialog.querySelector("[data-theme-color-value]");
    const swatches = dialog.querySelector("[data-accent-swatches]");
    const previewDot = dialog.querySelector("[data-theme-preview-dot]");

    const candidates = extractAccentCandidates(cssText);
    const initialAccent = candidates[0] || "#8b93a6";

    nameInput.value = smartThemeName(fileName);
    colorInput.value = cssColorToHex(initialAccent) || "#8b93a6";
    colorValue.textContent = colorInput.value.toUpperCase();
    previewDot.style.background = colorInput.value;

    swatches.innerHTML = "";

    if (candidates.length) {
      candidates.forEach((accent) => {
        const hex = cssColorToHex(accent) || "#8b93a6";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "loom-theme-import-swatch";
        button.dataset.accent = hex;
        button.style.background = hex;
        button.title = hex.toUpperCase();
        swatches.appendChild(button);
      });
    } else {
      const hint = document.createElement("div");
      hint.className = "loom-theme-import-no-swatches";
      hint.textContent = "No accent variables were detected in :root.";
      swatches.appendChild(hint);
    }

    const activeSwatch = swatches.querySelector(
      `.loom-theme-import-swatch[data-accent="${colorInput.value}"]`,
    );
    if (activeSwatch) activeSwatch.classList.add("active");

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    nameInput.focus();
    nameInput.select();

    return new Promise((resolve) => {
      importDialogResolve = resolve;
    });
  }

  function closeImportDialog(result) {
    const dialog = document.getElementById("loom-theme-import-dialog");
    if (!dialog) return;

    if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute("open");
      }
    }

    const resolve = importDialogResolve;
    importDialogResolve = null;

    if (typeof resolve === "function") resolve(result);
  }

  /* ---------------- UI ---------------- */
  function buildUI() {
    const root = document.createElement("div");
    root.className = "loom-theme-root";

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "loom-theme-fab";
    fab.setAttribute("aria-label", "Theme settings");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="2.6" stroke="currentColor" stroke-width="1.4"/>
        <path d="M9 1.6v2M9 14.4v2M16.4 9h-2M3.6 9h-2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3L3.9 3.9"
          stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>`;

    const panel = document.createElement("div");
    panel.className = "loom-theme-panel";
    panel.setAttribute("role", "menu");

    const label = document.createElement("div");
    label.className = "loom-theme-panel-label";
    label.textContent = "Theme";

    const list = document.createElement("div");
    list.className = "loom-theme-list";
    list.id = "loom-theme-list";

    const divider = document.createElement("div");
    divider.className = "loom-theme-divider";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "loom-theme-add-btn";
    addBtn.textContent = "+ Add custom theme";

    const hint = document.createElement("div");
    hint.className = "loom-theme-hint";
    hint.textContent =
      "CSS files override :root variables (--accent, --void, --ink…). Anything left out falls back to Default.";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".css";
    fileInput.hidden = true;

    panel.appendChild(label);
    panel.appendChild(list);
    panel.appendChild(divider);
    panel.appendChild(addBtn);
    panel.appendChild(hint);
    panel.appendChild(fileInput);

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    fab.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !root.classList.contains("open");
      root.classList.toggle("open", open);
      fab.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) root.classList.remove("open");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") root.classList.remove("open");
    });

    addBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const cssText = String(reader.result || "");
        const review = await openImportDialog({
          fileName: file.name,
          cssText,
        });

        if (!review) return;

        const id = "custom-" + Math.random().toString(36).slice(2, 9);
        const theme = {
          id,
          name: review.name,
          css: cssText,
          accent: review.accent,
        };

        customThemes.push(theme);
        saveCustomThemes();
        renderThemeList();
        applyTheme(id);
      };
      reader.readAsText(file);
    });

    renderThemeList();
  }

  function renderThemeList() {
    const list = document.getElementById("loom-theme-list");
    if (!list) return;

    list.innerHTML = "";

    BUILTIN_THEMES.forEach((theme) => {
      list.appendChild(buildThemeOption(theme));
    });

    customThemes.forEach((theme) => {
      const accent = theme.accent || extractAccent(theme.css) || "#8b93a6";
      list.appendChild(
        buildThemeOption({ ...theme, accent }, { removable: true }),
      );
    });
  }

  function buildThemeOption(theme, opts = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "loom-theme-option" + (theme.id === activeThemeId ? " active" : "");
    btn.dataset.themeId = theme.id;
    btn.setAttribute("role", "menuitemradio");
    btn.setAttribute("aria-checked", String(theme.id === activeThemeId));

    const swatch = document.createElement("span");
    swatch.className = "loom-theme-swatch";
    swatch.style.background = theme.accent || "#8b93a6";

    const labelEl = document.createElement("span");
    labelEl.className = "loom-theme-option-label";
    labelEl.textContent = theme.name;

    const check = document.createElement("span");
    check.className = "loom-theme-option-check";
    check.textContent = "✓";

    btn.appendChild(swatch);
    btn.appendChild(labelEl);
    btn.appendChild(check);

    if (opts.removable) {
      const remove = document.createElement("span");
      remove.className = "loom-theme-option-remove";
      remove.textContent = "×";
      remove.title = "Remove theme";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        removeCustomTheme(theme.id);
      });
      btn.appendChild(remove);
    }

    btn.addEventListener("click", () => applyTheme(theme.id));
    return btn;
  }

  function removeCustomTheme(id) {
    customThemes = customThemes.filter((t) => t.id !== id);
    saveCustomThemes();

    if (activeThemeId === id) applyTheme("default");
    renderThemeList();
  }

  function syncThemeList() {
    const list = document.getElementById("loom-theme-list");
    if (!list) return;

    list.querySelectorAll(".loom-theme-option").forEach((el) => {
      const isActive = el.dataset.themeId === activeThemeId;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-checked", String(isActive));
    });
  }

  function init() {
    customThemes = loadCustomThemes();
    ensureThemeStylesheet();
    buildUI();
    applyTheme(loadActiveThemeId(), { skipSave: true });
  }

  init();
})();
