// IndexedDB configuration
const DB_NAME = "YDD_Storage";
const STORE_NAME = "images";
const DB_VERSION = 2;
const RANDOM_BACKGROUND_QUEUE_KEY = "random_bg_queue";
const RANDOM_BACKGROUND_CURRENT_KEY = "random_bg_current";
const STARTUP_BACKGROUND_KEY = "startup_bg";
const STARTUP_BACKGROUND_PROFILE_KEY = "startup_bg_profile";
const STARTUP_MAX_WIDTH = 3840;
const STARTUP_MAX_HEIGHT = 2160;

let databasePromise = null;
let mutationQueue = Promise.resolve();

function getStartupBackgroundTarget() {
  const screenWidth = Math.max(1, Number(globalThis.screen?.width) || 1920);
  const screenHeight = Math.max(1, Number(globalThis.screen?.height) || 1080);
  const dpr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  const rawWidth = Math.ceil(screenWidth * dpr);
  const rawHeight = Math.ceil(screenHeight * dpr);
  const scale = Math.min(
    1,
    STARTUP_MAX_WIDTH / rawWidth,
    STARTUP_MAX_HEIGHT / rawHeight,
  );
  const width = Math.max(1, Math.round(rawWidth * scale));
  const height = Math.max(1, Math.round(rawHeight * scale));
  return {
    width,
    height,
    profile: `${width}x${height}`,
  };
}

async function createStartupBackgroundBlob(blob) {
  if (!(blob instanceof Blob) || blob.type === "image/gif") return null;
  if (typeof createImageBitmap !== "function") return null;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    const target = getStartupBackgroundTarget();
    const targetWidth = target.width;
    const targetHeight = target.height;

    const sourceRatio = bitmap.width / bitmap.height;
    const targetRatio = targetWidth / targetHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;

    if (sourceRatio > targetRatio) {
      sourceWidth = Math.round(bitmap.height * targetRatio);
      sourceX = Math.round((bitmap.width - sourceWidth) / 2);
    } else if (sourceRatio < targetRatio) {
      sourceHeight = Math.round(bitmap.width / targetRatio);
      sourceY = Math.round((bitmap.height - sourceHeight) / 2);
    }

    if (sourceWidth <= targetWidth && sourceHeight <= targetHeight) return null;

    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(targetWidth, targetHeight)
      : Object.assign(document.createElement("canvas"), {
        width: targetWidth,
        height: targetHeight,
      });
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    const outputType = "image/webp";
    let result = null;
    if (typeof canvas.convertToBlob === "function") {
      result = await canvas.convertToBlob({
        type: outputType,
        quality: 0.95,
      });
    } else {
      result = await new Promise((resolve) => {
        canvas.toBlob(
          resolve,
          outputType,
          0.95,
        );
      });
    }
    return result instanceof Blob && result.size > 0 ? result : null;
  } catch (error) {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

// Database lifecycle
function openDB() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("IndexedDB could not be opened."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("IndexedDB upgrade is blocked by another tab."));
    };
  });
  return databasePromise;
}

// Transaction helpers
async function runTransaction(mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      const request = operation(store);
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
      };
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("IndexedDB transaction was aborted."),
      );
  });
}

function enqueueMutation(operation) {
  const pending = mutationQueue.catch(() => {}).then(operation);
  mutationQueue = pending.catch(() => {});
  return pending;
}

// Background queue mutations
function mutateRandomBackgroundQueue(mutator) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let result;
        let settled = false;

        const fail = (error) => {
          if (settled) return;
          settled = true;
          try {
            transaction.abort();
          } catch (abortError) {
          }
          reject(error || new Error("Random background queue update failed."));
        };

        const request = store.get(RANDOM_BACKGROUND_QUEUE_KEY);
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          try {
            const queue = Array.isArray(request.result) ? request.result : [];
            const mutation = mutator(queue) || {};
            result = Array.isArray(mutation.result) ? mutation.result : {
              ...(mutation.result || {}),
              queueExists: Array.isArray(request.result),
            };
            if (mutation.queue) {
              store.put(mutation.queue, RANDOM_BACKGROUND_QUEUE_KEY);
            }
          } catch (error) {
            fail(error);
          }
        };

        transaction.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        };
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error);
      }),
  );
}

