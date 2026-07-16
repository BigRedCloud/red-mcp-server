import { stripHtmlEntitiesForCaption } from "./article-content-parser.js";
import { primaryWorkflow, workflowDisplayLabel, } from "./workflow-context.js";
export const FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH = 80;
export const FRESHDESK_SCREENSHOT_CAPTION_FALLBACK = "Freshdesk instruction screenshot";
const GENERIC_ALT_PATTERN = /^(image|images|img|screenshot|screenshots|photo|picture|graphic|diagram|untitled|show image|view image|open image|a screenshot of a computer|a screenshot of an account|ai-generated content may be incorrect|screenshot\s*\d+|image\s*\d+|relevant article section|relevant screenshot|freshdesk screenshot|freshdesk instruction screenshot)$/i;
const REJECTED_CAPTION_PATTERN = /^(image|images|img|screenshot|screenshots|photo|picture|graphic|diagram|untitled|show image|view image|open image|a screenshot of a computer|a screenshot of an account|ai-generated content may be incorrect|screenshot\s*\d+|image\s*\d+|relevant article section|relevant screenshot|freshdesk screenshot|freshdesk instruction screenshot)$/i;
const INSTRUCTION_PREFIX_PATTERN = /^(please\s+)?(then\s+)?(next[,:]?\s+)?(now[,:]?\s+)?/i;
export function isGenericFreshdeskAltText(altText) {
    const cleaned = stripHtmlEntitiesForCaption(altText ?? "");
    if (!cleaned) {
        return true;
    }
    return GENERIC_ALT_PATTERN.test(cleaned);
}
/** Captions that must never appear in customer-facing Markdown links. */
export function isRejectedFreshdeskCaption(caption) {
    const cleaned = stripHtmlEntitiesForCaption(caption ?? "");
    if (!cleaned) {
        return true;
    }
    if (REJECTED_CAPTION_PATTERN.test(cleaned)) {
        return true;
    }
    if (/^screenshot\s*\d+$/i.test(cleaned)) {
        return true;
    }
    if (/ai-generated content may be incorrect/i.test(cleaned)) {
        return true;
    }
    return false;
}
function truncateCaption(value) {
    const cleaned = stripHtmlEntitiesForCaption(value);
    if (cleaned.length <= FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH) {
        return cleaned;
    }
    const slice = cleaned
        .slice(0, FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH - 1)
        .trimEnd();
    const lastSpace = slice.lastIndexOf(" ");
    const base = lastSpace >= 40 ? slice.slice(0, lastSpace).trimEnd() : slice.trimEnd();
    return `${base}…`;
}
function titleCaseWords(value) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
        if (/^[A-Z0-9/]+$/.test(word) && word.length <= 4) {
            return word;
        }
        if (word.includes("/")) {
            return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    })
        .join(" ");
}
function resolveWorkflowLabel(context) {
    if (context.workflow && context.workflow !== "generic") {
        return workflowDisplayLabel(context.workflow);
    }
    const heading = stripHtmlEntitiesForCaption(context.sectionHeading ?? context.nearbyHeading ?? "");
    if (heading) {
        if (/screen$/i.test(heading)) {
            return heading;
        }
        if (/\bcustomer\b/i.test(heading) && /\badd\b/i.test(heading)) {
            return "Adding a customer";
        }
        if (/\bcustomer\b/i.test(heading) && /\bchange\b/i.test(heading)) {
            return "Changing a customer";
        }
        if (/\bopening\s+balance\b/i.test(heading)) {
            return "Customer opening balance";
        }
        if (/\bemail\b/i.test(heading)) {
            return "Customer email settings";
        }
        if (/\bbank\b/i.test(heading) || /\breconcile\b/i.test(heading)) {
            return "Bank reconciliation";
        }
        return heading;
    }
    return null;
}
/**
 * Turn nearby instruction text into a concise action/purpose phrase.
 * Deterministic only — no AI, no guessed UI actions beyond nearby text.
 */
