function normalizeText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Internal workflow tags derived from article HTML context.
 * Not customer-facing — used only for screenshot branch selection.
 */
export type FreshdeskWorkflowTag =
  | "add_customer"
  | "existing_customer"
  | "customer_opening_balance"
  | "manual_allocations"
  | "non_manual_allocations"
  | "final_save"
  | "email_preferences"
  | "bank_reconciliation"
  | "generic";

/** Known UI action / concept phrases extracted from article text (case-preserved). */
const KNOWN_UI_ACTIONS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bo\/\s*balance\b/i, label: "O/Balance" },
  { pattern: /\bemail\s+preferences\b/i, label: "Email Preferences" },
  { pattern: /\bmanual\s+allocations?\b/i, label: "Manual Allocations" },
  { pattern: /\bbank\s+reconciliation\b/i, label: "Bank Reconciliation" },
  { pattern: /\b3\s+months?\s+plus\b/i, label: "3 Months Plus" },
  { pattern: /\b1\s+month\b/i, label: "1 Month" },
  { pattern: /\b2\s+months?\b/i, label: "2 Months" },
  { pattern: /\bcustomers?\b/i, label: "Customers" },
  { pattern: /\bchange\b/i, label: "Change" },
  { pattern: /\badd\b/i, label: "Add" },
  { pattern: /\bsave\b/i, label: "Save" },
  { pattern: /\bok\b/i, label: "OK" },
  { pattern: /\blookup\b/i, label: "Lookup" },
  { pattern: /\bsetup\b/i, label: "Setup" },
  { pattern: /\bopening\s+balance\b/i, label: "Opening Balance" },
  { pattern: /\ba\/c\s*code\b/i, label: "A/C Code" },
  { pattern: /\bstatement\s+balance\b/i, label: "Statement Balance" },
];

const CLICK_TARGET_PATTERN =
  /\b(?:click|open|press|tap)\s+["']?([A-Za-z0-9][A-Za-z0-9 /&-]{0,40}?)["']?(?=\s*(?:[.!?,;]|on\s+the\b|then\b|and\b|$))/gi;

const MUTUALLY_EXCLUSIVE_PAIRS: Array<[FreshdeskWorkflowTag, FreshdeskWorkflowTag]> =
  [
    ["add_customer", "existing_customer"],
    ["manual_allocations", "non_manual_allocations"],
  ];

export function extractNearbyActions(...texts: Array<string | null | undefined>): string[] {
  const joined = texts
    .map((text) => normalizeText(text ?? ""))
    .filter(Boolean)
    .join(" ");

  if (!joined) {
    return [];
  }

  const found = new Map<string, string>();

  for (const entry of KNOWN_UI_ACTIONS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(joined) && !found.has(entry.label.toLowerCase())) {
      found.set(entry.label.toLowerCase(), entry.label);
    }
  }

  CLICK_TARGET_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLICK_TARGET_PATTERN.exec(joined)) !== null) {
    const raw = (match[1] ?? "").replace(/[.,;:]+$/, "").trim();
    if (!raw || /^here$/i.test(raw) || raw.length < 2) {
      continue;
    }
    const key = raw.toLowerCase();
    if (!found.has(key)) {
      found.set(key, raw);
    }
  }

  // Only treat "Current" as an ageing-bucket label when month buckets are nearby.
  if (
    /\bcurrent\b/i.test(joined) &&
    /\b(1\s+month|2\s+months?|3\s+months?\s+plus|age(?:d|ing)?)\b/i.test(joined)
  ) {
    found.set("current", "Current");
  }

  return [...found.values()];
}

/**
 * Classify a content fragment into one or more workflow tags using only
 * nearby article text — never article IDs or hard-coded sequences.
 */
