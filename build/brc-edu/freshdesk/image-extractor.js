import * as cheerio from "cheerio";
import { parseFreshdeskArticleContent } from "./article-content-parser.js";
/**
 * Extract HTTPS image references from Freshdesk article HTML.
 * Preserves first-seen DOM order and dedupes by sourceUrl (last alt wins).
 */
export function extractFreshdeskImages(html) {
    const parsed = parseFreshdeskArticleContent(html);
    if (parsed.images.length > 0) {
        return parsed.images;
    }
    // Fallback for edge cases where the ordered parser finds nothing but raw
    // imgs exist (e.g. images outside recognised block tags).
    const $ = cheerio.load(html || "");
    const images = new Map();
    $("img[src]").each((_index, element) => {
        const sourceUrl = $(element).attr("src")?.trim();
        if (!sourceUrl) {
            return;
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(sourceUrl);
        }
        catch {
            return;
        }
        if (parsedUrl.protocol !== "https:") {
            return;
        }
        const altText = $(element).attr("alt")?.trim() || null;
        images.set(sourceUrl, {
            sourceUrl,
            altText,
        });
    });
    return [...images.values()];
}
