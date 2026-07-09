import { escapeHtml } from "../auth/connection_page.js";
import { RED_LOGO_URL } from "../auth/red_assets.js";
import {
  BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY,
  BRC_EDU_UPLOAD_FIELD_NAME,
} from "./brc_edu_upload_store.js";

const BRC_RED = "#b5121b";
const BRC_RED_DARK = "#8f0e16";
const UPLOAD_PATH = "/internal/brc-edu/resources/upload";

function pageShell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="${RED_LOGO_URL}" type="image/png" sizes="any" />
    <link rel="shortcut icon" href="${RED_LOGO_URL}" type="image/png" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        color: #1f2937;
        background: linear-gradient(180deg, #eef0f3 0%, #f8f9fb 100%);
        padding: 0 0 clamp(32px, 5vw, 64px);
      }

      .brand-bar {
        width: 100%;
        background: linear-gradient(90deg, #c8102e 0%, #b5121b 42%, #9a0f18 100%);
        color: #ffffff;
        padding: clamp(28px, 4vw, 44px) clamp(16px, 3vw, 32px);
      }

      .brand-shell,
      .page {
        width: min(100%, 720px);
        margin: 0 auto;
      }

      .page {
        padding: clamp(20px, 3vw, 32px) clamp(16px, 3vw, 32px) 0;
      }

      .brand-inner {
        display: flex;
        align-items: center;
        gap: clamp(16px, 2.5vw, 24px);
      }

      .brand-logo {
        flex-shrink: 0;
        width: clamp(64px, 8vw, 76px);
        height: clamp(64px, 8vw, 76px);
        border-radius: 50%;
        background: #ffffff;
        padding: clamp(10px, 1.5vw, 14px);
        object-fit: contain;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      }

      .brand-copy h1 {
        margin: 0;
        font-size: clamp(1.75rem, 4vw, 2.5rem);
        line-height: 1;
        font-weight: 800;
      }

      .eyebrow {
        margin: 0 0 4px;
        font-size: 0.9rem;
        opacity: 0.92;
      }

      .card {
        background: #ffffff;
        padding: clamp(24px, 3.5vw, 40px);
        border-radius: 16px;
        box-shadow:
          0 1px 2px rgba(15, 23, 42, 0.06),
          0 12px 40px rgba(15, 23, 42, 0.12);
      }

      .lead {
        margin: 0 0 20px;
        color: #4b5563;
      }

      .notice {
        margin: 0 0 20px;
        padding: 12px 14px;
        border-radius: 8px;
        font-size: 15px;
      }

      .notice.error {
        color: #991b1b;
        background: #fef2f2;
        border: 1px solid #fecaca;
      }

      .notice.success {
        color: #166534;
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
      }

      label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #374151;
      }

      input[type="file"] {
        width: 100%;
        padding: 11px 12px;
        font-size: 15px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
      }

      .hint {
        margin: 8px 0 0;
        font-size: 14px;
        color: #6b7280;
      }

      .btn-primary {
        display: block;
        width: 100%;
        margin-top: 24px;
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 600;
        color: #ffffff;
        background: linear-gradient(180deg, ${BRC_RED} 0%, ${BRC_RED_DARK} 100%);
        border: none;
        border-radius: 10px;
        cursor: pointer;
      }

      .btn-primary:hover {
        filter: brightness(1.05);
      }
    </style>
  </head>
  <body>
    <header class="brand-bar">
      <div class="brand-shell">
        <div class="brand-inner">
          <img class="brand-logo" src="${RED_LOGO_URL}" alt="Red logo" width="72" height="72" />
          <div class="brand-copy">
            <p class="eyebrow">Internal admin</p>
            <h1>BRC Edu resource upload</h1>
          </div>
        </div>
      </div>
    </header>
    <main class="page">
      ${content}
    </main>
  </body>
</html>`;
}

function uploadActionUrl(secret: string): string {
  const encodedSecret = encodeURIComponent(secret);
  return `${UPLOAD_PATH}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodedSecret}`;
}

export function renderBrcEduUploadPage(secret: string): string {
  const content = `
      <div class="card">
        <p class="lead">
          Upload the approved BRC Edu resource file. Red stores the file in Azure Blob Storage for downstream processing.
        </p>
        <form method="POST" action="${escapeHtml(uploadActionUrl(secret))}" enctype="multipart/form-data">
          <label for="${BRC_EDU_UPLOAD_FIELD_NAME}">Resource file</label>
          <input
            id="${BRC_EDU_UPLOAD_FIELD_NAME}"
            name="${BRC_EDU_UPLOAD_FIELD_NAME}"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
          <p class="hint">Accepted file types: <strong>.xlsx</strong> or <strong>.csv</strong>. Maximum file size: <strong>5 MB</strong>.</p>
          <button class="btn-primary" type="submit">Upload file</button>
        </form>
      </div>`;

  return pageShell("BRC Edu resource upload", content);
}

export function renderBrcEduUploadSuccessPage(
  latestBlob: string,
  archiveBlob: string,
  secret: string,
): string {
  const content = `
      <div class="card">
        <div class="notice success">
          Upload successful. The file was stored in Azure Blob Storage.
        </div>
        <p><strong>Latest:</strong> ${escapeHtml(latestBlob)}</p>
        <p><strong>Archive:</strong> ${escapeHtml(archiveBlob)}</p>
        <p><a href="${escapeHtml(uploadActionUrl(secret))}">Upload another file</a></p>
      </div>`;

  return pageShell("BRC Edu upload successful", content);
}

export function renderBrcEduUploadErrorPage(message: string, secret?: string): string {
  const retryLink = secret
    ? `<p><a href="${escapeHtml(uploadActionUrl(secret))}">Try again</a></p>`
    : "";

  const content = `
      <div class="card">
        <div class="notice error">${escapeHtml(message)}</div>
        ${retryLink}
      </div>`;

  return pageShell("BRC Edu upload failed", content);
}

export function renderBrcEduUploadPlainError(message: string): string {
  return message;
}
