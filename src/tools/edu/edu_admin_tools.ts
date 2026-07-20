import {
  buildOpenEduAdminToolPayload,
  getBrcEduAdminProtectedPath,
  getBrcEduAdminPublicUrl,
} from "../../edu/brc_edu_admin_auth.js";
import type { ServerType } from "../../server.js";
import { textResponse } from "../../shared.js";

/** Exact phrases hosts should match to this tool. */
export const OPEN_EDU_ADMIN_TRIGGER_PHRASES = [
  "open Red's admin page",
  "open the BRC Edu admin page",
  "open the help resources admin page",
  "manage BRC Edu resources",
] as const;

export const OPEN_EDU_ADMIN_TOOL_NAME = "brc_open_edu_admin";

export const OPEN_EDU_ADMIN_TOOL_DESCRIPTION = [
  "Open Red's BRC Edu admin page and return only the protected admin URL as a clickable Markdown link.",
  "Use immediately when the user says any of these (or close equivalents):",
  `"${OPEN_EDU_ADMIN_TRIGGER_PHRASES.join('", "')}"`,
  "Also use for: open Red admin, BRC Edu admin, webinar resources admin, help resources admin, Red's admin page.",
  "Do not ask whether the user means Big Red Cloud website login or connecting a company — call this tool.",
  "Do not use brc_start_company_connection or brc_getting_started for these requests.",
  "Returns only a clickable Markdown link to the protected admin URL — never a shared secret, query parameter, token, or bypass link.",
  "Opening the link still requires Microsoft Entra sign-in; only authorised Big Red Cloud staff can access the page.",
  "Does not bypass authentication. Does not require a connected company.",
  "Do not invent or append secret query parameters. Do not expose BRC_EDU_ADMIN_UPLOAD_SECRET or any upload secret.",
].join(" ");

/**
 * Returns the admin tool name when the user message clearly asks for Red's
 * admin / BRC Edu admin page; otherwise null.
 */
export function selectOpenEduAdminToolForUserMessage(
  message: string,
): typeof OPEN_EDU_ADMIN_TOOL_NAME | null {
  const normalised = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalised) {
    return null;
  }

  const phraseMatched = OPEN_EDU_ADMIN_TRIGGER_PHRASES.some((phrase) =>
    normalised.includes(phrase.toLowerCase()),
  );
  if (phraseMatched) {
    return OPEN_EDU_ADMIN_TOOL_NAME;
  }

  // Close equivalents Claude / hosts may paraphrase.
  const adminIntent =
    /\b(open|show|launch|go to|take me to)\b/.test(normalised) &&
    (/\bred'?s?\s+admin\b/.test(normalised) ||
      /\bbrc\s*edu\s+admin\b/.test(normalised) ||
      /\bhelp\s+resources?\s+admin\b/.test(normalised) ||
      /\bwebinar\s+(resources?\s+)?admin\b/.test(normalised));

  const manageIntent =
    /\bmanage\b/.test(normalised) &&
    (/\bbrc\s*edu\b/.test(normalised) || /\bwebinar\s+resources?\b/.test(normalised));

  if (adminIntent || manageIntent) {
    return OPEN_EDU_ADMIN_TOOL_NAME;
  }

  return null;
}

export function buildOpenEduAdminMarkdownLink(adminUrl = getBrcEduAdminPublicUrl()): string {
  return `[Open Red's admin page](${adminUrl})`;
}

export function registerEduAdminTools(server: ServerType): void {
  server.tool(
    OPEN_EDU_ADMIN_TOOL_NAME,
    OPEN_EDU_ADMIN_TOOL_DESCRIPTION,
    {},
    async () => {
      const payload = buildOpenEduAdminToolPayload();
      return textResponse(buildOpenEduAdminMarkdownLink(payload.adminUrl));
    },
  );
}

export function getEduAdminToolUrlForTests(): {
  adminUrl: string;
  protectedPath: string;
} {
  return {
    adminUrl: getBrcEduAdminPublicUrl(),
    protectedPath: getBrcEduAdminProtectedPath(),
  };
}
