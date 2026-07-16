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
        { type: "text", text: "Click Customers, then click Add." },
        {
            type: "image",
            imageIndex: 0,
            sourceUrl: "https://cdn.freshdesk.com/a.png",
            altText: "image",
            nearbyHeading: undefined,
            precedingText: "Click Customers, then click Add.",
        },
        { type: "text", text: "Enter the customer details." },
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
        assert.equal(screenshot.caption, "Customers — click Add");
        assert.match(screenshot.url, /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//);
        assert.match(result.payload.responseGuidance.images ?? "", /Never label screenshot links Show Image/i);
        assert.match(result.payload.responseGuidance.images ?? "", /Place each screenshot link immediately after the step/i);
        assert.match(result.payload.responseGuidance.images ?? "", /Do not group all screenshots into one Relevant screenshots section/i);
        const payloadJson = JSON.stringify(result.payload);
        assert.equal(payloadJson.includes("cdn.freshdesk.com"), false);
        assert.equal(payloadJson.includes("sourceUrl"), false);
        assert.equal(result.payload.instructionBlocks?.some((block) => block.type === "screenshot" && /show image/i.test(block.caption)), false);
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
