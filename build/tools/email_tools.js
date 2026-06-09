import { z } from "zod";
import { brcJsonRequest, companyNameSchema, jsonResponse, } from "../shared.js";
const optionalEmailFields = {
    toAddress: z
        .string()
        .optional()
        .describe("Optional recipient override. If omitted or empty, BRC uses the customer's email address."),
    bccAddresses: z
        .array(z.string())
        .optional()
        .describe("Optional BCC email addresses."),
    messageBody: z.string().optional().describe("Optional custom email message body."),
    confirmSend: z.boolean().default(false),
};
function requireConfirmSend(confirmSend) {
    if (!confirmSend) {
        throw new Error("Email send not confirmed. Re-run with confirmSend=true.");
    }
}
async function sendEmail(companyName, path, payload) {
    const response = await brcJsonRequest(companyName, "POST", path, payload);
    return jsonResponse({
        message: "Email send request sent to BRC.",
        companyName,
        endpoint: path,
        payloadSent: payload,
        response,
    });
}
export function registerEmailTools(server) {
    server.tool("brc_send_sales_invoice_email", "Sends a sales invoice email. Requires confirmSend=true.", {
        companyName: companyNameSchema,
        salesInvoiceId: z
            .number()
            .int()
            .positive()
            .describe("Sales invoice id (BRC field: salesInvoiceId)."),
        ...optionalEmailFields,
    }, async ({ companyName, salesInvoiceId, toAddress, bccAddresses, messageBody, confirmSend }) => {
        requireConfirmSend(confirmSend);
        const payload = {
            salesInvoiceId,
            toAddress: toAddress ?? "",
        };
        if (bccAddresses !== undefined)
            payload.bccAddresses = bccAddresses;
        if (messageBody !== undefined)
            payload.messageBody = messageBody;
        return sendEmail(companyName, "/v1/email/sendSalesInvoice", payload);
    });
    server.tool("brc_send_email_statement", "Sends a customer statement email. Requires confirmSend=true.", {
        companyName: companyNameSchema,
        customerId: z
            .number()
            .int()
            .positive()
            .describe("Customer id (BRC field: customerId)."),
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
        ...optionalEmailFields,
    }, async ({ companyName, customerId, fromPeriod, toPeriod, minimumBalance, toAddress, bccAddresses, messageBody, confirmSend, }) => {
        requireConfirmSend(confirmSend);
        const payload = {
            customerId,
            toAddress: toAddress ?? "",
        };
        if (fromPeriod !== undefined)
            payload.fromPeriod = fromPeriod;
        if (toPeriod !== undefined)
            payload.toPeriod = toPeriod;
        if (minimumBalance !== undefined)
            payload.minimumBalance = minimumBalance;
        if (bccAddresses !== undefined)
            payload.bccAddresses = bccAddresses;
        if (messageBody !== undefined)
            payload.messageBody = messageBody;
        return sendEmail(companyName, "/v1/email/sendEmailStatement", payload);
    });
    server.tool("brc_send_quote_email", "Sends a quote email. Requires confirmSend=true.", {
        companyName: companyNameSchema,
        quoteId: z.number().int().positive().describe("Quote id (BRC field: quoteId)."),
        ...optionalEmailFields,
    }, async ({ companyName, quoteId, toAddress, bccAddresses, messageBody, confirmSend }) => {
        requireConfirmSend(confirmSend);
        const payload = {
            quoteId,
            toAddress: toAddress ?? "",
        };
        if (bccAddresses !== undefined)
            payload.bccAddresses = bccAddresses;
        if (messageBody !== undefined)
            payload.messageBody = messageBody;
        return sendEmail(companyName, "/v1/email/sendQuote", payload);
    });
}
