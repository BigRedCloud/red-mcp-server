import { CONNECTION_CODE_TTL_MINUTES } from "./connection_store.js";
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

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="${RED_LOGO_URL}" type="image/png" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        color: #1f2937;
        background: #f3f4f6;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: clamp(16px, 4vw, 48px) clamp(16px, 3vw, 32px) clamp(32px, 5vw, 64px);
      }

      .page {
        width: min(100%, 1100px);
        margin: 0 auto;
      }

      .brand-bar {
        background: ${BRC_RED};
        color: #ffffff;
        border-radius: 12px 12px 0 0;
        padding: clamp(20px, 3vw, 32px) clamp(20px, 3vw, 40px) clamp(16px, 2.5vw, 24px);
        text-align: center;
      }

      .brand-bar h1 {
        margin: 6px 0 0;
        font-size: 28px;
        font-weight: 700;
        line-height: 1.2;
      }

      .brand-bar .tagline {
        margin: 0;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.02em;
        opacity: 0.92;
      }

      .brand-logo {
        display: block;
        width: 64px;
        height: 64px;
        margin: 0 auto 12px;
        padding: 10px;
        border-radius: 50%;
        background: #ffffff;
        object-fit: contain;
      }

      .card {
        background: #ffffff;
        border-radius: 0 0 12px 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
        padding: clamp(20px, 3vw, 40px);
      }

      .card > p.lead {
        margin: 0 0 20px;
        color: #4b5563;
      }

      .section {
        margin-top: 0;
      }

      .connect-layout {
        margin-top: 24px;
      }

      .connect-layout .section {
        min-width: 0;
      }

      @media (min-width: 768px) {
        .connect-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: clamp(20px, 3vw, 40px);
          align-items: start;
        }

        .connect-divider {
          flex-direction: column;
          margin: 0;
          align-self: stretch;
          min-width: 2.5rem;
          padding: clamp(8px, 1.5vw, 16px) 0;
        }

        .connect-divider::before,
        .connect-divider::after {
          flex: 1;
          width: 1px;
          height: auto;
          min-height: 24px;
        }
      }

      .section-title {
        margin: 0 0 4px;
        font-size: 15px;
        font-weight: 600;
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
        margin-top: 28px;
        padding: 13px 20px;
        font-size: 16px;
        font-weight: 600;
        color: #ffffff;
        background: ${BRC_RED};
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s;
      }

      .btn-primary:hover {
        background: ${BRC_RED_DARK};
      }

      .btn-primary:focus {
        outline: none;
        box-shadow: 0 0 0 3px rgba(181, 18, 27, 0.35);
      }

      .trust-note {
        margin-top: 22px;
        padding: 14px 16px;
        font-size: 14px;
        color: #4b5563;
        background: ${BRC_RED_LIGHT};
        border-left: 4px solid ${BRC_RED};
        border-radius: 0 8px 8px 0;
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
    <div class="page">
      ${body}
    </div>
  </body>
</html>`;
}

function brandBar(): string {
  return `
      <div class="brand-bar">
        <img class="brand-logo" src="${RED_LOGO_URL}" alt="" width="64" height="64" />
        <p class="tagline">Big Red Cloud&rsquo;s AI assistant</p>
        <h1>Red</h1>
      </div>`;
}

export function renderConnectPage(code: string): string {
  const body = `
      ${brandBar()}
      <div class="card">
        <p class="lead">
          Enter your company details on this secure page. Your API key is never sent through chat — only submitted here to Red for this session.
        </p>

        <form method="POST" action="/connect" enctype="multipart/form-data">
          <input type="hidden" name="code" value="${escapeHtml(code)}" />
          <div class="trust-note">
          <strong>Your credentials stay private.</strong> API keys are submitted directly to the Red server, stored only for this session (about one hour), and are never shown in chat.
        </div>
        <div class="trust-note">
          <strong>File upload preferred:</strong> Below you can connect a single company via form or upload a file. If you upload a file the form will be ignored.
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

  return pageShell("Connect — Red", body);
}

export function renderExpiredLinkPage(): string {
  const body = `
      ${brandBar()}
      <div class="card">
        <div class="status-icon warning" aria-hidden="true">!</div>
        <h2>Connection link expired</h2>
        <p class="centered">
          This connection link is invalid, has expired, or has already been used. Connection links are valid for about ${CONNECTION_CODE_TTL_MINUTES} minutes and can only be used once.
        </p>
        <div class="next-step">
          Return to your chat and ask Red to <strong>start a new company connection</strong>.
        </div>
      </div>`;

  return pageShell("Connection link expired", body);
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

  const body = `
      ${brandBar()}
      <div class="card">
        <div class="status-icon success" aria-hidden="true">✓</div>
        <h2>Companies connected</h2>
        <p class="centered">${escapeHtml(summary)}</p>
        <ul class="company-list">${listItems}</ul>
        <div class="next-step">
          Connection complete. Return to your AI assistant and paste this confirmation command: <strong>Confirm connection code ${escapeHtml(code)}</strong>
        </div>
      </div>`;

  return pageShell("Companies connected", body);
}

export function renderConnectionFailedPage(message: string): string {
  const body = `
      ${brandBar()}
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

  return pageShell("Connection failed", body);
}
