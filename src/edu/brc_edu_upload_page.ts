import { escapeHtml } from "../auth/connection_page.js";
import { RED_LOGO_URL } from "../auth/red_assets.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "./brc_edu_upload_store.js";
import {
  renderYouTubeAdminSectionHtml,
  youtubeAdminSectionCss,
  YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS,
  youtubeSyncApiUrl,
} from "../brc-edu/youtube/youtube-admin-page.js";
import {
  renderFreshdeskAdminSectionHtml,
  freshdeskAdminSectionCss,
  FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS,
  freshdeskSyncApiUrl,
} from "../brc-edu/freshdesk/freshdesk-admin-page.js";
import { CONTENT_OVERVIEW_API_PATH } from "../brc-edu/content/content-overview-service.js";

const BRC_RED = "#b5121b";

export const BRC_EDU_ADMIN_PATH = "/internal/brc-edu/admin";
/** @deprecated Legacy path — redirects to BRC_EDU_ADMIN_PATH. */
export const BRC_EDU_UPLOAD_PATH = "/internal/brc-edu/resources/upload";

export type BrcEduAdminView = "overview" | "youtube" | "freshdesk";

export function parseBrcEduAdminView(value: unknown): BrcEduAdminView {
  if (value === "youtube" || value === "freshdesk" || value === "overview") {
    return value;
  }
  return "overview";
}

/** Element IDs the overview view requires. */
export const CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS = [
  "overview-status",
  "overview-refresh-summary",
  "overview-count-total",
  "overview-count-freshdesk",
  "overview-count-youtube",
  "overview-count-webinars",
  "overview-count-excluded",
  "overview-topics",
  "overview-refresh-btn",
  "overview-sync-freshdesk-btn",
  "overview-sync-youtube-btn",
] as const;

export const BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS = [
  ...CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS,
  ...YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS,
  ...FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS,
] as const;

export const BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS = [] as const;

export function getAdminPageScriptReferencedElementIds(
  view: BrcEduAdminView = "overview",
): string[] {
  if (view === "youtube") {
    return [...YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS];
  }
  if (view === "freshdesk") {
    return [...FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS];
  }
  return [...CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS];
}

/** Returns every `id="..."` value appearing in HTML before the first admin script. */
export function findAdminPageElementIdsBeforeScript(html: string): Set<string> {
  const markers = [
    "function requireOverviewElement(id)",
    "function requireYoutubeElement(id)",
    "function requireFreshdeskElement(id)",
  ];

  let scriptIndex = -1;
  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index >= 0 && (scriptIndex < 0 || index < scriptIndex)) {
      scriptIndex = index;
    }
  }

  const markup =
    scriptIndex >= 0 ? html.slice(0, scriptIndex) : html.slice(0, html.indexOf("</main>"));

  const ids = new Set<string>();
  const pattern = /\bid="([^"]+)"/g;

  for (const match of markup.matchAll(pattern)) {
    ids.add(match[1]!);
  }

  return ids;
}

/** How the admin page authenticates subsequent API calls. */
export type BrcEduAdminPageAuth =
  | { mode: "session" }
  | { mode: "secret"; secret: string };

function withOptionalSecretQuery(path: string, auth: BrcEduAdminPageAuth): string {
  if (auth.mode !== "secret") {
    return path;
  }

  return `${path}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(auth.secret)}`;
}

