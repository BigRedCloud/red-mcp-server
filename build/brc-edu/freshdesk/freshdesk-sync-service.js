import { normalizeFreshdeskArticle } from "./article-normalizer.js";
import { syncFreshdeskImages, } from "./image-sync.js";
export const FRESHDESK_SYNC_CATEGORY_ID = 157000561739;
export const FRESHDESK_EXCLUDED_FOLDER_IDS = new Set([
    157000940354,
    157000941102,
]);
const SECRET_ERROR_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /Authorization:\s*Basic/i,
    /Basic [A-Za-z0-9+/=]{8,}/,
];
export function toSafeSyncErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const pattern of SECRET_ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return "Freshdesk article sync failed.";
        }
    }
    return message;
}
function isIncludedFolder(folder) {
    return (folder.visibility === 1 &&
        !FRESHDESK_EXCLUDED_FOLDER_IDS.has(folder.id));
}
function isPublishedArticle(article) {
    return article.status === 2;
}
export async function syncFreshdeskKnowledgeBase(client, container, options = {}) {
    const syncImages = options.syncImages ?? syncFreshdeskImages;
    const articles = [];
    const failures = [];
    const folders = await client.getFolders(FRESHDESK_SYNC_CATEGORY_ID);
    const includedFolders = folders.filter(isIncludedFolder);
    for (const folder of includedFolders) {
        const folderArticles = await client.getArticles(folder.id);
        const publishedSummaries = folderArticles.filter(isPublishedArticle);
        for (const summary of publishedSummaries) {
            try {
                const fullArticle = await client.getArticle(summary.id);
                if (!isPublishedArticle(fullArticle)) {
                    continue;
                }
                const normalized = normalizeFreshdeskArticle(fullArticle, folder.name);
                const syncedImages = await syncImages(fullArticle.id, normalized.images, container);
                articles.push({
                    ...normalized,
                    syncedImages,
                });
            }
            catch (error) {
                failures.push({
                    freshdeskArticleId: summary.id,
                    folderId: folder.id,
                    message: toSafeSyncErrorMessage(error),
                });
            }
        }
    }
    return { articles, failures };
}
