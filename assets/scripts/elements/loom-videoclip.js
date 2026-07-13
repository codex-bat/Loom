// ============================================================
//   LOOM ELEMENT: VIDEOCLIP
//   (now with local file upload)
// ============================================================

function buildVideoclipEl(card, num) {
  var el = document.createElement("div");
  el.className =
    "card videoclip-card" + (selectedIds.has(card.id) ? " selected" : "");
  el.dataset.cardId = card.id;
  el.style.left = card.x + "px";
  el.style.top = card.y + "px";
  el.style.width = card.w + "px";
  el.style.height = card.h + "px";

  var color = card.color || "#6fe3c8";
  el.style.setProperty("--card-color", color);
  el.style.setProperty("--card-color-dim", hexToRgba(color, 0.4));
  el.style.setProperty("--card-color-mid", hexToRgba(color, 0.7));
  el.style.setProperty("--card-color-glow", hexToRgba(color, 0.22));

  // --- Header left group (num, title, meta) ---
  var headerLeft = document.createElement("div");
  headerLeft.className = "codeblock-header-left";

  var numEl = document.createElement("span");
  numEl.className = "card-num";
  numEl.textContent = String(num).padStart(2, "0");
  numEl.dataset.tooltip = "Drag to move · Ctrl + Drag to snap-align edges";

  var titleInput = document.createElement("input");
  titleInput.className = "card-title";
  titleInput.type = "text";
  titleInput.placeholder = "Untitled video clip";
  titleInput.value = card.title || "";
  titleInput.maxLength = 60;
  titleInput.readOnly = mode === "view";
  titleInput.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  titleInput.addEventListener("input", function () {
    if (mode === "view") return;
    card.title = titleInput.value;
    if (card.id === selectedId) $inspTitle.value = card.title;
    renderFrameListSoft();
    pushHistoryDebounced();
    save();
  });

  // Meta badge
  var meta = document.createElement("span");
  meta.className = "codeblock-meta";
  var platform = card.videoData
    ? "Local file"
    : detectVideoPlatform(card.videoUrl);
  meta.textContent = platform || "Video";
  meta.style.pointerEvents = "none";

  headerLeft.appendChild(numEl);
  headerLeft.appendChild(titleInput);
  headerLeft.appendChild(meta);

  // --- Buttons ---
  var pinBtn = makePinButton(card);
  var previewToggle = makePreviewToggle(card);
  var expandBtn = makeVideoExpandButton(card);

  var header = document.createElement("div");
  header.className = "card-header";
  header.appendChild(headerLeft);
  header.appendChild(pinBtn);
  header.appendChild(previewToggle);
  header.appendChild(expandBtn);
  el.appendChild(header);

  // Body – thumbnail + info
  var body = document.createElement("div");
  body.className = "card-body videoclip-body";

  var thumbWrapper = document.createElement("div");
  thumbWrapper.className = "videoclip-thumb-wrapper";
  thumbWrapper.addEventListener("click", function (e) {
    e.stopPropagation();
    openVideoModal(card);
  });

  var thumbImg = document.createElement("img");
  thumbImg.className = "videoclip-thumb";

  // Show thumbnail if external URL (YouTube/Vimeo); for local files, hide image and show a generic icon
  if (card.videoData) {
    thumbImg.style.display = "none";
  } else {
    var thumbUrl = getVideoThumbnail(card.videoUrl);
    if (thumbUrl) {
      thumbImg.src = thumbUrl;
      thumbImg.alt = "Video thumbnail";
    } else {
      thumbImg.style.display = "none";
    }
  }

  var playOverlay = document.createElement("div");
  playOverlay.className = "videoclip-play-overlay";
  playOverlay.innerHTML =
    '<svg viewBox="0 0 24 24" width="36" height="36" fill="white" opacity="0.85"><polygon points="5,3 19,12 5,21" /></svg>';

  thumbWrapper.appendChild(thumbImg);
  thumbWrapper.appendChild(playOverlay);

  // If local file, show a "local video" indicator under the overlay
  if (card.videoData) {
    var localIcon = document.createElement("div");
    localIcon.style.position = "absolute";
    localIcon.style.top = "50%";
    localIcon.style.left = "50%";
    localIcon.style.transform = "translate(-50%, -50%)";
    localIcon.style.pointerEvents = "none";
    localIcon.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" opacity="0.7"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 3c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm-4 14c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1H8v-1z"/></svg>';
    localIcon.style.zIndex = "2";
    thumbWrapper.appendChild(localIcon);
  }

  body.appendChild(thumbWrapper);

  // Info line
  var infoLine = document.createElement("div");
  infoLine.className = "videoclip-info";
  var infoText = card.title || (platform ? platform + " video" : "Video clip");
  infoLine.textContent = infoText;
  body.appendChild(infoLine);

  el.appendChild(body);

  // Resize handle
  var handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.dataset.tooltip = "Drag to resize";
  el.appendChild(handle);

  // Drag / interaction
  el.addEventListener("pointerdown", function (e) {
    if (e.button === 1) {
      startPanning(e, el);
      return;
    }
    if (e.target.closest(".resize-handle")) return;
    if (isCardDragBlockedTarget(e.target)) return;
    if (selectedIds.size > 1 && selectedIds.has(card.id))
      startGroupDrag(e, card, el);
    else startDragCard(e, card, el);
  });

  header.addEventListener("click", function () {
    selectCard(card.id);
  });
  handle.addEventListener("pointerdown", function (e) {
    startResizeCard(e, card, el);
  });

  if (previewCardIds.has(card.id)) {
    el.classList.add("card-preview");
  }

  return el;
}

