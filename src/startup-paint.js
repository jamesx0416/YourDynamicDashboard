// Prepare an uploaded wallpaper before the dashboard is revealed.
(() => {
  window.__yddUploadedWallpaperReady = Promise.resolve(false);

  try {
    if (localStorage.getItem("has_idb_bg") !== "true") return;

    const root = document.documentElement;
    const storedCanvasColor = localStorage.getItem("startupCanvasColor");
    const startupCanvasColor = /^#[\da-f]{6}$/i.test(storedCanvasColor || "")
      ? storedCanvasColor
      : "Canvas";

    let resolveStartup;
    let objectUrl = null;
    let wallpaperLayer = null;
    let finished = false;

    const releaseObjectUrl = () => {
      if (!objectUrl) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    window.__releaseYddStartupWallpaper = releaseObjectUrl;

    window.__yddUploadedWallpaperReady = new Promise((resolve) => {
      resolveStartup = resolve;
    });

    root.classList.add("ydd-custom-bg-pending", "ydd-wallpaper-startup");
    root.style.setProperty("--ydd-startup-canvas", startupCanvasColor);

    const bodyReady = new Promise((resolve) => {
      if (document.body) {
        resolve();
        return;
      }
      if (typeof MutationObserver === "function") {
        const observer = new MutationObserver(() => {
          if (!document.body) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(root, { childList: true });
        return;
      }
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });

    const readStoredWallpaper = () =>
      new Promise((resolve, reject) => {
        const openRequest = indexedDB.open("YDD_Storage", 2);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onblocked = () =>
          reject(new Error("Wallpaper database open was blocked."));
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          if (!db.objectStoreNames.contains("images")) {
            db.close();
            reject(new Error("Wallpaper store is unavailable."));
            return;
          }

          const transaction = db.transaction("images", "readonly");
          const getRequest = transaction.objectStore("images").get("current_bg");
          transaction.oncomplete = () => db.close();
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            if (!(getRequest.result instanceof Blob)) {
              reject(new Error("Stored wallpaper is unavailable."));
              return;
            }
            resolve(getRequest.result);
          };
        };
      });

    const clearStartupSurface = () => {
      root.classList.remove("ydd-wallpaper-startup", "ydd-custom-bg-pending");
      root.style.removeProperty("--ydd-startup-canvas");
      document.body?.classList.remove("ydd-startup-wallpaper-visible");
    };

    const failStartup = () => {
      if (finished) return;
      finished = true;
      clearStartupSurface();
      wallpaperLayer?.remove();
      wallpaperLayer = null;
      releaseObjectUrl();
      resolveStartup(false);
    };

    const finishStartup = () => {
      if (finished) return;
      const body = document.body;
      if (!body || !objectUrl) {
        failStartup();
        return;
      }
      finished = true;

      body.style.setProperty(
        "background-image",
        `url("${objectUrl.replace(/"/g, "%22")}")`,
        "important",
      );
      body.style.setProperty("background-size", "cover", "important");
      body.style.setProperty("background-position", "center", "important");
      body.style.setProperty("background-repeat", "no-repeat", "important");
      body.classList.add("has-custom-bg");
      root.classList.remove("ydd-wallpaper-startup");
      root.style.removeProperty("--ydd-startup-canvas");

      // Keep the decoded image for one paint while the body background takes over.
      window.requestAnimationFrame(() => {
        body.classList.remove("ydd-startup-wallpaper-visible");
        root.classList.remove("ydd-custom-bg-pending");
        wallpaperLayer?.remove();
        wallpaperLayer = null;
        resolveStartup(true);
      });
    };

    readStoredWallpaper()
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.id = "ydd-startup-wallpaper";
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.decoding = "async";

        const loaded = new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", reject, { once: true });
        });
        image.src = objectUrl;

        const decoded = typeof image.decode === "function"
          ? image.decode().catch(() => loaded)
          : loaded;

        return Promise.all([decoded, bodyReady]).then(() => image);
      })
      .then((image) => {
        if (finished || !document.body) return;
        wallpaperLayer = image;
        document.body.prepend(image);
        document.body.classList.add("has-custom-bg");

        let completed = false;
        const complete = () => {
          if (completed) return;
          completed = true;
          finishStartup();
        };
        image.addEventListener("transitionend", complete, { once: true });
        window.setTimeout(complete, 350);

        // Establish opacity: 0 before starting the transition in the same frame.
        void image.offsetWidth;
        document.body.classList.add("ydd-startup-wallpaper-visible");
      })
      .catch(failStartup);

    window.addEventListener(
      "pagehide",
      releaseObjectUrl,
      { once: true },
    );
  } catch (error) {
    window.__yddUploadedWallpaperReady = Promise.resolve(false);
  }
})();
