import { z } from "zod";
import { brcJsonRequest, companyNameSchema, jsonResponse, textResponse, } from "../../shared.js";
import { enforceTransactionSettingsOrThrow, getCompanyProcessingSettings, } from "../../guards/company_processing_settings.js";
import { buildRecipientEmailRequiredResponse, resolveCustomerEmailForEmailDocument, } from "../../guards/document_draft_details.js";
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
        .describe("Must be true only after the user has reviewed the email preview and explicitly confirmed sending."),
};
//normalise the email list to an array of unique email addresses
function normaliseEmailList(args) {
    const emails = [];
    if (typeof args.toAddress === "string" && args.toAddress.trim()) {
        emails.push(args.toAddress.trim());
    }
    //if the toAddresses is an array, add each email to the list
    if (Array.isArray(args.toAddresses)) {
        for (const value of args.toAddresses) {
            if (typeof value === "string" && value.trim()) {
                emails.push(value.trim());
            }
        }
    }
    return [...new Set(emails)];
}
//build the text for the multi-recipient choice
function buildMultiRecipientChoiceText(args) {
    return textResponse([
        "Email preview — not sent yet",
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
            `Recipient email: ${args.toAddress && args.toAddress.trim()
                ? args.toAddress.trim()
                : "Not provided"}`,
            ...bccLine,
        ];
    return textResponse([
        "Email preview — not sent yet",
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
        "",
        "Create/post confirmation and email send confirmation are separate steps.",
    ].join("\n"));
}
function documentTypeLabelForPath(path) {
    if (path === "/v1/email/sendSalesInvoice") {
        return "sales invoice";
    }
    if (path === "/v1/email/sendQuote") {
        return "quote";
    }
    if (path === "/v1/email/sendEmailStatement") {
        return "customer statement";
    }
    return "document";
}
async function resolveRecipientsForEmailSend(args) {
    let recipients = normaliseEmailList({
        toAddress: args.toAddress,
        toAddresses: args.toAddresses,
    });
    if (recipients.length === 0) {
        const customerEmail = await resolveCustomerEmailForEmailDocument({
            companyName: args.companyName,
            path: args.path,
            documentArgs: args.documentArgs,
        });
        if (customerEmail) {
            recipients = [customerEmail];
        }
    }
    return recipients;
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
function buildStatementPreflightPayload(rest) {
    const payload = {};
    for (const key of ["minBalance", "fromPeriod", "toPeriod", "customerId"]) {
        if (rest[key] !== undefined) {
            payload[key] = rest[key];
        }
    }
    return payload;
}
function enforceStatementEmailSettings(settings, rest) {
    enforceTransactionSettingsOrThrow(settings, "statement", buildStatementPreflightPayload(rest));
}
function registerEmailSendTool(server, toolName, description, path, idField, idSchema, extraShape = {}) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        //the id field is the id of the document to send the email for
        [idField]: idSchema.describe(`BRC field: ${idField}.`),
        ...extraShape,
        ...optionalEmailFields,
    }, 
    //pass the user's arguments to the function
    async (args) => {
        const { companyName, fromAddress, toAddress, toAddresses, sendMode, bccAddresses, messageBody, confirmSend, ...rest } = args;
        //minimal balance from setup/options
        const statementSettings = path === "/v1/email/sendEmailStatement"
            ? await getCompanyProcessingSettings(String(companyName))
            : undefined;
        if (path === "/v1/email/sendEmailStatement" && rest.minBalance === undefined) {
            if (statementSettings?.defaultDebtorStatementMinimumBalance !== undefined) {
                rest.minBalance = statementSettings.defaultDebtorStatementMinimumBalance;
            }
        }
        const documentLabel = `${idField} ${String(rest[idField])}`;
        const documentTypeLabel = documentTypeLabelForPath(path);
        let recipients = await resolveRecipientsForEmailSend({
            companyName: String(companyName),
            path,
            documentArgs: rest,
            toAddress,
            toAddresses,
        });
        if (recipients.length === 0 &&
            (path === "/v1/email/sendSalesInvoice" || path === "/v1/email/sendQuote")) {
            return jsonResponse(buildRecipientEmailRequiredResponse({
                documentLabel,
                documentTypeLabel,
            }));
        }
        //parse the send mode
        const parsedSendMode = sendMode;
        if (recipients.length === 0 && path === "/v1/email/sendEmailStatement") {
            return jsonResponse(buildRecipientEmailRequiredResponse({
                documentLabel,
                documentTypeLabel,
            }));
        }
        //if the user has provided multiple recipient addresses and no send mode, build the text for the multi-recipient choice
        if (recipients.length > 1 && !parsedSendMode) {
            return buildMultiRecipientChoiceText({
                documentLabel,
                recipients,
                messageBody: typeof messageBody === "string" ? messageBody : undefined,
            });
        }
        //build the combined BCC addresses
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
        //if the user has not confirmed the email, build the text for the email draft
        if (!Boolean(confirmSend)) {
            return buildEmailDraftText({
                documentLabel,
                toAddress: parsedSendMode === "single_with_bcc" && recipients.length
                    ? recipients[0]
                    : recipients.length === 1
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
        if (recipients.length === 0) {
            return jsonResponse(buildRecipientEmailRequiredResponse({
                documentLabel,
                documentTypeLabel,
            }));
        }
        //if the user has confirmed the email and the send mode is separate, send the email to each recipient separately
        if (parsedSendMode === "separate" && recipients.length > 1) {
            if (path === "/v1/email/sendEmailStatement" && statementSettings) {
                enforceStatementEmailSettings(statementSettings, rest);
            }
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
        //apply the extra fields to the payload
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
        if (path === "/v1/email/sendEmailStatement" && statementSettings) {
            enforceStatementEmailSettings(statementSettings, rest);
        }
        return sendEmail(String(companyName), path, payload);
    });
}
export function registerEmailTools(server) {
    const supportedEmailTypesNote = "Supported document type only. Red email sending is available for sales invoices, quotes, and customer statements — not for cash receipts, purchases, payments, bank accounts, customers, suppliers, products, reports, or other document types. If the user asks to email an unsupported document type, say Red cannot email it through the current MCP tools, list the supported types, and stop without preparing an email preview or attempting a workaround.";
    //common email rules
    const commonEmailRule = "Do not call this tool with confirmSend=true until the user has reviewed a plain-English email preview and explicitly confirmed they want to send it. The email preview must show the recipient email address clearly before asking for send confirmation. If there is no customer email on file and no recipient override, stop and ask for a recipient email address — do not send. Create/post confirmation and email send confirmation are separate steps. If the user provides multiple recipient addresses, ask whether to send one email using BCC or separate individual emails. Only use sendMode='separate' when the user explicitly chooses separate emails. Do not ask about BCC unless the user provides multiple recipients or asks to copy another address.";
    registerEmailSendTool(server, "brc_send_sales_invoice_email", `Sends a sales invoice email. ${supportedEmailTypesNote} ${commonEmailRule}`, "/v1/email/sendSalesInvoice", "salesInvoiceId", z.number().int().positive());
    registerEmailSendTool(server, "brc_send_email_statement", `Sends a customer statement email. ${supportedEmailTypesNote} ${commonEmailRule}`, "/v1/email/sendEmailStatement", "customerId", z.number().int().positive(), {
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
    registerEmailSendTool(server, "brc_send_quote_email", `Sends a quote email. ${supportedEmailTypesNote} ${commonEmailRule}`, "/v1/email/sendQuote", "quoteId", z.number().int().positive());
}
