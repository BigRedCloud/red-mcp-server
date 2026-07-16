import assert from "node:assert/strict";
import test from "node:test";
import { getHelpResourceDetails, helpResourceDetailResponse, } from "./help-resource-details.js";
function freshdeskArticle() {
    return {
        id: "freshdesk-1001",
        source: "freshdesk",
        freshdeskArticleId: 1001,
        categoryId: 1,
        folderId: 2,
        folderName: "Cash Book",
        title: "Complete a bank reconciliation",
        bodyText: "Step one. Step two.",
        images: [],
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/a.png",
                blobName: "freshdesk/1001/a.png",
                sha256: "00000000000000000000000000000000000000000000000000000000000000ab",
                contentType: "image/png",
                altText: "Cash book screen",
                order: 0,
            },
        ],
        updatedAt: "2026-07-01T00:00:00.000Z",
        enabled: true,
        slug: null,
        publicUrl: null,
    };
}
test("getHelpResourceDetails returns Freshdesk image blocks when blobs exist", async () => {
    process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
    process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";
    const png = Buffer.from("fake-image-bytes");
    const index = {
        generatedAt: "2026-07-15T10:00:00.000Z",
        articleCount: 1,
        failureCount: 0,
        articles: [freshdeskArticle()],
        failures: [],
    };
    const indexContainer = {
        getBlockBlobClient() {
            return {
                async exists() {
                    return true;
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield Buffer.from(JSON.stringify(index), "utf8");
                        })(),
                    };
                },
            };
        },
    };
    const imageContainer = {
        getBlockBlobClient(blobName) {
            return {
                async exists() {
                    return blobName === "freshdesk/1001/a.png";
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield png;
                        })(),
                    };
                },
            };
        },
    };
    const result = await getHelpResourceDetails("freshdesk:1001", {
        freshdeskIndexContainer: indexContainer,
        freshdeskImageContainer: imageContainer,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.payload.imageAvailable, true);
        assert.equal(result.payload.imageCount, 1);
        assert.equal(result.payload.screenshotUrls?.length, 1);
        assert.equal(result.payload.screenshotUrls?.[0]?.caption, "Cash book screen");
        assert.match(result.payload.screenshotUrls?.[0]?.url ?? "", /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//);
        assert.match(result.payload.responseGuidance.images ?? "", /Never label screenshot links Show Image/i);
        assert.match(result.payload.responseGuidance.images ?? "", /Place each screenshot after the most relevant paragraph/i);
        assert.equal(result.payload.instructionBlocks, undefined);
        assert.equal(result.payload.publicUrl, "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation");
        assert.equal(JSON.stringify(result.payload).includes("freshdesk/1001"), false);
        assert.equal(JSON.stringify(result.payload).includes("AccountKey="), false);
        assert.equal(JSON.stringify(result.payload).includes("blob.core.windows.net"), false);
    }
});
test("getHelpResourceDetails returns ordered instructionBlocks with safe captions", async () => {
    process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
    process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";
    const article = freshdeskArticle();
    article.contentBlocks = [
        {
            type: "text",
            text: "Click Customers, then click Add.",
            workflow: "add_customer",
            nearbyActions: ["Customers", "Add"],
            sectionHeading: "Add Customer",
        },
        {
            type: "image",
            imageIndex: 0,
            sourceUrl: "https://cdn.freshdesk.com/a.png",
            altText: "image",
            nearbyHeading: "Add Customer",
            sectionHeading: "Add Customer",
            precedingText: "Click Customers, then click Add.",
            workflow: "add_customer",
            nearbyActions: ["Customers", "Add"],
        },
        { type: "text", text: "Enter the customer details.", workflow: "add_customer" },
    ];
    const png = Buffer.from("fake-image-bytes");
    const index = {
        generatedAt: "2026-07-15T10:00:00.000Z",
        articleCount: 1,
        failureCount: 0,
        articles: [article],
        failures: [],
    };
    const indexContainer = {
        getBlockBlobClient() {
            return {
                async exists() {
                    return true;
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield Buffer.from(JSON.stringify(index), "utf8");
                        })(),
                    };
                },
            };
        },
    };
    const imageContainer = {
        getBlockBlobClient(blobName) {
            return {
                async exists() {
                    return blobName === "freshdesk/1001/a.png";
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield png;
                        })(),
                    };
                },
            };
        },
    };
    const result = await getHelpResourceDetails("freshdesk:1001", {
        freshdeskIndexContainer: indexContainer,
        freshdeskImageContainer: imageContainer,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.ok(result.payload.instructionBlocks);
        assert.equal(result.payload.instructionBlocks?.[0]?.type, "text");
        assert.equal(result.payload.instructionBlocks?.[1]?.type, "screenshot");
        const screenshot = result.payload.instructionBlocks?.[1];
        assert.ok(screenshot && screenshot.type === "screenshot");
        assert.equal(screenshot.caption, "Adding a customer: Click Add");
        assert.match(screenshot.url, /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//);
        assert.match(result.payload.responseGuidance.images ?? "", /Never replace the caption with Show Image/i);
        assert.match(result.payload.responseGuidance.images ?? "", /Place each screenshot link immediately after the step/i);
        assert.match(result.payload.responseGuidance.images ?? "", /Do not group screenshots into a separate Relevant screenshots section/i);
        const payloadJson = JSON.stringify(result.payload);
        assert.equal(payloadJson.includes("cdn.freshdesk.com"), false);
        assert.equal(JSON.stringify(result.payload.instructionBlocks).includes("sourceUrl"), false);
        assert.equal(result.payload.instructionBlocks?.some((block) => block.type === "screenshot" && /show image/i.test(block.caption)), false);
    }
});
test("getHelpResourceDetails selects existing-customer screenshots from question", async () => {
    process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
    process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";
    const png = Buffer.from("fake-image-bytes");
    const article = freshdeskArticle();
    article.title = "Customer Opening Balance";
    article.images = [
        { sourceUrl: "https://cdn.freshdesk.com/change.png", altText: null },
        { sourceUrl: "https://cdn.freshdesk.com/add.png", altText: null },
        { sourceUrl: "https://cdn.freshdesk.com/ageing.png", altText: null },
        { sourceUrl: "https://cdn.freshdesk.com/obalance.png", altText: null },
        { sourceUrl: "https://cdn.freshdesk.com/save.png", altText: null },
    ];
    article.syncedImages = article.images.map((image, order) => ({
        sourceUrl: image.sourceUrl,
        blobName: `freshdesk/1001/${order}.png`,
        sha256: `00000000000000000000000000000000000000000000000000000000000000${order}${order}`,
        contentType: "image/png",
        altText: "Show Image",
        order,
    }));
    article.contentBlocks = [
        {
            type: "text",
            text: "Open Customers, select the customer and click Change.",
            workflow: "existing_customer",
            nearbyActions: ["Customers", "Change"],
        },
        {
            type: "image",
            imageIndex: 0,
            precedingText: "Open Customers, select the customer and click Change.",
            workflow: "existing_customer",
            nearbyActions: ["Customers", "Change"],
            altText: "Show Image",
        },
        {
            type: "text",
            text: "To add a brand-new customer, click Add.",
            workflow: "add_customer",
            nearbyActions: ["Add"],
        },
        {
            type: "image",
            imageIndex: 1,
            precedingText: "To add a brand-new customer, click Add.",
            workflow: "add_customer",
            nearbyActions: ["Add"],
            altText: "Show Image",
        },
        {
            type: "text",
            text: "Click O/Balance.",
            workflow: "existing_customer",
            nearbyActions: ["O/Balance"],
        },
        {
            type: "image",
            imageIndex: 3,
            precedingText: "Click O/Balance.",
            workflow: "existing_customer",
            nearbyActions: ["O/Balance"],
            altText: "Show Image",
        },
        {
            type: "text",
            text: "Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus.",
            workflow: "customer_opening_balance",
            nearbyActions: ["Current", "1 Month", "2 Months", "3 Months Plus"],
        },
        {
            type: "image",
            imageIndex: 2,
            precedingText: "Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus.",
            workflow: "customer_opening_balance",
            nearbyActions: ["Current", "1 Month", "2 Months", "3 Months Plus"],
            altText: "Show Image",
        },
        {
            type: "text",
            text: "Click Save on the main customer screen.",
            workflow: "final_save",
            nearbyActions: ["Save"],
        },
        {
            type: "image",
            imageIndex: 4,
            precedingText: "Click Save on the main customer screen.",
            workflow: "final_save",
            nearbyActions: ["Save"],
            altText: "Show Image",
        },
    ];
    const index = {
        generatedAt: "2026-07-15T10:00:00.000Z",
        articleCount: 1,
        failureCount: 0,
        articles: [article],
        failures: [],
    };
    const indexContainer = {
        getBlockBlobClient() {
            return {
                async exists() {
                    return true;
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield Buffer.from(JSON.stringify(index), "utf8");
                        })(),
                    };
                },
            };
        },
    };
    const imageContainer = {
        getBlockBlobClient(blobName) {
            return {
                async exists() {
                    return /^freshdesk\/1001\/\d+\.png$/.test(blobName);
                },
                async download() {
                    return {
                        readableStreamBody: (async function* () {
                            yield png;
                        })(),
                    };
                },
            };
        },
    };
    const result = await getHelpResourceDetails("freshdesk:1001", {
        freshdeskIndexContainer: indexContainer,
        freshdeskImageContainer: imageContainer,
        question: "I've added a customer who already owes us money. How do I enter their opening balance?",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        const screenshots = result.payload.instructionBlocks?.filter((block) => block.type === "screenshot");
        assert.ok(screenshots && screenshots.length === 4);
        assert.equal(screenshots?.some((block) => /Click Add/i.test(block.caption)), false);
        assert.ok(screenshots?.some((block) => /Click Change/i.test(block.caption)));
        assert.ok(screenshots?.some((block) => /Open O\/Balance/i.test(block.caption)));
        assert.ok(screenshots?.some((block) => /Enter aged balances/i.test(block.caption)));
        assert.ok(screenshots?.some((block) => /Save changes/i.test(block.caption)));
        assert.equal(screenshots?.some((block) => block.type === "screenshot" && /show image/i.test(block.caption)), false);
        assert.equal(JSON.stringify(result.payload.instructionBlocks).includes("sourceUrl"), false);
        assert.equal(JSON.stringify(result.payload).includes("cdn.freshdesk.com"), false);
    }
});
test("helpResourceDetailResponse includes MCP image blocks and caption text", () => {
    const response = helpResourceDetailResponse({
        resourceId: "freshdesk:1001",
        source: "freshdesk",
        title: "Test",
        summary: "Summary",
        instructions: "Instructions",
        publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-test",
        category: "Help",
        topics: ["Help"],
        imageCount: 1,
        responseGuidance: {
            supportFooter: "footer",
            doNotExpose: [],
        },
    }, [
        {
            mimeType: "image/png",
            data: Buffer.from("x").toString("base64"),
            caption: "Screenshot 1: Cash book screen",
            order: 0,
        },
    ]);
    assert.equal(response.content.length, 3);
    assert.equal(response.content[0]?.type, "text");
    assert.equal(response.content[1]?.type, "text");
    assert.equal(response.content[2]?.type, "image");
});
test("getHelpResourceDetails rejects invalid resource IDs safely", async () => {
    const result = await getHelpResourceDetails("not-a-valid-id");
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.error, /invalid/i);
    }
});
test("customer docs do not attempt Azure image loading", async () => {
    const result = await getHelpResourceDetails("customer_docs:missing");
    assert.equal(result.ok, false);
});
