# Loom — Storyboard Maker

![loomsite logo](https://github.com/codex-bat/Loom/blob/main/assets/visual/l_small-headers_polished.png)

A sleek, infinite-canvas storyboard tool.

## Try it

visit [Loom](https://loom.codexbat.dev/). :3

## How it works
- **Canvas**: scroll to zoom (cursor-centered), drag empty space (or hold Space / middle-click) to pan, `F` to zoom-to-fit, `0` to reset.
- **Frames**: hit **New Frame** or press `N`. Drag the header to move, drag the bottom-right corner to resize, click to select.
- **Bottom widget**: each frame has a small toolbar with **Aa** (text block), **▢** (image upload), and **🔗** (link). Hover any block to reveal a delete button.
- **Left panel**: lists every frame in sequence order — click a row to jump to it.
- **Right panel**: inspector for the selected frame — title, tag color, exact position/size, and notes.
- **Top bar**: Export / Import as JSON for backups or sharing, Clear to wipe the board.
- **Persistence**: everything autosaves to the browser's `localStorage`, so it survives reloads on the same device/browser. Use Export if you want a portable backup or want to move the board to another machine — `localStorage` has a few MB of headroom, so if you add lots of large images, export periodically.
- and man, so much more that I added since hten. I'm too lazy on listing it all. I pulled an all-nighter tonight for this.
