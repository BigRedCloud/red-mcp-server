import assert from "node:assert/strict";
import test from "node:test";
import { parseFreshdeskArticleContent } from "./article-content-parser.js";
import { buildFreshdeskInstructionBlocks, enrichScreenshotUrlCaptions, SCREENSHOT_MATCH_MIN_SCORE, } from "./instruction-blocks.js";
import { buildFreshdeskScreenshotCaption, FRESHDESK_SCREENSHOT_CAPTION_FALLBACK, FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH, isGenericFreshdeskAltText, } from "./screenshot-caption.js";
import { selectWorkflowsFromQuestion, extractNearbyActions, } from "./workflow-context.js";
const SAMPLE_HTML = `
  <h2>Add Customer</h2>
  <p>Click Lookup or Setup.</p>
  <p>Click Customers, then click Add.</p>
  <img src="https://cdn.freshdesk.com/customers-list.png" alt="image" width="800" height="500" />
  <p>Fill in the relevant Details. The A/C Code box is mandatory.</p>
  <img src="https://cdn.freshdesk.com/add-customer.png" alt="screenshot" />
  <p>Click Email Preferences on the right-hand side.</p>
  <img src="https://cdn.freshdesk.com/email-prefs.png" alt="Customer Email Preferences" />
  <img src="https://cdn.freshdesk.com/logo.png" alt="logo" class="logo" width="24" height="24" />
`;
/** Opening-balance article: images appear in raw order 1–5; text follows the logical path. */
const OPENING_BALANCE_HTML = `
  <h2>Customer Opening Balance</h2>
  <p>Go to Lookup or Setup, open Customers, select the customer and click Change.</p>
  <img src="https://cdn.freshdesk.com/ob-change.png" alt="Show Image" width="800" height="500" />
  <p>To add a brand-new customer instead, click Add.</p>
  <img src="https://cdn.freshdesk.com/ob-add.png" alt="Show Image" width="800" height="500" />
  <p>Click O/Balance.</p>
  <img src="https://cdn.freshdesk.com/ob-obalance.png" alt="Show Image" width="800" height="500" />
  <p>Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus as appropriate.</p>
  <img src="https://cdn.freshdesk.com/ob-ageing.png" alt="Show Image" width="800" height="500" />
  <p>Click OK, then click Save on the main customer screen.</p>
  <img src="https://cdn.freshdesk.com/ob-save.png" alt="Show Image" width="800" height="500" />
`;
/**
 * Deliberately out-of-order images: ageing screenshot (index 2) appears in the
 * HTML before the O/Balance screenshot (index 3), while instruction text puts
 * O/Balance before aged balances. Distinct alt text (as authored in Freshdesk)
 * lets matching follow meaning rather than raw image index.
 */
