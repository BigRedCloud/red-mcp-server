import type { BrcEduAdminPageAuth } from "../../edu/brc_edu_upload_page.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../../edu/brc_edu_upload_store.js";

export const YOUTUBE_VIDEOS_API_PATH = "/internal/brc-edu/youtube/videos";
export const YOUTUBE_SYNC_API_PATH = "/internal/brc-edu/youtube/sync";
export const YOUTUBE_VISIBILITY_API_PATH_PREFIX =
  "/internal/brc-edu/youtube/videos/";

function withOptionalSecretQuery(path: string, auth: BrcEduAdminPageAuth): string {
  if (auth.mode !== "secret") {
    return path;
  }

  return `${path}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(auth.secret)}`;
}

export function youtubeVideosApiUrl(auth: BrcEduAdminPageAuth): string {
  return withOptionalSecretQuery(YOUTUBE_VIDEOS_API_PATH, auth);
}

export function youtubeSyncApiUrl(auth: BrcEduAdminPageAuth): string {
  return withOptionalSecretQuery(YOUTUBE_SYNC_API_PATH, auth);
}

export const YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS = [
  "youtube-status",
  "youtube-sync-summary",
  "youtube-count-total",
  "youtube-count-visible",
  "youtube-count-excluded",
  "youtube-filter",
  "youtube-rows",
  "youtube-sync-btn",
  "youtube-refresh-btn",
] as const;

