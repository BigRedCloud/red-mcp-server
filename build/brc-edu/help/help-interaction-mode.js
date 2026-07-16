/**
 * Conversation help interaction mode: Big Red Cloud tutorial vs Red action.
 * State is tracked per conversation by the host/model using these helpers and
 * MCP instructions — there is no durable server-side conversation store.
 */
export const HELP_INTERACTION_CLARIFICATION_QUESTION = "Would you like instructions for doing this in Big Red Cloud, or would you like to do it here through Red?";
export const TUTORIAL_MODE_NO_DATA_CHANGE_GUIDANCE = "In Big Red Cloud tutorial mode, never claim that any company data was created, updated, deleted, emailed, or otherwise changed. Tutorial answers only explain how to do the action in Big Red Cloud.";
export const UNSUPPORTED_RED_ACTION_GUIDANCE = "If Red has no tool capable of performing the requested action, say the action cannot currently be completed through Red, offer Big Red Cloud application instructions instead, and do not pretend the action was performed.";
const AMBIGUOUS_ACTION_PATTERN = /^\s*(?:how\s+(?:do\s+i|to|can\s+i|do\s+you|does\s+one)\s+)?(?:add|create|update|enter|post|raise|record|make)\b.+/i;
const AMBIGUOUS_CAN_YOU_PATTERN = /^\s*(?:can\s+you|could\s+you)\s+(?:add|create|update|enter|post|raise|record|make)\b.+/i;
const CLEAR_TUTORIAL_PATTERN = /\b(?:show\s+me\s+how|what\s+buttons?\s+(?:do\s+i\s+)?click|give\s+me\s+a\s+tutorial|tutorial\s+with\s+screenshots|how\s+is\s+this\s+done\s+in\s+(?:the\s+)?(?:brc|big\s+red\s+cloud)\b|in\s+big\s+red\s+cloud|in\s+the\s+(?:brc\s+)?(?:software|application|website|ui)|steps?\s+in\s+big\s+red\s+cloud)\b/i;
const CLEAR_RED_ACTION_PATTERN = /\b(?:through\s+red|via\s+red|in\s+red|for\s+me\s+here|use\s+this\s+chat|add\s+(?:this|the|a|an)\s+\w+\s+through\s+red|create\s+(?:this|the|a|an)\s+\w+\s+(?:for\s+me\s+)?(?:through\s+red|here)|please\s+post|post\s+this|update\s+the\s+\w+\s+record\s+in\s+red|perform\s+it\s+for\s+me|do\s+it\s+(?:for\s+me|here)\s+through\s+red)\b/i;
const TUTORIAL_CHOICE_PATTERN = /\b(?:big\s+red\s+cloud|show\s+me\s+how|tutorial|website|in\s+the\s+software|application\s+instructions|i'?ll\s+do\s+it\s+myself|don'?t\s+make\s+any\s+changes|give\s+me\s+the\s+steps|tutorial\s+only)\b/i;
const RED_ACTION_CHOICE_PATTERN = /\b(?:\bred\b|do\s+it\s+here|can\s+you\s+do\s+it|use\s+this\s+chat|perform\s+it\s+for\s+me|add\s+it\s+(?:here|through\s+red)|do\s+it\s+for\s+me)\b/i;
const SWITCH_TO_RED_PATTERN = /\b(?:switch\s+to\s+red|can\s+i\s+do\s+this\s+(?:in\s+red|here)|do\s+it\s+for\s+me|use\s+this\s+chat|perform\s+the\s+action|add\s+it\s+through\s+red|here\s+instead)\b/i;
const SWITCH_TO_TUTORIAL_PATTERN = /\b(?:show\s+me\s+how\s+in\s+big\s+red\s+cloud|give\s+me\s+the\s+steps|tutorial\s+only|don'?t\s+make\s+any\s+changes|i'?ll\s+do\s+it\s+myself)\b/i;
/** Operational Red write-style intents that may have a matching tool. */
const RED_ACTIONABLE_ENTITY_PATTERN = /\b(?:customer|supplier|invoice|quote|credit\s+note|purchase|payment|receipt|product|journal)\b/i;
export function createInitialHelpInteractionModeState() {
    return {
        helpInteractionMode: null,
        helpInteractionModeClarified: false,
    };
}
export function isClearTutorialRequest(message) {
    return CLEAR_TUTORIAL_PATTERN.test(message.trim());
}
export function isClearRedActionRequest(message) {
    return CLEAR_RED_ACTION_PATTERN.test(message.trim());
}
export function isAmbiguousHelpActionQuestion(message) {
    const trimmed = message.trim();
    if (!trimmed) {
        return false;
    }
    if (isClearTutorialRequest(trimmed) || isClearRedActionRequest(trimmed)) {
        return false;
    }
    return (AMBIGUOUS_ACTION_PATTERN.test(trimmed) ||
        AMBIGUOUS_CAN_YOU_PATTERN.test(trimmed));
}
export function detectHelpModeSwitch(message) {
    const trimmed = message.trim();
    if (SWITCH_TO_TUTORIAL_PATTERN.test(trimmed)) {
        return "big_red_cloud_tutorial";
    }
    if (SWITCH_TO_RED_PATTERN.test(trimmed)) {
        return "red_action";
    }
    return null;
}
export function detectHelpModeChoice(message) {
    const trimmed = message.trim();
    // Prefer explicit switch phrases first.
    const switched = detectHelpModeSwitch(trimmed);
    if (switched) {
        return switched;
    }
    if (isClearTutorialRequest(trimmed) || TUTORIAL_CHOICE_PATTERN.test(trimmed)) {
        // Avoid treating a bare "Red" sentence as tutorial when it also matches Red.
        if (isClearRedActionRequest(trimmed) ||
            (/\bred\b/i.test(trimmed) &&
                !/\bbig\s+red\s+cloud\b/i.test(trimmed) &&
                RED_ACTION_CHOICE_PATTERN.test(trimmed))) {
            return "red_action";
        }
        return "big_red_cloud_tutorial";
    }
    if (isClearRedActionRequest(trimmed) || RED_ACTION_CHOICE_PATTERN.test(trimmed)) {
        // "Big Red Cloud" wins over a lone "Red" token inside tutorial phrasing.
        if (/\bbig\s+red\s+cloud\b/i.test(trimmed) && !isClearRedActionRequest(trimmed)) {
            return "big_red_cloud_tutorial";
        }
        return "red_action";
    }
    return null;
}
/**
 * Resolve conversation help mode for the current user message.
 * Asks the tutorial-versus-Red clarification at most once for ambiguous action questions.
 * After clarification, defaults to Big Red Cloud tutorial until the user switches.
 */
