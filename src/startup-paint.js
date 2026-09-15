// Keep the browser's own new-tab canvas visible until the full wallpaper is ready.
try {
  var root = document.documentElement;
  var hasStoredBackground = localStorage.getItem("has_idb_bg") === "true";

  if (hasStoredBackground) {
    root.classList.add("ydd-custom-bg-pending", "ydd-browser-default-startup");
    root.style.removeProperty("background-color");
    root.style.removeProperty("background-image");

    var startupStyle = document.createElement("style");
    startupStyle.id = "ydd-browser-default-startup-style";
    startupStyle.textContent =
      "html.ydd-browser-default-startup," +
      "html.ydd-browser-default-startup body {" +
      "background-color: transparent !important;" +
      "background-image: none !important;" +
      "}" +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-track," +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-thumb," +
      "html.ydd-browser-default-startup ::-webkit-scrollbar-corner {" +
      "background: transparent !important;" +
      "}" +
      "#ydd-startup-wallpaper {" +
      "position: fixed; inset: 0; z-index: -2; pointer-events: none;" +
      "background-size: cover; background-position: center; background-repeat: no-repeat;" +
      "opacity: 0; transition: opacity 0.2s ease;" +
      "}" +
      "body.ydd-startup-wallpaper-visible #ydd-startup-wallpaper { opacity: 1; }" +
      "html.ydd-browser-default-startup body.has-custom-bg::before {" +
      "opacity: 0 !important; transition: opacity 0.2s ease !important;" +
      "}" +
      "html.ydd-browser-default-startup body.has-custom-bg.ydd-startup-wallpaper-visible::before {" +
      "opacity: 1 !important;" +
      "}";
    document.head.appendChild(startupStyle);

    var startupObjectUrl = null;
    var startupFinished = false;

    var finishStartup = function () {
      if (startupFinished) return;
      startupFinished = true;
      var body = document.body;
      var layer = document.getElementById("ydd-startup-wallpaper");

      if (body && startupObjectUrl) {
        body.style.setProperty(
          "background-image",
          'url("' + startupObjectUrl.replace(/"/g, "%22") + '")',
          "important",
        );
        body.style.setProperty("background-size", "cover", "important");
        body.style.setProperty("background-position", "center", "important");
        body.style.setProperty("background-repeat", "no-repeat", "important");
        body.classList.add("has-custom-bg");
        body.classList.remove("ydd-startup-wallpaper-visible");
      }

      root.classList.remove("ydd-browser-default-startup", "ydd-custom-bg-pending");
      root.style.removeProperty("background-color");
      root.style.removeProperty("background-image");
      root.style.removeProperty("background-size");
      root.style.removeProperty("background-position");
      root.style.removeProperty("background-repeat");
      document.getElementById("ydd-startup-background")?.remove();
      document.getElementById("idb-preloader")?.remove();
      document.getElementById("ydd-idb-background")?.remove();
      layer?.remove();
      startupStyle.remove();
    };

    var failStartup = function () {
      if (startupFinished) return;
      startupFinished = true;
      root.classList.remove("ydd-browser-default-startup");
      startupStyle.remove();
      if (startupObjectUrl) URL.revokeObjectURL(startupObjectUrl);
    };

    var bodyReady = document.body
      ? Promise.resolve()
      : new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });

    var request = indexedDB.open("YDD_Storage", 2);
    request.onsuccess = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains("images")) {
        db.close();
        failStartup();
        return;
      }

      var transaction = db.transaction("images", "readonly");
      var getRequest = transaction.objectStore("images").get("current_bg");
      transaction.oncomplete = function () { db.close(); };
      transaction.onerror = function () { db.close(); };
      transaction.onabort = function () { db.close(); };

      getRequest.onsuccess = function (getEvent) {
        var blob = getEvent.target.result;
        if (!(blob instanceof Blob)) {
          failStartup();
          return;
        }

        startupObjectUrl = URL.createObjectURL(blob);
        var image = new Image();
        image.decoding = "async";
        image.src = startupObjectUrl;
        var decoded = typeof image.decode === "function"
          ? image.decode()
          : new Promise(function (resolve, reject) {
            image.onload = resolve;
            image.onerror = reject;
          });

        Promise.all([decoded, bodyReady]).then(function () {
          if (startupFinished || !document.body) return;
          var layer = document.createElement("div");
          layer.id = "ydd-startup-wallpaper";
          layer.setAttribute("aria-hidden", "true");
          layer.style.backgroundImage =
            'url("' + startupObjectUrl.replace(/"/g, "%22") + '")';
          document.body.prepend(layer);
          document.body.classList.add("has-custom-bg");

          var completed = false;
          var complete = function () {
            if (completed) return;
            completed = true;
            finishStartup();
          };
          layer.addEventListener("transitionend", complete, { once: true });
          window.setTimeout(complete, 350);

          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              document.body?.classList.add("ydd-startup-wallpaper-visible");
            });
          });
        }).catch(failStartup);
      };
      getRequest.onerror = failStartup;
    };
    request.onerror = failStartup;

    window.addEventListener(
      "pagehide",
      function () {
        if (startupObjectUrl) URL.revokeObjectURL(startupObjectUrl);
      },
      { once: true },
    );
  }
} catch (error) {
}
