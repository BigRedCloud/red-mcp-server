import { UPCOMING_WEBINAR_SCHEDULE_URL } from "./upcoming-webinar-parser.js";

/**
 * Detects questions about the live / upcoming webinar schedule (not recorded webinars).
 */
export function isUpcomingWebinarScheduleQuery(question: string): boolean {
  const q = question.trim();
  if (!q) {
    return false;
  }

  if (
    /\brecorded\b/i.test(q) &&
    !/\b(upcoming|coming\s+up|scheduled|next|soon)\b/i.test(q)
  ) {
    return false;
  }

  return (
    /\b(upcoming|coming\s+up|scheduled|next|soon)\b[\s\S]{0,40}\bwebinars?\b/i.test(
      q,
    ) ||
    /\bwebinars?\b[\s\S]{0,40}\b(upcoming|coming\s+up|scheduled|next|soon)\b/i.test(
      q,
    ) ||
    /\bare there any (upcoming\s+)?webinars?\b/i.test(q) ||
    /\bany upcoming webinars?\b/i.test(q)
  );
}

export function buildEmptyUpcomingWebinarCustomerMarkdown(
  scheduleUrl: string = UPCOMING_WEBINAR_SCHEDULE_URL,
): string {
  return [
    "I couldn’t find any upcoming webinars in Red’s currently available webinar listings.",
    `You can check the [Upcoming Webinars](${scheduleUrl}) section of the Big Red Cloud website for the regular schedule.`,
    "Big Red Cloud may also announce specialist or additional webinars by email, so check your inbox as well.",
  ].join(" ");
}

export const EMPTY_UPCOMING_WEBINAR_RESPONSE_GUIDANCE = [
  "This question asked about upcoming webinars, but no upcoming_webinar resources were returned.",
  "Do not claim that no webinars are scheduled, that nothing is coming up, or that the schedule is empty.",
  "Use customerFacingEmptyUpcomingWebinarMarkdown (or the same wording) as the direct answer.",
  `Include the Upcoming Webinars webpage link from that markdown (${UPCOMING_WEBINAR_SCHEDULE_URL}) — do not invent titles, dates, registration links, or availability.`,
  "Do not present recorded_webinar or youtube_video results as upcoming webinars.",
  "Still end with the Still need help? support footer after this guidance — do not replace the webinar guidance with only a support link.",
].join(" ");
