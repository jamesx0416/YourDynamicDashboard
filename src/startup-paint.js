// Load an uploaded wallpaper as early as possible, then hand it to the page.
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
      "}";
    document.head.appendChild(startupStyle);

    var startupObjectUrl = null;
    var startupWallpaperUrl = null;
    var startupLayer = null;
    var startupFinished = false;

    var settleStartup = function () {
      if (!resolveWallpaperStartup) return;
      resolveWallpaperStartup();
      resolveWallpaperStartup = null;
    };

    var removeStartupLayer = function () {
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
      if (!body || !startupWallpaperUrl) {
        removeStartupLayer();
        return;
      }

      body.style.setProperty(
        "background-image",
        'url("' + startupWallpaperUrl.replace(/"/g, "%22") + '")',
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

      // The already-decoded image covers the first body-background paint.
      window.requestAnimationFrame(removeStartupLayer);
    };

    var failStartup = function () {
      if (startupFinished) return;
      startupFinished = true;
      root.classList.remove("ydd-browser-default-startup", "ydd-custom-bg-pending");
      root.style.removeProperty("color-scheme");
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

    var decodeWallpaper = function (url) {
      var image = new Image();
      image.id = "ydd-startup-wallpaper";
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.decoding = "async";
      image.fetchPriority = "high";
      image.src = url;

      var decoded = typeof image.decode === "function"
        ? image.decode()
        : new Promise(function (resolve, reject) {
          image.onload = resolve;
          image.onerror = reject;
        });

      return decoded.then(function () {
        return { image: image, url: url };
      });
    };

    var loadWallpaperFromIndexedDb = function () {
      return new Promise(function (resolve, reject) {
        var request = indexedDB.open("YDD_Storage", 2);
        request.onsuccess = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains("images")) {
            db.close();
            reject(new Error("Wallpaper store is unavailable."));
            return;
          }

          var transaction = db.transaction("images", "readonly");
          var getRequest = transaction.objectStore("images").get("current_bg");
          transaction.oncomplete = function () { db.close(); };
          transaction.onerror = function () {
            db.close();
            reject(transaction.error || new Error("Wallpaper transaction failed."));
          };
          transaction.onabort = function () {
            db.close();
            reject(transaction.error || new Error("Wallpaper transaction aborted."));
          };

          getRequest.onsuccess = function (getEvent) {
            var blob = getEvent.target.result;
            if (!(blob instanceof Blob)) {
              reject(new Error("Stored wallpaper is unavailable."));
              return;
            }
            startupObjectUrl = URL.createObjectURL(blob);
            decodeWallpaper(startupObjectUrl).then(resolve, reject);
          };
          getRequest.onerror = function () {
            reject(getRequest.error || new Error("Wallpaper read failed."));
          };
        };
        request.onerror = function () {
          reject(request.error || new Error("Wallpaper database failed to open."));
        };
      });
    };

    var canUseExtensionWallpaperRoute =
      location.protocol === "chrome-extension:" &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller;
    var fastWallpaperUrl = new URL("/__ydd/wallpaper-current", document.baseURI).href;
    var wallpaperLoad = canUseExtensionWallpaperRoute
      ? decodeWallpaper(fastWallpaperUrl).catch(loadWallpaperFromIndexedDb)
      : loadWallpaperFromIndexedDb();

    Promise.all([wallpaperLoad, bodyReady]).then(function (results) {
      if (startupFinished || !document.body) return;
      var prepared = results[0];
      startupLayer = prepared.image;
      startupWallpaperUrl = prepared.url;
      document.body.prepend(startupLayer);
      document.body.classList.add("has-custom-bg");
      finishStartup();
    }).catch(failStartup);

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