export function classifyFreshdeskWorkflows(
  ...texts: Array<string | null | undefined>
): FreshdeskWorkflowTag[] {
  const joined = texts
    .map((text) => normalizeText(text ?? ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!joined) {
    return ["generic"];
  }

  const tags = new Set<FreshdeskWorkflowTag>();

  if (
    /\bemail\s+preferences\b/.test(joined) ||
    /\bemail\s+settings\b/.test(joined)
  ) {
    tags.add("email_preferences");
  }

  if (
    /\bbank\s+reconciliation\b/.test(joined) ||
    /\breconcile\b/.test(joined) ||
    /\bstatement\s+balance\b/.test(joined)
  ) {
    tags.add("bank_reconciliation");
  }

  if (
    /\bmanual\s+allocations?\b/.test(joined) &&
    !/\b(without|if you (do )?not|when manual allocations (are|is) (not |off|disabled))\b/.test(
      joined,
    )
  ) {
    tags.add("manual_allocations");
  }

  if (
    /\b(without|not using|do not use|if you (do )?not)\b.{0,40}\bmanual\s+allocations?\b/.test(
      joined,
    ) ||
    (/\b(current|1\s+month|2\s+months?|3\s+months?\s+plus|age(?:d|ing)?)\b/.test(
      joined,
    ) &&
      /\bopening\s+balance\b/.test(joined))
  ) {
    tags.add("non_manual_allocations");
  }

  if (
    /\bo\/\s*balance\b/.test(joined) ||
    /\bopening\s+balance\b/.test(joined) ||
    (/\b(current|1\s+month|2\s+months?|3\s+months?\s+plus)\b/.test(joined) &&
      /\b(age|balance|enter)\b/.test(joined))
  ) {
    tags.add("customer_opening_balance");
  }

  const mentionsAdd =
    /\bclick\s+add\b/.test(joined) ||
    /\badd\s+(a\s+)?(new\s+)?customer\b/.test(joined) ||
    /\badding\s+(a\s+)?(new\s+)?customer\b/.test(joined);
  const mentionsChange =
    /\bclick\s+change\b/.test(joined) ||
    /\bchange\s+(a\s+)?customer\b/.test(joined) ||
    /\bchanging\s+(a\s+)?customer\b/.test(joined) ||
    /\bexisting\s+customer\b/.test(joined) ||
    /\balready\s+(exists|added|created|owe)/.test(joined);

  if (mentionsAdd && !mentionsChange) {
    tags.add("add_customer");
  } else if (mentionsChange && !mentionsAdd) {
    tags.add("existing_customer");
  } else if (mentionsAdd && mentionsChange) {
    // Ambiguous fragment — keep both and let query selection filter.
    tags.add("add_customer");
    tags.add("existing_customer");
  } else if (/\badd\b/.test(joined) && /\bcustomer\b/.test(joined)) {
    tags.add("add_customer");
  } else if (/\bchange\b/.test(joined) && /\bcustomer\b/.test(joined)) {
    tags.add("existing_customer");
  }

  if (
    /\bclick\s+save\b/.test(joined) ||
    /\bfinally\b.{0,30}\bsave\b/.test(joined) ||
    /\bsave\s+(changes|the\s+(customer|record))\b/.test(joined)
  ) {
    tags.add("final_save");
  }

  if (tags.size === 0) {
    tags.add("generic");
  }

  return [...tags];
}

/**
 * Pick the primary workflow tag for a block (most specific non-generic).
 * Prefer exclusive Add/Change tags when nearby actions make the branch clear.
 */
export function primaryWorkflow(
  workflows: FreshdeskWorkflowTag[],
  nearbyActions: string[] = [],
): FreshdeskWorkflowTag {
  const actionSet = new Set(nearbyActions.map((action) => action.toLowerCase()));
  const hasAdd = actionSet.has("add");
  const hasChange = actionSet.has("change");

  if (hasChange && !hasAdd) {
    return "existing_customer";
  }
  if (hasAdd && !hasChange) {
    return "add_customer";
  }

  if (actionSet.has("email preferences")) {
    return "email_preferences";
  }

  if (
    actionSet.has("bank reconciliation") ||
    actionSet.has("statement balance")
  ) {
    return "bank_reconciliation";
  }

  if (
    actionSet.has("o/balance") ||
    actionSet.has("current") ||
    actionSet.has("1 month") ||
    actionSet.has("2 months") ||
    actionSet.has("3 months plus")
  ) {
    if (workflows.includes("customer_opening_balance")) {
      return "customer_opening_balance";
    }
    if (workflows.includes("non_manual_allocations")) {
      return "non_manual_allocations";
    }
    if (actionSet.has("o/balance")) {
      return "existing_customer";
    }
    return "customer_opening_balance";
  }

  if (actionSet.has("save") && workflows.includes("final_save")) {
    return "final_save";
  }

  const priority: FreshdeskWorkflowTag[] = [
    "manual_allocations",
    "non_manual_allocations",
    "customer_opening_balance",
    "email_preferences",
    "bank_reconciliation",
    "existing_customer",
    "add_customer",
    "final_save",
    "generic",
  ];

  for (const tag of priority) {
    if (workflows.includes(tag)) {
      return tag;
    }
  }

  return "generic";
}

export type SelectedWorkflows = {
  include: Set<FreshdeskWorkflowTag>;
  exclude: Set<FreshdeskWorkflowTag>;
};

/**
 * Derive which workflow branches to keep from the customer question.
 * Generic and shared steps (final_save, opening balance) stay available
 * unless explicitly excluded by a mutually exclusive branch.
 */
export function selectWorkflowsFromQuestion(
  question: string | null | undefined,
): SelectedWorkflows {
  const include = new Set<FreshdeskWorkflowTag>([
    "generic",
    "final_save",
    "customer_opening_balance",
    "non_manual_allocations",
    "email_preferences",
    "bank_reconciliation",
  ]);
  const exclude = new Set<FreshdeskWorkflowTag>();

  const q = normalizeText(question ?? "").toLowerCase();
  if (!q) {
    // No question — keep all branches; callers may still omit weak matches.
    include.add("add_customer");
    include.add("existing_customer");
    include.add("manual_allocations");
    return { include, exclude };
  }

  const wantsExisting =
    /\balready\b/.test(q) ||
    /\bexisting\b/.test(q) ||
    /\bwho (already |)?owes\b/.test(q) ||
    /\bi('ve| have) added\b/.test(q) ||
    /\bchange\b/.test(q);

  const wantsNew =
    /\bbrand[- ]?new\b/.test(q) ||
    /\bnew customer\b/.test(q) ||
    /\badd(ing)? (a |an )?(new )?customer\b/.test(q) ||
    /\bcreate (a |an )?(new )?customer\b/.test(q);

  const wantsManual = /\bmanual\s+allocations?\b/.test(q);
  const wantsEmail =
    /\bemail\s+preferences\b/.test(q) || /\bemail\s+settings\b/.test(q);
  const wantsBank =
    /\bbank\s+reconciliation\b/.test(q) ||
    /\breconcile\b/.test(q) ||
    /\bstatement\s+balance\b/.test(q);

  if (wantsExisting && !wantsNew) {
    include.add("existing_customer");
    exclude.add("add_customer");
  } else if (wantsNew && !wantsExisting) {
    include.add("add_customer");
    exclude.add("existing_customer");
  } else {
    include.add("add_customer");
    include.add("existing_customer");
  }

  if (wantsManual) {
    include.add("manual_allocations");
    exclude.add("non_manual_allocations");
  } else if (
    /\bopening\s+balance\b/.test(q) ||
    /\bage(?:d|ing)?\b/.test(q) ||
    /\bowes?\b/.test(q)
  ) {
    exclude.add("manual_allocations");
    include.add("non_manual_allocations");
  } else {
    include.add("manual_allocations");
  }

  if (wantsEmail) {
    include.add("email_preferences");
  }

  if (wantsBank) {
    include.add("bank_reconciliation");
  }

  return { include, exclude };
}

export function blockMatchesSelectedWorkflows(
  blockWorkflows: FreshdeskWorkflowTag[] | undefined,
  selected: SelectedWorkflows,
): boolean {
  const workflows =
    blockWorkflows && blockWorkflows.length > 0
      ? blockWorkflows
      : (["generic"] as FreshdeskWorkflowTag[]);

  if (workflows.some((tag) => selected.exclude.has(tag))) {
    // Allow shared steps that also carry a kept workflow (e.g. opening balance + save).
    const nonExcluded = workflows.filter((tag) => !selected.exclude.has(tag));
    if (nonExcluded.length === 0) {
      return false;
    }
    // Pure add_customer blocks should drop when excluded even if they also say generic.
    const exclusiveOnly = workflows.filter(
      (tag) =>
        tag === "add_customer" ||
        tag === "existing_customer" ||
        tag === "manual_allocations" ||
        tag === "non_manual_allocations",
    );
    if (
      exclusiveOnly.length > 0 &&
      exclusiveOnly.every((tag) => selected.exclude.has(tag))
    ) {
      return false;
    }
  }

  return workflows.some(
    (tag) =>
      tag === "generic" ||
      tag === "final_save" ||
      selected.include.has(tag),
  );
}

export function workflowDisplayLabel(workflow: FreshdeskWorkflowTag): string {
  switch (workflow) {
    case "add_customer":
      return "Adding a customer";
    case "existing_customer":
      return "Changing a customer";
    case "customer_opening_balance":
      return "Customer opening balance";
    case "manual_allocations":
      return "Manual allocations";
    case "non_manual_allocations":
      return "Customer opening balance";
    case "final_save":
      return "Changing a customer";
    case "email_preferences":
      return "Customer email settings";
    case "bank_reconciliation":
      return "Bank reconciliation";
    default:
      return "Help article";
  }
}

export function actionsOverlapScore(
  left: string[] | undefined,
  right: string[] | undefined,
): number {
  if (!left?.length || !right?.length) {
    return 0;
  }

  const rightKeys = new Set(right.map((action) => action.toLowerCase()));
  let score = 0;
  for (const action of left) {
    if (rightKeys.has(action.toLowerCase())) {
      score += 3;
    }
  }
  return score;
}

export function textTokenOverlap(left: string, right: string): number {
  const tokenize = (value: string): Set<string> =>
    new Set(
      normalizeText(value)
        .toLowerCase()
        .split(/[^a-z0-9/]+/)
        .filter((token) => token.length > 2),
    );

  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

export function resolveMutuallyExclusiveConflicts(
  selected: SelectedWorkflows,
): SelectedWorkflows {
  for (const [left, right] of MUTUALLY_EXCLUSIVE_PAIRS) {
    if (selected.exclude.has(left) && selected.include.has(left)) {
      selected.include.delete(left);
    }
    if (selected.exclude.has(right) && selected.include.has(right)) {
      selected.include.delete(right);
    }
  }
  return selected;
}
