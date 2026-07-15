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
export function buildFreshdeskPublicImageViewerHtml(options) {
    const caption = options.caption?.trim() || "Freshdesk screenshot";
    const safeCaption = escapeHtml(caption);
    const safeImageSrc = escapeHtml(options.imageSrc);
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
        padding: clamp(16px, 3vw, 32px);
      }

      figure {
        margin: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: min(100%, 1400px);
        max-height: calc(100vh - 32px);
      }

      img {
        display: block;
        width: min(95vw, 1400px);
        max-height: calc(100vh - 96px);
        height: auto;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      }

      figcaption {
        margin: 16px 0 0;
        color: #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: clamp(0.95rem, 2vw, 1.05rem);
        line-height: 1.5;
        text-align: center;
        max-width: min(95vw, 1400px);
      }
    </style>
  </head>
  <body>
    <figure>
      <img src="${safeImageSrc}" alt="${safeCaption}" />
      <figcaption>${safeCaption}</figcaption>
    </figure>
  </body>
</html>`;
}
