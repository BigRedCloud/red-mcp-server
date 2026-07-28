const PRIVATE_IPV4_PATTERN = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
function envList(name) {
    return (process.env[name] ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}
export function isStrictRedPublicBaseUrlMode() {
    const deploymentEnv = process.env.BRC_DEPLOYMENT_ENV?.trim().toLowerCase();
    if (deploymentEnv === "staging" || deploymentEnv === "production") {
        return true;
    }
    return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}
function isPrivateOrLocalHostname(hostname) {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) {
        return true;
    }
    if (normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized === "::1" ||
        normalized === "[::1]") {
        return true;
    }
    if (PRIVATE_IPV4_PATTERN.test(normalized)) {
        return true;
    }
    return false;
}
export function validateCustomerFacingPublicBaseUrl(baseUrl, options = {}) {
    const trimmed = baseUrl.trim().replace(/\/$/, "");
    if (!trimmed) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return null;
    }
    const strict = options.strict ?? isStrictRedPublicBaseUrlMode();
    if (strict) {
        if (parsed.protocol !== "https:") {
            return null;
        }
        if (isPrivateOrLocalHostname(parsed.hostname)) {
            return null;
        }
        const allowedHosts = envList("RED_PUBLIC_ALLOWED_HOSTS");
        if (allowedHosts.length > 0 &&
            !allowedHosts.includes(parsed.hostname.toLowerCase())) {
            return null;
        }
    }
    return trimmed;
}
/**
 * Customer-facing Red base URL for public help assets such as Freshdesk screenshots.
 * Prefers RED_PUBLIC_BASE_URL, then BRC_PUBLIC_BASE_URL, then localhost for local dev.
 */
export function getRedPublicBaseUrl() {
    const fromRed = process.env.RED_PUBLIC_BASE_URL?.trim();
    if (fromRed) {
        const validated = validateCustomerFacingPublicBaseUrl(fromRed);
        if (validated) {
            return validated;
        }
    }
    const fromBrc = process.env.BRC_PUBLIC_BASE_URL?.trim();
    if (fromBrc) {
        const validated = validateCustomerFacingPublicBaseUrl(fromBrc);
        if (validated) {
            return validated;
        }
    }
    const port = process.env.PORT ?? "3000";
    return `http://localhost:${port}`;
}
export function getCustomerFacingScreenshotBaseUrl() {
    const baseUrl = getRedPublicBaseUrl();
    const validated = validateCustomerFacingPublicBaseUrl(baseUrl, {
        strict: isStrictRedPublicBaseUrlMode(),
    });
    if (validated) {
        return validated;
    }
    if (!isStrictRedPublicBaseUrlMode()) {
        return baseUrl.replace(/\/$/, "");
    }
    return null;
}