export function renderYouTubeAdminSectionHtml(auth: BrcEduAdminPageAuth): string {
  const videosUrl = youtubeVideosApiUrl(auth);
  const syncUrl = youtubeSyncApiUrl(auth);

  return `
      <div class="card" id="youtube-admin-card">
        <h2>YouTube video management</h2>
        <p class="lead">
          Videos are synchronised automatically from the Big Red Cloud YouTube channel.
          Recorded webinars come from the webinar playlist; other channel uploads appear as Big Red Cloud videos.
          Excluded videos stay visible here (greyed out) but are never returned to Red customers.
        </p>
        <div class="meta-bar">
          <span><strong>Total:</strong> <span id="youtube-count-total">0</span></span>
          <span><strong>Visible in Red:</strong> <span id="youtube-count-visible">0</span></span>
          <span><strong>Excluded:</strong> <span id="youtube-count-excluded">0</span></span>
        </div>
        <p class="hint" id="youtube-sync-summary">Last sync: not yet run</p>
        <div id="youtube-status" class="notice" style="display:none" role="status" aria-live="polite"></div>
        <div class="toolbar">
          <button type="button" class="btn btn-primary" id="youtube-sync-btn">Sync YouTube now</button>
          <button type="button" class="btn" id="youtube-refresh-btn">Refresh list</button>
          <label class="sr-only" for="youtube-filter">Filter videos</label>
          <select id="youtube-filter" class="btn" style="width:auto;min-width:180px">
            <option value="all">All</option>
            <option value="recorded_webinar">Recorded webinars</option>
            <option value="youtube_video">Big Red Cloud videos</option>
            <option value="visible">Visible</option>
            <option value="excluded">Excluded</option>
          </select>
        </div>
        <div class="table-wrap">
          <table aria-label="YouTube videos">
            <thead>
              <tr>
                <th scope="col">Thumbnail</th>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Published</th>
                <th scope="col">Visibility</th>
                <th scope="col">Last synced</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody id="youtube-rows"></tbody>
          </table>
        </div>
      </div>
      <script>
(() => {
  const videosApiUrl = ${JSON.stringify(videosUrl)};
  const syncApiUrl = ${JSON.stringify(syncUrl)};
  const visibilityBase = ${JSON.stringify(YOUTUBE_VISIBILITY_API_PATH_PREFIX)};

  function requireYoutubeElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("YouTube admin element missing: " + id);
    }
    return element;
  }

  const statusEl = requireYoutubeElement("youtube-status");
  const summaryEl = requireYoutubeElement("youtube-sync-summary");
  const totalEl = requireYoutubeElement("youtube-count-total");
  const visibleEl = requireYoutubeElement("youtube-count-visible");
  const excludedEl = requireYoutubeElement("youtube-count-excluded");
  const filterEl = requireYoutubeElement("youtube-filter");
  const rowsEl = requireYoutubeElement("youtube-rows");
  const syncBtn = requireYoutubeElement("youtube-sync-btn");
  const refreshBtn = requireYoutubeElement("youtube-refresh-btn");

  let videos = [];

  function escapeHtml(value) {
    return String(value)
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

  function categoryLabel(category) {
    return category === "recorded_webinar" ? "Recorded webinar" : "Big Red Cloud video";
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  function visibilityUrl(videoId) {
    const path = visibilityBase + encodeURIComponent(videoId) + "/visibility";
    ${
      auth.mode === "secret"
        ? `const secret = new URL(videosApiUrl, window.location.origin).searchParams.get(${JSON.stringify(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY)});
    return secret ? path + "?" + ${JSON.stringify(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY)} + "=" + encodeURIComponent(secret) : path;`
        : "return path;"
    }
  }

  function matchesFilter(video) {
    const filter = filterEl.value;
    if (filter === "all") return true;
    if (filter === "recorded_webinar") return video.category === "recorded_webinar";
    if (filter === "youtube_video") return video.category === "youtube_video";
    if (filter === "visible") return !video.excluded;
    if (filter === "excluded") return Boolean(video.excluded);
    return true;
  }

  function renderRows() {
    const filtered = videos.filter(matchesFilter);
    rowsEl.innerHTML = filtered.map((video) => {
      const excludedClass = video.excluded ? " youtube-row-excluded" : "";
      const visibility = video.excluded
        ? '<span class="youtube-excluded-label">Excluded from Red</span>'
        : "Visible in Red";
      const action = video.excluded
        ? '<button type="button" class="btn" data-action="restore" data-video-id="' + escapeHtml(video.videoId) + '">Make visible in Red</button>'
        : '<button type="button" class="btn btn-danger" data-action="exclude" data-video-id="' + escapeHtml(video.videoId) + '">Exclude from Red</button>';
      const thumb = video.thumbnailUrl
        ? '<img src="' + escapeHtml(video.thumbnailUrl) + '" alt="" width="120" height="68" loading="lazy" />'
        : "—";
      const reason = video.excluded && video.exclusionReason
        ? '<div class="hint">Reason: ' + escapeHtml(video.exclusionReason) + '</div>'
        : "";

      return '<tr class="' + excludedClass.trim() + '">' +
        '<td>' + thumb + '</td>' +
        '<td><strong>' + escapeHtml(video.title) + '</strong><div><a href="' + escapeHtml(video.url) + '" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div>' + reason + '</td>' +
        '<td>' + escapeHtml(categoryLabel(video.category)) + '</td>' +
        '<td>' + escapeHtml(formatDate(video.publishedAt)) + '</td>' +
        '<td>' + visibility + '</td>' +
        '<td>' + escapeHtml(formatDate(video.lastSyncedAt)) + '</td>' +
        '<td>' + action + '</td>' +
        '</tr>';
    }).join("");

    if (!filtered.length) {
      rowsEl.innerHTML = '<tr><td colspan="7">No videos match this filter.</td></tr>';
    }
  }

  function applyPayload(payload) {
    videos = Array.isArray(payload.videos) ? payload.videos : [];
    const counts = payload.counts || {};
    totalEl.textContent = String(counts.total ?? videos.length);
    visibleEl.textContent = String(counts.visible ?? videos.filter((v) => !v.excluded).length);
    excludedEl.textContent = String(counts.excluded ?? videos.filter((v) => v.excluded).length);

    const status = payload.status || {};
    if (status.lastSuccessAt) {
      const parts = ["Last successful sync: " + formatDate(status.lastSuccessAt)];
      if (status.lastSource) parts.push("source: " + status.lastSource);
      if (status.lastErrorSummary) parts.push("last error: " + status.lastErrorSummary);
      summaryEl.textContent = parts.join(" · ");
    } else if (status.lastErrorSummary) {
      summaryEl.textContent = "Last sync failed: " + status.lastErrorSummary;
    } else {
      summaryEl.textContent = "Last sync: not yet run";
    }

    renderRows();
  }

  async function loadVideos() {
    const response = await fetch(videosApiUrl, { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus("error", payload.error || "Could not load YouTube videos.");
      return;
    }
    applyPayload(payload);
    statusEl.style.display = "none";
  }

  async function syncNow() {
    syncBtn.disabled = true;
    refreshBtn.disabled = true;
    setStatus("warning", "Synchronising YouTube catalogue…");
    try {
      const response = await fetch(syncApiUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error", payload.error || "YouTube sync failed.");
        if (payload.status) applyPayload({ videos, status: payload.status, counts: payload.status.lastCounts || {} });
        return;
      }
      applyPayload(payload);
      setStatus("success", "YouTube catalogue synchronised.");
    } catch {
      setStatus("error", "YouTube sync failed.");
    } finally {
      syncBtn.disabled = false;
      refreshBtn.disabled = false;
    }
  }

  async function setVisibility(videoId, excluded) {
    let reason = "";
    if (excluded) {
      reason = window.prompt("Optional exclusion reason (visible to staff only):", "") || "";
    }

    const response = await fetch(visibilityUrl(videoId), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded, reason }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus("error", payload.error || "Could not update visibility.");
      return;
    }

    if (payload.video) {
      videos = videos.map((video) => video.videoId === videoId ? payload.video : video);
    }
    if (payload.counts) {
      totalEl.textContent = String(payload.counts.total ?? totalEl.textContent);
      visibleEl.textContent = String(payload.counts.visible ?? visibleEl.textContent);
      excludedEl.textContent = String(payload.counts.excluded ?? excludedEl.textContent);
    }
    renderRows();
    setStatus("success", excluded ? "Video excluded from Red." : "Video restored in Red.");
  }

  rowsEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLElement)) return;
    const videoId = button.getAttribute("data-video-id");
    const action = button.getAttribute("data-action");
    if (!videoId || !action) return;
    void setVisibility(videoId, action === "exclude");
  });

  filterEl.addEventListener("change", renderRows);
  syncBtn.addEventListener("click", () => { void syncNow(); });
  refreshBtn.addEventListener("click", () => { void loadVideos(); });

  void loadVideos();
})();
      </script>`;
}

export function youtubeAdminSectionCss(): string {
  return `
      tr.youtube-row-excluded {
        opacity: 0.55;
        background: #f3f4f6;
      }

      .youtube-excluded-label {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: #e5e7eb;
        color: #374151;
        font-size: 12px;
        font-weight: 700;
      }

      #youtube-admin-card img {
        border-radius: 6px;
        object-fit: cover;
        background: #e5e7eb;
      }
  `;
}