export function instructionTextToCaption(text, nearbyHeading) {
    const original = stripHtmlEntitiesForCaption(text);
    let cleaned = original.replace(INSTRUCTION_PREFIX_PATTERN, "").trim();
    if (/\ba\/c\s*code\b/i.test(original) &&
        /\b(fill|enter|mandatory|required|details)\b/i.test(original)) {
        return "Enter the required A/C Code";
    }
    if (/\b(current|1\s+month|2\s+months?|3\s+months?\s+plus)\b/i.test(original) &&
        /\b(enter|fill|age|balance)\b/i.test(original)) {
        return "Enter aged balances";
    }
    if (/\bo\/\s*balance\b/i.test(original) && /\bclick\b/i.test(original)) {
        return "Open O/Balance";
    }
    if (/\bsave\b/i.test(original) && /\bclick\b/i.test(original)) {
        return "Save changes";
    }
    if (/\bemail\s+preferences\b/i.test(original) &&
        /\b(click|open)\b/i.test(original)) {
        // Only claim "Open Email Preferences" when the nearby text is specifically
        // about opening that control — not when Change-screen context merely lists it.
        if (/\b(click|open)\s+email\s+preferences\b/i.test(original) ||
            /\bemail\s+preferences\b.{0,40}\b(right-hand|button|link)\b/i.test(original)) {
            return "Open Email Preferences";
        }
        return "Email Preferences button is shown";
    }
    if (/\bstatement\s+balance\b/i.test(original) &&
        /\b(enter|fill)\b/i.test(original)) {
        return "Enter statement balance";
    }
    const sentenceMatch = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
    if (sentenceMatch?.[1]) {
        cleaned = sentenceMatch[1].replace(/[.!?]+$/, "").trim();
    }
    const clickThenClick = cleaned.match(/^click\s+(.+?)[,.]?\s+then\s+click\s+(.+)$/i);
    if (clickThenClick) {
        return `Click ${titleCaseWords(clickThenClick[2] ?? "")}`;
    }
    const clickTarget = cleaned.match(/^click\s+(.+?)(?:\s+on\s+the\s+.+)?$/i);
    if (clickTarget?.[1] && clickTarget[1].length <= 60) {
        const target = clickTarget[1].replace(/[.]+$/, "").trim();
        if (!/^here$/i.test(target)) {
            return `Click ${titleCaseWords(target)}`;
        }
    }
    if (/^(fill in|enter|complete|go to|open)\b/i.test(cleaned)) {
        return titleCaseWords(cleaned.charAt(0).toLowerCase() + cleaned.slice(1))
            .replace(/^Fill In\b/, "Fill in")
            .replace(/^Enter\b/, "Enter")
            .replace(/^Complete\b/, "Complete")
            .replace(/^Go To\b/, "Go to")
            .replace(/^Open\b/, "Open");
    }
    // Prefer a short action from nearby heading context when the sentence is long.
    if (cleaned.length > 50 && nearbyHeading) {
        const heading = stripHtmlEntitiesForCaption(nearbyHeading);
        if (heading) {
            return truncateCaption(heading);
        }
    }
    return truncateCaption(cleaned);
}
function formatWorkflowCaption(workflowLabel, action) {
    const cleanedAction = stripHtmlEntitiesForCaption(action);
    if (!cleanedAction) {
        return workflowLabel
            ? truncateCaption(workflowLabel)
            : FRESHDESK_SCREENSHOT_CAPTION_FALLBACK;
    }
    if (!workflowLabel) {
        return truncateCaption(cleanedAction);
    }
    // Avoid "Changing a customer: Changing a customer".
    if (cleanedAction.toLowerCase() === workflowLabel.toLowerCase()) {
        return truncateCaption(workflowLabel);
    }
    return truncateCaption(`${workflowLabel}: ${cleanedAction}`);
}
function actionFromNearbyActions(nearbyActions, context) {
    if (!nearbyActions || nearbyActions.length === 0) {
        return null;
    }
    const preceding = stripHtmlEntitiesForCaption(context.precedingText ?? "");
    const alt = stripHtmlEntitiesForCaption(context.altText ?? "");
    const corpus = `${preceding} ${alt}`.toLowerCase();
    const preferred = [
        "O/Balance",
        "Email Preferences",
        "Save",
        "Add",
        "Change",
    ];
    // Prefer actions that are explicitly mentioned in the preceding instruction.
    for (const label of preferred) {
        const present = nearbyActions.some((action) => action.toLowerCase() === label.toLowerCase());
        if (!present) {
            continue;
        }
        if (corpus.includes(label.toLowerCase()) || /click\s+save\b/i.test(preceding)) {
            if (label === "O/Balance") {
                return "Open O/Balance";
            }
            if (label === "Email Preferences") {
                // Prefer accurate wording: only "Open …" when preceding text is that action.
                if (/\b(click|open)\s+email\s+preferences\b/i.test(preceding)) {
                    return "Open Email Preferences";
                }
                return "Email Preferences button is shown";
            }
            if (label === "Save") {
                return "Save changes";
            }
            return `Click ${label}`;
        }
    }
    for (const label of preferred) {
        if (nearbyActions.some((action) => action.toLowerCase() === label.toLowerCase())) {
            if (label === "O/Balance") {
                return "Open O/Balance";
            }
            if (label === "Email Preferences") {
                // Prefer accurate wording: only "Open …" when preceding text is that action.
                if (/\b(click|open)\s+email\s+preferences\b/i.test(preceding)) {
                    return "Open Email Preferences";
                }
                return "Email Preferences button is shown";
            }
            if (label === "Save") {
                return "Save changes";
            }
            return `Click ${label}`;
        }
    }
    if (nearbyActions.some((action) => /^(Current|1 Month|2 Months|3 Months Plus)$/i.test(action))) {
        return "Enter aged balances";
    }
    if (nearbyActions.some((action) => /statement balance/i.test(action)) ||
        (context.workflow === "bank_reconciliation" &&
            nearbyActions.some((action) => /balance/i.test(action)))) {
        return "Enter statement balance";
    }
    return null;
}
/**
 * Build a deterministic screenshot caption using nearby article text only.
 *
 * Preferred format: `{workflow or screen}: {action or purpose}`
 *
 * Priority:
 * 1. meaningful Freshdesk image alt text (combined with workflow when useful)
 * 2. exact nearby UI action
 * 3. actionable preceding instruction
 * 4. nearest heading
 * 5. other nearby explanatory text
 * 6. safe fallback
 */
