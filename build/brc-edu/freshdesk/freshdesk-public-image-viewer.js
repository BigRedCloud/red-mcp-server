export const FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE = 3;
export const FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_WIDTH_RATIO = 0.96;
export const FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_HEIGHT_RATIO = 0.86;
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
export function prefersFreshdeskPublicImageViewer(req) {
    const headers = req.headers ?? {};
    const secFetchDest = String(headers["sec-fetch-dest"] ?? "").toLowerCase();
    if (secFetchDest === "document" || secFetchDest === "iframe") {
        return true;
    }
    if (secFetchDest === "image") {
        return false;
    }
    const accept = String(headers.accept ?? "").toLowerCase();
    if (!accept || accept === "*/*") {
        return false;
    }
    if (accept.startsWith("image/")) {
        return false;
    }
    return accept.includes("text/html");
}
export function computeFreshdeskPublicImageDisplaySize(options) {
    const { naturalWidth, naturalHeight, viewportWidth, viewportHeight, maxScale = FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE, maxWidthRatio = FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_WIDTH_RATIO, maxHeightRatio = FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_HEIGHT_RATIO, } = options;
    if (naturalWidth <= 0 || naturalHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return { width: 1, scale: 1 };
    }
    const scale = Math.min(maxScale, (viewportWidth * maxWidthRatio) / naturalWidth, (viewportHeight * maxHeightRatio) / naturalHeight);
    return {
        width: Math.max(1, Math.round(naturalWidth * scale)),
        scale,
    };
}
export function buildFreshdeskPublicImageViewerResizeScript() {
    return `(function () {
  var image = document.querySelector(".viewer-image");
  if (!image) {
    return;
  }

  var maxScale = ${FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE};
  var maxWidthRatio = ${FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_WIDTH_RATIO};
  var maxHeightRatio = ${FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_HEIGHT_RATIO};

  function resizeViewerImage() {
    var naturalWidth = image.naturalWidth;
    var naturalHeight = image.naturalHeight;
    if (!naturalWidth || !naturalHeight) {
      return;
    }

    var scale = Math.min(
      maxScale,
      window.innerWidth * maxWidthRatio / naturalWidth,
      window.innerHeight * maxHeightRatio / naturalHeight
    );

    image.style.width = Math.max(1, Math.round(naturalWidth * scale)) + "px";
    image.style.height = "auto";
    image.style.maxWidth = "96vw";
    image.style.maxHeight = "90vh";
  }

  if (image.complete) {
    resizeViewerImage();
  } else {
    image.addEventListener("load", resizeViewerImage, { once: true });
  }

  window.addEventListener("resize", resizeViewerImage);
})();`;
}
export function buildFreshdeskPublicImageViewerHtml(options) {
    const caption = options.caption?.trim() || "Freshdesk screenshot";
    const safeCaption = escapeHtml(caption);
    const safeImageSrc = escapeHtml(options.imageSrc);
    const resizeScript = buildFreshdeskPublicImageViewerResizeScript();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeCaption}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111111;
      }

      .viewer {
        width: 100%;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px;
        box-sizing: border-box;
      }

      .viewer-image {
        display: block;
        width: auto;
        height: auto;
        max-width: 96vw;
        max-height: 90vh;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      }

      .viewer-caption {
        margin: 0;
        color: #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: clamp(0.95rem, 2vw, 1.05rem);
        line-height: 1.5;
        text-align: center;
        max-width: 96vw;
      }
    </style>
  </head>
  <body>
    <main class="viewer">
      <img class="viewer-image" src="${safeImageSrc}" alt="${safeCaption}" />
      <p class="viewer-caption">${safeCaption}</p>
    </main>
    <script>${resizeScript}</script>
  </body>
</html>`;
}
