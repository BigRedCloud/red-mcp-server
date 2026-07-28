import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUpcomingWebinarsFromHtml,
  shouldIgnoreRecordedWebinarCard,
} from "./upcoming-webinar-parser.js";

const UPCOMING_HTML = `
<section>
  <h2>Upcoming Webinars</h2>
  <p>Monday</p>
  <h3>Onboarding 1: New User Setup</h3>
  <p>Get started by setting up your company and foundations for success.</p>
  <ul><li>Financial Year Settings</li><li>VAT Setup</li></ul>
  <p>Friday</p>
  <h3>Feature Training: Bank Feeds</h3>
  <p>Learn how to connect your bank account and import transactions.</p>
  <ul><li>Connect Bank Account</li><li>Automation Rules</li></ul>
  <a href="https://zoom.us/meeting/register/test-bank-feeds">Reserve Your Spot</a>
  <h2>Recorded Webinars</h2>
  <h3>Getting Started with Big Red Cloud: Company Setup Guide</h3>
  <p>Recorded Webinar</p>
  <a href="https://www.youtube.com/watch?v=abc123">Watch Now</a>
</section>`;

test("parseUpcomingWebinarsFromHtml indexes only upcoming webinars", () => {
  const webinars = parseUpcomingWebinarsFromHtml(
    UPCOMING_HTML,
    "https://bigredcloud.com/webinar-series/",
    "2026-07-15T10:00:00.000Z",
  );

  assert.equal(webinars.length, 2);
  assert.ok(webinars.some((item) => item.title.includes("Onboarding 1")));
  assert.ok(webinars.some((item) => item.title.includes("Bank Feeds")));
  assert.equal(
    webinars.some((item) => item.title.includes("Getting Started with Big Red Cloud")),
    false,
  );
});

test("parseUpcomingWebinarsFromHtml preserves weekday and Zoom registration URL", () => {
  const webinars = parseUpcomingWebinarsFromHtml(UPCOMING_HTML);

  const bankFeeds = webinars.find((item) => item.title.includes("Bank Feeds"));
  assert.ok(bankFeeds);
  assert.equal(bankFeeds?.eventDay, "Friday");
  assert.equal(
    bankFeeds?.registrationUrl,
    "https://zoom.us/meeting/register/test-bank-feeds",
  );
  assert.match(bankFeeds?.topics.join(" "), /Connect Bank Account/i);
});

test("parseUpcomingWebinarsFromHtml does not invent calendar dates", () => {
  const webinars = parseUpcomingWebinarsFromHtml(UPCOMING_HTML);
  for (const webinar of webinars) {
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(webinar.summary), false);
  }
});

test("shouldIgnoreRecordedWebinarCard ignores recorded cards and YouTube links", () => {
  assert.equal(
    shouldIgnoreRecordedWebinarCard("Recorded Webinar Watch Now on YouTube"),
    true,
  );
  assert.equal(
    shouldIgnoreRecordedWebinarCard("Feature Training: Bank Feeds"),
    false,
  );
});

test("sync failure preserves previous index when save is not called", async () => {
  const { syncUpcomingWebinarsIndex } = await import("./upcoming-webinar-index-store.js");

  const previousIndex = {
    generatedAt: "2026-07-14T12:00:00.000Z",
    itemCount: 1,
    items: [
      {
        resourceId: "upcoming_webinar:bank-feeds",
        source: "upcoming_webinar" as const,
        title: "Feature Training: Bank Feeds",
        summary: "Existing index",
        bodyText: "Existing",
        url: "https://bigredcloud.com/webinar-series/",
        category: "Live training",
        topics: [],
        imageBlobNames: [],
        eventDay: "Friday",
        enabled: true,
        lastSyncedAt: "2026-07-14T12:00:00.000Z",
      },
    ],
  };

  let latestBlob = JSON.stringify(previousIndex);

  const container = {
    getBlockBlobClient(blobPath: string) {
      return {
        async exists() {
          return blobPath.includes("latest/");
        },
        async download() {
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(latestBlob, "utf8");
            })(),
          };
        },
        async uploadData(body: Buffer) {
          latestBlob = body.toString("utf8");
        },
      };
    },
  };

  const result = await syncUpcomingWebinarsIndex(container as never, {
    fetchImpl: async () => new Response("fail", { status: 500 }),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.preservedPreviousIndex, true);
  }

  assert.match(latestBlob, /Feature Training: Bank Feeds/);
});
