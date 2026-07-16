import assert from "node:assert/strict";
import test from "node:test";
import { HELP_INTERACTION_CLARIFICATION_QUESTION, TUTORIAL_MODE_NO_DATA_CHANGE_GUIDANCE, UNSUPPORTED_RED_ACTION_GUIDANCE, createInitialHelpInteractionModeState, detectHelpModeSwitch, isAmbiguousHelpActionQuestion, isClearRedActionRequest, isClearTutorialRequest, redActionLikelySupported, resolveHelpInteractionMode, unsupportedRedActionCustomerMessage, } from "./help-interaction-mode.js";
test("first ambiguous How do I add a customer asks tutorial versus Red action", () => {
    const resolution = resolveHelpInteractionMode(createInitialHelpInteractionModeState(), "How do I add a customer?");
    assert.equal(resolution.shouldAskClarification, true);
    assert.equal(resolution.clarificationQuestion, HELP_INTERACTION_CLARIFICATION_QUESTION);
    assert.equal(resolution.state.helpInteractionModeClarified, false);
    assert.equal(resolution.effectiveMode, null);
});
test("clarification is asked only once in the conversation", () => {
    const first = resolveHelpInteractionMode(createInitialHelpInteractionModeState(), "How do I add a customer?");
    assert.equal(first.shouldAskClarification, true);
    const afterChoice = resolveHelpInteractionMode(first.state, "Show me how.");
    assert.equal(afterChoice.shouldAskClarification, false);
    assert.equal(afterChoice.state.helpInteractionModeClarified, true);
    assert.equal(afterChoice.state.helpInteractionMode, "big_red_cloud_tutorial");
    const later = resolveHelpInteractionMode(afterChoice.state, "How do I add a supplier?");
    assert.equal(later.shouldAskClarification, false);
    assert.equal(later.effectiveMode, "big_red_cloud_tutorial");
});
test("tutorial mode persists for later ambiguous help questions", () => {
    let state = createInitialHelpInteractionModeState();
    state = resolveHelpInteractionMode(state, "How do I add a customer?").state;
    state = resolveHelpInteractionMode(state, "tutorial").state;
    const later = resolveHelpInteractionMode(state, "How do I create an invoice?");
    assert.equal(later.shouldAskClarification, false);
    assert.equal(later.effectiveMode, "big_red_cloud_tutorial");
    assert.equal(later.state.helpInteractionMode, "big_red_cloud_tutorial");
});
test("Switch to Red changes the mode to red_action", () => {
    let state = createInitialHelpInteractionModeState();
    state = resolveHelpInteractionMode(state, "How do I add a customer?").state;
    state = resolveHelpInteractionMode(state, "Show me how").state;
    const switched = resolveHelpInteractionMode(state, "Switch to Red");
    assert.equal(detectHelpModeSwitch("Switch to Red"), "red_action");
    assert.equal(switched.effectiveMode, "red_action");
    assert.equal(switched.state.helpInteractionMode, "red_action");
    assert.equal(switched.switchedMode, true);
});
test("Can I do this here changes the mode to red_action", () => {
    let state = createInitialHelpInteractionModeState();
    state = resolveHelpInteractionMode(state, "How do I add a supplier?").state;
    state = resolveHelpInteractionMode(state, "Big Red Cloud").state;
    const switched = resolveHelpInteractionMode(state, "Can I do this here?");
    assert.equal(switched.effectiveMode, "red_action");
    assert.equal(switched.state.helpInteractionMode, "red_action");
});
test("Show me how in Big Red Cloud changes back to tutorial mode", () => {
    let state = createInitialHelpInteractionModeState();
    state = resolveHelpInteractionMode(state, "Add this customer through Red.").state;
    assert.equal(state.helpInteractionMode, "red_action");
    const switched = resolveHelpInteractionMode(state, "Show me how in Big Red Cloud");
    assert.equal(switched.effectiveMode, "big_red_cloud_tutorial");
    assert.equal(switched.state.helpInteractionMode, "big_red_cloud_tutorial");
});
test("clear tutorial requests do not trigger clarification", () => {
    assert.equal(isClearTutorialRequest("Show me how to add a customer in Big Red Cloud."), true);
    assert.equal(isAmbiguousHelpActionQuestion("Show me how to add a customer in Big Red Cloud."), false);
    const resolution = resolveHelpInteractionMode(createInitialHelpInteractionModeState(), "Give me a tutorial with screenshots.");
    assert.equal(resolution.shouldAskClarification, false);
    assert.equal(resolution.effectiveMode, "big_red_cloud_tutorial");
});
test("clear Red-action requests do not trigger clarification", () => {
    assert.equal(isClearRedActionRequest("Create the invoice for me through Red."), true);
    assert.equal(isAmbiguousHelpActionQuestion("Create the invoice for me through Red."), false);
    const resolution = resolveHelpInteractionMode(createInitialHelpInteractionModeState(), "Please post this invoice.");
    assert.equal(resolution.shouldAskClarification, false);
    assert.equal(resolution.effectiveMode, "red_action");
});
test("tutorial mode never claims data was changed", () => {
    assert.match(TUTORIAL_MODE_NO_DATA_CHANGE_GUIDANCE, /never claim/i);
    assert.match(TUTORIAL_MODE_NO_DATA_CHANGE_GUIDANCE, /changed/i);
});
test("Red-action mode uses operational tools when available", () => {
    assert.equal(redActionLikelySupported("Add a customer through Red"), true);
    assert.equal(redActionLikelySupported("Create an invoice for me"), true);
    assert.equal(redActionLikelySupported("Update the supplier"), true);
});
test("unsupported Red actions offer tutorial instructions instead", () => {
    assert.equal(redActionLikelySupported("Change my company VAT settings"), false);
    assert.match(unsupportedRedActionCustomerMessage(), /cannot currently be completed through Red/i);
    assert.match(unsupportedRedActionCustomerMessage(), /Big Red Cloud/i);
    assert.match(UNSUPPORTED_RED_ACTION_GUIDANCE, /do not pretend/i);
});
