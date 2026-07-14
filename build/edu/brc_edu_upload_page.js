import { escapeHtml } from "../auth/connection_page.js";
import { RED_LOGO_URL } from "../auth/red_assets.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY, BRC_EDU_UPLOAD_FIELD_NAME, } from "./brc_edu_upload_store.js";
const BRC_RED = "#b5121b";
const BRC_RED_DARK = "#8f0e16";
const UPLOAD_PATH = "/internal/brc-edu/resources/upload";
const WORKBOOK_API_PATH = `${UPLOAD_PATH}/workbook`;
const WORKBOOK_DOWNLOAD_PATH = `${UPLOAD_PATH}/workbook/download`;
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

      .btn-danger {
        color: #991b1b;
        border-color: #fecaca;
        background: #fff5f5;
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

      td input, td select {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font: inherit;
      }

      td input.invalid, td select.invalid {
        border-color: #dc2626;
        background: #fef2f2;
      }

      .field-error {
        margin-top: 4px;
        font-size: 12px;
        color: #b91c1c;
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

      .unsaved-badge {
        display: none;
        padding: 4px 10px;
        border-radius: 999px;
        background: #fffbeb;
        color: #92400e;
        font-size: 13px;
        font-weight: 600;
      }

      .unsaved-badge.visible { display: inline-flex; }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

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
  const apiUrl = ${JSON.stringify(apiUrl)};
  const downloadUrl = ${JSON.stringify(downloadUrl)};
  const state = {
    rows: [],
    etag: "",
    lastModified: "",
    dirty: false,
    busy: false,
    rowErrors: {},
  };

  const els = {
    status: document.getElementById("admin-status"),
    metaUpdated: document.getElementById("meta-updated"),
    metaCount: document.getElementById("meta-count"),
    unsaved: document.getElementById("unsaved-badge"),
    tbody: document.getElementById("resource-rows"),
    saveBtn: document.getElementById("save-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    addBtn: document.getElementById("add-btn"),
    cancelBtn: document.getElementById("cancel-btn"),
  };

  function setStatus(message, kind) {
    els.status.textContent = message || "";
    els.status.className = "notice" + (kind ? " " + kind : "");
    els.status.style.display = message ? "block" : "none";
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const button of document.querySelectorAll("button")) {
      if (button.id === "save-btn" || button.dataset.busyDisable === "true") {
        button.disabled = busy;
      }
    }
  }

  function markDirty(dirty) {
    state.dirty = dirty;
    els.unsaved.classList.toggle("visible", dirty);
  }

  function defaultRow() {
    return {
      videoTitle: "",
      videoUrl: "",
      helpRoutingCategory: "",
      description: "",
      active: "Yes",
    };
  }

  function validateClientRow(row, index) {
    const errors = [];
    if (!row.videoTitle.trim()) errors.push("Video Title is required.");
    if (!row.videoUrl.trim()) errors.push("Video URL is required.");
    else {
      try {
        const parsed = new URL(row.videoUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("Video URL must use http or https.");
        }
      } catch {
        errors.push("Video URL must be valid.");
      }
    }
    if (!row.helpRoutingCategory.trim()) errors.push("Help-Routing Category is required.");
    if (!row.active.trim()) errors.push("Active is required.");
    state.rowErrors[index] = errors;
    return errors;
  }

  function renderRows() {
    els.tbody.innerHTML = "";
    state.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      const errors = state.rowErrors[index] || [];
      const invalidClass = errors.length ? " invalid" : "";
      tr.innerHTML = \`
        <td><label class="sr-only" for="title-\${index}">Video Title</label><input id="title-\${index}" data-field="videoTitle" data-index="\${index}" value="" /></td>
        <td><label class="sr-only" for="url-\${index}">Video URL</label><input id="url-\${index}" data-field="videoUrl" data-index="\${index}" value="" /></td>
        <td><label class="sr-only" for="category-\${index}">Help-Routing Category</label><input id="category-\${index}" data-field="helpRoutingCategory" data-index="\${index}" value="" /></td>
        <td><label class="sr-only" for="description-\${index}">Description</label><input id="description-\${index}" data-field="description" data-index="\${index}" value="" /></td>
        <td><label class="sr-only" for="active-\${index}">Active</label><select id="active-\${index}" data-field="active" data-index="\${index}"><option>Yes</option><option>No</option></select></td>
        <td><button type="button" class="btn btn-danger" data-delete="\${index}" aria-label="Delete row \${index + 1}">Delete</button></td>
      \`;
      els.tbody.appendChild(tr);
      tr.querySelector('[data-field="videoTitle"]').value = row.videoTitle;
      tr.querySelector('[data-field="videoUrl"]').value = row.videoUrl;
      tr.querySelector('[data-field="helpRoutingCategory"]').value = row.helpRoutingCategory;
      tr.querySelector('[data-field="description"]').value = row.description;
      tr.querySelector('[data-field="active"]').value = row.active || "Yes";
      for (const input of tr.querySelectorAll("input, select")) {
        if (errors.length) input.classList.add("invalid");
        else input.classList.remove("invalid");
      }
      if (errors.length) {
        const errorEl = document.createElement("div");
        errorEl.className = "field-error";
        errorEl.textContent = errors.join(" ");
        tr.querySelector("td").appendChild(errorEl);
      }
    });
  }

  function updateMeta() {
    els.metaCount.textContent = String(state.rows.length);
    els.metaUpdated.textContent = state.lastModified
      ? new Date(state.lastModified).toLocaleString()
      : "Not loaded";
  }

  function applyPayload(payload) {
    state.rows = Array.isArray(payload.rows) ? payload.rows : [];
    state.etag = payload.etag || "";
    state.lastModified = payload.lastModified || "";
    state.rowErrors = {};
    markDirty(false);
    renderRows();
    updateMeta();
  }

  async function loadWorkbook() {
    setBusy(true);
    setStatus("Loading workbook from Azure...", "warning");
    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      if (response.status === 404) {
        applyPayload({ rows: [], etag: "", lastModified: "", rowCount: 0 });
        setStatus("No latest workbook found. Add resources and save to publish.", "warning");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not load workbook.");
      }
      const payload = await response.json();
      applyPayload(payload);
      setStatus("Workbook loaded from Azure.", "success");
    } catch (error) {
      setStatus(error.message || "Could not load workbook.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkbook() {
    let hasErrors = false;
    state.rowErrors = {};
    state.rows.forEach((row, index) => {
      const errors = validateClientRow(row, index);
      if (errors.length) hasErrors = true;
    });
    renderRows();
    if (hasErrors) {
      setStatus("Fix validation errors before saving.", "error");
      return;
    }

    setBusy(true);
    setStatus("Saving workbook to Azure...", "warning");
    try {
      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ rows: state.rows, ifMatch: state.etag || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setStatus(body.error || "Workbook changed in Azure. Refresh before saving.", "error");
        return;
      }
      if (!response.ok) {
        const detail = Array.isArray(body.errors) ? " " + body.errors.join(" ") : "";
        throw new Error((body.error || "Save failed.") + detail);
      }
      applyPayload(body);
      setStatus("Workbook saved and published to Azure.", "success");
    } catch (error) {
      setStatus(error.message || "Save failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  function onInputChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    if (!Number.isInteger(index) || !field || !state.rows[index]) return;
    state.rows[index][field] = target.value;
    markDirty(true);
    validateClientRow(state.rows[index], index);
  }

  function onTableClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.delete != null) {
      const index = Number(target.dataset.delete);
      if (!Number.isInteger(index)) return;
      if (!window.confirm("Delete this resource row?")) return;
      state.rows.splice(index, 1);
      markDirty(true);
      renderRows();
      updateMeta();
    }
  }

  document.getElementById("refresh-btn").addEventListener("click", () => {
    if (state.dirty && !window.confirm("Discard unsaved changes and refresh from Azure?")) return;
    loadWorkbook();
  });

  document.getElementById("cancel-btn").addEventListener("click", () => {
    if (state.dirty && !window.confirm("Discard unsaved changes and reload from Azure?")) return;
    loadWorkbook();
  });

  document.getElementById("add-btn").addEventListener("click", () => {
    state.rows.push(defaultRow());
    markDirty(true);
    renderRows();
    updateMeta();
  });

  document.getElementById("save-btn").addEventListener("click", saveWorkbook);
  document.getElementById("download-btn").addEventListener("click", () => {
    window.location.href = downloadUrl;
  });

  document.getElementById("upload-excel-btn").addEventListener("click", () => {
    const fileInput = document.getElementById("${BRC_EDU_UPLOAD_FIELD_NAME}");
    if (fileInput instanceof HTMLInputElement) {
      fileInput.click();
    }
  });

  els.tbody.addEventListener("input", onInputChange);
  els.tbody.addEventListener("change", onInputChange);
  els.tbody.addEventListener("click", onTableClick);

  loadWorkbook();
})();
</script>`;
}
export function renderBrcEduUploadPage(secret) {
    const content = `
      <div class="card instructions">
        <h2>How to manage Red webinar resources</h2>
        <ol class="lead">
          <li>Refresh from Azure before editing.</li>
          <li>Add or update resource rows in the table below.</li>
          <li>Use public URLs for each video resource.</li>
          <li>Set Active to control visibility in Red.</li>
          <li>Save &amp; Publish when finished.</li>
          <li>Previous versions are archived automatically.</li>
        </ol>
      </div>

      <div class="card">
        <div class="meta-bar">
          <span id="unsaved-badge" class="unsaved-badge" aria-live="polite">Unsaved changes</span>
          <span><strong>Last updated:</strong> <span id="meta-updated">Not loaded</span></span>
          <span><strong>Rows:</strong> <span id="meta-count">0</span></span>
        </div>
        <div id="admin-status" class="notice" style="display:none" role="status" aria-live="polite"></div>
        <div class="toolbar">
          <button type="button" class="btn" id="refresh-btn" data-busy-disable="true">Refresh from Azure</button>
          <button type="button" class="btn" id="download-btn" data-busy-disable="true">Download current Excel</button>
          <button type="button" class="btn" id="upload-excel-btn" data-busy-disable="true">Upload Excel</button>
          <button type="button" class="btn" id="add-btn" data-busy-disable="true">Add resource</button>
          <button type="button" class="btn btn-primary" id="save-btn" data-busy-disable="true">Save &amp; Publish</button>
          <button type="button" class="btn" id="cancel-btn" data-busy-disable="true">Cancel changes / reload</button>
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
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody id="resource-rows"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Upload Excel file</h2>
        <p class="lead">
          You can still upload an approved <strong>.xlsx</strong> or <strong>.csv</strong> file directly. Red stores the file in Azure Blob Storage for downstream processing.
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
    return pageShell("BRC Edu webinar resources", content, adminPageScript(secret));
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
