import { z } from "zod";
import { brcFetch, brcJsonRequest, cloneJson, companyNameSchema, getTimestampFromRecord, jsonResponse, } from "../../shared.js";
import { enforceTransactionSettingsOrThrow, getCompanyProcessingSettings, loadAndEnforceTransactionSettings, } from "../../guards/company_processing_settings.js";
import { enforceReferenceSettingsOrThrow, getCompanyReferenceSettings, } from "../../guards/company_reference_settings.js";
import { buildBankAccountPayload, buildCashReceiptPayload, mergeCashReceiptUpdateFromCurrent, buildCustomerLikePayload, buildProductPayload, enforceSalesProductLineAnalysisOrThrow, normalizeBatchItems, unwrapPayload, } from "./payloads_tools.js";
import { checkCustomerNameEmailMatch } from "../../data_quality/customer_email_check.js";
import { getMaxBatchItems } from "../../config/server_config.js";
//Removed opening balance fields from payload --> don't prompt customer for customer opening balance because there is no API that will POST it
const OPENING_BALANCE_FIELD_NAMES = [
    "openingBalance",
    "opening_balance",
    "openingBalanceAmount",
    "opening_balance_amount",
    "openingBal",
    "opening_bal",
    "openingBalanceDate",
    "opening_balance_date",
];
function hasOpeningBalanceFields(value) {
    return OPENING_BALANCE_FIELD_NAMES.some((field) => field in value);
}
function removeOpeningBalanceFields(value) {
    const cleaned = { ...value };
    for (const field of OPENING_BALANCE_FIELD_NAMES) {
        delete cleaned[field];
    }
    return cleaned;
}
const REFERENCE_BATCH_WORKFLOWS = {
    "/v1/salesInvoices": "sales_invoice",
    "/v1/salesCreditNotes": "sales_credit_note",
    "/v1/purchases": "purchase",
    "/v1/quotes": "quote",
};
const SALES_ANALYSIS_BATCH_WORKFLOWS = {
    "/v1/salesInvoices": "sales_invoice",
    "/v1/salesCreditNotes": "sales_credit_note",
    "/v1/quotes": "quote",
};
const TRANSACTION_BATCH_WORKFLOWS = {
    "/v1/salesInvoices": "sales_invoice",
    "/v1/salesEntries": "sales_invoice",
    "/v1/salesCreditNotes": "sales_credit_note",
    "/v1/purchases": "purchase",
    "/v1/cashReceipts": "cash_receipt",
};
function extractBatchItemPayload(entry) {
    return (entry.item ?? entry.Item ?? entry);
}
export function registerRawCreateTool(server, toolName, description, path) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        payload: z
            .record(z.string(), z.unknown())
            .describe("Raw BRC-compatible payload for this endpoint."),
    }, async ({ companyName, payload }) => {
        let finalPayload = unwrapPayload(payload);
        const openingBalanceIgnored = (path === "/v1/customers" || path === "/v1/suppliers") &&
            hasOpeningBalanceFields(finalPayload);
        if (openingBalanceIgnored) {
            finalPayload = removeOpeningBalanceFields(finalPayload);
        }
        if (path === "/v1/products")
            finalPayload = buildProductPayload(finalPayload);
        if (path === "/v1/customers")
            finalPayload = buildCustomerLikePayload(finalPayload, 1);
        if (path === "/v1/suppliers")
            finalPayload = buildCustomerLikePayload(finalPayload, 3);
        if (path === "/v1/bankAccounts")
            finalPayload = buildBankAccountPayload(finalPayload);
        if (path === "/v1/cashReceipts") {
            const processingSettings = await loadAndEnforceTransactionSettings(companyName, "cash_receipt", finalPayload);
            const vatOnCashEnabled = processingSettings.vatOnCashReceiptsEnabled === true;
            finalPayload = buildCashReceiptPayload(finalPayload, { vatOnCashEnabled });
        }
        const emailNameCheck = path === "/v1/customers" || path === "/v1/suppliers"
            ? checkCustomerNameEmailMatch({
                name: finalPayload.name ?? finalPayload.Name,
                email: finalPayload.email ?? finalPayload.Email,
            })
            : { status: "not_checked" };
        const response = await brcJsonRequest(companyName, "POST", path, finalPayload);
        return jsonResponse({
            message: openingBalanceIgnored
                ? "Create request sent to BRC. Opening balance was not included because opening balances cannot currently be created or updated through Red."
                : "Create request sent to BRC.",
            companyName,
            endpoint: `POST ${path}`,
            payloadSent: finalPayload,
            openingBalanceWarning: openingBalanceIgnored
                ? "Opening balances must be entered directly in Big Red Cloud after the customer/supplier record is created."
                : undefined,
            dataQualityWarnings: emailNameCheck.status === "warning" ? [emailNameCheck.message] : [],
            response,
        });
    });
}
export function registerRawUpdateTool(server, toolName, description, path, label) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe(`${label} id.`),
        updates: z.record(z.string(), z.unknown()).optional().describe("Fields to merge into the existing record."),
        payload: z.record(z.string(), z.unknown()).optional().describe("Alias for updates."),
    }, async ({ companyName, id, updates, payload: payloadAlias }) => {
        const current = await brcFetch(companyName, `${path}/${encodeURIComponent(String(id))}`);
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            throw new Error(`Could not read ${label} ${id} before update.`);
        }
        let mergeUpdates = unwrapPayload((updates ?? payloadAlias ?? {}));
        const openingBalanceIgnored = (path === "/v1/customers" || path === "/v1/suppliers") &&
            hasOpeningBalanceFields(mergeUpdates);
        if (openingBalanceIgnored) {
            mergeUpdates = removeOpeningBalanceFields(mergeUpdates);
        }
        let payload = {
            ...cloneJson(current),
            ...mergeUpdates,
        };
        if (path === "/v1/products")
            payload = { ...payload, ...buildProductPayload(payload) };
        if (path === "/v1/customers")
            payload = { ...payload, ...buildCustomerLikePayload(payload, 1) };
        if (path === "/v1/suppliers")
            payload = { ...payload, ...buildCustomerLikePayload(payload, 3) };
        if (path === "/v1/bankAccounts")
            payload = { ...payload, ...buildBankAccountPayload(payload) };
        if (path === "/v1/cashReceipts") {
            const processingSettings = await loadAndEnforceTransactionSettings(companyName, "cash_receipt", {
                ...current,
                ...mergeUpdates,
            });
            const vatOnCashEnabled = processingSettings.vatOnCashReceiptsEnabled === true;
            const currentRecord = current;
            payload = mergeCashReceiptUpdateFromCurrent(buildCashReceiptPayload(payload, { vatOnCashEnabled }), currentRecord);
        }
        const updateResponse = await brcJsonRequest(companyName, "PUT", `${path}/${encodeURIComponent(String(id))}`, payload);
        const verification = await brcFetch(companyName, `${path}/${encodeURIComponent(String(id))}`);
        return jsonResponse({
            message: openingBalanceIgnored
                ? `${label} updated using merged MCP payload. Opening balance was not changed because opening balances cannot currently be created or updated through Red.`
                : `${label} updated using merged MCP payload.`,
            companyName,
            endpoint: `PUT ${path}/${id}`,
            payloadSent: payload,
            openingBalanceWarning: openingBalanceIgnored
                ? "Opening balances must be entered directly in Big Red Cloud."
                : undefined,
            updateResponse,
            verification,
        });
    });
}
export function registerRawDeleteTool(server, toolName, description, path, label) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe(`${label} id.`),
        confirmDelete: z.boolean().default(false),
    }, async ({ companyName, id, confirmDelete }) => {
        if (!confirmDelete) {
            throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
        }
        const current = await brcFetch(companyName, `${path}/${encodeURIComponent(String(id))}`);
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            throw new Error(`Could not read ${label} ${id} before deletion.`);
        }
        const timestamp = getTimestampFromRecord(current, `${label} ${id}`);
        const deleteResponse = await brcJsonRequest(companyName, "DELETE", `${path}/${encodeURIComponent(String(id))}?timestamp=${encodeURIComponent(timestamp)}`);
        return jsonResponse({
            deleted: true,
            companyName,
            endpoint: `DELETE ${path}/${id}`,
            id,
            timestampUsed: timestamp,
            deleteResponse,
        });
    });
}
export function registerRawBatchTool(server, toolName, description, path) {
    const maxBatchItems = getMaxBatchItems();
    server.tool(toolName, `${description} Maximum ${maxBatchItems} items per batch request.`, {
        companyName: companyNameSchema,
        items: z.array(z.record(z.string(), z.unknown())).min(1)
            .max(maxBatchItems)
            .describe(`Batch items to process. Maximum ${maxBatchItems} items per request.`),
    }, async ({ companyName, items }) => {
        if (items.length > maxBatchItems) {
            throw new Error(`Batch limit exceeded. Red allows a maximum of ${maxBatchItems} items per batch request. Split the work into smaller batches and confirm each batch before sending.`);
        }
        let vatOnCashReceiptEnabled = true;
        const transactionWorkflow = TRANSACTION_BATCH_WORKFLOWS[path];
        if (transactionWorkflow) {
            const processingSettings = await getCompanyProcessingSettings(companyName);
            if (path === "/v1/cashReceipts") {
                vatOnCashReceiptEnabled = processingSettings.vatOnCashReceiptsEnabled === true;
            }
            const preflightFailures = [];
            for (let index = 0; index < items.length; index++) {
                const raw = extractBatchItemPayload(items[index]);
                try {
                    enforceTransactionSettingsOrThrow(processingSettings, transactionWorkflow, raw);
                }
                catch (error) {
                    preflightFailures.push(`Item ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (preflightFailures.length > 0) {
                throw new Error(`Red stopped before posting the batch because ${preflightFailures.length} item(s) failed transaction settings preflight checks:\n${preflightFailures.join("\n")}`);
            }
        }
        const referenceWorkflow = REFERENCE_BATCH_WORKFLOWS[path];
        if (referenceWorkflow) {
            const referenceSettings = await getCompanyReferenceSettings(companyName);
            const preflightFailures = [];
            for (let index = 0; index < items.length; index++) {
                const raw = extractBatchItemPayload(items[index]);
                try {
                    enforceReferenceSettingsOrThrow(referenceSettings, referenceWorkflow, raw, "manual");
                }
                catch (error) {
                    preflightFailures.push(`Item ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (preflightFailures.length > 0) {
                throw new Error(`Red stopped before posting the batch because ${preflightFailures.length} item(s) failed reference preflight checks:\n${preflightFailures.join("\n")}`);
            }
        }
        const salesAnalysisWorkflow = SALES_ANALYSIS_BATCH_WORKFLOWS[path];
        if (salesAnalysisWorkflow) {
            const preflightFailures = [];
            for (let index = 0; index < items.length; index++) {
                const entry = items[index];
                const raw = extractBatchItemPayload(entry);
                const confirmCrAnalysisCategory = entry.confirmCrAnalysisCategory === true ||
                    raw.confirmCrAnalysisCategory === true;
                try {
                    enforceSalesProductLineAnalysisOrThrow(raw, salesAnalysisWorkflow, {
                        confirmCrAnalysisCategory,
                    });
                }
                catch (error) {
                    preflightFailures.push(`Item ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (preflightFailures.length > 0) {
                throw new Error(`Red stopped before posting the batch because ${preflightFailures.length} item(s) failed sales analysis preflight checks:\n${preflightFailures.join("\n")}`);
            }
        }
        const normalizedItems = normalizeBatchItems(path, items, {
            vatOnCashReceiptEnabled,
        });
        const response = await brcJsonRequest(companyName, "PUT", `${path}/batch`, normalizedItems);
        const responseItems = Array.isArray(response) ? response : [];
        const failedItems = responseItems.filter((item) => {
            const code = typeof item?.code === "number" ? item.code : 0;
            return code >= 400;
        });
        if (failedItems.length > 0) {
            throw new Error(`BRC batch ${path} returned ${failedItems.length} failed item(s): ${JSON.stringify(failedItems)}`);
        }
        return jsonResponse({
            message: "Batch request sent to BRC.",
            companyName,
            endpoint: `PUT ${path}/batch`,
            itemCount: normalizedItems.length,
            payloadSent: normalizedItems,
            response,
        });
    });
}