export function resolveHelpInteractionMode(previous, message) {
    const state = {
        helpInteractionMode: previous.helpInteractionMode,
        helpInteractionModeClarified: previous.helpInteractionModeClarified,
    };
    const switchMode = detectHelpModeSwitch(message);
    if (switchMode) {
        state.helpInteractionMode = switchMode;
        state.helpInteractionModeClarified = true;
        return {
            state,
            shouldAskClarification: false,
            clarificationQuestion: null,
            effectiveMode: switchMode,
            switchedMode: true,
        };
    }
    if (isClearTutorialRequest(message)) {
        state.helpInteractionMode = "big_red_cloud_tutorial";
        state.helpInteractionModeClarified = true;
        return {
            state,
            shouldAskClarification: false,
            clarificationQuestion: null,
            effectiveMode: "big_red_cloud_tutorial",
            switchedMode: false,
        };
    }
    if (isClearRedActionRequest(message)) {
        state.helpInteractionMode = "red_action";
        state.helpInteractionModeClarified = true;
        return {
            state,
            shouldAskClarification: false,
            clarificationQuestion: null,
            effectiveMode: "red_action",
            switchedMode: false,
        };
    }
    if (!state.helpInteractionModeClarified && isAmbiguousHelpActionQuestion(message)) {
        return {
            state,
            shouldAskClarification: true,
            clarificationQuestion: HELP_INTERACTION_CLARIFICATION_QUESTION,
            effectiveMode: null,
            switchedMode: false,
        };
    }
    // User is answering a prior clarification.
    if (!state.helpInteractionModeClarified) {
        const choice = detectHelpModeChoice(message);
        if (choice) {
            state.helpInteractionMode = choice;
            state.helpInteractionModeClarified = true;
            return {
                state,
                shouldAskClarification: false,
                clarificationQuestion: null,
                effectiveMode: choice,
                switchedMode: false,
            };
        }
    }
    // After clarification: keep tutorial by default for later ambiguous questions.
    if (state.helpInteractionModeClarified) {
        const effectiveMode = state.helpInteractionMode ?? "big_red_cloud_tutorial";
        if (!state.helpInteractionMode) {
            state.helpInteractionMode = "big_red_cloud_tutorial";
        }
        return {
            state,
            shouldAskClarification: false,
            clarificationQuestion: null,
            effectiveMode,
            switchedMode: false,
        };
    }
    return {
        state,
        shouldAskClarification: false,
        clarificationQuestion: null,
        effectiveMode: state.helpInteractionMode,
        switchedMode: false,
    };
}
/**
 * Whether Red is likely to have an operational tool for this action request.
 * Used to decide between performing a Red action and offering a tutorial instead.
 */
export function redActionLikelySupported(message) {
    return RED_ACTIONABLE_ENTITY_PATTERN.test(message.trim());
}
export function unsupportedRedActionCustomerMessage() {
    return [
        "That action cannot currently be completed through Red.",
        "I can show you how to do it in Big Red Cloud instead.",
    ].join(" ");
}
