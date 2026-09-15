// Keep the browser's own new tab canvas visible until the full wallpaper is ready.
try {
  var root = document.documentElement;
  var hasStoredBackground = localStorage.getItem("has_idb_bg") === "true";
  var storedStartupCanvasColor = localStorage.getItem("startupCanvasColor");
  var startupCanvasColor = /^#[\da-f]{6}$/i.test(storedStartupCanvasColor || "")
    ? storedStartupCanvasColor
    : "Canvas";

  if (hasStoredBackground) {
    var resolveWallpaperStartup = null;
    window.__yddUploadedWallpaperReady = new Promise(function (resolve) {
      resolveWallpaperStartup = resolve;
    });

    root.classList.add("ydd-custom-bg-pending", "ydd-browser-default-startup");
    root.style.setProperty("color-scheme", "light dark");
    root.style.removeProperty("background-color");
    root.style.removeProperty("background-image");

    var startupStyle = document.createElement("style");
    startupStyle.id = "ydd-browser-default-startup-style";
    startupStyle.textContent =
      "html.ydd-browser-default-startup," +
      "html.ydd-browser-default-startup body {" +
      "color-scheme: light dark;" +
      "background-color: " + startupCanvasColor + " !important;" +
      "background-image: none !important;" +
      "}" +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-track," +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-thumb," +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-corner {" +
      "background: transparent !important;" +
      "}" +
      "#ydd-startup-wallpaper {" +
      "position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: -2;" +
      "display: block; pointer-events: none; object-fit: cover; object-position: center;" +
      "opacity: 0; transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1) !important;" +
      "}" +
      "body.ydd-startup-wallpaper-visible #ydd-startup-wallpaper { opacity: 1; }" +
      "html.ydd-browser-default-startup body.has-custom-bg::before {" +
      "opacity: 0 !important; transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1) !important;" +
      "}" +
      "html.ydd-browser-default-startup body.has-custom-bg.ydd-startup-wallpaper-visible::before {" +
      "opacity: 1 !important;" +
      "}";
    document.head.appendChild(startupStyle);

    var startupObjectUrl = null;
    var startupLayer = null;
    var startupFinished = false;

    var settleStartup = function () {
      if (!resolveWallpaperStartup) return;
      resolveWallpaperStartup();
      resolveWallpaperStartup = null;
    };

    var removeStartupLayer = function () {
      document.body?.classList.remove("ydd-startup-wallpaper-visible");
      root.classList.remove("ydd-custom-bg-pending");
      startupLayer?.remove();
      startupLayer = null;
      startupStyle.remove();
      settleStartup();
    };

    var finishStartup = function () {
      if (startupFinished) return;
      startupFinished = true;
      var body = document.body;
      if (!body || !startupObjectUrl) {
        removeStartupLayer();
        return;
      }

      body.style.setProperty(
        "background-image",
        'url("' + startupObjectUrl.replace(/"/g, "%22") + '")',
        "important",
      );
      body.style.setProperty("background-size", "cover", "important");
      body.style.setProperty("background-position", "center", "important");
      body.style.setProperty("background-repeat", "no-repeat", "important");
      body.classList.add("has-custom-bg");

      root.classList.remove("ydd-browser-default-startup");
      root.style.removeProperty("color-scheme");
      root.style.removeProperty("background-color");
      root.style.removeProperty("background-image");
      root.style.removeProperty("background-size");
      root.style.removeProperty("background-position");
      root.style.removeProperty("background-repeat");

      // Keep the decoded layer through the next paint while the body takes over.
      window.requestAnimationFrame(removeStartupLayer);
    };

    var failStartup = function () {
      if (startupFinished) return;
      startupFinished = true;
      root.classList.remove("ydd-browser-default-startup", "ydd-custom-bg-pending");
      root.style.removeProperty("color-scheme");
      document.body?.classList.remove("ydd-startup-wallpaper-visible");
      startupLayer?.remove();
      startupLayer = null;
      startupStyle.remove();
      if (startupObjectUrl) {
        URL.revokeObjectURL(startupObjectUrl);
        startupObjectUrl = null;
      }
      settleStartup();
    };

    var bodyReady = document.body
      ? Promise.resolve()
      : new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });

    var getExpectedStartupProfile = function () {
      var screenWidth = Math.max(1, Number(window.screen?.width) || 1920);
      var screenHeight = Math.max(1, Number(window.screen?.height) || 1080);
      var dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
      var rawWidth = Math.ceil(screenWidth * dpr);
      var rawHeight = Math.ceil(screenHeight * dpr);
      var scale = Math.min(1, 3840 / rawWidth, 2160 / rawHeight);
      var width = Math.max(1, Math.round(rawWidth * scale));
      var height = Math.max(1, Math.round(rawHeight * scale));
      return "optimized:" + width + "x" + height;
    };

    var decodeAndShowBlob = function (backgroundBlob, fallbackToOriginal) {
      if (!(backgroundBlob instanceof Blob)) {
        if (fallbackToOriginal) {
          loadOriginalWallpaper();
        } else {
          failStartup();
        }
        return;
      }

      if (startupObjectUrl) URL.revokeObjectURL(startupObjectUrl);
      startupObjectUrl = URL.createObjectURL(backgroundBlob);
      var image = new Image();
      image.id = "ydd-startup-wallpaper";
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.decoding = "async";
      image.fetchPriority = "high";
      image.src = startupObjectUrl;

      var decoded = typeof image.decode === "function"
        ? image.decode()
        : new Promise(function (resolve, reject) {
          image.onload = resolve;
          image.onerror = reject;
        });

      Promise.all([decoded, bodyReady]).then(function () {
        if (startupFinished || !document.body) return;
        startupLayer = image;
        document.body.prepend(startupLayer);
        document.body.classList.add("has-custom-bg");

        var completed = false;
        var complete = function () {
          if (completed) return;
          completed = true;
          finishStartup();
        };
        startupLayer.addEventListener(
          "transitionend",
          function (event) {
            if (event.propertyName === "opacity") complete();
          },
          { once: true },
        );
        window.setTimeout(complete, 350);

        // Commit the transparent starting state now, then begin the fade without
        // deliberately waiting one or two display frames.
        void startupLayer.offsetWidth;
        document.body.classList.add("ydd-startup-wallpaper-visible");
      }).catch(function () {
        if (fallbackToOriginal) {
          loadOriginalWallpaper();
        } else {
          failStartup();
        }
      });
    };

    var loadOriginalWallpaper = function () {
      if (startupFinished) return;
      var fallbackDbRequest = indexedDB.open("YDD_Storage", 2);
      fallbackDbRequest.onsuccess = function (fallbackDbEvent) {
        var fallbackDb = fallbackDbEvent.target.result;
        if (!fallbackDb.objectStoreNames.contains("images")) {
          fallbackDb.close();
          failStartup();
          return;
        }
        var fallbackTransaction = fallbackDb.transaction("images", "readonly");
        var fallbackRequest = fallbackTransaction
          .objectStore("images")
          .get("current_bg");
        fallbackTransaction.oncomplete = function () { fallbackDb.close(); };
        fallbackTransaction.onerror = function () {
          fallbackDb.close();
          failStartup();
        };
        fallbackTransaction.onabort = function () {
          fallbackDb.close();
          failStartup();
        };
        fallbackRequest.onsuccess = function (fallbackEvent) {
          decodeAndShowBlob(fallbackEvent.target.result, false);
        };
        fallbackRequest.onerror = failStartup;
      };
      fallbackDbRequest.onerror = failStartup;
    };

    var request = indexedDB.open("YDD_Storage", 2);
    request.onsuccess = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains("images")) {
        db.close();
        failStartup();
        return;
      }

      var transaction = db.transaction("images", "readonly");
      var store = transaction.objectStore("images");
      var profileRequest = store.get("startup_bg_profile");
      transaction.oncomplete = function () { db.close(); };
      transaction.onerror = function () { db.close(); failStartup(); };
      transaction.onabort = function () { db.close(); failStartup(); };

      profileRequest.onsuccess = function (profileEvent) {
        if (profileEvent.target.result !== getExpectedStartupProfile()) {
          var originalRequest = store.get("current_bg");
          originalRequest.onsuccess = function (originalEvent) {
            decodeAndShowBlob(originalEvent.target.result, false);
          };
          originalRequest.onerror = failStartup;
          return;
        }

        var startupRequest = store.get("startup_bg");
        startupRequest.onsuccess = function (startupEvent) {
          decodeAndShowBlob(startupEvent.target.result, true);
        };
        startupRequest.onerror = loadOriginalWallpaper;
      };
      profileRequest.onerror = loadOriginalWallpaper;
    };
    request.onerror = failStartup;

    window.addEventListener(
      "pagehide",
      function () {
        if (startupObjectUrl) URL.revokeObjectURL(startupObjectUrl);
      },
      { once: true },
    );
  } else {
    window.__yddUploadedWallpaperReady = Promise.resolve();
  }
} catch (error) {
  window.__yddUploadedWallpaperReady = Promise.resolve();
}
