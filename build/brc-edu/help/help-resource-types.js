export const HELP_RESOURCE_SOURCES = [
    "freshdesk",
    "customer_docs",
    "recorded_webinar",
    "upcoming_webinar",
];
export function buildHelpResourceId(source, id) {
    return `${source}:${id}`;
}
export function parseHelpResourceId(resourceId) {
    const separator = resourceId.indexOf(":");
    if (separator <= 0) {
        return null;
    }
    const source = resourceId.slice(0, separator);
    const id = resourceId.slice(separator + 1);
    if (!HELP_RESOURCE_SOURCES.includes(source) || !id) {
        return null;
    }
    return { source, id };
}
export function isPublicHttpsUrl(value) {
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== "https:") {
            return false;
        }
        const blockedProtocols = ["javascript:", "data:", "file:"];
        if (blockedProtocols.some((protocol) => value.trim().toLowerCase().startsWith(protocol))) {
            return false;
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === "localhost" ||
            hostname.endsWith(".localhost") ||
            hostname === "127.0.0.1" ||
            hostname.startsWith("192.168.") ||
            hostname.startsWith("10.") ||
            hostname.startsWith("172.16.")) {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