function makeVideoExpandButton(card) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "videoclip-expand-btn";
  btn.dataset.tooltip = "Open video player";
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><polygon points="4,2 12,7 4,12" fill="currentColor"/></svg>';
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    openVideoModal(card);
  });
  btn.addEventListener("pointerdown", function (e) {
    e.stopPropagation();
  });
  return btn;
}

function openVideoModal(card) {
  var modal = document.createElement("div");
  modal.className = "videoclip-modal";

  var content = document.createElement("div");
  content.className = "videoclip-modal-content";

  // Header
  var modalHeader = document.createElement("div");
  modalHeader.className = "videoclip-modal-header";

  var titleSpan = document.createElement("span");
  titleSpan.className = "videoclip-modal-title";
  titleSpan.textContent = card.title || "Video Clip";
  modalHeader.appendChild(titleSpan);

  var closeBtn = document.createElement("button");
  closeBtn.className = "videoclip-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", function () {
    document.body.removeChild(modal);
  });
  modalHeader.appendChild(closeBtn);
  content.appendChild(modalHeader);

  // Body
  var modalBody = document.createElement("div");
  modalBody.className = "videoclip-modal-body";

  // If we have local file data, use it directly
  if (card.videoData) {
    var videoEl = document.createElement("video");
    videoEl.controls = true;
    videoEl.style.width = "100%";
    videoEl.style.maxHeight = "70vh";
    videoEl.src = card.videoData;
    modalBody.appendChild(videoEl);
  } else if (card.videoUrl) {
    var platform = detectVideoPlatform(card.videoUrl);
    if (platform === "YouTube") {
      var videoId = extractYouTubeID(card.videoUrl);
      if (videoId) {
        var iframe = document.createElement("iframe");
        iframe.className = "videoclip-iframe";
        iframe.src =
          "https://www.youtube.com/embed/" +
          videoId +
          "?autoplay=0&rel=0&origin=" +
          encodeURIComponent(window.location.origin);
        iframe.allow =
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";
        modalBody.appendChild(iframe);
      } else {
        modalBody.textContent = "Invalid YouTube URL.";
      }
    } else if (platform === "Vimeo") {
      var vimeoId = extractVimeoID(card.videoUrl);
      if (vimeoId) {
        var iframe = document.createElement("iframe");
        iframe.src = "https://player.vimeo.com/video/" + vimeoId;
        iframe.allow = "autoplay; fullscreen; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";
        modalBody.appendChild(iframe);
      } else {
        modalBody.textContent = "Invalid Vimeo URL.";
      }
    } else {
      // Direct URL (mp4 etc.)
      var videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.style.width = "100%";
      videoEl.style.maxHeight = "70vh";
      videoEl.src = card.videoUrl;
      modalBody.appendChild(videoEl);
    }
  } else {
    modalBody.textContent = "No video URL or file set.";
  }

  content.appendChild(modalBody);
  modal.appendChild(content);
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener("click", function (e) {
    if (e.target === modal) document.body.removeChild(modal);
  });

  // Close on Escape
  function onKey(e) {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      window.removeEventListener("keydown", onKey);
    }
  }
  window.addEventListener("keydown", onKey);
}

