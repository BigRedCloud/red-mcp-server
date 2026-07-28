import type {
    FreshdeskArticle,
    FreshdeskFolder,
  } from "./types.js";
  
  export class FreshdeskClient {
    private readonly baseUrl: string;
    private readonly authorization: string;
  
    constructor(baseUrl: string, apiKey: string) {
      if (!baseUrl.trim()) {
        throw new Error("Freshdesk base URL is required.");
      }
  
      if (!apiKey.trim()) {
        throw new Error("Freshdesk API key is required.");
      }
  
      this.baseUrl = baseUrl.replace(/\/+$/, "");
  
      const encodedCredentials = Buffer.from(
        `${apiKey}:X`,
        "utf8",
      ).toString("base64");
  
      this.authorization = `Basic ${encodedCredentials}`;
    }
  
    private async getJson<T>(path: string): Promise<T> {
      const response = await fetch(
        `${this.baseUrl}/api/v2${path}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: this.authorization,
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
  
      if (!response.ok) {
        throw new Error(
          `Freshdesk request failed with status ${response.status}.`,
        );
      }
  
      return (await response.json()) as T;
    }
  
    getFolders(categoryId: number): Promise<FreshdeskFolder[]> {
      return this.getJson(
        `/solutions/categories/${categoryId}/folders`,
      );
    }
  
    getArticles(folderId: number): Promise<FreshdeskArticle[]> {
      return this.getJson(
        `/solutions/folders/${folderId}/articles`,
      );
    }
  
    getArticle(articleId: number): Promise<FreshdeskArticle> {
      return this.getJson(
        `/solutions/articles/${articleId}`,
      );
    }
  }