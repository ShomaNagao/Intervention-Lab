// cubismcore-loader.js
(function () {
  const CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

  // ★重要：他のコードが await できる Promise を用意（多重実行も防ぐ）
  if (window.__cubismCoreReady) return;

  function loadByScriptTag(url, { timeoutMs = 15000, retry = 1 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;

      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.crossOrigin = "anonymous";

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        s.remove();
        reject(new Error("Timeout loading: " + url));
      }, timeoutMs);

      s.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };

      s.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.remove();

        if (retry > 0) {
          setTimeout(() => {
            loadByScriptTag(url, { timeoutMs, retry: retry - 1 }).then(resolve, reject);
          }, 500);
        } else {
          reject(new Error("Failed loading: " + url));
        }
      };

      document.head.appendChild(s);
    });
  }

  // 既にロード済みなら即resolve
  if (window.Live2DCubismCore) {
    window.__cubismCoreReady = Promise.resolve();
    return;
  }

  // ★Promiseを公開（Qualtrics側が await できる）
  window.__cubismCoreReady = loadByScriptTag(CORE_URL, { retry: 2 }).then(() => {
    if (!window.Live2DCubismCore) {
      throw new Error("Loaded but Live2DCubismCore is still undefined");
    }
  });
})();
