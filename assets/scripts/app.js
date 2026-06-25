(function () {
  const modules = [
    {
      key: "core",
      candidates: ["assets/scripts/partials/loom-core.js"],
    },
    {
      key: "graphics",
      candidates: ["assets/scripts/partials/loom-graphics.js"],
    },
    {
      key: "cards",
      candidates: ["assets/scripts/partials/loom-cards.js"],
    },
    {
      key: "bootstrap",
      candidates: ["assets/scripts/partials/loom-bootstrap.js"],
    },
  ];

  function alreadyLoaded(key) {
    return !!(window.LoomModules && window.LoomModules[key]);
  }

  function loadScriptOnce(src, key) {
    return new Promise((resolve, reject) => {
      if (alreadyLoaded(key)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.async = false;
      script.src = src;
      script.onload = () => {
        window.LoomModules = window.LoomModules || {};
        window.LoomModules[key] = true;
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(src));
      };
      document.head.appendChild(script);
    });
  }

  async function loadModule(moduleDef) {
    if (alreadyLoaded(moduleDef.key)) return;
    let lastErr = null;
    for (const src of moduleDef.candidates) {
      try {
        await loadScriptOnce(src, moduleDef.key);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `Unable to load module: ${moduleDef.candidates.join(" | ")}${lastErr ? `\n${lastErr.message || lastErr}` : ""}`,
    );
  }

  async function start() {
    for (const mod of modules) {
      await loadModule(mod);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      start().catch((err) => console.error(err));
    });
  } else {
    start().catch((err) => console.error(err));
  }
})();
