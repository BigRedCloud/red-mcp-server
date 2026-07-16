export const SUPPORT_CONTACT_URL = "https://bigredcloud.com/contact/";
export const CUSTOMER_FACING_SUPPORT_MARKDOWN = [
    "Still need help?",
    "",
    `[Contact Big Red Cloud Support](${SUPPORT_CONTACT_URL})`,
].join("\n");
export const COMPANY_SPECIFIC_SUPPORT_MARKDOWN = [
    "Your company settings may affect these steps.",
    "",
    `[Contact Big Red Cloud Support](${SUPPORT_CONTACT_URL})`,
].join("\n");
export const SUPPORT_FALLBACK_RESPONSE_GUIDANCE = [
    "Include the support contact link only when the answer may not be enough:",
    "no strong matching resource, incomplete answer, no relevant screenshot or source,",
    "the user says the instructions did not solve the problem, company-specific settings,",
    "specialised assistance, or unresolved uncertainty.",
    `Use exactly ${SUPPORT_CONTACT_URL}.`,
    "Do not add the support footer automatically to every successful complete answer.",
].join(" ");
const STRONG_MATCH_SCORE_THRESHOLD = 100;
export function buildCustomerFacingSupportMarkdown(reason) {
    if (!reason) {
        return undefined;
    }
    if (reason === "company_specific_settings") {
        return COMPANY_SPECIFIC_SUPPORT_MARKDOWN;
    }
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
    const recommended = reason !== null;
    const markdown = recommended
        ? buildCustomerFacingSupportMarkdown(reason)
        : undefined;
    return {
        supportFallbackRecommended: recommended,
        supportFallbackReason: reason,
        supportUrl: SUPPORT_CONTACT_URL,
        ...(markdown ? { customerFacingSupportMarkdown: markdown } : {}),
    };
}
export function buildSupportMarkdownTextBlock(supportMarkdown) {
    const markdown = supportMarkdown?.trim();
    if (!markdown) {
        return undefined;
    }
    return [
        "Include the following support Markdown only when supportFallbackRecommended is true:",
        "",
        markdown,
    ].join("\n");
}
