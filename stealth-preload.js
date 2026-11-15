// Stealth preload for AgentDeez — reduces common automation and fingerprint signals.
// Injected into every page via webPreferences.preload.
// Session-stable seeded noise so hashes stay consistent within a run but differ across launches.

(function () {
  'use strict';

  // Seed based on launch time so each run looks slightly different, stable within the session.
  const SEED = Math.floor(Date.now() / 60000) % 100000;
  function seeded(n) {
    const x = Math.sin(SEED + n) * 10000;
    return x - Math.floor(x);
  }

  // 1. Hide navigator.webdriver
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  // 2. Canvas fingerprint noise (session-stable)
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  function noiseImageData(imageData, offset) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      const n = seeded(offset + i);
      if (n < 0.08) { // small chance of ±1 on a channel
        const ch = Math.floor(seeded(offset + i + 1) * 3);
        data[i + ch] = Math.max(0, Math.min(255, data[i + ch] + (n > 0.04 ? 1 : -1)));
      }
    }
    return imageData;
  }

  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    try {
      const ctx = this.getContext('2d');
      if (ctx) {
        const imageData = originalGetImageData.call(ctx, 0, 0, this.width, this.height);
        noiseImageData(imageData, this.width * this.height);
        ctx.putImageData(imageData, 0, 0);
      }
    } catch (e) {}
    return originalToDataURL.apply(this, args);
  };

  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const imageData = originalGetImageData.apply(this, args);
    try { noiseImageData(imageData, args[0] + args[1]); } catch (e) {}
    return imageData;
  };

  // 3. WebGL vendor / renderer spoof (plausible consumer GPU)
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (param) {
    if (param === 37445) return 'Google Inc. (NVIDIA)'; // UNMASKED_VENDOR_WEBGL
    if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'; // UNMASKED_RENDERER_WEBGL
    return getParameter.call(this, param);
  };

  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)';
      return getParameter2.call(this, param);
    };
  }

  // 4. Basic AudioContext noise (light)
  if (typeof OfflineAudioContext !== 'undefined') {
    const originalStartRendering = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () {
      return originalStartRendering.call(this).then(buffer => {
        try {
          const data = buffer.getChannelData(0);
          for (let i = 0; i < Math.min(data.length, 200); i++) {
            if (seeded(i) < 0.02) data[i] += (seeded(i + 1) - 0.5) * 0.0001;
          }
        } catch (e) {}
        return buffer;
      });
    };
  }

  // 5. Languages / platform consistency (keep real if possible; optional override)
  // Left mostly alone so it matches the real OS. Uncomment to force:
  // Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

  console.debug('AgentDeez stealth preload applied');
})();
