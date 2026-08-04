import assert from "node:assert/strict";
import test from "node:test";
import { buildFreshdeskPublicImageViewerHtml, buildFreshdeskPublicImageViewerResizeScript, computeFreshdeskPublicImageDisplaySize, FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE, prefersFreshdeskPublicImageViewer, } from "./freshdesk-public-image-viewer.js";
import { createFreshdeskPublicImageToken, } from "./freshdesk-public-image-token.js";
import { handleFreshdeskPublicImageRequest, } from "./freshdesk-public-image-route.js";
const ARTICLE_ID = "1001";
const IMAGE_KEY = "c".repeat(64);
const SECRET = "viewer-test-secret";
test("prefersFreshdeskPublicImageViewer detects browser navigation", () => {
    assert.equal(prefersFreshdeskPublicImageViewer({
        headers: { "sec-fetch-dest": "document", accept: "text/html" },
    }), true);
    assert.equal(prefersFreshdeskPublicImageViewer({
        headers: { "sec-fetch-dest": "image", accept: "image/avif,image/*" },
    }), false);
    assert.equal(prefersFreshdeskPublicImageViewer({
        headers: { accept: "*/*" },
    }), false);
});
test("computeFreshdeskPublicImageDisplaySize upscales small images up to 3x", () => {
    const result = computeFreshdeskPublicImageDisplaySize({
        naturalWidth: 200,
        naturalHeight: 120,
        viewportWidth: 1200,
        viewportHeight: 800,
    });
    assert.equal(result.scale, FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE);
    assert.equal(result.width, 600);
});
test("computeFreshdeskPublicImageDisplaySize respects viewport width constraints", () => {
    const result = computeFreshdeskPublicImageDisplaySize({
        naturalWidth: 400,
        naturalHeight: 300,
        viewportWidth: 600,
        viewportHeight: 800,
    });
    assert.ok(result.scale < FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE);
    assert.ok(result.width <= 600 * 0.96);
    assert.equal(result.width, Math.round(400 * result.scale));
});
test("computeFreshdeskPublicImageDisplaySize respects viewport height constraints", () => {
    const result = computeFreshdeskPublicImageDisplaySize({
        naturalWidth: 300,
        naturalHeight: 500,
        viewportWidth: 1600,
        viewportHeight: 700,
    });
    assert.ok(result.scale < FRESHDESK_PUBLIC_IMAGE_VIEWER_MAX_SCALE);
    assert.ok(result.width <= Math.round(300 * result.scale));
    assert.equal(result.width, Math.round(300 * result.scale));
});
test("computeFreshdeskPublicImageDisplaySize preserves aspect ratio via width and auto height", () => {
    const naturalWidth = 180;
    const naturalHeight = 90;
    const result = computeFreshdeskPublicImageDisplaySize({
        naturalWidth,
        naturalHeight,
        viewportWidth: 1400,
        viewportHeight: 900,
    });
    const renderedHeight = naturalHeight * result.scale;
    assert.equal(result.width / renderedHeight, naturalWidth / naturalHeight);
});
test("buildFreshdeskPublicImageViewerHtml keeps centred layout and visible caption", () => {
    const html = buildFreshdeskPublicImageViewerHtml({
        imageSrc: "/public/brc-edu/freshdesk-images/1001/token",
        caption: 'Add Customer <screen> & "steps"',
    });
    assert.match(html, /class="viewer"/);
    assert.match(html, /class="viewer-image"/);
    assert.match(html, /class="viewer-caption"/);
    assert.match(html, /align-items:\s*center/);
    assert.match(html, /justify-content:\s*center/);
    assert.match(html, /max-width:\s*96vw/);
    assert.match(html, /max-height:\s*90vh/);
    assert.match(html, /Add Customer &lt;screen&gt; &amp; &quot;steps&quot;/);
    // Viewer caption stays descriptive — not the Markdown "View image" link label.
    assert.equal(html.includes(">View image<"), false);
    assert.match(html, /src="\/public\/brc-edu\/freshdesk-images\/1001\/token"/);
});
test("buildFreshdeskPublicImageViewerResizeScript upscales on load and resize", () => {
    const script = buildFreshdeskPublicImageViewerResizeScript();
    assert.match(script, /querySelector\("\.viewer-image"\)/);
    assert.match(script, /naturalWidth/);
    assert.match(script, /naturalHeight/);
    assert.match(script, /Math\.min\(/);
    assert.match(script, /maxScale/);
    assert.match(script, /window\.innerWidth \* maxWidthRatio \/ naturalWidth/);
    assert.match(script, /window\.innerHeight \* maxHeightRatio \/ naturalHeight/);
    assert.match(script, /image\.style\.width/);
    assert.match(script, /image\.style\.height = "auto"/);
    assert.match(script, /addEventListener\("load", resizeViewerImage/);
    assert.match(script, /addEventListener\("resize", resizeViewerImage\)/);
    assert.match(script, /maxWidth = "96vw"/);
    assert.match(script, /maxHeight = "90vh"/);
});
test("browser navigation receives HTML viewer while image clients receive bytes", async () => {
    process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
    const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
        now: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const png = Buffer.from("fake-png-bytes");
    const article = {
        id: "freshdesk-1001",
        source: "freshdesk",
        freshdeskArticleId: 1001,
        categoryId: 1,
        folderId: 2,
        folderName: "Sales",
        title: "Add a customer",
        bodyText: "Steps",
        images: [],
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/a.png",
                blobName: "freshdesk/1001/a.png",
                sha256: IMAGE_KEY,
                contentType: "image/png",
                altText: "Add Customer screen",
                order: 0,
            },
        ],
        updatedAt: "2026-07-01T00:00:00.000Z",
        enabled: true,
        slug: null,
        publicUrl: null,
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
                            yield Buffer.from(JSON.stringify({
                                generatedAt: "2026-07-15T10:00:00.000Z",
                                articleCount: 1,
                                failureCount: 0,
                                articles: [article],
                                failures: [],
                            }), "utf8");
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
    const viewerResponse = {
        headers: new Map(),
        statusCode: 200,
        body: undefined,
        setHeader(name, value) {
            this.headers.set(name.toLowerCase(), value);
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(value) {
            this.body = value;
        },
    };
    await handleFreshdeskPublicImageRequest({
        method: "GET",
        params: { articleId: ARTICLE_ID, imageToken: token },
        headers: { "sec-fetch-dest": "document", accept: "text/html" },
        originalUrl: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
        url: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
    }, viewerResponse, {
        freshdeskIndexContainer: indexContainer,
        freshdeskImageContainer: imageContainer,
    });
    assert.equal(viewerResponse.statusCode, 200);
    assert.equal(viewerResponse.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(String(viewerResponse.body ?? ""), /class="viewer-image"/);
    assert.match(String(viewerResponse.body ?? ""), /Add Customer screen/);
    assert.match(String(viewerResponse.body ?? ""), /addEventListener\("resize", resizeViewerImage\)/);
    const imageResponse = {
        headers: new Map(),
        statusCode: 200,
        body: undefined,
        setHeader(name, value) {
            this.headers.set(name.toLowerCase(), value);
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(value) {
            this.body = value;
        },
    };
    await handleFreshdeskPublicImageRequest({
        method: "GET",
        params: { articleId: ARTICLE_ID, imageToken: token },
        headers: { "sec-fetch-dest": "image", accept: "image/avif,image/*" },
        originalUrl: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
        url: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
    }, imageResponse, {
        freshdeskIndexContainer: indexContainer,
        freshdeskImageContainer: imageContainer,
    });
    assert.equal(imageResponse.statusCode, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    assert.equal(Buffer.isBuffer(imageResponse.body) ? imageResponse.body.equals(png) : false, true);
});
