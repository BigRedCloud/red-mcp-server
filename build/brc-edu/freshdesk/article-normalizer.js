import { readFreshdeskArticleUrlFields, resolveFreshdeskArticlePublicUrl, } from "./freshdesk-article-url.js";
import { extractFreshdeskImages } from "./image-extractor.js";
export function normalizeFreshdeskArticle(article, folderName) {
    const { apiUrl, apiPath, apiSlug } = readFreshdeskArticleUrlFields(article);
    const publicUrl = resolveFreshdeskArticlePublicUrl({
        freshdeskArticleId: article.id,
        apiUrl,
        apiPath,
        apiSlug,
    });
    return {
        id: `freshdesk-${article.id}`,
        source: "freshdesk",
        freshdeskArticleId: article.id,
        categoryId: article.category_id,
        folderId: article.folder_id,
        folderName,
        title: article.title.trim(),
        bodyText: article.description_text
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        images: extractFreshdeskImages(article.description),
        updatedAt: article.updated_at,
        enabled: article.status === 2,
        slug: apiSlug,
        publicUrl,
    };
}
