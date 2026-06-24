(() => {
  "use strict";

  const DOC_READY = () => {
    const body = document.body;
    const root = document.documentElement;
    if (!body) return;

    const css = (name, fallback = "") =>
      getComputedStyle(root).getPropertyValue(name).trim() || fallback;

    const palette = {
      void: css("--void", "#1a1d24"),
      panelSolid: css("--panel-solid", "#20242c"),
      panel: css("--panel", "rgba(30, 34, 42, 0.78)"),
      panelBorder: css("--panel-border", "rgba(255, 255, 255, 0.07)"),
      ink: css("--ink", "#e8eaf0"),
      inkDim: css("--ink-dim", "#8b93a6"),
      inkFaint: css("--ink-faint", "#5b6175"),
      accent: css("--accent", "#6fe3c8"),
      accentDim: css("--accent-dim", "rgba(111, 227, 200, 0.16)"),
      amber: css("--amber", "#ffb36b"),
      amberDim: css("--amber-dim", "rgba(255, 179, 107, 0.16)"),
      danger: css("--danger", "#ff7b72"),
      dangerDim: css("--danger-dim", "rgba(255, 123, 114, 0.14)"),
      display: css("--font-display", "'Space Grotesk', sans-serif"),
      body: css("--font-body", "'Inter', sans-serif"),
      mono: css("--font-mono", "'JetBrains Mono', monospace"),
      radius: css("--radius", "10px"),
      radiusSm: css("--radius-sm", "7px"),
    };

    const apply = (el, styles) => {
      if (!el) return;
      Object.assign(el.style, styles);
    };

    const addClass = (selector, className) => {
      document.querySelectorAll(selector).forEach((el) => el.classList.add(className));
    };

    const ensureThemeScript = () => {
      const existing = document.querySelector('script[src*="theme-switcher.js"]');
      if (existing) return;
      const s = document.createElement("script");
      s.src = "scripts/theme-switcher.js";
      s.defer = true;
      document.head.appendChild(s);
    };

    const ensureThemeDock = () => {
      if (document.querySelector(".loom-theme-root")) return;

      const dock = document.createElement("div");
      dock.className = "loom-theme-root";
      dock.innerHTML = `
        <button class="loom-theme-fab" type="button" aria-label="Open theme switcher" title="Theme">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6"/>
          </svg>
        </button>
        <div class="loom-theme-panel" aria-hidden="true">
          <div class="loom-theme-panel-label">Theme</div>
          <div class="loom-theme-list">
            <button class="loom-theme-option active" type="button" data-theme="default">
              <span class="loom-theme-swatch" style="background:#6fe3c8"></span>
              <span class="loom-theme-option-label">Default</span>
              <span class="loom-theme-option-check">✓</span>
            </button>
          </div>
          <div class="loom-theme-hint">Uses the existing theme system when available.</div>
        </div>
      `;
      document.body.appendChild(dock);

      const fab = dock.querySelector(".loom-theme-fab");
      const panel = dock.querySelector(".loom-theme-panel");

      fab?.addEventListener("click", () => {
        dock.classList.toggle("open");
        const open = dock.classList.contains("open");
        panel?.setAttribute("aria-hidden", String(!open));
      });

      document.addEventListener("click", (e) => {
        if (!dock.contains(e.target)) {
          dock.classList.remove("open");
          panel?.setAttribute("aria-hidden", "true");
        }
      });

      ensureThemeScript();
    };

    const makePanel = (el) => {
      if (!el || el.dataset.docsStyled === "1") return;
      el.dataset.docsStyled = "1";
      apply(el, {
        background: palette.panel,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: "16px",
        boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
      });
    };

    const styleRootLayout = () => {
      body.style.userSelect = "text";
      body.style.overflowX = "hidden";
      body.style.overflowY = "auto";
      body.style.margin = "0";
      body.style.color = palette.ink;
      body.style.backgroundColor = palette.void;
      body.style.fontFamily = palette.body;
      body.style.webkitFontSmoothing = "antialiased";
      body.style.textRendering = "optimizeLegibility";

      root.style.scrollBehavior = "smooth";

      const app = document.querySelector("#app") || document.body;
      apply(app, {
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: palette.void,
        backgroundImage:
          "radial-gradient(circle, rgba(167, 182, 210, 0.16) 1.6px, transparent 1.6px), radial-gradient(circle, rgba(167, 182, 210, 0.085) 1.2px, transparent 1.2px)",
        backgroundSize: "160px 160px, 32px 32px",
        backgroundPosition: "0 0, 0 0",
      });

      const header = document.querySelector("header, .docs-header, #topbar");
      if (header) {
        header.dataset.docsTopbar = "1";
        apply(header, {
          position: "sticky",
          top: "0",
          zIndex: "20",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          minHeight: "52px",
          padding: "0 14px",
          background: palette.panelSolid,
          borderBottom: `1px solid ${palette.panelBorder}`,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        });
      }

      const main = document.querySelector("main, .docs-main, article, .content");
      if (main) {
        main.dataset.docsMain = "1";
        apply(main, {
          width: "min(1180px, calc(100vw - 32px))",
          margin: "24px auto",
          padding: "0",
          display: "grid",
          gap: "18px",
          color: palette.ink,
        });
      }
    };

    const styleTypography = () => {
      const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
      headings.forEach((h) => {
        if (h.dataset.docsStyled === "1") return;
        h.dataset.docsStyled = "1";
        const level = Number(h.tagName.slice(1));
        const size =
          level === 1 ? "clamp(2rem, 4vw, 3.15rem)" :
          level === 2 ? "clamp(1.35rem, 2.2vw, 1.9rem)" :
          level === 3 ? "1.25rem" :
          level === 4 ? "1.08rem" :
          "0.98rem";
        apply(h, {
          fontFamily: palette.display,
          fontWeight: level <= 2 ? "700" : "600",
          letterSpacing: level <= 2 ? "-0.02em" : "0.01em",
          lineHeight: "1.1",
          margin: level === 1 ? "0 0 8px" : "22px 0 8px",
          fontSize: size,
          color: palette.ink,
        });
      });

      document.querySelectorAll("p, li, dd, dt, blockquote").forEach((el) => {
        if (el.dataset.docsStyled === "1") return;
        el.dataset.docsStyled = "1";
        apply(el, {
          fontSize: "15px",
          lineHeight: "1.7",
          color: palette.ink,
        });
      });

      document.querySelectorAll("small, .muted, .meta, .subtle").forEach((el) => {
        apply(el, { color: palette.inkDim });
      });

      document.querySelectorAll("a").forEach((a) => {
        if (a.dataset.docsStyled === "1") return;
        a.dataset.docsStyled = "1";
        apply(a, {
          color: palette.accent,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
          textDecorationThickness: "1.5px",
        });
      });
    };

    const stylePanels = () => {
      const candidates = [
        ...document.querySelectorAll(
          "section, .card, .panel, .docs-panel, .callout, .note, .tip, .warning, .hero, pre, table, blockquote, figure"
        ),
      ];

      candidates.forEach((el) => {
        if (el.matches("pre, table, blockquote, figure")) {
          makePanel(el);
        } else if (
          el.matches("section, .card, .panel, .docs-panel, .callout, .note, .tip, .warning, .hero")
        ) {
          makePanel(el);
          apply(el, { padding: "18px" });
        }
      });

      document.querySelectorAll("blockquote").forEach((bq) => {
        if (bq.dataset.docsStyled === "1") return;
        bq.dataset.docsStyled = "1";
        apply(bq, {
          borderLeft: `3px solid ${palette.panelBorder}`,
          padding: "12px 14px 12px 16px",
          color: palette.inkDim,
        });
      });

      document.querySelectorAll("pre").forEach((pre) => {
        if (pre.dataset.docsStyled === "1") return;
        pre.dataset.docsStyled = "1";
        apply(pre, {
          overflow: "auto",
          padding: "14px 16px",
          margin: "0",
        });
      });

      document.querySelectorAll("code").forEach((code) => {
        if (code.dataset.docsStyled === "1") return;
        code.dataset.docsStyled = "1";
        const isBlock = code.parentElement && code.parentElement.tagName === "PRE";
        apply(code, {
          fontFamily: palette.mono,
          fontSize: isBlock ? "13px" : "0.95em",
          color: palette.ink,
          background: isBlock ? "transparent" : "rgba(0, 0, 0, 0.28)",
          borderRadius: isBlock ? "0" : "6px",
          padding: isBlock ? "0" : "0.16em 0.42em",
        });
      });

      document.querySelectorAll("table").forEach((table) => {
        if (table.dataset.docsStyled === "1") return;
        table.dataset.docsStyled = "1";
        apply(table, {
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: "0",
          overflow: "hidden",
        });
        table.querySelectorAll("th, td").forEach((cell) => {
          apply(cell, {
            borderBottom: `1px solid ${palette.panelBorder}`,
            padding: "10px 12px",
            verticalAlign: "top",
          });
        });
        table.querySelectorAll("th").forEach((th) => {
          apply(th, {
            fontFamily: palette.mono,
            fontSize: "10.5px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: palette.inkDim,
            background: "rgba(255,255,255,0.03)",
          });
        });
      });

      document.querySelectorAll("img").forEach((img) => {
        if (img.dataset.docsStyled === "1") return;
        img.dataset.docsStyled = "1";
        apply(img, {
          maxWidth: "100%",
          height: "auto",
          borderRadius: "12px",
          border: `1px solid ${palette.panelBorder}`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
        });
      });
    };

    const styleControls = () => {
      document.querySelectorAll("button, input, select, textarea").forEach((el) => {
        if (el.dataset.docsStyled === "1") return;
        el.dataset.docsStyled = "1";
        if (el.tagName === "BUTTON") {
          apply(el, {
            fontFamily: palette.body,
            borderRadius: "7px",
            border: `1px solid ${palette.panelBorder}`,
            background: "rgba(255,255,255,0.04)",
            color: palette.inkDim,
            cursor: "pointer",
            transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease, transform 0.12s ease",
          });
        } else {
          apply(el, {
            fontFamily: palette.body,
            borderRadius: "7px",
            border: `1px solid ${palette.panelBorder}`,
            background: "rgba(0,0,0,0.22)",
            color: palette.ink,
            outline: "none",
          });
        }
      });
    };

    const styleSpacing = () => {
      document.querySelectorAll("main > *, article > *, .content > *").forEach((el) => {
        if (el.dataset.docsStyled === "1") return;
        if (el.matches("script, style, link, meta, title")) return;
        if (el.matches("header, footer")) return;
        el.dataset.docsStyled = "1";
        if (!el.matches("section, .card, .panel, .docs-panel, pre, table, blockquote, figure")) {
          apply(el, {
            marginBottom: "18px",
          });
        }
      });
    };

    const styleNav = () => {
      const nav = document.querySelector("nav, .docs-nav, aside");
      if (nav) {
        nav.dataset.docsStyled = "1";
        apply(nav, {
          background: palette.panel,
          border: `1px solid ${palette.panelBorder}`,
          borderRadius: "14px",
          padding: "14px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        });
      }
    };

    const update = () => {
      styleRootLayout();
      styleNav();
      stylePanels();
      styleTypography();
      styleControls();
      styleSpacing();
      ensureThemeDock();
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    const observe = () => {
      const target = document.body || document.documentElement;
      const mo = new MutationObserver(() => schedule());
      mo.observe(target, { childList: true, subtree: true });
    };

    schedule();
    observe();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", DOC_READY, { once: true });
  } else {
    DOC_READY();
  }
})();