const OPENING_BALANCE_REORDERED_IMAGES_HTML = `
  <h2>Customer Opening Balance</h2>
  <p>Go to Lookup or Setup, open Customers, select the customer and click Change.</p>
  <img src="https://cdn.freshdesk.com/ob2-change.png" alt="Customers list Change" />
  <p>To add a brand-new customer instead, click Add.</p>
  <img src="https://cdn.freshdesk.com/ob2-add.png" alt="Customers list Add" />
  <p>Click O/Balance.</p>
  <p>Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus as appropriate.</p>
  <img src="https://cdn.freshdesk.com/ob2-ageing.png" alt="Opening balance Current 1 Month 2 Months" />
  <img src="https://cdn.freshdesk.com/ob2-obalance.png" alt="Change a Customer O/Balance" />
  <p>Click OK, then click Save on the main customer screen.</p>
  <img src="https://cdn.freshdesk.com/ob2-save.png" alt="Change a Customer Save" />
`;
const BANK_RECON_HTML = `
  <h2>Bank Reconciliation</h2>
  <p>Open Bank Reconciliation from the Cash Book menu.</p>
  <img src="https://cdn.freshdesk.com/bank-open.png" alt="screenshot" />
  <p>Enter the statement balance from your bank statement.</p>
  <img src="https://cdn.freshdesk.com/bank-balance.png" alt="screenshot" />
  <p>Click Save to complete the reconciliation.</p>
  <img src="https://cdn.freshdesk.com/bank-save.png" alt="screenshot" />
`;
const EMAIL_PREFS_HTML = `
  <h2>Customer Email Preferences</h2>
  <p>Open Customers and click Change for the customer.</p>
  <img src="https://cdn.freshdesk.com/email-change.png" alt="screenshot" />
  <p>Click Email Preferences on the right-hand side.</p>
  <img src="https://cdn.freshdesk.com/email-open.png" alt="screenshot" />
  <p>Click Save on the customer screen.</p>
  <img src="https://cdn.freshdesk.com/email-save.png" alt="screenshot" />
`;
function mockScreenshotUrls(count, articleId = 1001) {
    return Array.from({ length: count }, (_value, index) => ({
        caption: `Screenshot ${index + 1}`,
        mimeType: "image/png",
        url: `https://red.example.com/public/brc-edu/freshdesk-images/${articleId}/token-${index}`,
        imageIndex: index,
    }));
}
test("Freshdesk HTML text and images are preserved in DOM order", () => {
    const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
    assert.deepEqual(parsed.contentBlocks.map((block) => block.type), ["text", "text", "text", "image", "text", "image", "text", "image"]);
    assert.equal(parsed.images.length, 3);
    assert.equal(parsed.images[0]?.sourceUrl, "https://cdn.freshdesk.com/customers-list.png");
    assert.equal(parsed.contentBlocks.find((block) => block.type === "text")?.text, "Add Customer");
});
test("screenshot is associated with nearest preceding instruction", () => {
    const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
    const firstImage = parsed.contentBlocks.find((block) => block.type === "image");
    assert.ok(firstImage && firstImage.type === "image");
    assert.equal(firstImage.precedingText, "Click Customers, then click Add.");
    assert.equal(firstImage.sectionHeading ?? firstImage.nearbyHeading, "Add Customer");
    assert.ok(firstImage.nearbyActions?.includes("Add"));
    assert.equal(firstImage.workflow, "add_customer");
});
test("nearest heading is used when alt text is generic", () => {
    const caption = buildFreshdeskScreenshotCaption({
        altText: "image",
        nearbyHeading: "Customers list",
        precedingText: undefined,
    });
    assert.equal(caption, "Customers list");
});
test("meaningful alt text has highest caption priority", () => {
    const caption = buildFreshdeskScreenshotCaption({
        altText: "Customer Email Preferences",
        nearbyHeading: "Add Customer",
        precedingText: "Click Email Preferences on the right-hand side.",
        workflow: "email_preferences",
    });
    assert.match(caption, /Customer Email Preferences|Customer email settings/i);
});
test("generic alt text such as image or screenshot is ignored", () => {
    assert.equal(isGenericFreshdeskAltText("image"), true);
    assert.equal(isGenericFreshdeskAltText("screenshot"), true);
    assert.equal(isGenericFreshdeskAltText("Show Image"), true);
    assert.equal(isGenericFreshdeskAltText("Customer Email Preferences"), false);
});
test("caption uses nearby instruction text with workflow format", () => {
    const caption = buildFreshdeskScreenshotCaption({
        altText: "screenshot",
        nearbyHeading: "Add Customer",
        precedingText: "Click Customers, then click Add.",
        workflow: "add_customer",
        nearbyActions: ["Customers", "Add"],
    });
    assert.equal(caption, "Adding a customer: Click Add");
});
test("caption length is capped", () => {
    const longText = "A".repeat(200);
    const caption = buildFreshdeskScreenshotCaption({
        altText: longText,
    });
    assert.ok(caption.length <= FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH);
    assert.match(caption, /…$/);
});
test("caption HTML is removed safely", () => {
    const caption = buildFreshdeskScreenshotCaption({
        altText: "<b>Add Customer</b> &amp; save",
    });
    assert.equal(caption.includes("<"), false);
    assert.equal(caption.includes("&amp;"), false);
    assert.match(caption, /Add Customer/);
});
test("instructionBlocks alternate correctly between text and screenshots", () => {
    const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
    const screenshotUrls = mockScreenshotUrls(3);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question: "How do I add a new customer?" });
    assert.ok(blocks.length >= 5);
    assert.equal(blocks[0]?.type, "text");
    assert.ok(blocks.some((block) => block.type === "screenshot"));
    const serialized = JSON.stringify(blocks);
    assert.equal(serialized.includes("cdn.freshdesk.com"), false);
    assert.equal(serialized.includes("blobName"), false);
    assert.equal(serialized.includes("sourceUrl"), false);
    assert.equal(serialized.includes("sha256"), false);
    assert.equal(serialized.includes("Show Image"), false);
    assert.equal(serialized.includes("workflow"), false);
    assert.equal(serialized.includes("nearbyActions"), false);
    const firstScreenshot = blocks.find((block) => block.type === "screenshot");
    assert.ok(firstScreenshot && firstScreenshot.type === "screenshot");
    assert.match(firstScreenshot.url, /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\//);
    assert.notEqual(firstScreenshot.caption, FRESHDESK_SCREENSHOT_CAPTION_FALLBACK);
    assert.notEqual(firstScreenshot.caption, "Show Image");
});
test("enrichScreenshotUrlCaptions uses content-block context", () => {
    const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
    const enriched = enrichScreenshotUrlCaptions([
        {
            caption: "Freshdesk screenshot",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1001/token-a",
            imageIndex: 0,
        },
    ], parsed.contentBlocks);
    assert.equal(enriched[0]?.caption, "Adding a customer: Click Add");
});
test("caption combines heading with fill instruction for A/C Code", () => {
    const caption = buildFreshdeskScreenshotCaption({
        altText: "image",
        nearbyHeading: "Add Customer",
        precedingText: "Fill in the relevant Details. The A/C Code box is mandatory.",
        workflow: "add_customer",
    });
    assert.equal(caption, "Adding a customer: Enter the required A/C Code");
});
test("existing-customer opening balance excludes Add screenshot", () => {
    const parsed = parseFreshdeskArticleContent(OPENING_BALANCE_HTML);
    const screenshotUrls = mockScreenshotUrls(5);
    const question = "I've added a customer who already owes us money. How do I enter their opening balance?";
    const selected = selectWorkflowsFromQuestion(question);
    assert.equal(selected.exclude.has("add_customer"), true);
    assert.equal(selected.include.has("existing_customer"), true);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question });
    const screenshots = blocks.filter((block) => block.type === "screenshot");
    const urls = screenshots.map((block) => block.type === "screenshot" ? block.url : "");
    assert.equal(urls.includes(screenshotUrls[1].url), false, "Add screenshot excluded");
    assert.equal(urls.includes(screenshotUrls[0].url), true, "Change screenshot included");
    assert.equal(urls.includes(screenshotUrls[2].url), true, "O/Balance screenshot included");
    assert.equal(urls.includes(screenshotUrls[3].url), true, "Ageing screenshot included");
    assert.equal(urls.includes(screenshotUrls[4].url), true, "Save screenshot included");
    assert.equal(new Set(urls).size, urls.length, "no repeated screenshots");
});
test("opening balance screenshots match steps by meaning not raw image order", () => {
    const parsed = parseFreshdeskArticleContent(OPENING_BALANCE_REORDERED_IMAGES_HTML);
    const screenshotUrls = mockScreenshotUrls(5);
    const question = "I've added a customer who already owes us money. How do I enter their opening balance?";
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question });
    const paired = [];
    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (block?.type !== "text") {
            continue;
        }
        const next = blocks[index + 1];
        paired.push({
            text: block.text,
            url: next?.type === "screenshot" ? next.url : undefined,
            caption: next?.type === "screenshot" ? next.caption : undefined,
        });
    }
    const changeStep = paired.find((entry) => /click Change/i.test(entry.text));
    const obalanceStep = paired.find((entry) => /O\/Balance/i.test(entry.text));
    const ageingStep = paired.find((entry) => /1 Month/i.test(entry.text));
    const saveStep = paired.find((entry) => /click Save/i.test(entry.text));
    assert.equal(changeStep?.url, screenshotUrls[0].url);
    assert.match(changeStep?.caption ?? "", /Click Change/i);
    assert.equal(obalanceStep?.url, screenshotUrls[3].url);
    assert.match(obalanceStep?.caption ?? "", /Open O\/Balance|O\/Balance/i);
    assert.equal(ageingStep?.url, screenshotUrls[2].url);
    assert.match(ageingStep?.caption ?? "", /Enter aged balances|1 Month/i);
    assert.equal(saveStep?.url, screenshotUrls[4].url);
    assert.match(saveStep?.caption ?? "", /Save changes|Save/i);
    // Instruction order: Change → O/Balance → ageing → Save (not raw image order).
    const screenshotOrder = blocks
        .filter((block) => block.type === "screenshot")
        .map((block) => (block.type === "screenshot" ? block.url : ""));
    assert.deepEqual(screenshotOrder, [
        screenshotUrls[0].url,
        screenshotUrls[3].url,
        screenshotUrls[2].url,
        screenshotUrls[4].url,
    ]);
});
test("Add and Change captions differ; O/Balance and Save captions differ", () => {
    const addCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click Add.",
        workflow: "add_customer",
        nearbyActions: ["Add"],
    });
    const changeCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click Change.",
        workflow: "existing_customer",
        nearbyActions: ["Change"],
    });
    const obalanceCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click O/Balance.",
        workflow: "existing_customer",
        nearbyActions: ["O/Balance"],
    });
    const saveCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click Save on the main customer screen.",
        workflow: "final_save",
        nearbyActions: ["Save"],
    });
    assert.notEqual(addCaption, changeCaption);
    assert.notEqual(obalanceCaption, saveCaption);
    assert.match(addCaption, /Adding a customer: Click Add/i);
    assert.match(changeCaption, /Changing a customer: Click Change/i);
    assert.match(obalanceCaption, /Open O\/Balance/i);
    assert.match(saveCaption, /Save changes/i);
});
test("weak screenshot matches are omitted", () => {
    const blocks = buildFreshdeskInstructionBlocks([
        {
            type: "text",
            text: "Review the overview notes for this feature.",
            workflow: "generic",
        },
        {
            type: "image",
            imageIndex: 0,
            altText: "Show Image",
            precedingText: "Something unrelated about printers.",
            workflow: "generic",
            nearbyActions: ["Printers"],
        },
    ], mockScreenshotUrls(1), { question: "How do printers work?" });
    assert.equal(blocks.some((block) => block.type === "screenshot"), false);
    assert.ok(SCREENSHOT_MATCH_MIN_SCORE >= 4);
});
test("screenshots without valid URLs are omitted", () => {
    const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, [
        {
            caption: "Broken",
            mimeType: "image/png",
            url: "",
            imageIndex: 0,
        },
    ], { question: "How do I add a new customer?" });
    assert.equal(blocks.some((block) => block.type === "screenshot"), false);
});
test("exact signed URL is preserved unchanged", () => {
    const exactUrl = "https://red.example.com/public/brc-edu/freshdesk-images/1001/exact.token.value";
    const parsed = parseFreshdeskArticleContent(OPENING_BALANCE_HTML);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, [
        {
            caption: "x",
            mimeType: "image/png",
            url: exactUrl,
            imageIndex: 0,
        },
        ...mockScreenshotUrls(4).slice(1),
    ], {
        question: "I've added a customer who already owes us money. How do I enter their opening balance?",
    });
    const changeScreenshot = blocks.find((block) => block.type === "screenshot" && /Click Change/i.test(block.caption));
    assert.ok(changeScreenshot && changeScreenshot.type === "screenshot");
    assert.equal(changeScreenshot.url, exactUrl);
});
test("Azure source URLs and blob metadata are never exposed", () => {
    const parsed = parseFreshdeskArticleContent(OPENING_BALANCE_HTML);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, mockScreenshotUrls(5), {
        question: "I've added a customer who already owes us money. How do I enter their opening balance?",
    });
    const serialized = JSON.stringify(blocks);
    assert.equal(serialized.includes("cdn.freshdesk.com"), false);
    assert.equal(serialized.includes("blob.core.windows.net"), false);
    assert.equal(serialized.includes("AccountKey="), false);
    assert.equal(serialized.includes("sourceUrl"), false);
    assert.equal(serialized.includes("sha256"), false);
    assert.equal(serialized.includes("blobName"), false);
});
test("bank reconciliation workflow uses generic matching without hard-coding", () => {
    const parsed = parseFreshdeskArticleContent(BANK_RECON_HTML);
    const screenshotUrls = mockScreenshotUrls(3, 2002);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question: "How do I complete a bank reconciliation?" });
    const screenshots = blocks.filter((block) => block.type === "screenshot");
    assert.ok(screenshots.length >= 2);
    assert.ok(screenshots.some((block) => block.type === "screenshot" &&
        /Bank reconciliation/i.test(block.caption) &&
        /statement balance/i.test(block.caption)));
    assert.equal(JSON.stringify(blocks).includes("Show Image"), false);
});
test("customer email preferences workflow uses generic matching", () => {
    const parsed = parseFreshdeskArticleContent(EMAIL_PREFS_HTML);
    const screenshotUrls = mockScreenshotUrls(3, 2003);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question: "How do I open customer email preferences?" });
    const screenshots = blocks.filter((block) => block.type === "screenshot");
    assert.ok(screenshots.length >= 1);
    assert.ok(screenshots.some((block) => block.type === "screenshot" &&
        /Email Preferences|email settings/i.test(block.caption)));
    const serialized = JSON.stringify(blocks);
    assert.equal(serialized.includes("Show Image"), false);
    assert.ok(screenshots.every((block) => block.type === "screenshot" &&
        block.caption.length <= FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH));
});
test("new-customer question prefers Add workflow screenshots", () => {
    const parsed = parseFreshdeskArticleContent(OPENING_BALANCE_HTML);
    const screenshotUrls = mockScreenshotUrls(5);
    const blocks = buildFreshdeskInstructionBlocks(parsed.contentBlocks, screenshotUrls, { question: "How do I add a brand-new customer?" });
    const urls = blocks
        .filter((block) => block.type === "screenshot")
        .map((block) => (block.type === "screenshot" ? block.url : ""));
    assert.equal(urls.includes(screenshotUrls[1].url), true);
    assert.ok(blocks.some((block) => block.type === "screenshot" && /Click Add/i.test(block.caption)));
});
test("extractNearbyActions finds O/Balance and ageing buckets", () => {
    const actions = extractNearbyActions("Click O/Balance then enter Current, 1 Month, 2 Months and 3 Months Plus");
    assert.ok(actions.includes("O/Balance"));
    assert.ok(actions.includes("Current"));
    assert.ok(actions.includes("1 Month"));
});
test("email preferences caption is accurate and O/Balance is not substituted", () => {
    const openCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click Email Preferences on the right-hand side.",
        workflow: "email_preferences",
        nearbyActions: ["Email Preferences"],
    });
    assert.match(openCaption, /Open Email Preferences/i);
    const shownCaption = buildFreshdeskScreenshotCaption({
        altText: "Change a Customer",
        precedingText: "Open Customers and click Change.",
        workflow: "existing_customer",
        nearbyActions: ["Change", "Email Preferences"],
    });
    assert.match(shownCaption, /Email Preferences button is shown|Click Change/i);
    assert.doesNotMatch(shownCaption, /^.*Open Email Preferences$/i);
    const obalanceCaption = buildFreshdeskScreenshotCaption({
        altText: "Show Image",
        precedingText: "Click O/Balance.",
        workflow: "existing_customer",
        nearbyActions: ["O/Balance"],
    });
    assert.match(obalanceCaption, /Open O\/Balance/i);
    assert.doesNotMatch(obalanceCaption, /Email Preferences/i);
});
test("legacy articles without contentBlocks still enrich captions safely", () => {
    const enriched = enrichScreenshotUrlCaptions([
        {
            caption: "Show Image",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/9/token",
        },
    ], undefined);
    assert.equal(enriched.length, 1);
    assert.notEqual(enriched[0]?.caption, "Show Image");
    assert.equal(enriched[0]?.url, "https://red.example.com/public/brc-edu/freshdesk-images/9/token");
});
