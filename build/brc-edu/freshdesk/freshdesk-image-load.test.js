import assert from "node:assert/strict";
import test from "node:test";
import { extractSafeBlobNameFromLegacyAzureUrl, normalizeFreshdeskImageMimeType, normalizeFreshdeskSyncedImages, } from "./freshdesk-image-metadata.js";
import { loadFreshdeskImageBlocks, } from "./freshdesk-image-load.js";
function createArticle(overrides = {}) {
    return {
        id: "freshdesk-1001",
        source: "freshdesk",
        freshdeskArticleId: 1001,
        categoryId: 1,
        folderId: 2,
        folderName: "Customers",
        title: "How do I add a Customer?",
        bodyText: "Step one. Step two.",
        images: [{ sourceUrl: "https://cdn.freshdesk.com/a.png", altText: "Add customer screen" }],
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/a.png",
                blobName: "freshdesk/1001/abc.png",
                sha256: "abc",
                contentType: "image/png",
                altText: "Add customer screen",
                order: 0,
            },
        ],
        updatedAt: "2026-07-01T00:00:00.000Z",
        enabled: true,
        slug: "how-do-i-add-a-customer-",
        publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-how-do-i-add-a-customer-",
        ...overrides,
    };
}
function createMockContainer(blobs, options = {}) {
    return {
        getBlockBlobClient(blobName) {
            return {
                async exists() {
                    return Object.hasOwn(blobs, blobName);
                },
                async download() {
                    if (options.failDownloads?.has(blobName)) {
                        throw new Error("download failed");
                    }
                    const body = blobs[blobName];
                    if (!body) {
                        throw new Error("missing");
                    }
                    return {
                        readableStreamBody: (async function* () {
                            yield body;
                        })(),
                    };
                },
            };
        },
    };
}
test("normalizeFreshdeskImageMimeType normalizes image/jpg to image/jpeg", () => {
    assert.equal(normalizeFreshdeskImageMimeType("image/jpg"), "image/jpeg");
});
test("legacy syncedImages receive mimeType and order", () => {
    const article = {
        images: [
            {
                sourceUrl: "https://example.com/a.jpg",
                altText: "Changing a customer",
            },
            {
                sourceUrl: "https://example.com/b.jpg",
                altText: "Open O/Balance",
            },
        ],
        syncedImages: [
            {
                blobName: "freshdesk/1001/a.jpg",
                sha256: "a".repeat(64),
                contentType: "image/jpeg",
            },
            {
                blobName: "freshdesk/1001/b.jpg",
                sha256: "b".repeat(64),
                contentType: "image/jpeg",
            },
        ],
    };
    const result = normalizeFreshdeskSyncedImages(article.syncedImages, article.images);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.mimeType, "image/jpeg");
    assert.equal(result[0]?.order, 0);
    assert.equal(result[1]?.order, 1);
});
test("extractSafeBlobNameFromLegacyAzureUrl keeps only safe freshdesk blob paths", () => {
    assert.equal(extractSafeBlobNameFromLegacyAzureUrl("https://account.blob.core.windows.net/brc-edu-images/freshdesk/1001/abc.png", { allowedContainerName: "brc-edu-images" }), "freshdesk/1001/abc.png");
    assert.equal(extractSafeBlobNameFromLegacyAzureUrl("https://account.blob.core.windows.net/other/freshdesk/1001/abc.png", { allowedContainerName: "brc-edu-images" }), null);
});
test("Freshdesk article with one stored PNG returns one MCP image block", async () => {
    const png = Buffer.from("fake-png");
    const container = createMockContainer({
        "freshdesk/1001/abc.png": png,
    });
    const result = await loadFreshdeskImageBlocks(createArticle(), container, {
        maxImageBytes: png.byteLength,
        maxTotalBytes: png.byteLength,
    });
    assert.equal(result.imageCount, 1);
    assert.equal(result.blocks[0]?.mimeType, "image/png");
    assert.match(result.blocks[0]?.data ?? "", /^[A-Za-z0-9+/=]+$/);
    assert.match(result.blocks[0]?.caption ?? "", /Screenshot 1/i);
});
test("multiple images return in article order", async () => {
    const first = Buffer.from("one");
    const second = Buffer.from("two");
    const container = createMockContainer({
        "freshdesk/1001/first.png": first,
        "freshdesk/1001/second.png": second,
    });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/1.png",
                blobName: "freshdesk/1001/first.png",
                sha256: "1",
                contentType: "image/png",
                order: 0,
            },
            {
                sourceUrl: "https://cdn.freshdesk.com/2.png",
                blobName: "freshdesk/1001/second.png",
                sha256: "2",
                contentType: "image/png",
                order: 1,
            },
        ],
    }), container, {
        maxImageBytes: 10,
        maxTotalBytes: 20,
    });
    assert.equal(result.imageCount, 2);
    assert.deepEqual(result.blocks.map((block) => block.order), [0, 1]);
});
test("PNG, JPEG, WebP, and GIF MIME types are preserved correctly", async () => {
    const container = createMockContainer({
        "freshdesk/1001/a.png": Buffer.from("a"),
        "freshdesk/1001/b.jpg": Buffer.from("b"),
        "freshdesk/1001/c.webp": Buffer.from("c"),
        "freshdesk/1001/d.gif": Buffer.from("d"),
    });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            { sourceUrl: "a", blobName: "freshdesk/1001/a.png", sha256: "a", contentType: "image/png", order: 0 },
            { sourceUrl: "b", blobName: "freshdesk/1001/b.jpg", sha256: "b", contentType: "image/jpg", order: 1 },
            { sourceUrl: "c", blobName: "freshdesk/1001/c.webp", sha256: "c", contentType: "image/webp", order: 2 },
            { sourceUrl: "d", blobName: "freshdesk/1001/d.gif", sha256: "d", contentType: "image/gif", order: 3 },
        ],
    }), container, { maxImages: 4, maxImageBytes: 10, maxTotalBytes: 40 });
    assert.deepEqual(result.blocks.map((block) => block.mimeType), [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
    ]);
});
test("maxImages is enforced", async () => {
    const container = createMockContainer({
        "freshdesk/1001/1.png": Buffer.from("1"),
        "freshdesk/1001/2.png": Buffer.from("2"),
        "freshdesk/1001/3.png": Buffer.from("3"),
    });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            { sourceUrl: "1", blobName: "freshdesk/1001/1.png", sha256: "1", contentType: "image/png", order: 0 },
            { sourceUrl: "2", blobName: "freshdesk/1001/2.png", sha256: "2", contentType: "image/png", order: 1 },
            { sourceUrl: "3", blobName: "freshdesk/1001/3.png", sha256: "3", contentType: "image/png", order: 2 },
        ],
    }), container, { maxImages: 2, maxImageBytes: 10, maxTotalBytes: 30 });
    assert.equal(result.requestedImageCount, 2);
    assert.equal(result.imageCount, 2);
});
test("total byte limit is enforced", async () => {
    const container = createMockContainer({
        "freshdesk/1001/1.png": Buffer.alloc(10),
        "freshdesk/1001/2.png": Buffer.alloc(10),
    });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            { sourceUrl: "1", blobName: "freshdesk/1001/1.png", sha256: "1", contentType: "image/png", order: 0 },
            { sourceUrl: "2", blobName: "freshdesk/1001/2.png", sha256: "2", contentType: "image/png", order: 1 },
        ],
    }), container, { maxImages: 2, maxImageBytes: 10, maxTotalBytes: 15 });
    assert.equal(result.imageCount, 1);
    assert.equal(result.skippedByReason.total_limit, 1);
});
test("oversized image is skipped", async () => {
    const container = createMockContainer({
        "freshdesk/1001/abc.png": Buffer.alloc(20),
    });
    const result = await loadFreshdeskImageBlocks(createArticle(), container, {
        maxImageBytes: 10,
        maxTotalBytes: 20,
    });
    assert.equal(result.imageCount, 0);
    assert.equal(result.skippedByReason.oversized, 1);
});
test("missing blob is skipped without failing article details", async () => {
    const container = createMockContainer({});
    const result = await loadFreshdeskImageBlocks(createArticle(), container);
    assert.equal(result.imageCount, 0);
    assert.equal(result.skippedByReason.missing_blob, 1);
});
test("unsupported MIME type is skipped", async () => {
    const container = createMockContainer({
        "freshdesk/1001/file.bin": Buffer.from("bin"),
    });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            {
                sourceUrl: "x",
                blobName: "freshdesk/1001/file.bin",
                sha256: "x",
                contentType: "application/octet-stream",
                order: 0,
            },
        ],
    }), container);
    assert.equal(result.imageCount, 0);
    assert.equal(result.skippedByReason.unsupported_mime, 1);
});
test("one Azure failure does not prevent later valid images where safe", async () => {
    const container = createMockContainer({
        "freshdesk/1001/good.png": Buffer.from("ok"),
    }, { failDownloads: new Set(["freshdesk/1001/bad.png"]) });
    const result = await loadFreshdeskImageBlocks(createArticle({
        syncedImages: [
            { sourceUrl: "bad", blobName: "freshdesk/1001/bad.png", sha256: "b", contentType: "image/png", order: 0 },
            { sourceUrl: "good", blobName: "freshdesk/1001/good.png", sha256: "g", contentType: "image/png", order: 1 },
        ],
    }), container, { maxImageBytes: 10, maxTotalBytes: 10 });
    assert.equal(result.imageCount, 1);
    assert.equal(result.skippedByReason.missing_blob, 1);
});
test("complete storage failure returns sanitized warning", async () => {
    const result = await loadFreshdeskImageBlocks(createArticle(), null);
    assert.equal(result.imageCount, 0);
    assert.match(result.storageWarning ?? "", /temporarily unavailable/i);
});
test("imageAvailable and imageCount are consistent when blobs exist", async () => {
    const container = createMockContainer({
        "freshdesk/1001/abc.png": Buffer.from("png"),
    });
    const result = await loadFreshdeskImageBlocks(createArticle(), container, {
        maxImageBytes: 10,
        maxTotalBytes: 10,
    });
    assert.equal(result.imageAvailable, true);
    assert.equal(result.imageCount, 1);
});