function adminPageUrl(
  auth: BrcEduAdminPageAuth,
  view: BrcEduAdminView = "overview",
): string {
  const base =
    view === "overview"
      ? BRC_EDU_ADMIN_PATH
      : `${BRC_EDU_ADMIN_PATH}?view=${encodeURIComponent(view)}`;

  if (auth.mode !== "secret") {
    return base;
  }

  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(auth.secret)}`;
}

function resolvePageAuth(secretOrAuth?: string | BrcEduAdminPageAuth): BrcEduAdminPageAuth {
  if (!secretOrAuth) {
    return { mode: "session" };
  }

  if (typeof secretOrAuth === "string") {
    return { mode: "secret", secret: secretOrAuth };
  }

  return secretOrAuth;
}

function renderAdminNav(auth: BrcEduAdminPageAuth, view: BrcEduAdminView): string {
  const items: Array<{ view: BrcEduAdminView; label: string }> = [
    { view: "overview", label: "Content overview" },
    { view: "youtube", label: "YouTube videos" },
    { view: "freshdesk", label: "Freshdesk articles" },
  ];

  return `
      <nav class="admin-nav" aria-label="Content administration">
        ${items
          .map((item) => {
            const href = escapeHtml(adminPageUrl(auth, item.view));
            const active = item.view === view;
            return `<a href="${href}" class="admin-nav-link${active ? " nav-active" : ""}"${
              active ? ' aria-current="page"' : ""
            }>${escapeHtml(item.label)}</a>`;
          })
          .join("")}
      </nav>`;
}

function renderOverviewSectionHtml(auth: BrcEduAdminPageAuth): string {
  const overviewUrl = withOptionalSecretQuery(CONTENT_OVERVIEW_API_PATH, auth);
  const freshdeskSyncUrl = freshdeskSyncApiUrl(auth);
  const youtubeSyncUrl = youtubeSyncApiUrl(auth);

  return `
      <div class="card instructions">
        <h2>How Red help content works</h2>
        <ol class="lead">
          <li>Red uses Freshdesk articles and YouTube videos as help content for customers.</li>
          <li>Content below is grouped by topic from structured help-routing and folder categories.</li>
          <li>Excluding an item on the YouTube or Freshdesk pages prevents Red from presenting it to customers.</li>
          <li>Source content remains synchronised and can be restored later.</li>
        </ol>
      </div>

      <div class="card" id="content-overview-card">
        <h2>Visible content by topic</h2>
        <div class="meta-bar">
          <span><strong>Total visible:</strong> <span id="overview-count-total">0</span></span>
          <span><strong>Freshdesk:</strong> <span id="overview-count-freshdesk">0</span></span>
          <span><strong>YouTube videos:</strong> <span id="overview-count-youtube">0</span></span>
          <span><strong>Recorded webinars:</strong> <span id="overview-count-webinars">0</span></span>
          <span><strong>Excluded:</strong> <span id="overview-count-excluded">0</span></span>
        </div>
        <p class="hint" id="overview-refresh-summary">Last content refresh: not yet available</p>
        <div id="overview-status" class="notice" style="display:none" role="status" aria-live="polite"></div>
        <div class="toolbar">
          <button type="button" class="btn" id="overview-refresh-btn">Refresh overview</button>
          <button type="button" class="btn btn-primary" id="overview-sync-freshdesk-btn">Sync Freshdesk</button>
          <button type="button" class="btn btn-primary" id="overview-sync-youtube-btn">Sync YouTube</button>
        </div>
        <div id="overview-topics" class="overview-topics"></div>
      </div>

      <script>