export function buildFreshdeskScreenshotCaption(context) {
    const workflowLabel = resolveWorkflowLabel(context);
    const alt = stripHtmlEntitiesForCaption(context.altText ?? "");
    const fromActions = actionFromNearbyActions(context.nearbyActions, context);
    // Prefer structured workflow:action captions over raw alt when we have a clear UI action.
    if (fromActions && workflowLabel) {
        if (/email preferences button is shown/i.test(fromActions)) {
            return formatWorkflowCaption("Customer settings", fromActions);
        }
        return formatWorkflowCaption(workflowLabel, fromActions);
    }
    if (alt && !isGenericFreshdeskAltText(alt)) {
        // Meaningful alt that already looks like a full caption.
        if (/:/.test(alt) || alt.length > 40) {
            return truncateCaption(alt);
        }
        if (fromActions) {
            return formatWorkflowCaption(workflowLabel, fromActions);
        }
        return formatWorkflowCaption(workflowLabel, alt);
    }
    const heading = stripHtmlEntitiesForCaption(context.sectionHeading ?? context.nearbyHeading ?? "");
    const preceding = stripHtmlEntitiesForCaption(context.precedingText ?? "");
    const following = stripHtmlEntitiesForCaption(context.followingText ?? "");
    if (preceding &&
        /\b(click|go to|fill|enter|complete|open|select)\b/i.test(preceding)) {
        return formatWorkflowCaption(workflowLabel, instructionTextToCaption(preceding, heading || null));
    }
    if (heading &&
        preceding &&
        /\b(fill|enter|complete)\b/i.test(preceding)) {
        return formatWorkflowCaption(workflowLabel, instructionTextToCaption(preceding, heading));
    }
    if (heading && workflowLabel && heading.toLowerCase() !== workflowLabel.toLowerCase()) {
        return formatWorkflowCaption(workflowLabel, heading);
    }
    if (heading) {
        return truncateCaption(heading);
    }
    if (preceding) {
        return formatWorkflowCaption(workflowLabel, instructionTextToCaption(preceding, heading || null));
    }
    if (following) {
        return formatWorkflowCaption(workflowLabel, instructionTextToCaption(following, heading || null));
    }
    if (workflowLabel) {
        return truncateCaption(workflowLabel);
    }
    return FRESHDESK_SCREENSHOT_CAPTION_FALLBACK;
}
/** Re-export for callers that need workflow primary helper alongside captions. */
export { primaryWorkflow };
