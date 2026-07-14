// ============================================================
//   LOOM ELEMENT: VIDEOCLIP
//   – Auto‑generated cover art for local videos
//   – Strictly one source (URL or local file)
//   – 5 MB size‑limit pop‑up
//   – Inline playback on click
//   – Frame styling (colour + line) toggled in inspector
// ============================================================

(function () {
  /* ----------------------------------------------------------
     CONSTANTS
     ---------------------------------------------------------- */
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  /* ----------------------------------------------------------
     BUILDER
     ---------------------------------------------------------- */
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

    // --- Frame line tag (if not "none") ---
    var frameLine = normalizeFrameLine(card.frameLine);
    if (frameLine !== "none") {
      el.dataset.frameLine = frameLine;
      var tag = document.createElement("div");
      tag.className = "card-tag";
      tag.style.background = color;
      el.appendChild(tag);
    }

    // --- Header left group ---
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

    var meta = document.createElement("span");
    meta.className = "codeblock-meta";
    meta.textContent = card.videoData
      ? "Local file"
      : detectVideoPlatform(card.videoUrl) || "Video";
    meta.style.pointerEvents = "none";

    headerLeft.appendChild(numEl);
    headerLeft.appendChild(titleInput);
    headerLeft.appendChild(meta);

    // --- Header buttons ---
    var pinBtn = makePinButton(card);
    var previewToggle = makePreviewToggle(card);
    var expandBtn = makeVideoExpandButton(card);

    var openLinkBtn = null;
    if (card.videoUrl && !card.videoData) {
      openLinkBtn = document.createElement("button");
      openLinkBtn.className = "videoclip-link-btn";
      openLinkBtn.dataset.tooltip = "Open video in new tab";
      openLinkBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M12 2h4v4M16 2L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      openLinkBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        window.open(card.videoUrl, "_blank");
      });
      openLinkBtn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
    }

    var header = document.createElement("div");
    header.className = "card-header";
    header.appendChild(headerLeft);
    header.appendChild(pinBtn);
    if (openLinkBtn) header.appendChild(openLinkBtn);
    header.appendChild(previewToggle);
    header.appendChild(expandBtn);
    el.appendChild(header);

    // --- Body (thumbnail + inline player) ---
    var body = document.createElement("div");
    body.className = "card-body videoclip-body";

    var thumbWrapper = document.createElement("div");
    thumbWrapper.className = "videoclip-thumb-wrapper";
    thumbWrapper.setAttribute("data-block-drag", "");

    var thumbImg = document.createElement("img");
    thumbImg.className = "videoclip-thumb";

    var thumbUrl = "";
    if (card.videoData) {
      thumbUrl = card.coverArt || "";
    } else if (card.videoUrl) {
      thumbUrl = getVideoThumbnail(card.videoUrl) || "";
    }

    if (thumbUrl) {
      thumbImg.src = thumbUrl;
      thumbImg.alt = "Video thumbnail";
      thumbImg.style.display = "";
    } else {
      thumbImg.style.display = "none";
    }

    var playOverlay = document.createElement("div");
    playOverlay.className = "videoclip-play-overlay";
    playOverlay.innerHTML =
      '<svg viewBox="0 0 24 24" width="36" height="36" fill="white" opacity="0.85"><polygon points="5,3 19,12 5,21" /></svg>';

    thumbWrapper.appendChild(thumbImg);
    thumbWrapper.appendChild(playOverlay);

    thumbWrapper.addEventListener("click", function (e) {
      e.stopPropagation();
      var player = thumbWrapper.querySelector("video");
      if (player) {
        player.play();
        return;
      }
      var videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.style.position = "absolute";
      videoEl.style.top = "0";
      videoEl.style.left = "0";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "contain";
      videoEl.style.background = "#000";
      if (card.videoData) {
        videoEl.src = card.videoData;
      } else if (card.videoUrl) {
        if (isDirectVideoUrl(card.videoUrl)) {
          videoEl.src = card.videoUrl;
        } else {
          openVideoModal(card);
          return;
        }
      }
      videoEl.play();
      thumbImg.style.display = "none";
      playOverlay.style.display = "none";
      thumbWrapper.appendChild(videoEl);
    });

    if (card.videoData && !card.coverArt) {
      var localIcon = document.createElement("div");
      localIcon.className = "videoclip-local-icon";
      localIcon.innerHTML =
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" opacity="0.7"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 3c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm-4 14c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1H8v-1z"/></svg>';
      thumbWrapper.appendChild(localIcon);
    }

    body.appendChild(thumbWrapper);

    var infoLine = document.createElement("div");
    infoLine.className = "videoclip-info";
    var infoText =
      card.title || detectVideoPlatform(card.videoUrl) || "Video clip";
    infoLine.textContent = infoText;
    body.appendChild(infoLine);

    el.appendChild(body);

    var handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.dataset.tooltip = "Drag to resize";
    el.appendChild(handle);

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

    if (previewCardIds.has(card.id)) el.classList.add("card-preview");

    return el;
  }

  /* ----------------------------------------------------------
     EXPAND BUTTON
     ---------------------------------------------------------- */
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

  /* ----------------------------------------------------------
     MODAL PLAYER
     ---------------------------------------------------------- */
  function openVideoModal(card) {
    var modal = document.createElement("div");
    modal.className = "videoclip-modal";

    var content = document.createElement("div");
    content.className = "videoclip-modal-content";

    var modalHeader = document.createElement("div");
    modalHeader.className = "videoclip-modal-header";
    var titleSpan = document.createElement("span");
    titleSpan.className = "videoclip-modal-title";
    titleSpan.textContent = card.title || "Video Clip";
    var closeBtn = document.createElement("button");
    closeBtn.className = "videoclip-modal-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", function () {
      document.body.removeChild(modal);
    });
    modalHeader.appendChild(titleSpan);
    modalHeader.appendChild(closeBtn);
    content.appendChild(modalHeader);

    var modalBody = document.createElement("div");
    modalBody.className = "videoclip-modal-body";

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

    modal.addEventListener("click", function (e) {
      if (e.target === modal) document.body.removeChild(modal);
    });
    function onKey(e) {
      if (e.key === "Escape") {
        document.body.removeChild(modal);
        window.removeEventListener("keydown", onKey);
      }
    }
    window.addEventListener("keydown", onKey);
  }

  /* ----------------------------------------------------------
     HELPERS
     ---------------------------------------------------------- */
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

  function isDirectVideoUrl(url) {
    return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
  }

  function getVideoThumbnail(url) {
    if (!url) return "";
    var ytId = extractYouTubeID(url);
    if (ytId) return "https://img.youtube.com/vi/" + ytId + "/hqdefault.jpg";
    return "";
  }

  /* ----------------------------------------------------------
     AUTO‑GENERATE THUMBNAIL FROM LOCAL VIDEO
     ---------------------------------------------------------- */
  function generateVideoThumbnail(dataUrl, callback) {
    var video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.style.display = "none";
    document.body.appendChild(video);

    var cleaned = false;
    function cleanUp() {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(video.src);
      video.remove();
    }

    video.addEventListener("loadedmetadata", function () {
      var seekTime = Math.min(1, video.duration * 0.5);
      video.currentTime = seekTime;
    });

    video.addEventListener("seeked", function () {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var thumbDataUrl = canvas.toDataURL("image/jpeg", 0.7);
        cleanUp();
        callback(thumbDataUrl);
      } catch (err) {
        cleanUp();
        callback(null);
      }
    });

    video.addEventListener("error", function () {
      cleanUp();
      callback(null);
    });

    var byteString = atob(dataUrl.split(",")[1]);
    var mimeString = dataUrl.split(",")[0].split(":")[1].split(";")[0];
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    var blob = new Blob([ab], { type: mimeString });
    video.src = URL.createObjectURL(blob);
    video.load();
  }

  /* ----------------------------------------------------------
     FILE SIZE WARNING POP‑UP
     ---------------------------------------------------------- */
  function showFileSizeWarning() {
    var modal = document.createElement("div");
    modal.className = "videoclip-size-warning";

    var content = document.createElement("div");
    content.className = "videoclip-size-warning-content";
    content.innerHTML =
      "<p><strong>File too large</strong></p>" +
      "<p>Local videos must be under 5 MB to be stored inside your board. " +
      "Use a shorter clip or reduce the resolution.</p>" +
      '<button class="videoclip-size-warning-close">OK</button>';

    modal.appendChild(content);
    document.body.appendChild(modal);

    var close = content.querySelector(".videoclip-size-warning-close");
    close.addEventListener("click", function () {
      document.body.removeChild(modal);
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) document.body.removeChild(modal);
    });
    function onKey(e) {
      if (e.key === "Escape") {
        document.body.removeChild(modal);
        window.removeEventListener("keydown", onKey);
      }
    }
    window.addEventListener("keydown", onKey);
  }

  /* ----------------------------------------------------------
     INSPECTOR (with frame styling toggle)
     ---------------------------------------------------------- */
  function renderVideoclipInspector(card) {
    var container = document.createElement("div");

    // --- Frame styling block (hidden) – placed early so we can toggle it ---
    var stylingWrap = document.createElement("div");
    stylingWrap.style.display = "none";

    // Tag colour
    var colorField = document.createElement("div");
    colorField.className = "field";
    var colorLabel = document.createElement("label");
    colorLabel.textContent = "Tag color";
    var swatchRow = document.createElement("div");
    swatchRow.className = "swatch-row";
    SWATCHES.forEach(function (swColor) {
      var sw = document.createElement("div");
      sw.className = "swatch";
      sw.style.background = swColor;
      sw.dataset.color = swColor;
      if (swColor === card.color) sw.classList.add("active");
      sw.addEventListener("click", function () {
        if (mode === "view" || selectedIds.size > 1) return;
        card.color = swColor;
        swatchRow.querySelectorAll(".swatch").forEach(function (s) {
          s.classList.toggle("active", s.dataset.color === swColor);
        });
        refreshCardEl(card);
        pushHistoryDebounced();
        save();
      });
      swatchRow.appendChild(sw);
    });
    colorField.appendChild(colorLabel);
    colorField.appendChild(swatchRow);
    stylingWrap.appendChild(colorField);

    // Frame line
    var lineField = document.createElement("div");
    lineField.className = "field";
    var lineLabel = document.createElement("label");
    lineLabel.textContent = "Frame line";
    var selector = document.createElement("div");
    selector.className = "frame-line-selector";
    var options = [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
      { value: "up", label: "Up" },
      { value: "down", label: "Down" },
      { value: "none", label: "None" },
    ];
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "frame-line-btn";
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      if (normalizeFrameLine(card.frameLine) === opt.value)
        btn.classList.add("active");
      btn.addEventListener("click", function () {
        if (mode === "view" || selectedIds.size > 1) return;
        var newValue = opt.value;
        card.frameLine = newValue;
        selector.querySelectorAll(".frame-line-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.value === newValue);
        });
        refreshCardEl(card);
        pushHistoryDebounced();
        save();
      });
      selector.appendChild(btn);
    });
    lineField.appendChild(lineLabel);
    lineField.appendChild(selector);
    stylingWrap.appendChild(lineField);

    // --- Title field with inline toggle button ---
    var titleField = document.createElement("div");
    titleField.className = "field";

    var titleLabel = document.createElement("label");
    titleLabel.textContent = "Title";
    titleField.appendChild(titleLabel);

    var titleRow = document.createElement("div");
    titleRow.className = "videoclip-file-row"; // existing flex row class

    var titleInp = document.createElement("input");
    titleInp.type = "text";
    titleInp.value = card.title || "";
    titleInp.placeholder = "Video title";
    titleInp.style.flex = "1";
    titleInp.style.minWidth = "0";
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
    titleRow.appendChild(titleInp);

    // Small square toggle button (uses existing videoclip-file-clear style)
    var stylingToggleBtn = document.createElement("button");
    stylingToggleBtn.type = "button";
    stylingToggleBtn.className = "videoclip-file-clear";
    stylingToggleBtn.innerHTML = "▸"; // closed state
    stylingToggleBtn.dataset.tooltip = "Frame styling";
    stylingToggleBtn.addEventListener("click", function () {
      var isOpen = stylingWrap.style.display !== "none";
      stylingWrap.style.display = isOpen ? "none" : "";
      stylingToggleBtn.innerHTML = isOpen ? "▸" : "▾";
    });
    titleRow.appendChild(stylingToggleBtn);
    titleField.appendChild(titleRow);

    container.appendChild(titleField);
    container.appendChild(stylingWrap); // placed right after title

    // --- Position grid (unchanged) ---
    var grid = document.createElement("div");
    grid.className = "field-grid";
    function makeCoordField(label, key) {
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
    grid.appendChild(makeCoordField("W", "w"));
    grid.appendChild(makeCoordField("H", "h"));
    container.appendChild(grid);

    // --- Video source section (unchanged) ---
    var sourceSection = document.createElement("div");
    sourceSection.className = "field videoclip-source-section";
    var sourceLabel = document.createElement("label");
    sourceLabel.textContent = "Video source";
    sourceSection.appendChild(sourceLabel);

    // URL row
    var urlRow = document.createElement("div");
    urlRow.style.display = "flex";
    urlRow.style.gap = "8px";
    urlRow.style.alignItems = "center";
    var urlInp = document.createElement("input");
    urlInp.type = "text";
    urlInp.value = card.videoUrl || "";
    urlInp.placeholder = "https://youtube.com/watch?v=...";
    urlInp.style.flex = "1";
    var urlClearBtn = document.createElement("button");
    urlClearBtn.className = "videoclip-file-clear";
    urlClearBtn.innerHTML = "✕";
    urlClearBtn.title = "Clear URL";
    urlRow.appendChild(urlInp);
    urlRow.appendChild(urlClearBtn);
    sourceSection.appendChild(urlRow);

    // File row
    var fileRow = document.createElement("div");
    fileRow.className = "videoclip-file-row";
    var fileInp = document.createElement("input");
    fileInp.type = "file";
    fileInp.accept = "video/*";
    fileInp.style.display = "none";
    var chooseBtn = document.createElement("button");
    chooseBtn.type = "button";
    chooseBtn.className = "videoclip-file-btn";
    chooseBtn.textContent = "Choose file";
    var fileNameDisplay = document.createElement("span");
    fileNameDisplay.className = "videoclip-file-name";
    fileNameDisplay.textContent = card.videoData
      ? "File loaded"
      : "No file chosen";
    var fileClearBtn = document.createElement("button");
    fileClearBtn.className = "videoclip-file-clear";
    fileClearBtn.innerHTML = "✕";
    fileClearBtn.title = "Remove local file";
    chooseBtn.addEventListener("click", function () {
      fileInp.click();
    });
    fileRow.appendChild(fileInp);
    fileRow.appendChild(chooseBtn);
    fileRow.appendChild(fileNameDisplay);
    fileRow.appendChild(fileClearBtn);
    sourceSection.appendChild(fileRow);

    // URL behaviour
    urlInp.addEventListener("input", function () {
      var newUrl = urlInp.value;
      if (newUrl && card.videoData) {
        card.videoData = null;
        card.coverArt = null;
        fileNameDisplay.textContent = "No file chosen";
      }
      card.videoUrl = newUrl;
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    });
    urlClearBtn.addEventListener("click", function () {
      card.videoUrl = "";
      urlInp.value = "";
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    });

    // File behaviour
    fileInp.addEventListener("change", function () {
      var file = fileInp.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        showFileSizeWarning();
        fileInp.value = "";
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var dataUrl = e.target.result;
        card.videoUrl = "";
        card.videoData = dataUrl;
        card.coverArt = null;
        fileNameDisplay.textContent =
          file.name + " (" + (file.size / 1024 / 1024).toFixed(1) + " MB)";
        urlInp.value = "";
        generateVideoThumbnail(dataUrl, function (thumb) {
          card.coverArt = thumb || null;
          refreshCardEl(card);
          pushHistoryDebounced();
          save();
        });
        refreshCardEl(card);
        pushHistoryDebounced();
        save();
      };
      reader.readAsDataURL(file);
    });
    fileClearBtn.addEventListener("click", function () {
      card.videoData = null;
      card.coverArt = null;
      fileInp.value = "";
      fileNameDisplay.textContent = "No file chosen";
      refreshCardEl(card);
      pushHistoryDebounced();
      save();
    });

    container.appendChild(sourceSection);

    // Notes
    var notesField = document.createElement("div");
    notesField.className = "field";
    var notesLabel = document.createElement("label");
    notesLabel.textContent = "Creator's note";
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

  /* ----------------------------------------------------------
     CARD REFRESH
     ---------------------------------------------------------- */
  function refreshCardEl(card) {
    var el = $world.querySelector('[data-card-id="' + card.id + '"]');
    if (!el) return;
    var meta = el.querySelector(".codeblock-meta");
    if (meta)
      meta.textContent = card.videoData
        ? "Local file"
        : detectVideoPlatform(card.videoUrl) || "Video";
    if (el.parentNode) {
      var num = parseInt(el.querySelector(".card-num").textContent, 10);
      var newEl = buildVideoclipEl(card, num);
      el.parentNode.replaceChild(newEl, el);
    }
  }

  /* ----------------------------------------------------------
     REGISTRATION
     ---------------------------------------------------------- */
  window.LoomElements = window.LoomElements || {};
  window.LoomElements["videoclip"] = {
    id: "videoclip",
    name: "Video Clip",
    description:
      "Embed YouTube/Vimeo or upload local video (auto‑thumbnail, 5 MB limit) with optional frame styling.",
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
        videoData: null,
        coverArt: null,
        frameLine: "none", // default – line hidden
      };
    },
    render: function (card, num) {
      return buildVideoclipEl(card, num);
    },
    renderInspector: renderVideoclipInspector,
  };
})();
