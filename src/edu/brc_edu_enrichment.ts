import { parse } from "csv-parse/sync";

export const SUPPORT_EDU_SOURCE_FILE = "webinar_video_routing_index.csv";

export const ENRICHED_EDU_CSV_COLUMNS = [
  "title",
  "url",
  "helpRoutingCategory",
  "keywords",
  "description",
  "isActive",
  "contentType",
  "source",
  "lastReviewed",
  "generatedFrom",
  "needsReview",
] as const;

export const HELP_ROUTING_CATEGORIES = [
  "setup",
  "sales",
  "purchases",
  "bank",
  "bank_feeds",
  "purchase_importer",
  "year_end",
  "migration",
  "red_ai",
  "payroll_auto_enrolment",
  "support",
  "general_help",
] as const;

export type HelpRoutingCategory = (typeof HELP_ROUTING_CATEGORIES)[number];

export type SupportEduRow = {
  title: string;
  url: string;
  notes?: string;
  preferredCategory?: string;
  active: boolean;
};

export type EnrichedEduResource = {
  title: string;
  url: string;
  helpRoutingCategory: HelpRoutingCategory | string;
  keywords: string;
  description: string;
  isActive: boolean;
  contentType: "video" | "webinar" | "support";
  source: string;
  lastReviewed: string;
  generatedFrom: string;
  needsReview: boolean;
  notes?: string;
};

type CategoryInference = {
  category: HelpRoutingCategory | string;
  confidence: "high" | "medium" | "low";
};

type CategoryRule = {
  category: HelpRoutingCategory;
  patterns: RegExp[];
  confidence: "high" | "medium";
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "purchase_importer",
    patterns: [/purchase importer/i, /\bimporter\b/i],
    confidence: "high",
  },
  {
    category: "bank_feeds",
    patterns: [/bank feeds/i, /open banking/i],
    confidence: "high",
  },
  {
    category: "year_end",
    patterns: [/year[- ]?end/i, /close books/i],
    confidence: "high",
  },
  {
    category: "payroll_auto_enrolment",
    patterns: [/payroll/i, /auto enrolment/i, /pension/i],
    confidence: "medium",
  },
  {
    category: "migration",
    patterns: [/migrate/i, /migration/i, /big red book/i],
    confidence: "medium",
  },
  {
    category: "red_ai",
    patterns: [/\bred\b/i, /\bai\b/i, /artificial intelligence/i],
    confidence: "medium",
  },
  {
    category: "setup",
    patterns: [/setup/i, /getting started/i, /company setup/i],
    confidence: "medium",
  },
  {
    category: "purchases",
    patterns: [/purchase/i, /payment/i, /supplier/i],
    confidence: "medium",
  },
  {
    category: "sales",
    patterns: [/sales/i, /invoice/i, /quote/i, /cash book/i, /bank rec/i],
    confidence: "medium",
  },
  {
    category: "bank",
    patterns: [/\bbank\b/i, /reconciliation/i],
    confidence: "medium",
  },
  {
    category: "support",
    patterns: [/support/i, /\bhelp\b/i, /contact/i],
    confidence: "medium",
  },
];

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function isBlankRow(record: Record<string, unknown>): boolean {
  return Object.values(record).every((value) => asTrimmedString(value) === "");
}

function parseActive(value: unknown): boolean {
  if (value == null || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["false", "no", "0", "inactive", "n"].includes(normalized)) {
    return false;
  }
  return true;
}

function normalizeCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

function normalizeHeaderKey(key: string): string {
  return key
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

const SUPPORT_FIELD_ALIASES = {
  title: ["video_title", "title"],
  url: ["video_url", "url"],
  notes: ["notes", "note"],
  preferredCategory: [
    "help_routing_category",
    "preferred_category",
    "preferredcategory",
    "helproutingcategory",
  ],
  active: ["active", "is_active"],
} as const;

export function normalizeSupportCsvRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(record)) {
    const normalizedKey = normalizeHeaderKey(rawKey);
    for (const [canonical, aliases] of Object.entries(SUPPORT_FIELD_ALIASES)) {
      if ((aliases as readonly string[]).includes(normalizedKey)) {
        if (asTrimmedString(normalized[canonical]) === "") {
          normalized[canonical] = value;
        }
        break;
      }
    }
  }

  return normalized;
}

function readCanonicalField(
  record: Record<string, unknown>,
  field: keyof typeof SUPPORT_FIELD_ALIASES,
): string {
  return asTrimmedString(record[field]);
}

export function normaliseSupportEduRows(rows: unknown[]): SupportEduRow[] {
  const normalised: SupportEduRow[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = normalizeSupportCsvRecord(row as Record<string, unknown>);
    if (isBlankRow(record)) {
      continue;
    }

    const title = readCanonicalField(record, "title");
    const url = readCanonicalField(record, "url");
    if (!title || !url) {
      continue;
    }

    const notes = readCanonicalField(record, "notes") || undefined;
    const preferredCategory = readCanonicalField(record, "preferredCategory") || undefined;
    const active = parseActive(record.active);

    normalised.push({
      title,
      url,
      notes,
      preferredCategory,
      active,
    });
  }

  return normalised;
}

