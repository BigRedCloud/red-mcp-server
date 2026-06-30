import { RED_LOGO_URL } from "./red_assets.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const BRC_RED = "#b5121b";
const BRC_RED_DARK = "#8f0e16";
const BRC_RED_LIGHT = "#fdf2f2";

function pageShell(title: string, header: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="${RED_LOGO_URL}" type="image/png" sizes="any" />
    <link rel="shortcut icon" href="${RED_LOGO_URL}" type="image/png" />
    <link rel="apple-touch-icon" href="${RED_LOGO_URL}" />
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
        width: min(100%, 1100px);
        margin: 0 auto;
      }

      .page {
        padding: clamp(20px, 3vw, 32px) clamp(16px, 3vw, 32px) 0;
      }

      .brand-inner {
        display: flex;
        align-items: center;
        justify-content: flex-start;
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

      .brand-copy {
        text-align: left;
        min-width: 0;
      }

      .eyebrow {
        margin: 0 0 4px;
        font-size: clamp(0.8rem, 1.2vw, 0.95rem);
        font-weight: 500;
        letter-spacing: 0.01em;
        opacity: 0.92;
      }

      .brand-copy h1 {
        margin: 0;
        font-size: clamp(2rem, 4.5vw, 3.25rem);
        line-height: 1;
        font-weight: 800;
        letter-spacing: -0.02em;
      }

      @media (max-width: 480px) {
        .brand-inner {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .brand-copy {
          text-align: center;
        }
      }

      .card {
        background: #ffffff;
        padding: clamp(24px, 3.5vw, 44px);
        border-radius: 16px;
        box-shadow:
          0 1px 2px rgba(15, 23, 42, 0.06),
          0 12px 40px rgba(15, 23, 42, 0.12);
      }

      .card > p.lead {
        margin: 0 0 clamp(20px, 3vw, 28px);
        font-size: clamp(0.98rem, 1.2vw, 1.05rem);
        line-height: 1.65;
        color: #4b5563;
        width: 100%;
      }

      .trust-notes {
        display: grid;
        gap: 12px;
        margin-bottom: clamp(20px, 3vw, 28px);
      }

      @media (min-width: 768px) {
        .trust-notes {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      .trust-note {
        margin-top: 0;
        padding: 14px 16px;
        font-size: 14px;
        line-height: 1.55;
        color: #4b5563;
        background: ${BRC_RED_LIGHT};
        border: 1px solid rgba(181, 18, 27, 0.12);
        border-left: 4px solid ${BRC_RED};
        border-radius: 10px;
      }

      .section {
        margin-top: 0;
      }

      .connect-layout {
        margin-top: 0;
      }

      .connect-layout .section {
        min-width: 0;
        padding: clamp(16px, 2.5vw, 24px);
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }

      @media (min-width: 768px) {
        .connect-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: clamp(20px, 3vw, 32px);
          align-items: stretch;
        }

        .connect-divider {
          flex-direction: column;
          margin: 0;
          align-self: center;
          min-width: 2rem;
          padding: 0;
          color: #9ca3af;
        }

        .connect-divider::before,
        .connect-divider::after {
          flex: 1;
          width: 1px;
          height: auto;
          min-height: 32px;
          background: #d1d5db;
        }
      }

      .section-title {
        margin: 0 0 6px;
        font-size: 1rem;
        font-weight: 700;
        color: #111827;
      }

      .section-hint {
        margin: 0 0 14px;
        font-size: 14px;
        color: #6b7280;
      }

      label {
        display: block;
        margin-top: 14px;
        font-size: 14px;
        font-weight: 600;
        color: #374151;
      }

      label:first-of-type {
        margin-top: 0;
      }

      input[type="text"],
      input[type="password"],
      input[type="file"] {
        width: 100%;
        margin-top: 6px;
        padding: 11px 12px;
        font-size: 15px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        transition: border-color 0.15s, box-shadow 0.15s;
      }

      input[type="text"]:focus,
      input[type="password"]:focus,
      input[type="file"]:focus {
        outline: none;
        border-color: ${BRC_RED};
        box-shadow: 0 0 0 3px rgba(181, 18, 27, 0.15);
      }

      input[type="file"] {
        padding: 9px 12px;
        font-size: 14px;
      }

      .divider {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 28px 0;
        color: #9ca3af;
        font-size: 13px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .divider::before,
      .divider::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #e5e7eb;
      }

      .csv-example {
        margin: 0 0 14px;
        padding: 12px 14px;
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 13px;
        line-height: 1.5;
        color: #374151;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow-x: auto;
        white-space: pre;
      }

      .btn-primary {
        display: block;
        width: 100%;
        max-width: 360px;
        margin: clamp(24px, 3vw, 32px) auto 0;
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 600;
        color: #ffffff;
        background: linear-gradient(180deg, ${BRC_RED} 0%, ${BRC_RED_DARK} 100%);
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
        box-shadow: 0 4px 14px rgba(181, 18, 27, 0.28);
      }

      .btn-primary:hover {
        filter: brightness(1.05);
        box-shadow: 0 6px 18px rgba(181, 18, 27, 0.34);
      }

      .btn-primary:active {
        transform: translateY(1px);
      }

      .btn-primary:focus {
        outline: none;
        box-shadow: 0 0 0 3px rgba(181, 18, 27, 0.35);
      }

      .trust-note strong {
        color: #991b1b;
      }

      .company-list {
        margin: 16px 0 20px;
        padding: 0;
        list-style: none;
      }

      .company-list li {
        padding: 10px 14px;
        margin-bottom: 8px;
        font-weight: 500;
        color: #111827;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }

      .company-list li::before {
        content: "✓ ";
        color: ${BRC_RED};
        font-weight: 700;
      }

      .status-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        margin: 0 auto 18px;
        font-size: 28px;
        border-radius: 50%;
      }

      .status-icon.success {
        background: #dcfce7;
        color: #15803d;
      }

      .status-icon.warning {
        background: #fef3c7;
        color: #b45309;
      }

      .status-icon.error {
        background: #fee2e2;
        color: ${BRC_RED};
      }

      .card h2 {
        margin: 0 0 10px;
        font-size: 20px;
        font-weight: 700;
        text-align: center;
        color: #111827;
      }

      .card .centered {
        text-align: center;
        color: #4b5563;
      }

      .next-step {
        margin-top: 20px;
        padding: 14px 16px;
        font-size: 14px;
        color: #374151;
        background: #f9fafb;
        border-radius: 8px;
        text-align: center;
      }

      .next-step strong {
        color: #111827;
      }

      .error-message {
        margin: 0 0 16px;
        padding: 12px 14px;
        font-size: 14px;
        color: #991b1b;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    ${header}
    <main class="page">
      ${content}
    </main>
  </body>
</html>`;
}

function brandBar(): string {
  return `
      <header class="brand-bar">
        <div class="brand-shell">
          <div class="brand-inner">
            <img class="brand-logo" src="${RED_LOGO_URL}" alt="Red logo" width="72" height="72" />
            <div class="brand-copy">
              <p class="eyebrow">Big Red Cloud&rsquo;s AI assistant</p>
              <h1>Red</h1>
            </div>
          </div>
        </div>
      </header>`;
}

export function renderConnectPage(code: string): string {
  const content = `
      <div class="card">
        <p class="lead">
          Securely connect your Big Red Cloud companies to Red. Your API key is never sent through chat — it is only submitted here for this connection session.
        </p>

        <form method="POST" action="/connect" enctype="multipart/form-data">
          <input type="hidden" name="code" value="${escapeHtml(code)}" />
          <div class="trust-notes">
            <div class="trust-note">
              <strong>Your credentials stay private.</strong> API keys are submitted directly to the Red server, stored only for this session (about two hours), and are never shown in chat.
            </div>
            <div class="trust-note">
              <strong>File upload preferred:</strong> Connect a single company via the form or upload a CSV for several at once. If you upload a file, the form is ignored.
            </div>
          </div>

          <div class="connect-layout">
          <div class="section">
            <p class="section-title">Connect one company</p>
            <p class="section-hint">Enter a company name and its Big Red Cloud API key.</p>

            <label for="companyName">Company name</label>
            <input
              id="companyName"
              name="companyName"
              type="text"
              autocomplete="organization"
              placeholder="e.g. Company A"
            />

            <label for="apiKey">Big Red Cloud API key</label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autocomplete="off"
              placeholder="Enter your API key"
            />
          </div>

          <div class="divider connect-divider">or</div>

          <div class="section">
            <p class="section-title">Connect multiple companies</p>
            <p class="section-hint">Upload a CSV file with one company per row.</p>

            <div class="csv-example">companyName,apiKey
Company A,xxxxxxxx
Company B,xxxxxxxx</div>

            <label for="companyFile">CSV file</label>
            <input
              id="companyFile"
              name="companyFile"
              type="file"
              accept=".csv,text/csv"
            />
          </div>
          </div>

          <button type="submit" class="btn-primary">Connect companies</button>
        </form>


      </div>`;

  return pageShell("Connect — Red", brandBar(), content);
}

export function renderExpiredLinkPage(): string {
  const content = `
      <div class="card">
        <div class="status-icon warning" aria-hidden="true">!</div>
        <h2>Connection link not available</h2>
        <p class="centered">
          This connection link is invalid or has already been used. Each secure connection link works only once. Ask Red in chat for a new secure connection link.
        </p>
        <div class="next-step">
          Return to your chat and ask Red to <strong>start a new company connection</strong>.
        </div>
      </div>`;

  return pageShell("Connection link not available", brandBar(), content);
}

export function renderSuccessPage(connectedNames: string[], code: string): string {
  const count = connectedNames.length;
  const summary =
    count === 1
      ? "1 company was connected to Red for this session."
      : `${count} companies were connected to Red for this session.`;

  const listItems = connectedNames
    .map((name) => `<li>${escapeHtml(name)}</li>`)
    .join("");

  const content = `
      <div class="card">
        <div class="status-icon success" aria-hidden="true">✓</div>
        <h2>Companies connected</h2>
        <p class="centered">${escapeHtml(summary)}</p>
        <ul class="company-list">${listItems}</ul>
        <div class="next-step">
          Connection complete. Return to this chat and copy/paste this confirmation code: <strong>Confirm connection code ${escapeHtml(code)}</strong>
        </div>
      </div>`;

  return pageShell("Companies connected", brandBar(), content);
}

export function renderConnectionFailedPage(message: string): string {
  const content = `
      <div class="card">
        <div class="status-icon error" aria-hidden="true">✕</div>
        <h2>Connection failed</h2>
        <p class="error-message">${escapeHtml(message)}</p>
        <p class="centered">
          Please check your company details and try again, or return to chat and ask Red to start a new connection.
        </p>
        <div class="next-step">
          Return to your chat and ask Red to <strong>start a new company connection</strong>.
        </div>
      </div>`;

  return pageShell("Connection failed", brandBar(), content);
}
