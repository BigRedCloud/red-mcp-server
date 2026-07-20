export const SUPPORT_CONTACT_URL = "https://bigredcloud.com/contact/";
export const CUSTOMER_FACING_SUPPORT_MARKDOWN = [
    "Still need help?",
    "",
    `[Contact Big Red Cloud Support](${SUPPORT_CONTACT_URL})`,
].join("\n");
/** @deprecated Prefer CUSTOMER_FACING_SUPPORT_MARKDOWN — support footer is always the standard section. */
export const COMPANY_SPECIFIC_SUPPORT_MARKDOWN = CUSTOMER_FACING_SUPPORT_MARKDOWN;
export const SUPPORT_FALLBACK_RESPONSE_GUIDANCE = [
    "Always end every help answer with the Still need help? support section.",
    `Use exactly ${SUPPORT_CONTACT_URL}.`,
    "Place support after Sources and after any Do this through Red section — support must always be last.",
].join(" ");
const STRONG_MATCH_SCORE_THRESHOLD = 100;
export function buildCustomerFacingSupportMarkdown(_reason) {
    return CUSTOMER_FACING_SUPPORT_MARKDOWN;
}
export function resolveSupportFallback(options) {
    let reason = null;
    if (options.userUnresolved) {
        reason = "user_unresolved";
    }
    else if (options.companySpecific) {
        reason = "company_specific_settings";
    }
    else if (options.specialised) {
        reason = "specialised_assistance";
    }
    else if (options.uncertain) {
        reason = "uncertain_branch";
    }
    else if (options.incomplete) {
        reason = "incomplete_answer";
    }
    else if (options.matchCount <= 0) {
        reason = "no_strong_match";
    }
    else if (typeof options.strongestScore === "number" &&
        options.strongestScore < STRONG_MATCH_SCORE_THRESHOLD) {
        reason = "no_strong_match";
    }
    else if (options.hasRelevantSourceOrScreenshot === false) {
        reason = "no_relevant_source_or_screenshot";
    }
    return {
        // Support footer is required on every help answer.
        supportFallbackRecommended: true,
        supportFallbackReason: reason,
        supportUrl: SUPPORT_CONTACT_URL,
        contactUrl: SUPPORT_CONTACT_URL,
        customerFacingSupportMarkdown: CUSTOMER_FACING_SUPPORT_MARKDOWN,
    };
}
export function buildSupportMarkdownTextBlock(supportMarkdown) {
    const markdown = supportMarkdown?.trim() || CUSTOMER_FACING_SUPPORT_MARKDOWN;
    return [
        "Always include the following support Markdown last, after Sources and after any Do this through Red section:",
        "",
        markdown,
    ].join("\n");
}
