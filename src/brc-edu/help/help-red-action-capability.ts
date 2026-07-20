import { isToolEnabled } from "../../config/server_config.js";

export type HelpRedActionName =
  | "create_customer"
  | "create_supplier"
  | "create_sales_invoice";

export type HelpRedActionCapability = {
  redActionAvailable: boolean;
  redActionName: HelpRedActionName | null;
  toolName: string | null;
  customerFacingRedActionMarkdown?: string;
};

export const RED_ACTION_MARKDOWN_COPY_INSTRUCTION =
  "When redActionAvailable is true, include the following Markdown after Sources and before any support section. Do not start the Red action unless the user asks. Do not claim any data has already been changed.";

type RedActionDefinition = {
  redActionName: HelpRedActionName;
  toolNames: string[];
  match: RegExp;
  markdown: string;
};

/**
 * Maps help topics to currently registered operational tools.
 * Availability is checked via isToolEnabled — not article titles alone.
 */
const RED_ACTION_DEFINITIONS: RedActionDefinition[] = [
  {
    redActionName: "create_customer",
    toolNames: ["brc_create_customer"],
    match:
      /\b(?:add|create|set\s+up|setup)\b.{0,40}\bcustomers?\b|\bcustomers?\b.{0,40}\b(?:add|create|set\s+up|setup)\b/i,
    markdown: [
      "Do this through Red",
      "",
      "You can also create the customer directly here through Red. I'll collect the required customer details and show you a preview before anything is saved.",
    ].join("\n"),
  },
  {
    redActionName: "create_supplier",
    toolNames: ["brc_create_supplier"],
    match:
      /\b(?:add|create|set\s+up|setup)\b.{0,40}\bsuppliers?\b|\bsuppliers?\b.{0,40}\b(?:add|create|set\s+up|setup)\b/i,
    markdown: [
      "Do this through Red",
      "",
      "You can also create the supplier directly here through Red. I'll ask for the required details and show you a preview before posting it.",
    ].join("\n"),
  },
  {
    redActionName: "create_sales_invoice",
    toolNames: ["brc_create_sales_invoice", "brc_create_sales_invoice_gen_ref"],
    match:
      /\b(?:create|raise|prepare|add)\b.{0,40}\b(?:sales\s+)?invoices?\b|\b(?:sales\s+)?invoices?\b.{0,40}\b(?:create|raise|prepare|add)\b/i,
    markdown: [
      "Do this through Red",
      "",
      "You can also prepare the sales invoice here through Red. I'll confirm the customer, products, VAT and totals, then show you a preview before posting.",
    ].join("\n"),
  },
];

export function resolveHelpRedActionCapability(
  question: string | null | undefined,
  options: {
    isToolEnabled?: (toolName: string) => boolean;
  } = {},
): HelpRedActionCapability {
  const trimmed = question?.trim() ?? "";
  if (!trimmed) {
    return {
      redActionAvailable: false,
      redActionName: null,
      toolName: null,
    };
  }

  const checkEnabled = options.isToolEnabled ?? isToolEnabled;

  for (const definition of RED_ACTION_DEFINITIONS) {
    if (!definition.match.test(trimmed)) {
      continue;
    }

    const enabledTool = definition.toolNames.find((toolName) =>
      checkEnabled(toolName),
    );
    if (!enabledTool) {
      continue;
    }

    return {
      redActionAvailable: true,
      redActionName: definition.redActionName,
      toolName: enabledTool,
      customerFacingRedActionMarkdown: definition.markdown,
    };
  }

  return {
    redActionAvailable: false,
    redActionName: null,
    toolName: null,
  };
}

export function buildRedActionMarkdownTextBlock(
  redActionMarkdown: string | undefined,
): string | undefined {
  const markdown = redActionMarkdown?.trim();
  if (!markdown) {
    return undefined;
  }

  return [RED_ACTION_MARKDOWN_COPY_INSTRUCTION, "", markdown].join("\n");
}
