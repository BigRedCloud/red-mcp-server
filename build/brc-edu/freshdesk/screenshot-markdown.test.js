import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerFacingInstructionMarkdown, buildCustomerFacingScreenshotMarkdown, buildScreenshotLinksMarkdown, buildScreenshotMarkdownTextBlock, resolveHelpImagePresentation, SCREENSHOT_MARKDOWN_COPY_INSTRUCTION, toScreenshotMarkdownLink, } from "./screenshot-markdown.js";
import { isRejectedFreshdeskCaption } from "./screenshot-caption.js";
test("buildScreenshotLinksMarkdown uses exact caption and URL", () => {
    const links = buildScreenshotLinksMarkdown([
        {
            caption: "Changing a customer: Click Change",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-a",
        },
        {
            caption: "Changing a customer: Open O/Balance",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-b",
        },
    ]);
    assert.deepEqual(links, [
        "[Changing a customer: Click Change](https://red.example.com/public/brc-edu/freshdesk-images/1/token-a)",
        "[Changing a customer: Open O/Balance](https://red.example.com/public/brc-edu/freshdesk-images/1/token-b)",
    ]);
});
test("buildCustomerFacingScreenshotMarkdown joins links", () => {
    const markdown = buildCustomerFacingScreenshotMarkdown([
        {
            caption: "Changing a customer: Click Change",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-a",
        },
        {
            caption: "Changing a customer: Save changes",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-b",
        },
    ]);
    assert.equal(markdown, "[Changing a customer: Click Change](https://red.example.com/public/brc-edu/freshdesk-images/1/token-a)\n\n[Changing a customer: Save changes](https://red.example.com/public/brc-edu/freshdesk-images/1/token-b)");
});
test("buildCustomerFacingInstructionMarkdown numbers steps with links", () => {
    const markdown = buildCustomerFacingInstructionMarkdown([
        { type: "text", text: "Open Customers and click Change." },
        {
            type: "screenshot",
            caption: "Changing a customer: Click Change",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-a",
            mimeType: "image/png",
        },
        { type: "text", text: "Click O/Balance." },
        {
            type: "screenshot",
            caption: "Changing a customer: Open O/Balance",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/token-b",
            mimeType: "image/png",
        },
    ]);
    assert.match(markdown ?? "", /^1\. Open Customers and click Change\./);
    assert.match(markdown ?? "", /\[Changing a customer: Click Change\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1\/token-a\)/);
    assert.match(markdown ?? "", /2\. Click O\/Balance\./);
    assert.match(markdown ?? "", /\[Changing a customer: Open O\/Balance\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1\/token-b\)/);
});
test("generic captions are rejected from Markdown links", () => {
    assert.equal(isRejectedFreshdeskCaption("Show Image"), true);
    assert.equal(isRejectedFreshdeskCaption("Screenshot 1"), true);
    assert.equal(isRejectedFreshdeskCaption("A screenshot of a computer"), true);
    assert.equal(isRejectedFreshdeskCaption("AI-generated content may be incorrect"), true);
    assert.equal(toScreenshotMarkdownLink("Show Image", "https://red.example.com/public/brc-edu/freshdesk-images/1/t"), null);
    assert.equal(buildScreenshotLinksMarkdown([
        {
            caption: "Show Image",
            mimeType: "image/png",
            url: "https://red.example.com/public/brc-edu/freshdesk-images/1/t",
        },
    ]).length, 0);
});
test("Markdown text block includes copy instruction", () => {
    const text = buildScreenshotMarkdownTextBlock({
        screenshotMarkdown: "[Changing a customer: Click Change](https://red.example.com/public/brc-edu/freshdesk-images/1/t)",
    });
    assert.ok(text?.includes(SCREENSHOT_MARKDOWN_COPY_INSTRUCTION));
    assert.match(text ?? "", /Changing a customer: Click Change/);
    assert.equal(text?.includes("blob.core.windows.net"), false);
    assert.equal(text?.includes("sourceUrl"), false);
});
test("imagePresentation defaults to links", () => {
    assert.equal(resolveHelpImagePresentation(undefined), "links");
    assert.equal(resolveHelpImagePresentation(null), "links");
    assert.equal(resolveHelpImagePresentation("both"), "both");
    assert.equal(resolveHelpImagePresentation("inline"), "inline");
});
