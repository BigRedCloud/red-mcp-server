import { z } from "zod";
import { brcJsonRequest, companyNameSchema, jsonResponse } from "../shared.js";
import { registerListTool, registerGetTool } from "./general/list_tools.js";
import { registerRawUpdateTool, registerRawDeleteTool, registerRawBatchTool, } from "./general/crud_tools.js";
import { buildBankAccountPayload, unwrapPayload, } from "./general/payloads_tools.js";
export function registerBankTools(server) {
    // Bank Accounts
    registerListTool(server, "brc_list_bank_accounts", "Lists BRC bank accounts.", "/v1/bankAccounts");
    registerGetTool(server, "brc_get_bank_account", "Gets one BRC bank account by id.", "/v1/bankAccounts", "Bank account");
    server.tool("brc_create_bank_account", "Creates a BRC bank account. Requires acCode, details, lastChq, nominalAcCode, and categoryId (Bank Payments category type from brc_list_category_types). nominalAcCode must reference an existing balance-sheet bank nominal account created in BRC setup.", {
        companyName: companyNameSchema,
        payload: z.record(z.string(), z.unknown()).optional().describe("Optional raw bank account payload."),
        acCode: z.string().optional().describe("Bank account code, for example 1603."),
        details: z.string().optional().describe("Bank account description."),
        nominalAcCode: z.string().optional().describe("Linked balance-sheet nominal account code, for example 1601."),
        lastChq: z.string().optional().describe("Last cheque number, for example 000001."),
        categoryId: z.number().int().optional().describe("Bank Payments category type id from brc_list_category_types."),
        balance: z.number().optional().default(0).describe("Opening balance / current starting balance."),
        isDefaultBank: z.boolean().default(false),
        address: z.array(z.string()).optional(),
        accountName: z.string().optional(),
        businessIdentifierCode: z.string().optional(),
        internationalBankAccountNumber: z.string().optional(),
        creditorScheme: z.string().optional(),
        sortCode: z.string().optional(),
        accountNumber: z.string().optional(),
        bankFeedsSource: z.number().int().optional(),
    }, async ({ companyName, ...args }) => {
        const merged = unwrapPayload(args);
        const payload = buildBankAccountPayload(merged);
        const response = await brcJsonRequest(companyName, "POST", "/v1/bankAccounts", payload);
        return jsonResponse({
            message: "Bank account create request sent to BRC.",
            companyName,
            endpoint: "POST /v1/bankAccounts",
            payloadSent: payload,
            response,
        });
    });
    registerRawUpdateTool(server, "brc_update_bank_account", "Updates a BRC bank account using merged fields.", "/v1/bankAccounts", "Bank account");
    registerRawDeleteTool(server, "brc_delete_bank_account", "Deletes a BRC bank account by id.", "/v1/bankAccounts", "bank account");
    registerRawBatchTool(server, "brc_batch_bank_accounts", "Processes a batch of BRC bank accounts.", "/v1/bankAccounts");
}
