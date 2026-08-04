import type { BrcEduAdminPageAuth } from "../../edu/brc_edu_upload_page.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../../edu/brc_edu_upload_store.js";

export const FRESHDESK_ARTICLES_API_PATH =
  "/internal/brc-edu/freshdesk/articles";

export const FRESHDESK_SYNC_API_PATH =
  "/internal/brc-edu/freshdesk/sync";

export const FRESHDESK_VISIBILITY_API_PATH_PREFIX =
  "/internal/brc-edu/freshdesk/articles/";

function withOptionalSecretQuery(
  path: string,
  auth: BrcEduAdminPageAuth,
): string {
  if (auth.mode !== "secret") {
    return path;
  }

  return `${path}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(
    auth.secret,
  )}`;
}

export function freshdeskArticlesApiUrl(
  auth: BrcEduAdminPageAuth,
): string {
  return withOptionalSecretQuery(FRESHDESK_ARTICLES_API_PATH, auth);
}

export function freshdeskSyncApiUrl(
  auth: BrcEduAdminPageAuth,
): string {
  return withOptionalSecretQuery(FRESHDESK_SYNC_API_PATH, auth);
}

export const FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS = [
  "freshdesk-status",
  "freshdesk-sync-summary",
  "freshdesk-count-total",
  "freshdesk-count-visible",
  "freshdesk-count-excluded",
  "freshdesk-filter",
  "freshdesk-search",
  "freshdesk-rows",
  "freshdesk-sync-btn",
  "freshdesk-refresh-btn",
] as const;