(() => {
  const overviewApiUrl = ${JSON.stringify(overviewUrl)};
  const freshdeskSyncApiUrl = ${JSON.stringify(freshdeskSyncUrl)};
  const youtubeSyncApiUrl = ${JSON.stringify(youtubeSyncUrl)};

  function requireOverviewElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("Overview admin element missing: " + id);
    }
    return element;
  }

  const statusEl = requireOverviewElement("overview-status");
  const summaryEl = requireOverviewElement("overview-refresh-summary");
  const totalEl = requireOverviewElement("overview-count-total");
  const freshdeskEl = requireOverviewElement("overview-count-freshdesk");
  const youtubeEl = requireOverviewElement("overview-count-youtube");
  const webinarsEl = requireOverviewElement("overview-count-webinars");
  const excludedEl = requireOverviewElement("overview-count-excluded");
  const topicsEl = requireOverviewElement("overview-topics");
  const refreshBtn = requireOverviewElement("overview-refresh-btn");
  const syncFreshdeskBtn = requireOverviewElement("overview-sync-freshdesk-btn");
  const syncYoutubeBtn = requireOverviewElement("overview-sync-youtube-btn");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setStatus(kind, message) {
    statusEl.style.display = "block";
    statusEl.className = "notice " + kind;
    statusEl.textContent = message;
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  function typeLabel(type) {
    if (type === "freshdesk_article") return "Freshdesk article";
    if (type === "recorded_webinar") return "Recorded webinar";
    return "YouTube video";
  }

  function renderTopics(payload) {
    const topics = Array.isArray(payload.topics) ? payload.topics : [];
    if (!topics.length) {
      topicsEl.innerHTML = '<p class="hint">No visible Red help content is available yet. Run a Freshdesk or YouTube sync.</p>';
      return;
    }

    topicsEl.innerHTML = topics.map((topic) => {
      const counts = topic.counts || {};
      const summaryParts = [];
      if (counts.freshdeskArticles) {
        summaryParts.push(counts.freshdeskArticles + " Freshdesk article" + (counts.freshdeskArticles === 1 ? "" : "s"));
      }
      if (counts.youtubeVideos) {
        summaryParts.push(counts.youtubeVideos + " YouTube video" + (counts.youtubeVideos === 1 ? "" : "s"));
      }
      if (counts.recordedWebinars) {
        summaryParts.push(counts.recordedWebinars + " recorded webinar" + (counts.recordedWebinars === 1 ? "" : "s"));
      }

      const items = Array.isArray(topic.items) ? topic.items : [];
      const itemsHtml = items.map((item) => {
        const link = item.url
          ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">Open</a>'
          : "";
        const manage = item.manageUrl
          ? '<a href="' + escapeHtml(item.manageUrl) + '">Manage</a>'
          : "";
        return (
          '<li class="overview-item">' +
          "<div><strong>" + escapeHtml(item.title) + "</strong>" +
          '<div class="hint">' + escapeHtml(typeLabel(item.type)) +
          " · " + escapeHtml(item.source) +
          (item.updatedAt ? " · " + escapeHtml(formatDate(item.updatedAt)) : "") +
          "</div>" +
          (item.description ? '<div class="hint">' + escapeHtml(item.description) + "</div>" : "") +
          '<div class="overview-item-actions">' + [link, manage].filter(Boolean).join(" · ") + "</div>" +
          "</div></li>"
        );
      }).join("");

      return (
        '<details class="overview-topic">' +
        '<summary><span class="overview-topic-title">' + escapeHtml(topic.label) +
        '</span><span class="hint">' + escapeHtml(summaryParts.join(" · ") || "0 items") +
        "</span></summary>" +
        '<ul class="overview-item-list">' + itemsHtml + "</ul>" +
        "</details>"
      );
    }).join("");
  }

  function applyPayload(payload) {
    const counts = payload.counts || {};
    totalEl.textContent = String(counts.totalVisible ?? 0);
    freshdeskEl.textContent = String(counts.freshdeskArticles ?? 0);
    youtubeEl.textContent = String(counts.youtubeVideos ?? 0);
    webinarsEl.textContent = String(counts.recordedWebinars ?? 0);
    excludedEl.textContent = String(counts.excluded ?? 0);

    if (payload.lastContentRefreshAt) {
      summaryEl.textContent = "Last content refresh: " + formatDate(payload.lastContentRefreshAt);
    } else {
      summaryEl.textContent = "Last content refresh: not yet available";
    }

    renderTopics(payload);
  }

  async function loadOverview() {
    try {
      const response = await fetch(overviewApiUrl, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error", payload.error || "Could not load content overview.");
        return;
      }
      applyPayload(payload);
      statusEl.style.display = "none";
    } catch {
      setStatus("error", "Could not load content overview.");
    }
  }

  async function runSync(url, label) {
    syncFreshdeskBtn.disabled = true;
    syncYoutubeBtn.disabled = true;
    refreshBtn.disabled = true;
    setStatus("warning", "Synchronising " + label + "…");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error", payload.error || label + " sync failed.");
        return;
      }
      setStatus("success", label + " synchronised.");
      await loadOverview();
    } catch {
      setStatus("error", label + " sync failed.");
    } finally {
      syncFreshdeskBtn.disabled = false;
      syncYoutubeBtn.disabled = false;
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", () => { void loadOverview(); });
  syncFreshdeskBtn.addEventListener("click", () => { void runSync(freshdeskSyncApiUrl, "Freshdesk"); });
  syncYoutubeBtn.addEventListener("click", () => { void runSync(youtubeSyncApiUrl, "YouTube"); });

  void loadOverview();
})();
      </script>`;
}

function pageShell(title: string, content: string, extraHead = ""): string {
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
        background:
          radial-gradient(circle at top left, rgba(181, 18, 27, 0.08), transparent 40%),
          linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
      }

      .brand-bar {
        background: linear-gradient(135deg, ${BRC_RED} 0%, #8f0e16 100%);
        color: #fff;
        padding: 20px 0;
      }

      .brand-shell, .page {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
      }

      .brand-inner {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .brand-logo {
        border-radius: 12px;
        background: #fff;
        padding: 6px;
      }

      .eyebrow {
        margin: 0 0 4px;
        font-size: 13px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.9;
      }

      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.2;
      }

      .page { padding: 24px 0 48px; }

      .admin-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 20px;
      }

      .admin-nav-link {
        display: inline-flex;
        align-items: center;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid #d1d5db;
        background: #fff;
        color: #111827;
        text-decoration: none;
        font-weight: 600;
        font-size: 14px;
      }

      .admin-nav-link:hover {
        border-color: ${BRC_RED};
        color: ${BRC_RED};
      }

      .admin-nav-link.nav-active,
      .admin-nav-link[aria-current="page"] {
        background: ${BRC_RED};
        border-color: ${BRC_RED};
        color: #fff;
      }

      .card {
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
      }

      h2 { margin: 0 0 12px; font-size: 20px; }

      .lead { margin: 0 0 16px; color: #4b5563; }

      .meta-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 12px;
        font-size: 14px;
      }

      .hint { color: #6b7280; font-size: 13px; margin: 0 0 12px; }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0;
        align-items: center;
      }

      .btn {
        appearance: none;
        border: 1px solid #d1d5db;
        background: #fff;
        color: #111827;
        border-radius: 10px;
        padding: 8px 14px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .btn:hover { border-color: #9ca3af; }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .btn-primary { background: ${BRC_RED}; border-color: ${BRC_RED}; color: #fff; }
      .btn-danger { background: #fff; border-color: #fca5a5; color: #b91c1c; }

      .notice {
        border-radius: 10px;
        padding: 10px 12px;
        margin: 12px 0;
        font-size: 14px;
      }

      .notice.success { background: #ecfdf5; color: #065f46; }
      .notice.error { background: #fef2f2; color: #991b1b; }
      .notice.warning { background: #fffbeb; color: #92400e; }

      .table-wrap { overflow-x: auto; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      th, td {
        padding: 10px 8px;
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

      .instructions ol {
        margin: 0;
        padding-left: 20px;
      }

      .instructions li { margin-bottom: 6px; }

      .overview-topic {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 8px 12px;
        margin-bottom: 10px;
        background: #fafafa;
      }

      .overview-topic summary {
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        align-items: baseline;
        list-style: none;
      }

      .overview-topic summary::-webkit-details-marker { display: none; }

      .overview-topic-title {
        font-weight: 700;
        color: #111827;
      }

      .overview-item-list {
        margin: 12px 0 4px;
        padding-left: 18px;
      }

      .overview-item { margin-bottom: 12px; }
      .overview-item-actions { margin-top: 4px; font-size: 13px; }

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

      ${youtubeAdminSectionCss()}
      ${freshdeskAdminSectionCss()}
    </style>
  </head>
  <body>
    <header class="brand-bar">
      <div class="brand-shell">
        <div class="brand-inner">
          <img class="brand-logo" src="${RED_LOGO_URL}" alt="Red logo" width="72" height="72" />
          <div class="brand-copy">
            <p class="eyebrow">Internal admin</p>
            <h1>Red content administration</h1>
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

export function renderBrcEduUploadPage(
  secretOrAuth?: string | BrcEduAdminPageAuth,
  view: BrcEduAdminView = "overview",
): string {
  const auth = resolvePageAuth(secretOrAuth);
  const nav = renderAdminNav(auth, view);

  let body = "";
  if (view === "youtube") {
    body = `
      <div class="card instructions">
        <h2>YouTube videos</h2>
        <p class="lead">
          Channel videos and webinar-playlist videos are synchronised separately.
          Exclusions persist across future synchronisations and stay visible here so staff can restore them.
        </p>
      </div>
      ${renderYouTubeAdminSectionHtml(auth)}`;
  } else if (view === "freshdesk") {
    body = `
      <div class="card instructions">
        <h2>Freshdesk articles</h2>
        <p class="lead">
          Articles are synchronised from Freshdesk.
          Exclusions persist across syncs. Excluded articles remain visible to administrators but are never returned to Red customers.
        </p>
      </div>
      ${renderFreshdeskAdminSectionHtml(auth)}`;
  } else {
    body = renderOverviewSectionHtml(auth);
  }

  return pageShell("Red content administration", `${nav}${body}`);
}

export function renderBrcEduUploadErrorPage(
  message: string,
  secretOrAuth?: string | BrcEduAdminPageAuth,
): string {
  const auth = resolvePageAuth(secretOrAuth);
  const retryLink = `<p><a href="${escapeHtml(adminPageUrl(auth))}">Return to content admin</a></p>`;

  const content = `
      ${renderAdminNav(auth, "overview")}
      <div class="card">
        <div class="notice error">${escapeHtml(message)}</div>
        ${retryLink}
      </div>`;

  return pageShell("Red content admin error", content);
}

export function renderBrcEduUploadPlainError(message: string): string {
  return message;
}

export function renderBrcEduStaffDeniedPage(
  message = "This area is available only to authorised Big Red Cloud staff.",
): string {
  const content = `
      <div class="card">
        <div class="notice error">${escapeHtml(message)}</div>
      </div>`;

  return pageShell("Access denied", content);
}
