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
];
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
];
const CATEGORY_RULES = [
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
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function isBlankRow(record) {
    return Object.values(record).every((value) => asTrimmedString(value) === "");
}
function parseActive(value) {
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
function normalizeCategory(value) {
    return value.trim().toLowerCase().replace(/\s+/g, "_");
}
function pickField(record, names) {
    for (const name of names) {
        const direct = asTrimmedString(record[name]);
        if (direct) {
            return direct;
        }
        const match = Object.entries(record).find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
        if (match) {
            const value = asTrimmedString(match[1]);
            if (value) {
                return value;
            }
        }
    }
    return "";
}
export function normaliseSupportEduRows(rows) {
    const normalised = [];
    for (const row of rows) {
        if (!row || typeof row !== "object") {
            continue;
        }
        const record = row;
        if (isBlankRow(record)) {
            continue;
        }
        const title = pickField(record, ["title", "Title"]);
        const url = pickField(record, ["url", "URL", "Url"]);
        if (!title || !url) {
            continue;
        }
        const notes = pickField(record, ["notes", "Notes"]) || undefined;
        const preferredCategory = pickField(record, ["preferredCategory", "preferred_category", "PreferredCategory"]) ||
            undefined;
        const active = parseActive(record.active ?? record.Active ?? record.isActive);
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
export function inferHelpRoutingCategory(title, notes, preferredCategory) {
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
function uniqueKeywords(parts) {
    const seen = new Set();
    const keywords = [];
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
export function buildKeywords(title, category, notes) {
    return uniqueKeywords([title, category.replace(/_/g, " "), notes ?? ""]);
}
const CATEGORY_DESCRIPTIONS = {
    setup: "company setup and getting started",
    sales: "sales, invoicing, and cash book workflows",
    purchases: "purchases, payments, and suppliers",
    bank: "bank accounts and reconciliation",
    bank_feeds: "bank feeds and open banking",
    purchase_importer: "purchase importer workflows",
    year_end: "year-end and closing the books",
    migration: "migration from other systems",
    red_ai: "RED AI features",
    payroll_auto_enrolment: "payroll and auto-enrolment",
    support: "support and contact options",
    general_help: "general Big Red Cloud help",
};
export function buildDescription(title, category, notes) {
    const topic = CATEGORY_DESCRIPTIONS[category] ?? "Big Red Cloud help";
    const base = `Video resource about ${topic}: ${title}.`;
    if (notes?.trim()) {
        return `${base} ${notes.trim()}`;
    }
    return base;
}
function resolveContentType(title, notes, category) {
    const haystack = `${title} ${notes ?? ""}`.toLowerCase();
    if (category === "support") {
        return "support";
    }
    if (haystack.includes("webinar")) {
        return "webinar";
    }
    return "video";
}
function formatReviewDate(date) {
    return date.toISOString().slice(0, 10);
}
export function enrichSupportEduRows(rows, options) {
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
function escapeCsvValue(value) {
    const text = value == null ? "" : String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}
export function toEnrichedCsvRecord(row) {
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
export function parseSupportEduCsv(csvText) {
    return parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });
}
export function formatEnrichedEduCsv(rows) {
    const header = ENRICHED_EDU_CSV_COLUMNS.join(",");
    const body = rows.map((row) => ENRICHED_EDU_CSV_COLUMNS.map((column) => escapeCsvValue(toEnrichedCsvRecord(row)[column])).join(","));
    return [header, ...body].join("\n") + (body.length > 0 ? "\n" : "");
}
