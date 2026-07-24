/**
 * Anonymous non-OAuth telemetry identity helpers for Red.
 *
 * red.telemetry_client_id — stable anonymous browser/device UUID
 * red.connection_session_id — per confirmed connection-flow UUID
 *
 * Never store or emit API keys, emails, connectionRef, claim codes, or session IDs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export const TELEMETRY_CLIENT_ID_COOKIE = "red_telemetry_client_id";
export const TELEMETRY_CLIENT_ID_STORAGE_KEY = "red.telemetry_client_id";
export const TELEMETRY_CLIENT_ID_FORM_FIELD = "telemetryClientId";
/** Cookie lifetime: ~1 year. */
export const TELEMETRY_CLIENT_ID_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const telemetryContextStorage = new AsyncLocalStorage();
export function isValidTelemetryUuid(value) {
    return typeof value === "string" && UUID_PATTERN.test(value.trim());
}
export function generateTelemetryUuid() {
    return randomUUID();
}
/**
 * Accepts a browser-supplied client ID only when it is a well-formed UUID.
 * Malformed or empty values are replaced with a freshly generated UUID.
 */
export function normaliseTelemetryClientId(value) {
    if (isValidTelemetryUuid(value)) {
        return value.trim().toLowerCase();
    }
    return generateTelemetryUuid();
}
export function generateConnectionSessionId() {
    return generateTelemetryUuid();
}
export function getRedTelemetryContext() {
    return telemetryContextStorage.getStore() ?? {};
}
export function runWithRedTelemetryContext(context, fn) {
    const parent = getRedTelemetryContext();
    return telemetryContextStorage.run({ ...parent, ...context }, fn);
}
export function mergeRedTelemetryContext(patch) {
    const store = telemetryContextStorage.getStore();
    if (!store) {
        return;
    }
    Object.assign(store, patch);
}
export function buildTelemetryCustomDimensions(context = getRedTelemetryContext()) {
    const dimensions = {};
    if (context.telemetryClientId && isValidTelemetryUuid(context.telemetryClientId)) {
        dimensions["red.telemetry_client_id"] = context.telemetryClientId;
    }
    if (context.connectionSessionId &&
        isValidTelemetryUuid(context.connectionSessionId)) {
        dimensions["red.connection_session_id"] = context.connectionSessionId;
    }
    if (context.clientPlatform) {
        dimensions["red.client_platform"] = context.clientPlatform;
    }
    if (context.environment) {
        dimensions["red.environment"] = context.environment;
    }
    if (typeof context.connectedCompanyCount === "number" &&
        Number.isFinite(context.connectedCompanyCount)) {
        dimensions["red.connected_company_count"] = String(Math.max(0, Math.floor(context.connectedCompanyCount)));
    }
    if (context.toolName && typeof context.toolName === "string") {
        const toolName = context.toolName.trim();
        if (toolName && !looksSensitiveTelemetryValue(toolName)) {
            dimensions["red.tool_name"] = toolName;
        }
    }
    return dimensions;
}
/** Reject values that look like secrets if somehow passed as tool names / platforms. */
export function looksSensitiveTelemetryValue(value) {
    const lower = value.toLowerCase();
    return (lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("password") ||
        lower.includes("connectionref") ||
        lower.includes("redconn_") ||
        lower.includes("@") ||
        /bearer\s+/i.test(value));
}
export function parseCookieHeader(cookieHeader) {
    if (!cookieHeader) {
        return {};
    }
    const result = {};
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx <= 0)
            continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!name)
            continue;
        try {
            result[name] = decodeURIComponent(value);
        }
        catch {
            result[name] = value;
        }
    }
    return result;
}
export function readTelemetryClientIdFromCookieHeader(cookieHeader) {
    const value = parseCookieHeader(cookieHeader)[TELEMETRY_CLIENT_ID_COOKIE];
    return isValidTelemetryUuid(value) ? value.trim().toLowerCase() : undefined;
}
export function buildTelemetryClientIdSetCookie(clientId, options = {}) {
    const id = normaliseTelemetryClientId(clientId);
    const secure = options.secure !== false;
    const parts = [
        `${TELEMETRY_CLIENT_ID_COOKIE}=${encodeURIComponent(id)}`,
        "Path=/",
        `Max-Age=${TELEMETRY_CLIENT_ID_MAX_AGE_SECONDS}`,
        "SameSite=Lax",
    ];
    if (secure) {
        parts.push("Secure");
    }
    // Not HttpOnly so the connection page can mirror into localStorage when cookies
    // are restricted on later visits; value is an anonymous UUID only.
    return parts.join("; ");
}
/**
 * Inline script for the secure connection page.
 * Prefers an existing first-party cookie, then localStorage, else creates a UUID.
 * localStorage is a fallback when cookies are blocked between visits on the same device.
 */
export function buildTelemetryClientIdPageScript() {
    return `<script>
(function () {
  var COOKIE = ${JSON.stringify(TELEMETRY_CLIENT_ID_COOKIE)};
  var LS = ${JSON.stringify(TELEMETRY_CLIENT_ID_STORAGE_KEY)};
  var FIELD = ${JSON.stringify(TELEMETRY_CLIENT_ID_FORM_FIELD)};
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(";") : [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(name + "=") === 0) {
        try { return decodeURIComponent(p.slice(name.length + 1)); }
        catch (e) { return p.slice(name.length + 1); }
      }
    }
    return null;
  }

  function writeCookie(id) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = COOKIE + "=" + encodeURIComponent(id) +
      "; Path=/; Max-Age=${TELEMETRY_CLIENT_ID_MAX_AGE_SECONDS}; SameSite=Lax" + secure;
  }

  function valid(id) {
    return typeof id === "string" && UUID_RE.test(id);
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  var id = readCookie(COOKIE);
  try {
    if (!valid(id)) id = localStorage.getItem(LS);
  } catch (e) {}
  if (!valid(id)) id = createId();
  id = String(id).toLowerCase();
  writeCookie(id);
  try { localStorage.setItem(LS, id); } catch (e) {}

  function ensureHiddenField(form) {
    if (!form) return;
    var input = form.querySelector('input[name="' + FIELD + '"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = FIELD;
      form.appendChild(input);
    }
    input.value = id;
  }

  document.querySelectorAll("form").forEach(ensureHiddenField);
})();
</script>`;
}
