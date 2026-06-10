import { z } from "zod";
import { brcJsonRequest, companyNameSchema, jsonResponse, textResponse, } from "../../shared.js";
import { registerRawDeleteTool, registerRawUpdateTool, } from "../general/crud_tools.js";
import { registerGetTool, registerListTool } from "../general/list_tools.js";
import { buildBankAccountPayload, unwrapPayload } from "../general/payloads_tools.js";
/** List/get only — safe read-only tools for payments and reference data. */
export function registerBankListTools(server) {
    registerListTool(server, "brc_list_bank_accounts", "Lists BRC bank accounts.", "/v1/bankAccounts");
    registerGetTool(server, "brc_get_bank_account", "Gets one BRC bank account by id.", "/v1/bankAccounts", "Bank account");
}
/** Full bank CRUD — only register when update/delete skills are allowed. */
export function registerBankTools(server) {
    registerBankListTools(server);
    server.tool("brc_create_bank_account", [
        "Creates a BRC bank account.",
        "Do not call this tool with confirmCreate=true until the user has reviewed a plain-English summary and explicitly confirmed creation.",
        "Required fields: acCode, details, lastChq, nominalAcCode, and categoryId.",
        "categoryId must be the Bank Payments category type from brc_list_category_types.",
        "nominalAcCode must reference an existing balance-sheet bank nominal account created in BRC setup.",
    ].join(" "), {
        companyName: companyNameSchema,
        payload: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Optional raw bank account payload."),
        acCode: z
            .string()
            .optional()
            .describe("Bank account code, for example 1603."),
        details: z
            .string()
            .optional()
            .describe("Bank account description/name."),
        nominalAcCode: z
            .string()
            .optional()
            .describe("Linked balance-sheet nominal account code, for example 1601."),
        lastChq: z
            .string()
            .optional()
            .describe("Last cheque number, for example 000001."),
        categoryId: z
            .number()
            .int()
            .optional()
            .describe("Bank Payments category type id from brc_list_category_types."),
        balance: z
            .number()
            .optional()
            .default(0)
            .describe("Opening/current starting balance."),
        isDefaultBank: z.boolean().default(false),
        address: z.array(z.string()).optional(),
        accountName: z.string().optional(),
        businessIdentifierCode: z.string().optional(),
        internationalBankAccountNumber: z.string().optional(),
        creditorScheme: z.string().optional(),
        sortCode: z.string().optional(),
        accountNumber: z.string().optional(),
        bankFeedsSource: z.number().int().optional(),
        confirmCreate: z
            .boolean()
            .default(false)
            .describe("Must be true only after the user explicitly confirms creation."),
    }, async ({ companyName, confirmCreate, ...args }) => {
        const merged = unwrapPayload(args);
        const payload = buildBankAccountPayload(merged);
        const missingRequiredFields = [
            "acCode",
            "details",
            "nominalAcCode",
            "lastChq",
            "categoryId",
        ].filter((field) => payload[field] === undefined || payload[field] === "");
        if (missingRequiredFields.length > 0) {
            return textResponse([
                "I cannot create the bank account yet because some required details are missing.",
                "",
                "Missing details:",
                ...missingRequiredFields.map((field) => `- ${field}`),
                "",
                "Required details are:",
                "- Bank account code",
                "- Bank account description/name",
                "- Linked nominal account code",
                "- Last cheque number",
                "- Bank Payments category type id",
            ].join("\n"));
        }
        if (!confirmCreate) {
            return textResponse([
                "Bank account draft — not created yet",
                "",
                `Company: ${companyName}`,
                `Bank account code: ${String(payload.acCode)}`,
                `Description: ${String(payload.details)}`,
                `Linked nominal account code: ${String(payload.nominalAcCode)}`,
                `Last cheque number: ${String(payload.lastChq)}`,
                `Category type id: ${String(payload.categoryId)}`,
                `Starting balance: ${String(payload.balance ?? 0)}`,
                `Default bank account: ${payload.isDefaultBank ? "Yes" : "No"}`,
                "",
                payload.accountName ? `Account name: ${String(payload.accountName)}` : undefined,
                payload.sortCode ? `Sort code: ${String(payload.sortCode)}` : undefined,
                payload.accountNumber ? `Account number: ${String(payload.accountNumber)}` : undefined,
                payload.internationalBankAccountNumber
                    ? `IBAN: ${String(payload.internationalBankAccountNumber)}`
                    : undefined,
                payload.businessIdentifierCode
                    ? `BIC: ${String(payload.businessIdentifierCode)}`
                    : undefined,
                "",
                "Please review this carefully.",
                "",
                "Reply with \"Yes, create this bank account\" to create it, or tell me what to change.",
            ]
                .filter(Boolean)
                .join("\n"));
        }
        const response = await brcJsonRequest(companyName, "POST", "/v1/bankAccounts", payload);
        return jsonResponse({
            message: "Bank account create request sent to BRC.",
            companyName,
            endpoint: "POST /v1/bankAccounts",
            payloadSent: payload,
            response,
        });
    });
    registerRawUpdateTool(server, "brc_update_bank_account", "Updates a BRC bank account using merged fields. Before calling this tool, show the user a plain-English summary of the changes and ask for explicit confirmation.", "/v1/bankAccounts", "Bank account");
    registerRawDeleteTool(server, "brc_delete_bank_account", "Deletes a BRC bank account by id. Only call this after the user has explicitly confirmed deletion.", "/v1/bankAccounts", "bank account");
}
