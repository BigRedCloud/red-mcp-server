import { escapeHtml } from "../auth/connection_page.js";
import { RED_LOGO_URL } from "../auth/red_assets.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY, BRC_EDU_UPLOAD_FIELD_NAME, } from "./brc_edu_upload_store.js";
const BRC_RED = "#b5121b";
const BRC_RED_DARK = "#8f0e16";
const UPLOAD_PATH = "/internal/brc-edu/resources/upload";
const WORKBOOK_API_PATH = `${UPLOAD_PATH}/workbook`;
const WORKBOOK_DOWNLOAD_PATH = `${UPLOAD_PATH}/workbook/download`;
/** Element IDs the admin page script requires at init time. */
export const BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS = [
    "admin-status",
    "meta-updated",
    "meta-count",
    "resource-rows",
    "refresh-btn",
    "download-btn",
    "upload-excel-btn",
];
/** Element IDs referenced by the admin script but safe to omit. */
export const BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS = [
    BRC_EDU_UPLOAD_FIELD_NAME,
];
export function getAdminPageScriptReferencedElementIds() {
    return [
        ...BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS,
        ...BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS,
    ];
}
/** Returns every `id="..."` value appearing in HTML before the admin init script. */
export function findAdminPageElementIdsBeforeScript(html) {
    const scriptMarker = "function requireElement(id)";
    const scriptIndex = html.indexOf(scriptMarker);
    const markup = scriptIndex >= 0 ? html.slice(0, scriptIndex) : html.slice(0, html.indexOf("</main>"));
    const ids = new Set();
    const pattern = /\bid="([^"]+)"/g;
    for (const match of markup.matchAll(pattern)) {
        ids.add(match[1]);
    }
    return ids;
}
function pageShell(title, content, extraHead = "") {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="${RED_LOGO_URL}" type="image/png" sizes="any" />
    <link rel="shortcut icon" href="${RED_LOGO_URL}" type="image/png" />
    ${extraHead}
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
        width: min(100%, 1200px);
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
        margin-bottom: 20px;
      }

      .lead, .hint {
        color: #4b5563;
      }

      .lead { margin: 0 0 20px; }
      .hint { margin: 8px 0 0; font-size: 14px; color: #6b7280; }

      .notice {
        margin: 0 0 20px;
        padding: 12px 14px;
        border-radius: 8px;
        font-size: 15px;
      }

      .notice.error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; }
      .notice.success { color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; }
      .notice.warning { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: 600;
        border-radius: 8px;
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #1f2937;
        cursor: pointer;
      }

      .btn:hover:not(:disabled) { background: #f9fafb; }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .btn-primary {
        color: #ffffff;
        background: linear-gradient(180deg, ${BRC_RED} 0%, ${BRC_RED_DARK} 100%);
        border: none;
      }

      .meta-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        font-size: 14px;
        color: #4b5563;
        margin-bottom: 12px;
      }

      .table-wrap {
        overflow-x: auto;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 960px;
      }

      th, td {
        padding: 10px;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
        text-align: left;
      }

      th {
        background: #f9fafb;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      td a {
        color: ${BRC_RED};
        word-break: break-all;
      }

      .empty-state {
        padding: 24px;
        text-align: center;
        color: #6b7280;
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

      .instructions ol {
        margin: 0;
        padding-left: 20px;
      }

      .instructions li { margin-bottom: 6px; }

      @media (max-width: 720px) {
        .toolbar { flex-direction: column; }
        .btn { width: 100%; }
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
            <h1>BRC Edu webinar resources</h1>
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
function uploadActionUrl(secret) {
    return `${UPLOAD_PATH}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}
function workbookApiUrl(secret) {
    return `${WORKBOOK_API_PATH}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}
function workbookDownloadUrl(secret) {
    return `${WORKBOOK_DOWNLOAD_PATH}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}
function adminPageScript(secret) {
    const apiUrl = workbookApiUrl(secret);
    const downloadUrl = workbookDownloadUrl(secret);
    return `<script>
(() => {
  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("Admin page element missing: " + id);
    }
    return element;
  }

  function initAdminPage() {
    const apiUrl = ${JSON.stringify(apiUrl)};
    const downloadUrl = ${JSON.stringify(downloadUrl)};
    const fileInputId = ${JSON.stringify(BRC_EDU_UPLOAD_FIELD_NAME)};

    const els = {
      status: requireElement("admin-status"),
      metaUpdated: requireElement("meta-updated"),
      metaCount: requireElement("meta-count"),
      tbody: requireElement("resource-rows"),
      refreshBtn: requireElement("refresh-btn"),
      downloadBtn: requireElement("download-btn"),
      uploadExcelBtn: requireElement("upload-excel-btn"),
    };

    let busy = false;

    function setStatus(message, kind) {
      els.status.textContent = message || "";
      els.status.className = "notice" + (kind ? " " + kind : "");
      els.status.style.display = message ? "block" : "none";
    }

    function setBusy(nextBusy) {
      busy = nextBusy;
      for (const button of document.querySelectorAll("button[data-busy-disable='true']")) {
        button.disabled = nextBusy;
      }
    }

    function appendTextCell(row, value) {
      const cell = document.createElement("td");
      cell.textContent = value == null ? "" : String(value);
      row.appendChild(cell);
    }

    function appendUrlCell(row, value) {
      const cell = document.createElement("td");
      const trimmed = value == null ? "" : String(value).trim();
      if (!trimmed) {
        cell.textContent = "";
        row.appendChild(cell);
        return;
      }

      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const link = document.createElement("a");
          link.href = trimmed;
          link.textContent = trimmed;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          cell.appendChild(link);
          row.appendChild(cell);
          return;
        }
      } catch {
        // Fall through to plain text.
      }

      cell.textContent = trimmed;
      row.appendChild(cell);
    }

    function renderRows(rows) {
      els.tbody.replaceChildren();

      if (!Array.isArray(rows) || rows.length === 0) {
        const emptyRow = document.createElement("tr");
        const emptyCell = document.createElement("td");
        emptyCell.colSpan = 5;
        emptyCell.className = "empty-state";
        emptyCell.textContent = "No workbook rows to display. Download the current Excel file or upload a replacement workbook.";
        emptyRow.appendChild(emptyCell);
        els.tbody.appendChild(emptyRow);
        return;
      }

      for (const row of rows) {
        const tr = document.createElement("tr");
        appendTextCell(tr, row.videoTitle);
        appendUrlCell(tr, row.videoUrl);
        appendTextCell(tr, row.helpRoutingCategory);
        appendTextCell(tr, row.description);
        appendTextCell(tr, row.active);
        els.tbody.appendChild(tr);
      }
    }

    function updateMeta(payload) {
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      els.metaCount.textContent = String(rows.length);
      els.metaUpdated.textContent = payload?.lastModified
        ? new Date(payload.lastModified).toLocaleString()
        : "Not loaded";
    }

    function applyPayload(payload) {
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      renderRows(rows);
      updateMeta(payload);
    }

    async function loadWorkbook() {
      setBusy(true);
      setStatus("Loading workbook from Azure...", "warning");
      try {
        const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Could not load workbook.");
        }
        const payload = await response.json();
        applyPayload(payload);
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        if (rows.length === 0 && !payload.lastModified) {
          setStatus("No latest workbook found. Upload a replacement file to publish one.", "warning");
        } else {
          setStatus("Workbook loaded from Azure.", "success");
        }
      } catch (error) {
        setStatus(error.message || "Could not load workbook.", "error");
      } finally {
        setBusy(false);
      }
    }

    els.refreshBtn.addEventListener("click", () => {
      loadWorkbook();
    });

    els.downloadBtn.addEventListener("click", () => {
      window.location.href = downloadUrl;
    });

    els.uploadExcelBtn.addEventListener("click", () => {
      const fileInput = document.getElementById(fileInputId);
      if (fileInput instanceof HTMLInputElement) {
        fileInput.click();
      }
    });

    loadWorkbook();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminPage);
  } else {
    initAdminPage();
  }
})();
</script>`;
}
export function renderBrcEduUploadPage(secret) {
    const content = `
      <div class="card instructions">
        <h2>How to manage Red webinar resources</h2>
        <ol class="lead">
          <li>Click Refresh from Azure to view the latest workbook.</li>
          <li>Click Download current Excel.</li>
          <li>Open the downloaded file in Excel and make the required changes.</li>
          <li>Keep the existing column headers unchanged.</li>
          <li>Save the updated file as .xlsx or .csv.</li>
          <li>Use Upload Excel to upload the replacement file.</li>
          <li>Previous versions are archived automatically.</li>
          <li>Red updates after the uploaded file is processed.</li>
        </ol>
      </div>

      <div class="card">
        <div class="meta-bar">
          <span><strong>Last updated:</strong> <span id="meta-updated">Not loaded</span></span>
          <span><strong>Rows:</strong> <span id="meta-count">0</span></span>
        </div>
        <div id="admin-status" class="notice" style="display:none" role="status" aria-live="polite"></div>
        <div class="toolbar">
          <button type="button" class="btn" id="refresh-btn" data-busy-disable="true">Refresh from Azure</button>
          <button type="button" class="btn" id="download-btn" data-busy-disable="true">Download current Excel</button>
          <button type="button" class="btn" id="upload-excel-btn" data-busy-disable="true">Upload Excel</button>
        </div>
        <div class="table-wrap">
          <table aria-label="Webinar resources">
            <thead>
              <tr>
                <th scope="col">Video Title</th>
                <th scope="col">Video URL</th>
                <th scope="col">Help-Routing Category</th>
                <th scope="col">Description</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody id="resource-rows"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Upload Excel file</h2>
        <p class="lead">
          Upload an approved <strong>.xlsx</strong> or <strong>.csv</strong> file. Red stores the file in Azure Blob Storage for downstream processing.
        </p>
        <form method="POST" action="${escapeHtml(uploadActionUrl(secret))}" enctype="multipart/form-data">
          <label for="${BRC_EDU_UPLOAD_FIELD_NAME}">Resource file</label>
          <input
            id="${BRC_EDU_UPLOAD_FIELD_NAME}"
            name="${BRC_EDU_UPLOAD_FIELD_NAME}"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
          <p class="hint">Accepted file types: <strong>.xlsx</strong> or <strong>.csv</strong>. Maximum file size: <strong>5 MB</strong>.</p>
          <button class="btn btn-primary" type="submit">Upload Excel</button>
        </form>
      </div>`;
    return pageShell("BRC Edu webinar resources", content + adminPageScript(secret));
}
export function renderBrcEduUploadSuccessPage(latestBlob, archiveBlob, secret) {
    const content = `
      <div class="card">
        <div class="notice success">
          Upload successful. The file was stored in Azure Blob Storage.
        </div>
        <p><strong>Latest:</strong> ${escapeHtml(latestBlob)}</p>
        <p><strong>Archive:</strong> ${escapeHtml(archiveBlob)}</p>
        <p><a href="${escapeHtml(uploadActionUrl(secret))}">Return to webinar admin</a></p>
      </div>`;
    return pageShell("BRC Edu upload successful", content);
}
export function renderBrcEduUploadErrorPage(message, secret) {
    const retryLink = secret
        ? `<p><a href="${escapeHtml(uploadActionUrl(secret))}">Return to webinar admin</a></p>`
        : "";
    const content = `
      <div class="card">
        <div class="notice error">${escapeHtml(message)}</div>
        ${retryLink}
      </div>`;
    return pageShell("BRC Edu upload failed", content);
}
export function renderBrcEduUploadPlainError(message) {
    return message;
}
export { WORKBOOK_API_PATH, WORKBOOK_DOWNLOAD_PATH };
