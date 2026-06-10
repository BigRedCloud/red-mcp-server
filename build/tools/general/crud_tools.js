import { z } from "zod";
import { brcFetch, brcJsonRequest, cloneJson, companyNameSchema, getTimestampFromRecord, jsonResponse, } from "../../shared.js";
import { isVatOnCashReceiptEnabled } from "../../cash_receipt_settings.js";
import { buildBankAccountPayload, buildCashReceiptPayload, mergeCashReceiptUpdateFromCurrent, buildCustomerLikePayload, buildProductPayload, normalizeBatchItems, unwrapPayload, } from "./payloads_tools.js";
import { checkCustomerNameEmailMatch } from "../../data_quality/customer_email_check.js";
import { getMaxBatchItems } from "../../server_config.js";
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
            const vatOnCashEnabled = await isVatOnCashReceiptEnabled(companyName);
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
                ? "Create request sent to BRC. Opening balance was not included because opening balances cannot currently be created or updated through Red Connect."
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
            const vatOnCashEnabled = await isVatOnCashReceiptEnabled(companyName);
            const currentRecord = current;
            payload = mergeCashReceiptUpdateFromCurrent(buildCashReceiptPayload(payload, { vatOnCashEnabled }), currentRecord);
        }
        const updateResponse = await brcJsonRequest(companyName, "PUT", `${path}/${encodeURIComponent(String(id))}`, payload);
        const verification = await brcFetch(companyName, `${path}/${encodeURIComponent(String(id))}`);
        return jsonResponse({
            message: openingBalanceIgnored
                ? `${label} updated using merged MCP payload. Opening balance was not changed because opening balances cannot currently be created or updated through Red Connect.`
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
            throw new Error(`Batch limit exceeded. Red Connect allows a maximum of ${maxBatchItems} items per batch request. Split the work into smaller batches and confirm each batch before sending.`);
        }
        const vatOnCashReceiptEnabled = path === "/v1/cashReceipts" ? await isVatOnCashReceiptEnabled(companyName) : true;
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
