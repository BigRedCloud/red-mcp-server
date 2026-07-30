/**
 * Preferred customer-facing help answer section order.
 * 1. Tutorial steps (+ screenshots beside steps)
 * 2. Sources (Articles / Videos)
 * 3. Optional "Do this through Red"
 * 4. Support (always last)
 */
import { CUSTOMER_FACING_SUPPORT_MARKDOWN } from "./help-support-fallback.js";
export const HELP_ANSWER_SECTION_ORDER = [
    "tutorial_steps_and_screenshots",
    "sources",
    "red_action",
    "support",
];
export const TUTORIAL_NO_DATA_CHANGE_GUIDANCE = "When giving Big Red Cloud tutorial answers, never claim that any company data was created, updated, deleted, emailed, or otherwise changed. Tutorial answers only explain how to do the action in Big Red Cloud.";
export const AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE = [
    "For Big Red Cloud how-to or tutorial questions, automatically open the best matching Freshdesk article with brc_get_help_resource_details using includeImages=true and imagePresentation=links.",
    "Use usedResourceIds / the first Sources entry — never claim no article exists when a matching Freshdesk resource was returned.",
    "Pass the user’s original question as question so workflow-specific screenshots are selected.",
    "Place each relevant screenshot beside its step even when the user did not explicitly ask for images.",
    "Do not require the user to say include screenshots, show images, or place images beside the steps.",
    "Do not claim screenshots were shown when imageCount is 0 or no Markdown links are returned.",
    "Never claim no Freshdesk article exists when brc_red_help or brc_find_help_resources returned a matching Freshdesk resource.",
    "Base tutorial steps on the official help content — do not invent UI paths such as usually under Sales.",
    "Do not manually retry alternate search wording — the server already expands procedural queries.",
].join(" ");
export const HELP_ANSWER_LAYOUT_GUIDANCE = [
    "Preferred successful tutorial layout — always in this exact order:",
    "1) title and numbered steps with screenshot Markdown links immediately after the related step;",
    "2) Sources grouped as Articles (Freshdesk / docs) and Videos (recorded webinars when used) — exact publicUrl or registrationUrl only;",
    "3) optional Do this through Red when redActionAvailable is true;",
    "4) Still need help? support section — always last on every help answer.",
    "Never emit Do this through Red before Sources.",
    "Keep screenshot links beside steps — never move them into Sources.",
    "Do not start a Red write action unless the user asks Red to perform it.",
    "Mention preview-before-posting for write actions offered through Red.",
    "When customerFacingAnswerSectionsMarkdown is present, copy it in order after the tutorial steps/screenshots.",
].join(" ");
/**
 * Deterministic post-tutorial sections: Sources → Red action → support.
 * Support is always included last. Tutorial steps/screenshots are supplied
 * separately from instruction Markdown.
 */
export function buildHelpAnswerSectionsMarkdown(options) {
    const sections = [];
    const sources = options.sourcesMarkdown?.trim();
    if (sources) {
        sections.push(sources);
    }
    const redAction = options.redActionMarkdown?.trim();
    if (redAction) {
        sections.push(redAction);
    }
    sections.push(options.supportMarkdown?.trim() || CUSTOMER_FACING_SUPPORT_MARKDOWN);
    return sections.join("\n\n");
}
