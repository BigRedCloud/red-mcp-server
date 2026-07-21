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
    /** Public article URL when returned by the Freshdesk API. */
    url?: string;
    /** Article path or slug segment when returned by the Freshdesk API. */
    path?: string;
    /** Article slug when returned by the Freshdesk API. */
    slug?: string;
  };
  
  export type FreshdeskImageReference = {
    sourceUrl: string;
    altText: string | null;
  };

  /**
   * Ordered article content preserved from Freshdesk HTML DOM order.
   * Internal matching fields (workflow, nearbyActions, sourceUrl) must never
   * be returned to customers.
   */
  export type FreshdeskArticleContentBlock =
    | {
        type: "text";
        text: string;
        /** @deprecated Prefer sectionHeading — retained for legacy indexes. */
        heading?: string;
        sectionHeading?: string;
        /** Internal workflow classification — never expose publicly. */
        workflow?: string;
        /** Internal UI action labels for matching — never expose publicly. */
        nearbyActions?: string[];
      }
    | {
        type: "image";
        imageIndex: number;
        /** Internal only — used to match syncedImages; never return to clients. */
        sourceUrl?: string;
        altText?: string;
        /** @deprecated Prefer sectionHeading — retained for legacy indexes. */
        nearbyHeading?: string;
        sectionHeading?: string;
        /** Internal workflow classification — never expose publicly. */
        workflow?: string;
        precedingText?: string;
        followingText?: string;
        /** Internal UI action labels for matching — never expose publicly. */
        nearbyActions?: string[];
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
    /**
     * Ordered text/image blocks from article HTML. Optional for legacy indexes
     * that were synced before content-block support.
     */
    contentBlocks?: FreshdeskArticleContentBlock[];
    updatedAt: string;
    enabled: boolean;
    slug: string | null;
    publicUrl: string | null;
  };
