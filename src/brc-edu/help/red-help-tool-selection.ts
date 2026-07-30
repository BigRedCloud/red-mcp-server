/**
 * Test/harness helpers for red-help MCP tool discovery.
 *
 * MCP clients remain responsible for selecting the initial tool. detectHelpMode()
 * only runs after a help tool is invoked — it cannot force discovery. These
 * helpers simulate intended client selection from tool name, description, and
 * top-level server instructions.
 */

import { detectHelpMode } from "./help-mode.js";

export type DiscoverableTool = {
  name: string;
  description: string;
};

const TRANSACTIONAL_TOOL_PATTERN =
  /^brc_(?:create|update|delete|batch|send|post)_/i;

/**
 * Simulate which tool an MCP client should select for a user message when
 * following Red's RED-HELP ROUTING OVERRIDE and brc_red_help metadata.
 *
 * Returns null when the message is not a reserved red-help command (normal
 * semantic discovery applies and is out of scope for this harness).
 */
export function simulateRedHelpToolSelection(
  userMessage: string,
  tools: ReadonlyArray<DiscoverableTool>,
  instructions: string,
): string | null {
  const { isHelpMode } = detectHelpMode(userMessage);
  if (!isHelpMode) {
    return null;
  }

  const hasRoutingOverride =
    (/REQUEST ROUTING|RED-HELP SHORTCUT|RED-HELP ROUTING OVERRIDE/i.test(
      instructions,
    ) &&
      /\bbrc_red_help\b/.test(instructions)) ||
    /\bbrc_route_request\b/.test(instructions);

  const redHelp = tools.find((tool) => tool.name === "brc_red_help");
  if (
    hasRoutingOverride &&
    redHelp &&
    /MANDATORY FOR RED-HELP COMMANDS/i.test(redHelp.description) &&
    /red-help/i.test(redHelp.description)
  ) {
    return "brc_red_help";
  }

  // Fallback scoring: prefer help tools; never pick transactional tools in
  // red-help mode even when topic keywords overlap (sales invoice, customer).
  let bestName: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const tool of tools) {
    if (TRANSACTIONAL_TOOL_PATTERN.test(tool.name)) {
      continue;
    }

    let score = 0;
    if (tool.name === "brc_red_help") score += 100;
    if (tool.name === "brc_find_help_resources") score += 40;
    if (/red-help/i.test(tool.name) || /red-help/i.test(tool.description)) {
      score += 50;
    }
    if (/MANDATORY FOR RED-HELP/i.test(tool.description)) score += 40;
    if (/manual instructions|help article|tutorial/i.test(tool.description)) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestName = tool.name;
    }
  }

  return bestName;
}

/** Assert a candidate tool is transactional (create/update/delete/batch/email). */
export function isTransactionalAccountingToolName(toolName: string): boolean {
  return TRANSACTIONAL_TOOL_PATTERN.test(toolName);
}
