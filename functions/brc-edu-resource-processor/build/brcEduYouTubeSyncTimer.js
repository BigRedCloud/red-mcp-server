import { app } from "@azure/functions";
import { RED_BRC_EDU_SYNC_SECRET_HEADER, RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV, RED_BRC_YOUTUBE_SYNC_SCHEDULE_ENV, RED_BRC_YOUTUBE_SYNC_SECRET_ENV, } from "./constants.js";
function resolveSchedule() {
    return process.env[RED_BRC_YOUTUBE_SYNC_SCHEDULE_ENV]?.trim() || "0 0 * * * *";
}
async function postYouTubeSyncToRed(context, source) {
    const endpoint = process.env[RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV]?.trim();
    const secret = process.env[RED_BRC_YOUTUBE_SYNC_SECRET_ENV]?.trim();
    if (!endpoint || !secret) {
        context.error("YouTube sync skipped: RED_BRC_YOUTUBE_SYNC_ENDPOINT or RED_BRC_YOUTUBE_SYNC_SECRET is not configured.");
        return;
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            [RED_BRC_EDU_SYNC_SECRET_HEADER]: secret,
            "x-red-youtube-sync-source": source,
        },
        body: "{}",
    });
    if (!response.ok) {
        const text = await response.text();
        context.error(`YouTube sync to Red failed (${response.status}): ${text.slice(0, 300)}`);
        return;
    }
    context.log(`YouTube sync to Red succeeded (source=${source}).`);
}
export async function brcEduYouTubeSyncTimer(_timer, context) {
    await postYouTubeSyncToRed(context, "timer");
}
app.timer("brcEduYouTubeSyncTimer", {
    schedule: resolveSchedule(),
    handler: brcEduYouTubeSyncTimer,
});
