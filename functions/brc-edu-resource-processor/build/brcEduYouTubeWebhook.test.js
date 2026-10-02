import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { brcEduYouTubeWebhook } from "./brcEduYouTubeWebhook.js";
test("anonymous webhook cannot forward unsigned, tampered or unconfigured notifications", async () => {
    const previous = { ...process.env };
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
    const body = "<feed><entry><yt:videoId>test-video</yt:videoId></entry></feed>";
    const request = (signature, delivered = body) => new HttpRequest({
        method: "POST", url: "https://functions.example.test/webhook",
        headers: signature ? { "x-hub-signature": signature } : {}, body: { string: delivered },
    });
    const context = new InvocationContext({ functionName: "test-webhook" });
    try {
        process.env.RED_BRC_YOUTUBE_SYNC_ENDPOINT = "https://red.example.test/sync";
        process.env.RED_BRC_YOUTUBE_SYNC_SECRET = "test-only-forward-secret";
        delete process.env.BRC_YOUTUBE_WEBHOOK_SECRET;
        assert.equal((await brcEduYouTubeWebhook(request(), context)).status, 503);
        process.env.BRC_YOUTUBE_WEBHOOK_SECRET = "test-only-websub-secret";
        assert.equal((await brcEduYouTubeWebhook(request(), context)).status, 401);
        const signature = "sha1=" + createHmac("sha1", process.env.BRC_YOUTUBE_WEBHOOK_SECRET).update(body).digest("hex");
        assert.equal((await brcEduYouTubeWebhook(request(signature, body + "tampered"), context)).status, 401);
        assert.equal(calls, 0);
        assert.equal((await brcEduYouTubeWebhook(request(signature), context)).status, 204);
        assert.equal(calls, 1);
        process.env.RED_BRC_YOUTUBE_WEBHOOK_FORWARD = "false";
        assert.equal((await brcEduYouTubeWebhook(request(signature), context)).status, 204);
        assert.equal(calls, 1);
    }
    finally {
        globalThis.fetch = originalFetch;
        for (const name of ["BRC_YOUTUBE_WEBHOOK_SECRET", "RED_BRC_YOUTUBE_SYNC_ENDPOINT", "RED_BRC_YOUTUBE_SYNC_SECRET", "RED_BRC_YOUTUBE_WEBHOOK_FORWARD"]) {
            if (previous[name] === undefined)
                delete process.env[name];
            else
                process.env[name] = previous[name];
        }
    }
});
