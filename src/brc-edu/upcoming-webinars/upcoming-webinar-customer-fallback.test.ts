import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmptyUpcomingWebinarCustomerMarkdown,
  isUpcomingWebinarScheduleQuery,
} from "./upcoming-webinar-customer-fallback.js";
import { UPCOMING_WEBINAR_SCHEDULE_URL } from "./upcoming-webinar-parser.js";

test("isUpcomingWebinarScheduleQuery detects schedule questions", () => {
  assert.equal(
    isUpcomingWebinarScheduleQuery("What webinars are coming up?"),
    true,
  );
  assert.equal(
    isUpcomingWebinarScheduleQuery("Are there any upcoming webinars?"),
    true,
  );
  assert.equal(
    isUpcomingWebinarScheduleQuery("Find a recorded webinar about sales invoices"),
    false,
  );
});

test("empty upcoming webinar markdown points to schedule page and email without claiming none exist", () => {
  const text = buildEmptyUpcomingWebinarCustomerMarkdown();

  assert.match(
    text,
    /couldn’t find any upcoming webinars in Red’s currently available webinar listings/i,
  );
  assert.match(text, /Upcoming Webinars/i);
  assert.match(text, /check your inbox/i);
  assert.match(text, new RegExp(UPCOMING_WEBINAR_SCHEDULE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(/nothing scheduled/i.test(text), false);
  assert.equal(/no webinars are scheduled/i.test(text), false);
  assert.equal(/there(?:'s| is) nothing/i.test(text), false);
});