// --- Helpers ---

function detectVideoPlatform(url) {
  if (!url) return "";
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/vimeo\.com/.test(url)) return "Vimeo";
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return "Direct video";
  return "Video";
}

function extractYouTubeID(url) {
  var match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  return match ? match[1] : null;
}

function extractVimeoID(url) {
  var match = url.match(/vimeo\.com\/(\d+)/);
  return match ? match[1] : null;
}

function getVideoThumbnail(url) {
  if (!url) return "";
  var ytId = extractYouTubeID(url);
  if (ytId) return "https://img.youtube.com/vi/" + ytId + "/hqdefault.jpg";
  return "";
}

// --- Inspector ---
function renderVideoclipInspector(card) {
  var container = document.createElement("div");

  // Title
  var titleField = document.createElement("div");
  titleField.className = "field";
  var titleLabel = document.createElement("label");
  titleLabel.textContent = "Title";
  var titleInp = document.createElement("input");
  titleInp.type = "text";
  titleInp.value = card.title || "";
  titleInp.addEventListener("input", function () {
    card.title = titleInp.value;
    var titleEl = $world.querySelector(
      '[data-card-id="' + card.id + '"] .card-title',
    );
    if (titleEl) titleEl.value = card.title;
    renderFrameListSoft();
    pushHistoryDebounced();
    save();
  });
  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInp);
  container.appendChild(titleField);

  // Position grid
  var grid = document.createElement("div");
  grid.className = "field-grid";

  function makeCoordField(label, key, minVal) {
    var f = document.createElement("div");
    f.className = "field";
    var lbl = document.createElement("label");
    lbl.textContent = label;
    var inp = document.createElement("input");
    inp.type = "number";
    inp.value = card[key];
    inp.addEventListener("input", function () {
      var val = parseInt(inp.value, 10);
      if (Number.isNaN(val)) return;
      if (key === "w") val = Math.max(180, val);
      if (key === "h") val = Math.max(130, val);
      card[key] = val;
      var el = $world.querySelector('[data-card-id="' + card.id + '"]');
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
    f.appendChild(lbl);
    f.appendChild(inp);
    return f;
  }

  grid.appendChild(makeCoordField("X", "x"));
  grid.appendChild(makeCoordField("Y", "y"));
  grid.appendChild(makeCoordField("W", "w", true));
  grid.appendChild(makeCoordField("H", "h", true));
  container.appendChild(grid);

  // --- Video URL (external) ---
  var urlField = document.createElement("div");
  urlField.className = "field";
  var urlLabel = document.createElement("label");
  urlLabel.textContent = "Video URL";
  var urlInp = document.createElement("input");
  urlInp.type = "text";
  urlInp.value = card.videoUrl || "";
  urlInp.placeholder = "https://youtube.com/watch?v=...";
  urlInp.addEventListener("input", function () {
    card.videoUrl = urlInp.value;
    // If URL is set, clear local file data (user is choosing external)
    card.videoData = null;
    refreshCardEl(card);
    pushHistoryDebounced();
    save();
  });
  urlField.appendChild(urlLabel);
  urlField.appendChild(urlInp);
  container.appendChild(urlField);

  // --- Local file upload ---
  var fileField = document.createElement("div");
  fileField.className = "field";
  var fileLabel = document.createElement("label");
  fileLabel.textContent = "Or upload a video file";
  var fileRow = document.createElement("div");
  fileRow.style.display = "flex";
  fileRow.style.gap = "8px";
  fileRow.style.alignItems = "center";

  var fileInp = document.createElement("input");
  fileInp.type = "file";
  fileInp.accept = "video/*";
  fileInp.style.flex = "1";

  var fileNameDisplay = document.createElement("span");
  fileNameDisplay.style.fontSize = "11px";
  fileNameDisplay.style.color = "var(--ink-dim)";
  fileNameDisplay.textContent = card.videoData
    ? "File loaded"
    : "No file chosen";

  fileInp.addEventListener("change", function () {
    var file = fileInp.files[0];
    if (!file) return;

    // Read file as data URL (base64)
    var reader = new FileReader();
    reader.onload = function (e) {
      card.videoData = e.target.result;
      card.videoUrl = ""; // clear URL
      fileNameDisplay.textContent =
        file.name + " (" + (file.size / 1024 / 1024).toFixed(1) + " MB)";
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    };
    reader.readAsDataURL(file);
  });

  // Clear button
  var clearBtn = document.createElement("button");
  clearBtn.textContent = "✕";
  clearBtn.style.background = "rgba(255,255,255,0.06)";
  clearBtn.style.border = "1px solid var(--panel-border)";
  clearBtn.style.borderRadius = "4px";
  clearBtn.style.color = "var(--ink-dim)";
  clearBtn.style.cursor = "pointer";
  clearBtn.style.padding = "4px 8px";
  clearBtn.addEventListener("click", function () {
    card.videoData = null;
    fileInp.value = "";
    fileNameDisplay.textContent = "No file chosen";
    refreshCardEl(card);
    pushHistoryDebounced();
    save();
  });

  fileRow.appendChild(fileInp);
  fileRow.appendChild(clearBtn);
  fileField.appendChild(fileLabel);
  fileField.appendChild(fileRow);
  fileField.appendChild(fileNameDisplay);
  container.appendChild(fileField);

  // Notes
  var notesField = document.createElement("div");
  notesField.className = "field";
  var notesLabel = document.createElement("label");
  notesLabel.textContent = "Creator’s note";
  var notesTextarea = document.createElement("textarea");
  notesTextarea.value = card.notes || "";
  notesTextarea.rows = 3;
  notesTextarea.addEventListener("input", function () {
    card.notes = notesTextarea.value;
    pushHistoryDebounced();
    save();
  });
  notesField.appendChild(notesLabel);
  notesField.appendChild(notesTextarea);
  container.appendChild(notesField);

  return container;
}

// Helper to re-render the card element after data change
function refreshCardEl(card) {
  var el = $world.querySelector('[data-card-id="' + card.id + '"]');
  if (!el) return;
  // Update meta badge
  var meta = el.querySelector(".codeblock-meta");
  if (meta) {
    meta.textContent = card.videoData
      ? "Local file"
      : detectVideoPlatform(card.videoUrl) || "Video";
  }
  // Update thumbnail
  var thumbImg = el.querySelector(".videoclip-thumb");
  if (thumbImg) {
    if (card.videoData) {
      thumbImg.style.display = "none";
    } else {
      var newThumb = getVideoThumbnail(card.videoUrl);
      if (newThumb) {
        thumbImg.src = newThumb;
        thumbImg.style.display = "";
      } else {
        thumbImg.style.display = "none";
      }
    }
  }
  // Show/hide local icon
  var localIcon = el.querySelector(".videoclip-thumb-wrapper svg"); // the custom icon we inserted
  // This is a bit fragile; better to use a class. We'll handle by checking if data exists.
  // For simplicity, we'll re-render the whole card instead. But a full re-render might be heavy.
  // Here we'll just force a full rebuild of the card element.
  // Replace old card with new one.
  if (el.parentNode) {
    var num = parseInt(el.querySelector(".card-num").textContent, 10);
    var newEl = buildVideoclipEl(card, num);
    el.parentNode.replaceChild(newEl, el);
  }
}

// Registration
window.LoomElements = window.LoomElements || {};
window.LoomElements["videoclip"] = {
  id: "videoclip",
  name: "Video Clip",
  description: "Embed a YouTube/Vimeo link or upload a local video file.",
  icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" fill="currentColor"/></svg>',
  factory: function () {
    var center = screenToWorld(
      $canvas.getBoundingClientRect().left + $canvas.clientWidth / 2,
      $canvas.getBoundingClientRect().top + $canvas.clientHeight / 2,
    );
    var cascade = (state.cards.length % 6) * 22;
    return {
      id: uid(),
      type: "videoclip",
      x: Math.round(center.x - 140 + cascade),
      y: Math.round(center.y - 100 + cascade),
      w: 320,
      h: 260,
      title: "",
      color: SWATCHES[state.cards.length % SWATCHES.length],
      notes: "",
      videoUrl: "",
      videoData: null, // will hold base64 data URL if local file chosen
    };
  },
  render: function (card, num) {
    return buildVideoclipEl(card, num);
  },
  renderInspector: renderVideoclipInspector,
};
