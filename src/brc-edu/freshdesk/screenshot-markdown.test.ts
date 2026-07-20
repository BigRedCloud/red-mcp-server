import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerFacingInstructionMarkdown,
  buildCustomerFacingScreenshotMarkdown,
  buildScreenshotLinkLabel,
  buildScreenshotLinkMarkdown,
  buildScreenshotLinksMarkdown,
  buildScreenshotMarkdownTextBlock,
  resolveHelpImagePresentation,
  SCREENSHOT_MARKDOWN_COPY_INSTRUCTION,
  toScreenshotMarkdownLink,
} from "./screenshot-markdown.js";
import { isRejectedFreshdeskCaption } from "./screenshot-caption.js";
import { FRESHDESK_SCREENSHOT_LINK_LABEL } from "./freshdesk-public-image-url.js";

const SIGNED_A =
  "https://red.example.com/public/brc-edu/freshdesk-images/1/token-a";
const SIGNED_B =
  "https://red.example.com/public/brc-edu/freshdesk-images/1/token-b";

test("buildScreenshotLinkLabel uses View image and numbers within a step", () => {
  assert.equal(buildScreenshotLinkLabel(), "View image");
  assert.equal(buildScreenshotLinkLabel(0, 1), "View image");
  assert.equal(buildScreenshotLinkLabel(0, 2), "View image 1");
  assert.equal(buildScreenshotLinkLabel(1, 2), "View image 2");
});

test("buildScreenshotLinksMarkdown uses View image with exact URL", () => {
  const longCaption =
    "Click Bank Accounts > select the relevant Bank Account > click Ledger";
  const links = buildScreenshotLinksMarkdown([
    {
      caption: longCaption,
      linkLabel: FRESHDESK_SCREENSHOT_LINK_LABEL,
      mimeType: "image/png",
      url: SIGNED_A,
    },
    {
      caption: "Changing a customer: Open O/Balance",
      mimeType: "image/png",
      url: SIGNED_B,
    },
  ]);

  assert.deepEqual(links, [
    `[View image](${SIGNED_A})`,
    `[View image](${SIGNED_B})`,
  ]);
  assert.equal(links.some((link) => link.includes(longCaption)), false);
});

test("buildCustomerFacingScreenshotMarkdown joins View image links", () => {
  const markdown = buildCustomerFacingScreenshotMarkdown([
    {
      caption: "Changing a customer: Click Change",
      mimeType: "image/png",
      url: SIGNED_A,
    },
    {
      caption: "Changing a customer: Save changes",
      mimeType: "image/png",
      url: SIGNED_B,
    },
  ]);

  assert.equal(
    markdown,
    `[View image](${SIGNED_A})\n\n[View image](${SIGNED_B})`,
  );
});

test("buildCustomerFacingInstructionMarkdown uses View image beside steps", () => {
  const longCaption =
    "Click Bank Accounts > select the relevant Bank Account > click Ledger";
  const markdown = buildCustomerFacingInstructionMarkdown([
    {
      type: "text",
      text: "Click Bank Accounts → select the relevant Bank Account → click Ledger.",
    },
    {
      type: "screenshot",
      caption: longCaption,
      url: SIGNED_A,
      mimeType: "image/png",
    },
    { type: "text", text: "Click O/Balance." },
    {
      type: "screenshot",
      caption: "Changing a customer: Open O/Balance",
      url: SIGNED_B,
      mimeType: "image/png",
    },
  ]);

  assert.match(
    markdown ?? "",
    /^1\. Click Bank Accounts → select the relevant Bank Account → click Ledger\./,
  );
  assert.match(markdown ?? "", /\[View image\]\(https:\/\/red\.example\.com/);
  assert.equal(markdown?.includes(longCaption), false);
  assert.equal(
    markdown?.includes("Changing a customer: Open O/Balance"),
    false,
  );
  assert.match(markdown ?? "", /2\. Click O\/Balance\./);
  assert.match(
    markdown ?? "",
    /\[View image\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1\/token-b\)/,
  );
});

test("multiple screenshots on one step use View image 1 and View image 2", () => {
  const markdown = buildCustomerFacingInstructionMarkdown([
    { type: "text", text: "Enter the invoice details." },
    {
      type: "screenshot",
      caption: "Sales invoice: Header fields",
      url: SIGNED_A,
      mimeType: "image/png",
    },
    {
      type: "screenshot",
      caption: "Sales invoice: Line items",
      url: SIGNED_B,
      mimeType: "image/png",
    },
  ]);

  assert.match(markdown ?? "", /^1\. Enter the invoice details\./);
  assert.match(markdown ?? "", /\[View image 1\]\(https:\/\/red\.example\.com/);
  assert.match(markdown ?? "", /\[View image 2\]\(https:\/\/red\.example\.com/);
  assert.equal(markdown?.includes("Sales invoice: Header fields"), false);
  assert.equal(markdown?.includes("Sales invoice: Line items"), false);
});

test("internal caption remains available while link uses View image", () => {
  const screenshot = {
    caption: "Bank reconciliation: Select the account and click Ledger",
    linkLabel: "View image" as const,
    mimeType: "image/png",
    url: SIGNED_A,
  };

  assert.equal(
    screenshot.caption,
    "Bank reconciliation: Select the account and click Ledger",
  );
  assert.equal(
    buildScreenshotLinkMarkdown(screenshot),
    `[View image](${SIGNED_A})`,
  );
});

test("rejected descriptive captions still emit View image links", () => {
  assert.equal(isRejectedFreshdeskCaption("Show Image"), true);
  assert.equal(isRejectedFreshdeskCaption("View image"), true);
  assert.equal(
    toScreenshotMarkdownLink(
      "Show Image",
      "https://red.example.com/public/brc-edu/freshdesk-images/1/t",
    ),
    "[View image](https://red.example.com/public/brc-edu/freshdesk-images/1/t)",
  );
  assert.equal(
    buildScreenshotLinksMarkdown([
      {
        caption: "Show Image",
        mimeType: "image/png",
        url: "https://red.example.com/public/brc-edu/freshdesk-images/1/t",
      },
    ]).length,
    1,
  );
});

test("Markdown text block includes copy instruction with View image guidance", () => {
  const text = buildScreenshotMarkdownTextBlock({
    screenshotMarkdown: `[View image](https://red.example.com/public/brc-edu/freshdesk-images/1/t)`,
  });

  assert.ok(text?.includes(SCREENSHOT_MARKDOWN_COPY_INSTRUCTION));
  assert.match(text ?? "", /\[View image\]/);
  assert.equal(text?.includes("blob.core.windows.net"), false);
  assert.equal(text?.includes("sourceUrl"), false);
});

test("imagePresentation defaults to links", () => {
  assert.equal(resolveHelpImagePresentation(undefined), "links");
  assert.equal(resolveHelpImagePresentation(null), "links");
  assert.equal(resolveHelpImagePresentation("both"), "both");
  assert.equal(resolveHelpImagePresentation("inline"), "inline");
});
