import { HELP_ROUTING_CATEGORIES, inferHelpRoutingCategory, } from "../../edu/brc_edu_enrichment.js";
/** Canonical topic keys used for Red content overview grouping. */
export const CONTENT_TOPIC_LABELS = {
    sales: "Sales",
    sales_invoices: "Sales Invoices",
    purchases: "Purchases",
    purchase_invoices: "Purchase Invoices",
    cash_book: "Cash Book",
    payments: "Payments",
    bank: "Bank",
    bank_reconciliation: "Bank Reconciliation",
    bank_feeds: "Bank Feeds",
    vat: "VAT",
    year_end: "Year End",
    setup: "Company Setup",
    company_setup: "Company Setup",
    reports: "Reports",
    purchase_importer: "Purchase Importer",
    migration: "Migration",
    red_ai: "Red AI",
    payroll_auto_enrolment: "Payroll / Auto Enrolment",
    support: "Support",
    general_help: "General Help",
    other: "Other",
};
const FOLDER_TOPIC_ALIASES = [
    { pattern: /^sales\s+invoices?\b/i, topic: "sales_invoices" },
    { pattern: /^purchase\s+invoices?\b/i, topic: "purchase_invoices" },
    { pattern: /^cash\s+book\b/i, topic: "cash_book" },
    { pattern: /^payments?\b/i, topic: "payments" },
    { pattern: /^bank\s+rec(onciliation)?\b/i, topic: "bank_reconciliation" },
    { pattern: /^bank\s+feeds?\b/i, topic: "bank_feeds" },
    { pattern: /\bvat\b/i, topic: "vat" },
    { pattern: /^year[- ]?end\b/i, topic: "year_end" },
    { pattern: /^company\s+setup\b/i, topic: "company_setup" },
    { pattern: /^reports?\b/i, topic: "reports" },
    { pattern: /^purchase\s+importer\b/i, topic: "purchase_importer" },
    { pattern: /^sales\b/i, topic: "sales" },
    { pattern: /^purchases?\b/i, topic: "purchases" },
    { pattern: /^bank\b/i, topic: "bank" },
    { pattern: /^setup\b/i, topic: "setup" },
    { pattern: /^support\b/i, topic: "support" },
    { pattern: /^general\b/i, topic: "general_help" },
];
const KNOWN_ROUTING = new Set(HELP_ROUTING_CATEGORIES);
function normalizeTopicKey(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}
function humanizeTopicKey(topic) {
    return topic
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
export function topicLabel(topic) {
    const key = normalizeTopicKey(topic);
    if (!key) {
        return CONTENT_TOPIC_LABELS.other;
    }
    return CONTENT_TOPIC_LABELS[key] ?? humanizeTopicKey(key);
}
function mapFolderToTopic(folderName) {
    const trimmed = folderName.trim();
    if (!trimmed) {
        return null;
    }
    for (const alias of FOLDER_TOPIC_ALIASES) {
        if (alias.pattern.test(trimmed)) {
            return alias.topic;
        }
    }
    return null;
}
/**
 * Resolves a shared content topic for overview grouping.
 * Preference: explicit help-routing category → Freshdesk folder aliases →
 * title/folder inference → general_help / other.
 */
export function resolveContentTopic(input) {
    const preferred = input.helpRoutingCategory?.trim();
    if (preferred) {
        const key = normalizeTopicKey(preferred);
        if (CONTENT_TOPIC_LABELS[key] || KNOWN_ROUTING.has(key)) {
            return { topic: key, label: topicLabel(key) };
        }
        if (key) {
            return { topic: key, label: topicLabel(key) };
        }
    }
    const folderMapped = input.folderName
        ? mapFolderToTopic(input.folderName)
        : null;
    if (folderMapped) {
        return { topic: folderMapped, label: topicLabel(folderMapped) };
    }
    const inferred = inferHelpRoutingCategory(input.title ?? "", input.folderName);
    const inferredKey = normalizeTopicKey(inferred.category);
    if (inferred.confidence !== "low" && inferredKey) {
        return { topic: inferredKey, label: topicLabel(inferredKey) };
    }
    if (input.folderName?.trim()) {
        const folderKey = normalizeTopicKey(input.folderName);
        if (folderKey && folderKey !== "general" && folderKey !== "general_help") {
            return {
                topic: folderKey,
                label: topicLabel(folderKey),
            };
        }
    }
    if (inferredKey === "general_help" || !inferredKey) {
        return {
            topic: "general_help",
            label: topicLabel("general_help"),
        };
    }
    return { topic: inferredKey, label: topicLabel(inferredKey) };
}
/** Sort topics alphabetically, with general_help and other last. */
export function compareContentTopics(left, right) {
    const rank = (topic) => {
        const key = normalizeTopicKey(topic);
        if (key === "general_help")
            return 1;
        if (key === "other")
            return 2;
        return 0;
    };
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) {
        return rankDiff;
    }
    return topicLabel(left).localeCompare(topicLabel(right), undefined, {
        sensitivity: "base",
    });
}
export function compareOverviewItemsByDateThenTitle(left, right) {
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.NaN;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.NaN;
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (leftValid && rightValid && leftTime !== rightTime) {
        return rightTime - leftTime;
    }
    if (leftValid && !rightValid) {
        return -1;
    }
    if (!leftValid && rightValid) {
        return 1;
    }
    return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
    });
}
