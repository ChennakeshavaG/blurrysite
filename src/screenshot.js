/**
 * screenshot.js — Capture viewport screenshot with blur/redaction applied.
 *
 * Uses chrome.tabs.captureVisibleTab() via background message relay.
 * Provides optional crop tool and download/copy-to-clipboard output.
 *
 * Exposed as blsi.Screenshot (IIFE — no ES module syntax).
 */

const BlurrySiteScreenshot = (() => {
  'use strict';

  let _cropOverlay = null;
  let _cropCallback = null;

  /**
   * Capture the full visible viewport as a PNG data URL.
   * Sends a message to background.js which calls captureVisibleTab.
   * @returns {Promise<string>} PNG data URL
   */
  function captureViewport() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          reject(new Error('No screenshot data received'));
        }
      });
    });
  }

  /**
   * Download a data URL as a file.
   * @param {string} dataUrl
   * @param {string} [filename]
   */
  function download(dataUrl, filename) {
    const name = filename || 'blurrysite-screenshot-' + Date.now() + '.png';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Copy a data URL to clipboard as an image.
   * @param {string} dataUrl
   * @returns {Promise<void>}
   */
  async function copyToClipboard(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
  }

  /**
   * Start crop mode: overlay + drag to select region.
   * @param {Function} callback - Called with { x, y, width, height, dataUrl }
   */
  function startCrop(callback) {
    cancelCrop();
    _cropCallback = callback;

    _cropOverlay = document.createElement('div');
    _cropOverlay.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15);';

    let startX = 0, startY = 0;
    let box = null;

    function onDown(e) {
      startX = e.clientX;
      startY = e.clientY;
      box = document.createElement('div');
      box.style.cssText =
        'position:fixed;border:2px dashed #f59e0b;background:rgba(245,158,11,0.1);z-index:2147483647;';
      document.body.appendChild(box);
    }

    function onMove(e) {
      if (!box) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    }

    async function onUp(e) {
      cleanup();
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      if (w < 10 || h < 10) {
        if (_cropCallback) _cropCallback(null);
        return;
      }

      try {
        const fullDataUrl = await captureViewport();
        const cropped = await _cropImage(fullDataUrl, x, y, w, h);
        if (_cropCallback) _cropCallback({ x, y, width: w, height: h, dataUrl: cropped });
      } catch (err) {
        if (_cropCallback) _cropCallback(null);
      }
    }

    function cleanup() {
      if (_cropOverlay && _cropOverlay.parentNode) _cropOverlay.parentNode.removeChild(_cropOverlay);
      if (box && box.parentNode) box.parentNode.removeChild(box);
      _cropOverlay = null;
      box = null;
    }

    _cropOverlay.addEventListener('mousedown', onDown);
    _cropOverlay.addEventListener('mousemove', onMove);
    _cropOverlay.addEventListener('mouseup', onUp);
    document.body.appendChild(_cropOverlay);
  }

  /**
   * Cancel crop mode.
   */
  function cancelCrop() {
    if (_cropOverlay && _cropOverlay.parentNode) {
      _cropOverlay.parentNode.removeChild(_cropOverlay);
    }
    _cropOverlay = null;
    _cropCallback = null;
  }

  /**
   * Crop a data URL image to a specified region.
   * @param {string} dataUrl
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @returns {Promise<string>} Cropped PNG data URL
   */
  function _cropImage(dataUrl, x, y, w, h) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No canvas context')); return; }
        ctx.drawImage(img, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load screenshot image'));
      img.src = dataUrl;
    });
  }

  return Object.freeze({
    captureViewport,
    download,
    copyToClipboard,
    startCrop,
    cancelCrop,
  });
})();

blsi.Screenshot = BlurrySiteScreenshot;
