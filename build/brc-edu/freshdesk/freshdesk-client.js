export class FreshdeskClient {
    baseUrl;
    authorization;
    constructor(baseUrl, apiKey) {
        if (!baseUrl.trim()) {
            throw new Error("Freshdesk base URL is required.");
        }
        if (!apiKey.trim()) {
            throw new Error("Freshdesk API key is required.");
        }
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        const encodedCredentials = Buffer.from(`${apiKey}:X`, "utf8").toString("base64");
        this.authorization = `Basic ${encodedCredentials}`;
    }
    async getJson(path) {
        const response = await fetch(`${this.baseUrl}/api/v2${path}`, {
            headers: {
                Accept: "application/json",
                Authorization: this.authorization,
            },
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            throw new Error(`Freshdesk request failed with status ${response.status}.`);
        }
        return (await response.json());
    }
    getFolders(categoryId) {
        return this.getJson(`/solutions/categories/${categoryId}/folders`);
    }
    getArticles(folderId) {
        return this.getJson(`/solutions/folders/${folderId}/articles`);
    }
    getArticle(articleId) {
        return this.getJson(`/solutions/articles/${articleId}`);
    }
}
