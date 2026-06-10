import { z } from "zod";
import { brcJsonRequest, companyNameSchema, jsonResponse, textResponse, } from "../shared.js";
const optionalEmailFields = {
    fromAddress: z
        .string()
        .optional()
        .describe("Optional sender address override."),
    toAddress: z
        .string()
        .optional()
        .describe("Optional single recipient override. If omitted or empty, BRC uses the customer's email address."),
    toAddresses: z
        .array(z.string())
        .optional()
        .describe("Optional list of recipients. If more than one is provided, ask the user whether to send one email with BCC or separate individual emails."),
    sendMode: z
        .enum(["single_with_bcc", "separate"])
        .optional()
        .describe("How to handle multiple recipients. Use separate only when the user explicitly asks to send separate individual emails."),
    bccAddresses: z
        .array(z.string())
        .optional()
        .describe("Optional BCC email addresses. Only use if the user explicitly provides BCC addresses or chooses one email with BCC."),
    messageBody: z
        .string()
        .optional()
        .describe("Optional custom email message body."),
    confirmSend: z
        .boolean()
        .default(false)
        .describe("Must be true only after the user has reviewed the email draft and explicitly confirmed sending."),
};
function normaliseEmailList(args) {
    const emails = [];
    if (typeof args.toAddress === "string" && args.toAddress.trim()) {
        emails.push(args.toAddress.trim());
    }
    if (Array.isArray(args.toAddresses)) {
        for (const value of args.toAddresses) {
            if (typeof value === "string" && value.trim()) {
                emails.push(value.trim());
            }
        }
    }
    return [...new Set(emails)];
}
function buildMultiRecipientChoiceText(args) {
    return textResponse([
        "Email draft — not sent yet",
        "",
        `Document: ${args.documentLabel}`,
        "",
        "You provided multiple recipient addresses:",
        ...args.recipients.map((email, index) => `${index + 1}. ${email}`),
        "",
        "How would you like to send this?",
        "",
        "Option 1 — One email",
        `- To: ${args.recipients[0]}`,
        `- BCC: ${args.recipients.slice(1).join(", ") || "None"}`,
        "",
        "Option 2 — Separate emails",
        "- Send one individual email to each recipient.",
        "- No recipient will see the other recipients.",
        "",
        "Message:",
        args.messageBody && args.messageBody.trim()
            ? args.messageBody
            : "Default Big Red Cloud email message.",
        "",
        "Reply with:",
        '- "Send as one email"',
        '- "Send separately"',
        "- or tell me what to change.",
    ].join("\n"));
}
function buildEmailDraftText(args) {
    const bccLine = args.bccAddresses?.length
        ? [`BCC: ${args.bccAddresses.join(", ")}`]
        : [];
    const recipientLines = args.sendMode === "separate" && args.separateRecipients?.length
        ? [
            "Send mode: Separate individual emails",
            "Recipients:",
            ...args.separateRecipients.map((email) => `- ${email}`),
        ]
        : [
            `To: ${args.toAddress && args.toAddress.trim()
                ? args.toAddress
                : "Customer email address on file"}`,
            ...bccLine,
        ];
    return textResponse([
        "Email draft — not sent yet",
        "",
        `Document: ${args.documentLabel}`,
        ...recipientLines,
        `From: ${args.fromAddress && args.fromAddress.trim()
            ? args.fromAddress
            : "Default Big Red Cloud sender"}`,
        "",
        "Message:",
        args.messageBody && args.messageBody.trim()
            ? args.messageBody
            : "Default Big Red Cloud email message.",
        "",
        'Reply with "Yes, send it" to send this email, or tell me what to change.',
    ].join("\n"));
}
function applyOptionalEmailFields(payload, fields) {
    if (fields.fromAddress !== undefined) {
        payload.fromAddress = fields.fromAddress;
    }
    if (fields.bccAddresses !== undefined) {
        payload.bccAddresses = fields.bccAddresses;
    }
    if (fields.messageBody !== undefined) {
        payload.messageBody = fields.messageBody;
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
function registerEmailSendTool(server, toolName, description, path, idField, idSchema, extraShape = {}) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        [idField]: idSchema.describe(`BRC field: ${idField}.`),
        ...extraShape,
        ...optionalEmailFields,
    }, async (args) => {
        const { companyName, fromAddress, toAddress, toAddresses, sendMode, bccAddresses, messageBody, confirmSend, ...rest } = args;
        const documentLabel = `${idField} ${String(rest[idField])}`;
        const recipients = normaliseEmailList({ toAddress, toAddresses });
        const parsedSendMode = sendMode;
        if (recipients.length > 1 && !parsedSendMode) {
            return buildMultiRecipientChoiceText({
                documentLabel,
                recipients,
                messageBody: typeof messageBody === "string" ? messageBody : undefined,
            });
        }
        const combinedBcc = parsedSendMode === "single_with_bcc" && recipients.length > 1
            ? [
                ...recipients.slice(1),
                ...(Array.isArray(bccAddresses)
                    ? bccAddresses
                    : []),
            ]
            : Array.isArray(bccAddresses)
                ? bccAddresses
                : undefined;
        if (!Boolean(confirmSend)) {
            return buildEmailDraftText({
                documentLabel,
                toAddress: parsedSendMode === "single_with_bcc" && recipients.length
                    ? recipients[0]
                    : typeof toAddress === "string"
                        ? toAddress
                        : undefined,
                fromAddress: typeof fromAddress === "string" ? fromAddress : undefined,
                bccAddresses: combinedBcc,
                messageBody: typeof messageBody === "string" ? messageBody : undefined,
                sendMode: parsedSendMode,
                separateRecipients: parsedSendMode === "separate" ? recipients : undefined,
            });
        }
        if (parsedSendMode === "separate" && recipients.length > 1) {
            const results = [];
            for (const recipient of recipients) {
                const individualPayload = {
                    [idField]: rest[idField],
                    toAddress: recipient,
                };
                for (const key of Object.keys(extraShape)) {
                    if (rest[key] !== undefined) {
                        individualPayload[key] = rest[key];
                    }
                }
                applyOptionalEmailFields(individualPayload, {
                    fromAddress: fromAddress,
                    bccAddresses: [],
                    messageBody: messageBody,
                });
                const response = await brcJsonRequest(String(companyName), "POST", path, individualPayload);
                results.push({
                    toAddress: recipient,
                    response,
                });
            }
            return jsonResponse({
                message: "Separate email send requests sent to BRC.",
                companyName,
                endpoint: path,
                sendMode: "separate",
                recipientCount: recipients.length,
                results,
            });
        }
        const payload = {
            [idField]: rest[idField],
            toAddress: recipients.length > 0
                ? recipients[0]
                : typeof toAddress === "string"
                    ? toAddress
                    : "",
        };
        for (const key of Object.keys(extraShape)) {
            if (rest[key] !== undefined) {
                payload[key] = rest[key];
            }
        }
        applyOptionalEmailFields(payload, {
            fromAddress: fromAddress,
            bccAddresses: combinedBcc,
            messageBody: messageBody,
        });
        return sendEmail(String(companyName), path, payload);
    });
}
export function registerEmailTools(server) {
    const commonEmailRule = "Do not call this tool with confirmSend=true until the user has reviewed a plain-English email draft and explicitly confirmed they want to send it. If the user provides multiple recipient addresses, ask whether to send one email using BCC or separate individual emails. Only use sendMode='separate' when the user explicitly chooses separate emails. Do not ask about BCC unless the user provides multiple recipients or asks to copy another address.";
    registerEmailSendTool(server, "brc_send_sales_invoice_email", `Sends a sales invoice email. ${commonEmailRule}`, "/v1/email/sendSalesInvoice", "salesInvoiceId", z.number().int().positive());
    registerEmailSendTool(server, "brc_send_email_statement", `Sends a customer statement email. ${commonEmailRule}`, "/v1/email/sendEmailStatement", "customerId", z.number().int().positive(), {
        fromPeriod: z
            .string()
            .optional()
            .describe("Statement period start (ISO date-time, e.g. 2026-01-01T00:00:00)."),
        toPeriod: z
            .string()
            .optional()
            .describe("Statement period end (ISO date-time, e.g. 2026-05-31T00:00:00)."),
        minBalance: z
            .number()
            .optional()
            .describe("Minimum balance threshold for transactions included on the statement."),
    });
    registerEmailSendTool(server, "brc_send_quote_email", `Sends a quote email. ${commonEmailRule}`, "/v1/email/sendQuote", "quoteId", z.number().int().positive());
}
