import { extractFreshdeskImages } from "./image-extractor.js";
export function normalizeFreshdeskArticle(article, folderName) {
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
    };
}