function randomBackgroundIdentity(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    const picsumId = parsed.pathname.match(/\/id\/([^/]+)/)?.[1];
    return picsumId
      ? `picsum:${picsumId}`
      : `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return url;
  }
}

// Background storage API
export const secondStorage = {
  saveImage(blob) {
    return enqueueMutation(async () => {
      const result = await runTransaction(
        "readwrite",
        (store) => store.put(blob, "current_bg"),
      );

      const startupBlob = await createStartupBackgroundBlob(blob);
      const startupProfile = getStartupBackgroundTarget().profile;
      try {
        await runTransaction("readwrite", (store) => {
          if (startupBlob instanceof Blob) {
            store.put(
              `optimized:${startupProfile}`,
              STARTUP_BACKGROUND_PROFILE_KEY,
            );
            return store.put(startupBlob, STARTUP_BACKGROUND_KEY);
          }
          store.put(
            `original:${startupProfile}`,
            STARTUP_BACKGROUND_PROFILE_KEY,
          );
          return store.delete(STARTUP_BACKGROUND_KEY);
        });
      } catch (error) {
        // The original wallpaper is already safely stored. Optimization is a
        // best-effort acceleration and must not make wallpaper saves fail.
        try {
          await runTransaction("readwrite", (store) => {
            store.put(
              `original:${startupProfile}`,
              STARTUP_BACKGROUND_PROFILE_KEY,
            );
            return store.delete(STARTUP_BACKGROUND_KEY);
          });
        } catch (cleanupError) {
        }
      }
      return result;
    });
  },

  async getImage() {
    await mutationQueue;
    return runTransaction("readonly", (store) => store.get("current_bg"));
  },

  async ensureStartupImage() {
    return enqueueMutation(async () => {
      try {
        const targetProfile = getStartupBackgroundTarget().profile;
        const existing = await runTransaction(
          "readonly",
          (store) => store.get(STARTUP_BACKGROUND_KEY),
        );
        const existingProfile = await runTransaction(
          "readonly",
          (store) => store.get(STARTUP_BACKGROUND_PROFILE_KEY),
        );
        if (
          existing instanceof Blob &&
          existingProfile === `optimized:${targetProfile}`
        ) {
          return true;
        }
        if (
          !(existing instanceof Blob) &&
          existingProfile === `original:${targetProfile}`
        ) return true;

        const original = await runTransaction(
          "readonly",
          (store) => store.get("current_bg"),
        );
        if (!(original instanceof Blob)) return false;

        const startupBlob = await createStartupBackgroundBlob(original);
        try {
          await runTransaction("readwrite", (store) => {
            if (startupBlob instanceof Blob) {
              store.put(
                `optimized:${targetProfile}`,
                STARTUP_BACKGROUND_PROFILE_KEY,
              );
              return store.put(startupBlob, STARTUP_BACKGROUND_KEY);
            }
            store.put(
              `original:${targetProfile}`,
              STARTUP_BACKGROUND_PROFILE_KEY,
            );
            return store.delete(STARTUP_BACKGROUND_KEY);
          });
        } catch (error) {
          // Startup optimization is optional. If IndexedDB cannot persist the
          // derived copy (for example because storage is full), fall back to
          // the original wallpaper and avoid retrying this failed profile.
          try {
            await runTransaction("readwrite", (store) => {
              store.put(
                `original:${targetProfile}`,
                STARTUP_BACKGROUND_PROFILE_KEY,
              );
              return store.delete(STARTUP_BACKGROUND_KEY);
            });
          } catch (cleanupError) {
          }
          return false;
        }
        return true;
      } catch (error) {
        // The normal wallpaper path does not depend on this derived cache.
        return false;
      }
    });
  },

  deleteImage() {
    return enqueueMutation(() =>
      runTransaction("readwrite", (store) => {
        store.delete(STARTUP_BACKGROUND_KEY);
        store.delete(STARTUP_BACKGROUND_PROFILE_KEY);
        return store.delete("current_bg");
      })
    );
  },

  saveRandomBackgroundQueue(queue) {
    return enqueueMutation(() =>
      runTransaction(
        "readwrite",
        (store) => store.put(queue, RANDOM_BACKGROUND_QUEUE_KEY),
      )
    );
  },

  async getRandomBackgroundQueue() {
    await mutationQueue;
    const queue = await runTransaction(
      "readonly",
      (store) => store.get(RANDOM_BACKGROUND_QUEUE_KEY),
    );
    return Array.isArray(queue) ? queue : [];
  },

  takeRandomBackgroundQueue() {
    return enqueueMutation(() =>
      mutateRandomBackgroundQueue((queue) => {
        const [entry, ...remaining] = queue;
        return {
          result: { entry: entry || null, queue: remaining },
          queue: remaining,
        };
      })
    );
  },

  appendRandomBackgroundQueue(entries, limit = 2) {
    return enqueueMutation(() =>
      mutateRandomBackgroundQueue((queue) => {
        const nextQueue = queue.filter((entry) =>
          Boolean(randomBackgroundIdentity(entry?.url))
        );
        const knownUrls = new Set(
          nextQueue
            .map((entry) => randomBackgroundIdentity(entry?.url))
            .filter(Boolean),
        );

        for (const entry of Array.isArray(entries) ? entries : []) {
          const identity = randomBackgroundIdentity(entry?.url);
          if (!entry || !identity || knownUrls.has(identity)) continue;
          nextQueue.push(entry);
          knownUrls.add(identity);
          if (nextQueue.length >= limit) break;
        }

        const limitedQueue = nextQueue.slice(0, limit);
        return { result: limitedQueue, queue: limitedQueue };
      })
    );
  },

  deleteRandomBackgroundQueue() {
    return enqueueMutation(() =>
      runTransaction(
        "readwrite",
        (store) => store.delete(RANDOM_BACKGROUND_QUEUE_KEY),
      )
    );
  },

  saveRandomBackgroundCurrent(entry) {
    return enqueueMutation(() =>
      runTransaction(
        "readwrite",
        (store) => store.put(entry, RANDOM_BACKGROUND_CURRENT_KEY),
      )
    );
  },

  async getRandomBackgroundCurrent() {
    await mutationQueue;
    return runTransaction(
      "readonly",
      (store) => store.get(RANDOM_BACKGROUND_CURRENT_KEY),
    );
  },

  deleteRandomBackgroundCurrent() {
    return enqueueMutation(() =>
      runTransaction(
        "readwrite",
        (store) => store.delete(RANDOM_BACKGROUND_CURRENT_KEY),
      )
    );
  },

  async close() {
    if (!databasePromise) return;
    try {
      const db = await databasePromise;
      db.close();
    } finally {
      databasePromise = null;
    }
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void secondStorage.close();
  });
}
// [src/secondStorage.js] YourDynamicDashboard V3.0.0 (Ditom Baroi Antu - 2025-26)
