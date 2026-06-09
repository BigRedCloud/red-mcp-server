import { z } from "zod";
import type { ServerType } from "../../server.js";
import { brcJsonRequest, companyNameSchema, jsonResponse } from "../../shared.js";

const optionalEmailFields = {
  toAddress: z
    .string()
    .optional()
    .describe(
      "Optional recipient override. If omitted or empty, BRC uses the customer's email address."
    ),
  bccAddresses: z
    .array(z.string())
    .optional()
    .describe("Optional BCC email addresses."),
  messageBody: z.string().optional().describe("Optional custom email message body."),
  confirmSend: z.boolean().default(false),
};

type OptionalEmailArgs = {
  toAddress?: string;
  bccAddresses?: string[];
  messageBody?: string;
};

function requireConfirmSend(confirmSend: boolean) {
  if (!confirmSend) {
    throw new Error("Email send not confirmed. Re-run with confirmSend=true.");
  }
}

function applyOptionalEmailFields(
  payload: Record<string, unknown>,
  fields: OptionalEmailArgs
) {
  if (fields.bccAddresses !== undefined) payload.bccAddresses = fields.bccAddresses;
  if (fields.messageBody !== undefined) payload.messageBody = fields.messageBody;
}

async function sendEmail(companyName: string, path: string, payload: Record<string, unknown>) {
  const response = await brcJsonRequest(companyName, "POST", path, payload);

  return jsonResponse({
    message: "Email send request sent to BRC.",
    companyName,
    endpoint: path,
    payloadSent: payload,
    response,
  });
}

function registerEmailSendTool(
  server: ServerType,
  toolName: string,
  description: string,
  path: string,
  idField: string,
  idSchema: z.ZodType<number>,
  extraShape: Record<string, z.ZodTypeAny> = {}
) {
  server.tool(
    toolName,
    description,
    {
      companyName: companyNameSchema,
      [idField]: idSchema.describe(`BRC field: ${idField}.`),
      ...extraShape,
      ...optionalEmailFields,
    },
    async (args: Record<string, unknown>) => {
      const {
        companyName,
        toAddress,
        bccAddresses,
        messageBody,
        confirmSend,
        ...rest
      } = args;

      requireConfirmSend(Boolean(confirmSend));

      const payload: Record<string, unknown> = {
        [idField]: rest[idField],
        toAddress: typeof toAddress === "string" ? toAddress : "",
      };

      for (const key of Object.keys(extraShape)) {
        if (rest[key] !== undefined) payload[key] = rest[key];
      }

      applyOptionalEmailFields(payload, {
        bccAddresses: bccAddresses as string[] | undefined,
        messageBody: messageBody as string | undefined,
      });

      return sendEmail(String(companyName), path, payload);
    }
  );
}

export function registerEmailTools(server: ServerType) {
  registerEmailSendTool(
    server,
    "brc_send_sales_invoice_email",
    "Sends a sales invoice email. Requires confirmSend=true.",
    "/v1/email/sendSalesInvoice",
    "salesInvoiceId",
    z.number().int().positive()
  );

  registerEmailSendTool(
    server,
    "brc_send_email_statement",
    "Sends a customer statement email. Requires confirmSend=true.",
    "/v1/email/sendEmailStatement",
    "customerId",
    z.number().int().positive(),
    {
      fromPeriod: z
        .string()
        .optional()
        .describe("Statement period start (ISO date-time, e.g. 2026-01-01T00:00:00)."),
      toPeriod: z
        .string()
        .optional()
        .describe("Statement period end (ISO date-time, e.g. 2026-05-31T00:00:00)."),
      minimumBalance: z
        .number()
        .optional()
        .describe("Minimum balance threshold for transactions included on the statement."),
    }
  );

  registerEmailSendTool(
    server,
    "brc_send_quote_email",
    "Sends a quote email. Requires confirmSend=true.",
    "/v1/email/sendQuote",
    "quoteId",
    z.number().int().positive()
  );
}
