/**
 * blur_engine.js — PrivacyBlur Core Blur Engine
 *
 * Handles all DOM manipulation for blurring/unblurring elements.
 * Exposed as window.PrivacyBlurEngine (IIFE — no ES module syntax).
 *
 * Special handling:
 *  - IMG / background-image: CSS filter (fast, no artefacts)
 *  - VIDEO: canvas overlay with requestAnimationFrame (bypasses DRM filter restriction)
 *  - Text nodes: wrapped in <span> so CSS filter can target them
 *  - Generic elements: CSS class + custom property approach
 */

const PrivacyBlurEngine = (() => {
  // -------------------------------------------------------------------------
  // Internal constants
  // -------------------------------------------------------------------------
  const BLURRED_CLASS      = "pb-blurred";
  const CANVAS_CLASS       = "pb-canvas-overlay";
  const TEXT_WRAPPER_CLASS = "pb-text-node-wrapper";

  // Map from video element -> { canvas, animFrameId } for cleanup
  const videoOverlayMap = new WeakMap();

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether `element` is a bare text node container that should be
   * treated as text content (i.e. has at least one direct text-node child
   * with non-whitespace content, but no meaningful child elements).
   */
  function hasMeaningfulTextContent(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Wraps a bare text-node inside a <span> so the CSS blur filter can target
   * a block-level or inline element rather than trying to filter a text node
   * directly (which is not supported).
   * Returns the wrapper span, or null if there was nothing to wrap.
   */
  function wrapTextNodes(element) {
    const fragment = document.createDocumentFragment();
    const nodesToWrap = [];

    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        nodesToWrap.push(node);
      }
    }

    if (nodesToWrap.length === 0) return null;

    const span = document.createElement("span");
    span.classList.add(TEXT_WRAPPER_CLASS);

    // Move text nodes into the span, preserving document order
    for (const node of nodesToWrap) {
      span.appendChild(node.cloneNode(true));
    }

    // Replace the first text node with the wrapper; remove the rest
    const firstNode = nodesToWrap[0];
    element.insertBefore(span, firstNode);
    for (const node of nodesToWrap) {
      // After inserting span before firstNode, firstNode is still in element
      if (element.contains(node)) {
        element.removeChild(node);
      }
    }

    return span;
  }

  /**
   * Creates a <canvas> overlay on top of a video element and starts a
   * requestAnimationFrame loop that draws blurred video frames onto it.
   * This works for DRM-protected video because we are not reading pixel data —
   * we are re-rendering using the CSS filter on the canvas context.
   */
  function startVideoBlurCanvas(videoElement, radius) {
    // If an overlay already exists, stop old one first
    stopVideoBlurCanvas(videoElement);

    const canvas = document.createElement("canvas");
    canvas.classList.add(CANVAS_CLASS);

    // Position canvas exactly over the video
    const rect = videoElement.getBoundingClientRect();
    canvas.width  = videoElement.videoWidth  || rect.width;
    canvas.height = videoElement.videoHeight || rect.height;

    Object.assign(canvas.style, {
      position:      "absolute",
      top:           "0",
      left:          "0",
      width:         "100%",
      height:        "100%",
      pointerEvents: "none",  // clicks pass through to video controls
      zIndex:        "9999"
    });

    // The video container must be positioned so the canvas can overlay it
    const videoParent = videoElement.parentElement;
    const parentPos = window.getComputedStyle(videoParent).position;
    if (parentPos === "static") {
      videoParent.style.position = "relative";
    }

    videoParent.insertBefore(canvas, videoElement.nextSibling);

    // Guard: if video has no parent (detached from DOM) we cannot overlay a canvas.
    if (!videoParent) {
      videoElement.classList.add(BLURRED_CLASS);
      videoElement.style.setProperty("--pb-radius", `${radius}px`);
      return;
    }

    const ctx = canvas.getContext("2d");

    // Use an object so drawFrame always writes the latest handle into the same
    // reference that videoOverlayMap holds. Storing animFrameId by value would
    // capture the handle from frame 0 only; subsequent frames update the closure
    // variable but the map would hold a stale handle, making cancelAnimationFrame
    // cancel the wrong frame and leave the loop running.
    const state = { canvas, animFrameId: null };

    function drawFrame() {
      // Resize canvas if video dimensions changed (e.g., fullscreen, resolution switch)
      if (
        canvas.width  !== videoElement.videoWidth  && videoElement.videoWidth  > 0 ||
        canvas.height !== videoElement.videoHeight && videoElement.videoHeight > 0
      ) {
        canvas.width  = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply blur filter via the canvas 2D context (not CSS), then draw frame
      ctx.filter = `blur(${radius}px)`;
      try {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      } catch {
        // drawImage can throw for cross-origin or DRM videos — keep looping
        // so the solid-colour canvas remains visible as a visual mask
        ctx.fillStyle = "rgba(30, 30, 30, 0.85)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      state.animFrameId = requestAnimationFrame(drawFrame);
    }

    drawFrame();

    videoOverlayMap.set(videoElement, state);
  }

  /**
   * Stops the canvas overlay loop and removes the canvas from the DOM.
   */
  function stopVideoBlurCanvas(videoElement) {
    const overlay = videoOverlayMap.get(videoElement);
    if (!overlay) return;

    cancelAnimationFrame(overlay.animFrameId);

    if (overlay.canvas && overlay.canvas.parentNode) {
      overlay.canvas.parentNode.removeChild(overlay.canvas);
    }

    videoOverlayMap.delete(videoElement);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Applies blur to an element.
   * @param {Element} element - The DOM element to blur
   * @param {number}  radius  - Blur radius in pixels (default 8)
   */
  function applyBlur(element, radius = 8) {
    if (!element || !(element instanceof Element)) return;
    if (isBlurred(element)) return; // idempotent

    const tag = element.tagName.toLowerCase();

    // ---- VIDEO: canvas overlay approach ----
    if (tag === "video") {
      element.classList.add(BLURRED_CLASS);
      element.style.setProperty("--pb-radius", `${radius}px`);
      startVideoBlurCanvas(element, radius);
      return;
    }

    // ---- IMG: apply CSS filter directly ----
    if (tag === "img") {
      element.classList.add(BLURRED_CLASS);
      element.style.setProperty("--pb-radius", `${radius}px`);
      element.style.filter = `blur(${radius}px)`;
      return;
    }

    // ---- Elements with background-image: CSS filter on element itself ----
    const bgImage = window.getComputedStyle(element).backgroundImage;
    if (bgImage && bgImage !== "none" && tag !== "body" && tag !== "html") {
      element.classList.add(BLURRED_CLASS);
      element.style.setProperty("--pb-radius", `${radius}px`);
      return;
    }

    // ---- Text-containing elements: wrap bare text nodes if needed ----
    if (hasMeaningfulTextContent(element)) {
      wrapTextNodes(element);
    }

    // ---- Generic element: class + custom property ----
    element.classList.add(BLURRED_CLASS);
    element.style.setProperty("--pb-radius", `${radius}px`);
  }

  /**
   * Removes blur from an element.
   * @param {Element} element - The DOM element to unblur
   */
  function removeBlur(element) {
    if (!element || !(element instanceof Element)) return;

    const tag = element.tagName.toLowerCase();

    // ---- VIDEO: stop canvas overlay ----
    if (tag === "video") {
      element.classList.remove(BLURRED_CLASS);
      element.style.removeProperty("--pb-radius");
      stopVideoBlurCanvas(element);
      return;
    }

    // ---- IMG: remove CSS filter directly ----
    if (tag === "img") {
      element.classList.remove(BLURRED_CLASS);
      element.style.removeProperty("--pb-radius");
      element.style.filter = "";
      return;
    }

    // ---- Generic element ----
    element.classList.remove(BLURRED_CLASS);
    element.style.removeProperty("--pb-radius");

    // Clean up any text-node wrappers this engine introduced
    const textWrappers = element.querySelectorAll(`.${TEXT_WRAPPER_CLASS}`);
    textWrappers.forEach((wrapper) => {
      // Unwrap: replace wrapper with its children
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });
  }

  /**
   * Toggles blur on an element: applies if not blurred, removes if blurred.
   * @param {Element} element
   * @param {number}  radius
   */
  function toggleBlur(element, radius = 8) {
    if (!element || !(element instanceof Element)) return;

    if (isBlurred(element)) {
      removeBlur(element);
    } else {
      applyBlur(element, radius);
    }
  }

  /**
   * Blurs all meaningful content elements on the page.
   * Targets: img, video, canvas, headings, paragraphs, spans, and divs/sections
   * that contain direct text-node content (to avoid blurring container divs).
   * @param {number} radius - Blur radius in pixels
   */
  function blurAllContent(radius = 8) {
    // Media and structural block elements — always blur regardless of content
    const MEDIA_SELECTORS = [
      "img", "video", "canvas",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p",
    ];

    document.querySelectorAll(MEDIA_SELECTORS.join(",")).forEach((el) => {
      applyBlur(el, radius);
    });

    // Inline and generic elements — only blur when they contain direct text content.
    // `span` is intentionally in this group: it is used for icons, badges, and
    // decoration on most sites. Blurring every span unconditionally would make
    // navigation illegible on sites like GitHub, Twitter, etc.
    document.querySelectorAll(
      "span, div, section, article, li, td, th, label, button, a"
    ).forEach((el) => {
      if (el.classList.contains(BLURRED_CLASS)) return;
      if (hasMeaningfulTextContent(el)) {
        applyBlur(el, radius);
      }
    });
  }

  /**
   * Removes blur from every element on the page that has the blur class,
   * including any canvas overlays and img wrappers.
   */
  function unblurAll() {
    // Handle video elements first to cancel rAF loops
    document.querySelectorAll(`video.${BLURRED_CLASS}`).forEach((el) => {
      removeBlur(el);
    });

    // Handle all remaining blurred elements
    document.querySelectorAll(`.${BLURRED_CLASS}`).forEach((el) => {
      removeBlur(el);
    });

    // Clean up any orphaned text-node wrappers
    document.querySelectorAll(`.${TEXT_WRAPPER_CLASS}`).forEach((wrapper) => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });

    // Remove any orphaned canvas overlays
    document.querySelectorAll(`.${CANVAS_CLASS}`).forEach((canvas) => {
      canvas.parentNode && canvas.parentNode.removeChild(canvas);
    });
  }

  /**
   * Returns true if the element currently has blur applied.
   * Checks the element itself and, for imgs, their parent wrapper.
   * @param {Element} element
   * @returns {boolean}
   */
  function isBlurred(element) {
    if (!element || !(element instanceof Element)) return false;

    // Direct class check
    if (element.classList.contains(BLURRED_CLASS)) return true;

    return false;
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    applyBlur,
    removeBlur,
    toggleBlur,
    blurAllContent,
    unblurAll,
    isBlurred
  };
})();

// Attach to window so content_script.js and other injected scripts can access it
window.PrivacyBlurEngine = PrivacyBlurEngine;
