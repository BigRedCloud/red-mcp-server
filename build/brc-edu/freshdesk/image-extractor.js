import * as cheerio from "cheerio";
export function extractFreshdeskImages(html) {
    const $ = cheerio.load(html);
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
