// cubismcore-loader.js
(function () {
  // 既にロード済みなら何もしない
  if (window.Live2DCubismCore) return;

  const CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

  function loadByScriptTag(url, { timeoutMs = 15000, retry = 1 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;

      const s = document.createElement("script");
      s.src = url;                 // ★ jQuery.getScript と違って ?_=... を付けない
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
          // 少し待ってリトライ（ネットワーク瞬断対策）
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

  // 実行
  loadByScriptTag(CORE_URL, { retry: 2 })
    .then(() => {
      if (!window.Live2DCubismCore) {
        throw new Error("Loaded but Live2DCubismCore is still undefined");
      }
    })
    .catch((e) => {
      // 必要ならここでconsoleに出す（Qualtrics本番では抑制してもOK）
      console.error("[CubismCore Loader]", e);
    });
})();
