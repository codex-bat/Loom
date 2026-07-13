(function () {
  const modules = [
    { key: "core", candidates: ["assets/scripts/partials/loom-core.js"] },
    {
      key: "graphics",
      candidates: ["assets/scripts/partials/loom-graphics.js"],
    },
    {
      key: "interactions",
      candidates: ["assets/scripts/partials/loom-interactions.js"],
    },
    { key: "syntax", candidates: ["assets/scripts/loom-syntax.js"] },
    {
      key: "bootstrap",
      candidates: ["assets/scripts/partials/loom-bootstrap.js"],
    },
  ];

  const ELEMENTS_PATH = "assets/scripts/elements/";
  const ELEMENT_FILES = [
    "loom-frames.js",
    "loom-codeblock.js",
    "loom-videoclip.js",
  ];

  function alreadyLoaded(key) {
    return !!(window.LoomModules && window.LoomModules[key]);
  }

  function loadScriptOnce(src, key) {
    return new Promise((resolve, reject) => {
      if (alreadyLoaded(key)) return resolve();
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

  async function loadElements() {
    window.LoomElements = window.LoomElements || {};
    for (const file of ELEMENT_FILES) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = ELEMENTS_PATH + file;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`Failed to load ${file}`));
          document.head.appendChild(script);
        });
      } catch (err) {
        console.error(`❌ Failed to load element ${file}:`, err);
      }
    }
    document.dispatchEvent(new CustomEvent("loom-elements-ready"));
  }

  async function start() {
    for (const mod of modules) await loadModule(mod);
    await loadElements();
    if (typeof window.LoomInit === "function") window.LoomInit();
    else console.error("LoomInit not found – did loom-bootstrap.js expose it?");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      start().catch(console.error),
    );
  } else {
    start().catch(console.error);
  }
})();