export function inferHelpRoutingCategory(
  title: string,
  notes?: string,
  preferredCategory?: string,
): CategoryInference {
  if (preferredCategory?.trim()) {
    return {
      category: normalizeCategory(preferredCategory),
      confidence: "high",
    };
  }

  const haystack = `${title} ${notes ?? ""}`.trim();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return {
        category: rule.category,
        confidence: rule.confidence,
      };
    }
  }

  return {
    category: "general_help",
    confidence: "low",
  };
}

function uniqueKeywords(parts: string[]): string {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of parts) {
    for (const token of part.split(/[^a-zA-Z0-9]+/)) {
      const keyword = token.trim().toLowerCase();
      if (keyword.length < 2 || seen.has(keyword)) {
        continue;
      }
      seen.add(keyword);
      keywords.push(keyword);
    }
  }
  return keywords.join(", ");
}

export function buildKeywords(title: string, category: string, notes?: string): string {
  return uniqueKeywords([title, category.replace(/_/g, " "), notes ?? ""]);
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  setup: "company setup and getting started",
  sales: "sales, invoicing, and cash book workflows",
  sales_cash_bank_rec: "sales, cash book, and bank reconciliation",
  purchases: "purchases, payments, and suppliers",
  purchases_payments: "purchases and payments",
  bank: "bank accounts and reconciliation",
  bank_feeds: "bank feeds and open banking",
  purchase_importer: "purchase importer workflows",
  year_end: "year-end and closing the books",
  migration: "migration from other systems",
  red_ai: "RED AI features",
  payroll_auto_enrolment: "payroll and auto-enrolment",
  trial_onboarding: "trial onboarding",
  support: "support and contact options",
  general_help: "general Big Red Cloud help",
};

export function buildDescription(title: string, category: string, notes?: string): string {
  const topic = CATEGORY_DESCRIPTIONS[category] ?? "Big Red Cloud help";
  const base = `Video resource about ${topic}: ${title}.`;
  if (notes?.trim()) {
    return `${base} ${notes.trim()}`;
  }
  return base;
}

function resolveContentType(
  title: string,
  notes: string | undefined,
  category: string,
): EnrichedEduResource["contentType"] {
  const haystack = `${title} ${notes ?? ""}`.toLowerCase();
  if (category === "support") {
    return "support";
  }
  if (haystack.includes("webinar")) {
    return "webinar";
  }
  return "video";
}

function formatReviewDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function enrichSupportEduRows(
  rows: SupportEduRow[],
  options?: { reviewDate?: Date; generatedFrom?: string },
): EnrichedEduResource[] {
  const reviewDate = options?.reviewDate ?? new Date();
  const generatedFrom = options?.generatedFrom ?? SUPPORT_EDU_SOURCE_FILE;

  return rows.map((row) => {
    const inference = inferHelpRoutingCategory(row.title, row.notes, row.preferredCategory);
    const helpRoutingCategory = inference.category;
    const needsReview = inference.confidence === "low";

    return {
      title: row.title,
      url: row.url,
      helpRoutingCategory,
      keywords: buildKeywords(row.title, helpRoutingCategory, row.notes),
      description: buildDescription(row.title, helpRoutingCategory, row.notes),
      isActive: row.active,
      contentType: resolveContentType(row.title, row.notes, helpRoutingCategory),
      source: "Big Red Cloud",
      lastReviewed: formatReviewDate(reviewDate),
      generatedFrom,
      needsReview,
    };
  });
}

function escapeCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toEnrichedCsvRecord(row: EnrichedEduResource): Record<string, string | boolean> {
  return {
    title: row.title,
    url: row.url,
    helpRoutingCategory: row.helpRoutingCategory,
    keywords: row.keywords,
    description: row.description,
    isActive: row.isActive,
    contentType: row.contentType,
    source: row.source,
    lastReviewed: row.lastReviewed,
    generatedFrom: row.generatedFrom,
    needsReview: row.needsReview,
  };
}

export function parseSupportEduCsv(csvText: string): unknown[] {
  const withoutBom = csvText.replace(/^\uFEFF/, "");
  return parse(withoutBom, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as unknown[];
}

export function formatEnrichedEduCsv(rows: EnrichedEduResource[]): string {
  const header = ENRICHED_EDU_CSV_COLUMNS.join(",");
  const body = rows.map((row) =>
    ENRICHED_EDU_CSV_COLUMNS.map((column) =>
      escapeCsvValue(toEnrichedCsvRecord(row)[column]),
    ).join(","),
  );
  return [header, ...body].join("\n") + (body.length > 0 ? "\n" : "");
}