export function renderFreshdeskAdminSectionHtml(
  auth: BrcEduAdminPageAuth,
): string {
  const articlesUrl = freshdeskArticlesApiUrl(auth);
  const syncUrl = freshdeskSyncApiUrl(auth);

  return `
      <div class="card" id="freshdesk-admin-card">
        <h2>Freshdesk article management</h2>

        <p class="lead">
          Help articles are synchronised automatically from Freshdesk.
          Excluded articles remain visible to administrators but are never
          returned to Red customers.
        </p>

        <div class="meta-bar">
          <span>
            <strong>Total:</strong>
            <span id="freshdesk-count-total">0</span>
          </span>

          <span>
            <strong>Visible in Red:</strong>
            <span id="freshdesk-count-visible">0</span>
          </span>

          <span>
            <strong>Excluded:</strong>
            <span id="freshdesk-count-excluded">0</span>
          </span>
        </div>

        <p class="hint" id="freshdesk-sync-summary">
          Last sync: not yet run
        </p>

        <div
          id="freshdesk-status"
          class="notice"
          style="display:none"
          role="status"
          aria-live="polite"
        ></div>

        <div class="toolbar">
          <button
            type="button"
            class="btn btn-primary"
            id="freshdesk-sync-btn"
          >
            Sync Freshdesk now
          </button>

          <button
            type="button"
            class="btn"
            id="freshdesk-refresh-btn"
          >
            Refresh list
          </button>

          <label class="sr-only" for="freshdesk-search">
            Search Freshdesk articles
          </label>

          <input
            id="freshdesk-search"
            class="btn"
            type="search"
            placeholder="Search articles"
            style="width:auto;min-width:220px;text-align:left"
          />

          <label class="sr-only" for="freshdesk-filter">
            Filter Freshdesk articles
          </label>

          <select
            id="freshdesk-filter"
            class="btn"
            style="width:auto;min-width:180px"
          >
            <option value="all">All</option>
            <option value="visible">Visible</option>
            <option value="excluded">Excluded</option>
          </select>
        </div>

        <div class="table-wrap">
          <table aria-label="Freshdesk articles">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Folder</th>
                <th scope="col">Topic</th>
                <th scope="col">Updated</th>
                <th scope="col">Visibility</th>
                <th scope="col">Last synced</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>

            <tbody id="freshdesk-rows"></tbody>
          </table>
        </div>
      </div>

      <script>
(() => {
  const articlesApiUrl = ${JSON.stringify(articlesUrl)};
  const syncApiUrl = ${JSON.stringify(syncUrl)};
  const visibilityBase = ${JSON.stringify(
    FRESHDESK_VISIBILITY_API_PATH_PREFIX,
  )};

  function requireFreshdeskElement(id) {
    const element = document.getElementById(id);

    if (!element) {
      throw new Error("Freshdesk admin element missing: " + id);
    }

    return element;
  }

  const statusEl = requireFreshdeskElement("freshdesk-status");
  const summaryEl = requireFreshdeskElement("freshdesk-sync-summary");
  const totalEl = requireFreshdeskElement("freshdesk-count-total");
  const visibleEl = requireFreshdeskElement("freshdesk-count-visible");
  const excludedEl = requireFreshdeskElement("freshdesk-count-excluded");
  const filterEl = requireFreshdeskElement("freshdesk-filter");
  const searchEl = requireFreshdeskElement("freshdesk-search");
  const rowsEl = requireFreshdeskElement("freshdesk-rows");
  const syncBtn = requireFreshdeskElement("freshdesk-sync-btn");
  const refreshBtn = requireFreshdeskElement("freshdesk-refresh-btn");

  let articles = [];

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
    if (!value) {
      return "—";
    }

    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  function visibilityUrl(articleId) {
    const path =
      visibilityBase +
      encodeURIComponent(articleId) +
      "/visibility";

    ${
      auth.mode === "secret"
        ? `
    const secret = new URL(
      articlesApiUrl,
      window.location.origin,
    ).searchParams.get(
      ${JSON.stringify(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY)}
    );

    return secret
      ? path +
          "?" +
          ${JSON.stringify(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY)} +
          "=" +
          encodeURIComponent(secret)
      : path;
    `
        : "return path;"
    }
  }

  function matchesFilter(article) {
    const filter = filterEl.value;

    if (filter === "visible") {
      return !article.excluded;
    }

    if (filter === "excluded") {
      return Boolean(article.excluded);
    }

    return true;
  }

  function matchesSearch(article) {
    const query = String(searchEl.value || "")
      .trim()
      .toLowerCase();

    if (!query) {
      return true;
    }

    const searchableText = [
      article.title,
      article.folderName,
      article.categoryName,
      article.topic,
      article.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  }

  function renderRows() {
    const filtered = articles.filter(
      (article) =>
        matchesFilter(article) && matchesSearch(article),
    );

    rowsEl.innerHTML = filtered
      .map((article) => {
        const excludedClass = article.excluded
          ? " freshdesk-row-excluded"
          : "";

        const visibility = article.excluded
          ? '<span class="freshdesk-excluded-label">Excluded from Red</span>'
          : "Visible in Red";

        const action = article.excluded
          ? '<button type="button" class="btn" ' +
            'data-action="restore" ' +
            'data-article-id="' +
            escapeHtml(article.articleId) +
            '">Make visible in Red</button>'
          : '<button type="button" class="btn btn-danger" ' +
            'data-action="exclude" ' +
            'data-article-id="' +
            escapeHtml(article.articleId) +
            '">Exclude from Red</button>';

        const reason =
          article.excluded && article.exclusionReason
            ? '<div class="hint">Reason: ' +
              escapeHtml(article.exclusionReason) +
              "</div>"
            : "";

        const articleLink = article.url
          ? '<div><a href="' +
            escapeHtml(article.url) +
            '" target="_blank" rel="noopener noreferrer">' +
            "Open in Freshdesk</a></div>"
          : "";

        const folder =
          article.folderName ||
          article.categoryName ||
          "—";

        return (
          '<tr class="' +
          excludedClass.trim() +
          '">' +
          "<td><strong>" +
          escapeHtml(article.title) +
          "</strong>" +
          articleLink +
          reason +
          "</td>" +
          "<td>" +
          escapeHtml(folder) +
          "</td>" +
          "<td>" +
          escapeHtml(article.topic || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(formatDate(article.updatedAt)) +
          "</td>" +
          "<td>" +
          visibility +
          "</td>" +
          "<td>" +
          escapeHtml(formatDate(article.lastSyncedAt)) +
          "</td>" +
          "<td>" +
          action +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    if (!filtered.length) {
      rowsEl.innerHTML =
        '<tr><td colspan="7">No articles match this filter.</td></tr>';
    }
  }

  function applyPayload(payload) {
    articles = Array.isArray(payload.articles)
      ? payload.articles
      : [];

    const counts = payload.counts || {};

    totalEl.textContent = String(
      counts.total ?? articles.length,
    );

    visibleEl.textContent = String(
      counts.visible ??
        articles.filter((article) => !article.excluded).length,
    );

    excludedEl.textContent = String(
      counts.excluded ??
        articles.filter((article) => article.excluded).length,
    );

    const status = payload.status || {};

    if (status.lastSuccessAt) {
      const parts = [
        "Last successful sync: " +
          formatDate(status.lastSuccessAt),
      ];

      if (status.lastSource) {
        parts.push("source: " + status.lastSource);
      }

      if (status.lastErrorSummary) {
        parts.push(
          "last error: " + status.lastErrorSummary,
        );
      }

      summaryEl.textContent = parts.join(" · ");
    } else if (status.lastErrorSummary) {
      summaryEl.textContent =
        "Last sync failed: " + status.lastErrorSummary;
    } else {
      summaryEl.textContent = "Last sync: not yet run";
    }

    renderRows();
  }

  async function loadArticles() {
    try {
      const response = await fetch(articlesApiUrl, {
        credentials: "same-origin",
      });

      const payload = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setStatus(
          "error",
          payload.error ||
            "Could not load Freshdesk articles.",
        );
        return;
      }

      applyPayload(payload);
      statusEl.style.display = "none";
    } catch {
      setStatus(
        "error",
        "Could not load Freshdesk articles.",
      );
    }
  }

  async function syncNow() {
    syncBtn.disabled = true;
    refreshBtn.disabled = true;

    setStatus(
      "warning",
      "Synchronising Freshdesk articles…",
    );

    try {
      const response = await fetch(syncApiUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      const payload = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setStatus(
          "error",
          payload.error || "Freshdesk sync failed.",
        );

        if (payload.status) {
          applyPayload({
            articles,
            status: payload.status,
            counts:
              payload.status.lastCounts || {},
          });
        }

        return;
      }

      applyPayload(payload);

      setStatus(
        "success",
        "Freshdesk articles synchronised.",
      );
    } catch {
      setStatus(
        "error",
        "Freshdesk sync failed.",
      );
    } finally {
      syncBtn.disabled = false;
      refreshBtn.disabled = false;
    }
  }

  async function setVisibility(articleId, excluded) {
    let reason = "";

    if (excluded) {
      reason =
        window.prompt(
          "Optional exclusion reason (visible to staff only):",
          "",
        ) || "";
    }

    const response = await fetch(
      visibilityUrl(articleId),
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          excluded,
          reason,
        }),
      },
    );

    const payload = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      setStatus(
        "error",
        payload.error ||
          "Could not update article visibility.",
      );
      return;
    }

    if (payload.article) {
      articles = articles.map((article) =>
        article.articleId === articleId
          ? payload.article
          : article,
      );
    }

    if (payload.counts) {
      totalEl.textContent = String(
        payload.counts.total ??
          totalEl.textContent,
      );

      visibleEl.textContent = String(
        payload.counts.visible ??
          visibleEl.textContent,
      );

      excludedEl.textContent = String(
        payload.counts.excluded ??
          excludedEl.textContent,
      );
    }

    renderRows();

    setStatus(
      "success",
      excluded
        ? "Article excluded from Red."
        : "Article restored in Red.",
    );
  }

  rowsEl.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest(
      "button[data-action]",
    );

    if (!(button instanceof HTMLElement)) {
      return;
    }

    const articleId =
      button.getAttribute("data-article-id");

    const action =
      button.getAttribute("data-action");

    if (!articleId || !action) {
      return;
    }

    void setVisibility(
      articleId,
      action === "exclude",
    );
  });

  filterEl.addEventListener("change", renderRows);
  searchEl.addEventListener("input", renderRows);

  syncBtn.addEventListener("click", () => {
    void syncNow();
  });

  refreshBtn.addEventListener("click", () => {
    void loadArticles();
  });

  void loadArticles();
})();
      </script>`;
}

export function freshdeskAdminSectionCss(): string {
  return `
      tr.freshdesk-row-excluded {
        opacity: 0.55;
        background: #f3f4f6;
      }

      .freshdesk-excluded-label {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: #e5e7eb;
        color: #374151;
        font-size: 12px;
        font-weight: 700;
      }
  `;
}