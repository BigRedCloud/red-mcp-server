import { normaliseHelpSearchText } from "../freshdesk/freshdesk-help-search.js";

/**
 * Deterministic procedural query expansion for BRC help search.
 * Expands common user wording into Freshdesk-friendly phrases and strips
 * product-name noise that otherwise matches unrelated "Big Red Cloud" articles.
 */

const PRODUCT_NOISE_PATTERN =
  /\b(?:in\s+)?(?:the\s+)?(?:brc|big\s+red\s+cloud)(?:\s+(?:software|application|website|ui|system))?\b/gi;

const PROCEDURAL_PREFIX_PATTERN =
  /^(?:how\s+(?:do\s+i|to|can\s+i|do\s+you|does\s+one)|show\s+me\s+how(?:\s+to)?|where\s+do\s+i|can\s+you\s+show\s+me\s+how(?:\s+to)?)\s+/i;

export type HelpProceduralIntent =
  | "add_customer"
  | "add_supplier"
  | "bank_reconciliation"
  | "opening_balance"
  | "create_sales_invoice"
  | null;

type ExpansionRule = {
  intent: Exclude<HelpProceduralIntent, null>;
  match: RegExp;
  expansions: string[];
  /** Canonical title fragments used for strong Freshdesk title boosting. */
  titleHints: string[];
};

const EXPANSION_RULES: ExpansionRule[] = [
  {
    intent: "add_customer",
    match:
      /\b(?:add|create|set\s*up|setup|new)\b.{0,40}\bcustomers?\b|\bcustomers?\b.{0,40}\b(?:add|create|set\s*up|setup|new|record)\b/i,
    expansions: [
      "How do I add a Customer",
      "add customer",
      "create customer",
      "new customer",
      "customer setup",
      "add customer record",
    ],
    titleHints: ["add a customer", "add customer"],
  },
  {
    intent: "add_supplier",
    match:
      /\b(?:add|create|set\s*up|setup|new)\b.{0,40}\bsuppliers?\b|\bsuppliers?\b.{0,40}\b(?:add|create|set\s*up|setup|new|record)\b/i,
    expansions: [
      "How do I add a Supplier",
      "add supplier",
      "create supplier",
      "new supplier",
      "supplier setup",
      "add supplier record",
    ],
    titleHints: ["add a supplier", "add supplier"],
  },
  {
    intent: "bank_reconciliation",
    match:
      /\b(?:bank\s+rec(?:onciliation)?|reconcil(?:e|ing|iation)\b.{0,30}\bbank|match\s+bank\s+transactions|reconcile\s+(?:my\s+)?(?:bank|statement))\b/i,
    expansions: [
      "bank reconciliation",
      "bank rec",
      "reconcile bank account",
      "Bank Reconciliation",
      "How do I do the Bank Reconciliation",
      "reconcile bank",
      "reconcile statement",
    ],
    titleHints: ["bank reconciliation", "bank rec"],
  },
  {
    intent: "opening_balance",
    match:
      /\b(?:opening\s+balance|aged\s+balance|outstanding\s+(?:customer\s+)?balance|customer\s+owes\s+us\s+money|supplier\s+opening\s+balance|amount\s+already\s+owed)\b/i,
    expansions: [
      "customer opening balance",
      "supplier opening balance",
      "opening balance",
      "aged balance",
      "outstanding customer balance",
    ],
    titleHints: ["opening balance"],
  },
  {
    intent: "create_sales_invoice",
    match:
      /\b(?:create|raise|prepare|add)\b.{0,40}\b(?:sales\s+)?invoices?\b|\b(?:sales\s+)?invoices?\b.{0,40}\b(?:create|raise|prepare|add)\b/i,
    expansions: [
      "create sales invoice",
      "sales invoice",
      "How do I create a sales invoice",
      "raise invoice",
    ],
    titleHints: ["sales invoice", "create a sales invoice"],
  },
];

/** Titles that are usually noise for procedural how-to answers. */
const IRRELEVANT_PROCEDURAL_TITLE_PATTERN =
  /\b(log\s*in|login|api\s*key|password|user(?:s|name)?|permission|webinar|backup|restore|reset\s+password)\b/i;

export function stripHelpProductNoise(question: string): string {
  return question
    .replace(PRODUCT_NOISE_PATTERN, " ")
    .replace(/\s+([?!,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHelpProceduralPrefix(question: string): string {
  return question.replace(PROCEDURAL_PREFIX_PATTERN, "").trim();
}

export function detectHelpProceduralIntent(
  question: string,
): HelpProceduralIntent {
  const cleaned = stripHelpProductNoise(question);
  for (const rule of EXPANSION_RULES) {
    if (rule.match.test(cleaned) || rule.match.test(question)) {
      return rule.intent;
    }
  }
  return null;
}

/**
 * Build the original question plus a small deterministic list of expanded phrases.
 * Always includes a product-noise-stripped variant of the original.
 */
export function expandHelpSearchQueries(question: string): string[] {
  const trimmed = question.trim();
  if (!trimmed) {
    return [];
  }

  const seen = new Set<string>();
  const queries: string[] = [];

  const push = (value: string) => {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return;
    }
    const key = normaliseHelpSearchText(cleaned);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queries.push(cleaned);
  };

  push(trimmed);

  const withoutProduct = stripHelpProductNoise(trimmed);
  push(withoutProduct);
  push(stripHelpProceduralPrefix(withoutProduct));

  const intent = detectHelpProceduralIntent(trimmed);
  if (intent) {
    const rule = EXPANSION_RULES.find((entry) => entry.intent === intent);
    for (const expansion of rule?.expansions ?? []) {
      push(expansion);
    }
  }

  return queries;
}

export function getProceduralTitleHints(question: string): string[] {
  const intent = detectHelpProceduralIntent(question);
  if (!intent) {
    return [];
  }
  return (
    EXPANSION_RULES.find((rule) => rule.intent === intent)?.titleHints ?? []
  );
}

export function isIrrelevantProceduralTitle(
  title: string,
  intent: HelpProceduralIntent,
): boolean {
  if (!intent) {
    return false;
  }
  return IRRELEVANT_PROCEDURAL_TITLE_PATTERN.test(title);
}

/**
 * Strong boost when a Freshdesk title matches the procedural entity + action.
 */
export function scoreProceduralTitleMatch(
  question: string,
  title: string,
): number {
  const intent = detectHelpProceduralIntent(question);
  if (!intent) {
    return 0;
  }

  if (isIrrelevantProceduralTitle(title, intent)) {
    return -400;
  }

  const titleNorm = normaliseHelpSearchText(title);
  const hints = getProceduralTitleHints(question);
  let best = 0;

  for (const hint of hints) {
    const hintNorm = normaliseHelpSearchText(hint);
    if (!hintNorm) {
      continue;
    }
    if (titleNorm === hintNorm || titleNorm === `how do i ${hintNorm}?`) {
      best = Math.max(best, 900);
      continue;
    }
    if (titleNorm.includes(hintNorm)) {
      // Prefer exact procedural titles over longer variants (e.g. opening balance).
      const extra = titleNorm.replace(hintNorm, "").replace(/how do i|\?/g, "").trim();
      if (!extra) {
        best = Math.max(best, 850);
      } else if (intent === "opening_balance" || extra.includes("opening")) {
        best = Math.max(best, intent === "opening_balance" ? 820 : 200);
      } else {
        best = Math.max(best, 700);
      }
    }
  }

  return best;
}
