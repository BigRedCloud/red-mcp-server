import { URL } from "node:url";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
]);
function isPrivateIpv4(hostname) {
    const parts = hostname.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
        return false;
    }
    if (parts[0] === 10) {
        return true;
    }
    if (parts[0] === 192 && parts[1] === 168) {
        return true;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return true;
    }
    return parts[0] === 127;
}
export function validateApprovedWebUrl(rawUrl, rules) {
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    }
    catch {
        throw new Error("URL is malformed.");
    }
    if (parsed.protocol !== "https:") {
        throw new Error("Only HTTPS URLs are allowed.");
    }
    if (["javascript:", "data:", "file:"].includes(parsed.protocol)) {
        throw new Error("URL protocol is not allowed.");
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIpv4(hostname)) {
        throw new Error("URL host is not allowed.");
    }
    const allowed = rules.some((rule) => hostname === rule.hostname.toLowerCase() &&
        parsed.pathname.startsWith(rule.pathPrefix));
    if (!allowed) {
        throw new Error("URL is outside the approved crawl scope.");
    }
    return parsed;
}
export function normalizeApprovedWebUrl(rawUrl, rules, baseUrl) {
    const resolved = rawUrl.startsWith("http")
        ? rawUrl
        : new URL(rawUrl, baseUrl ?? "https://bigredcloud.com").toString();
    return validateApprovedWebUrl(resolved, rules).toString();
}
export async function safeWebFetchText(rawUrl, rules, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let currentUrl = validateApprovedWebUrl(rawUrl, rules).toString();
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const response = await fetchImpl(currentUrl, {
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                Accept: "text/html,application/xhtml+xml",
                "User-Agent": "BigRedCloudHelpIndexer/1.0",
            },
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) {
                throw new Error("Redirect response did not include a location.");
            }
            currentUrl = normalizeApprovedWebUrl(location, rules, currentUrl);
            continue;
        }
        if (!response.ok) {
            throw new Error(`Page request failed with status ${response.status}.`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
            throw new Error("Response is not HTML.");
        }
        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            throw new Error("Response exceeds the maximum allowed size.");
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
            throw new Error("Response exceeds the maximum allowed size.");
        }
        return {
            url: currentUrl,
            text: Buffer.from(arrayBuffer).toString("utf8"),
        };
    }
    throw new Error("Too many redirects.");
}
export const BIGREDCLOUD_DOCS_RULE = {
    hostname: "bigredcloud.com",
    pathPrefix: "/docs",
};
export const BIGREDCLOUD_WEBINAR_SERIES_RULE = {
    hostname: "bigredcloud.com",
    pathPrefix: "/webinar-series",
};
