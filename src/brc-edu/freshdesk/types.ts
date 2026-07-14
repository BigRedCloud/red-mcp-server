export type FreshdeskFolder = {
    id: number;
    name: string;
    description: string | null;
    articles_count: number;
    created_at: string;
    updated_at: string;
    visibility: number;
  };
  
  export type FreshdeskArticle = {
    id: number;
    type: number;
    status: number;
    category_id: number;
    folder_id: number;
    title: string;
    created_at: string;
    updated_at: string;
    description: string;
    description_text: string;
  };
  
  export type FreshdeskImageReference = {
    sourceUrl: string;
    altText: string | null;
  };
  
  export type NormalizedFreshdeskArticle = {
    id: string;
    source: "freshdesk";
    freshdeskArticleId: number;
    categoryId: number;
    folderId: number;
    folderName: string;
    title: string;
    bodyText: string;
    images: FreshdeskImageReference[];
    updatedAt: string;
    enabled: boolean;
  };