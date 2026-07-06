export const ACTIVE_CONNECTION_STATUS = "active";
export const EMPTY_RESULT_REASON = "no_matching_records";
export const EMPTY_READ_RESULT_MESSAGE = "The Red connection is active. No matching records were returned for this company/filter.";
function extractListItems(data) {
    if (Array.isArray(data)) {
        return data;
    }
    if (data && typeof data === "object") {
        const record = data;
        const items = record.items ?? record.Items;
        if (Array.isArray(items)) {
            return items;
        }
    }
    return [];
}
export function isListPayload(data) {
    if (Array.isArray(data)) {
        return true;
    }
    if (!data || typeof data !== "object") {
        return false;
    }
    const record = data;
    return ("items" in record ||
        "Items" in record ||
        "count" in record ||
        "Count" in record);
}
export function isEmptyListResponse(data) {
    const items = extractListItems(data);
    if (items.length > 0) {
        return false;
    }
    if (!isListPayload(data)) {
        return false;
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const record = data;
        const count = record.Count ?? record.count;
        if (typeof count === "number") {
            return count === 0;
        }
    }
    return items.length === 0;
}
export function buildReadConnectionMetadata(data, companyName) {
    const metadata = {
        connectionStatus: ACTIVE_CONNECTION_STATUS,
        shouldReconnect: false,
    };
    if (!isEmptyListResponse(data)) {
        return metadata;
    }
    const companySuffix = companyName?.trim()
        ? ` for ${companyName.trim()}`
        : " for this company/filter";
    return {
        ...metadata,
        emptyResultReason: EMPTY_RESULT_REASON,
        message: `The Red connection is active. No matching records were returned${companySuffix}.`,
    };
}
export function enrichReadResponseBody(data, companyName) {
    const metadata = buildReadConnectionMetadata(data, companyName);
    if (data && typeof data === "object" && !Array.isArray(data)) {
        return {
            ...data,
            ...metadata,
        };
    }
    return {
        result: data,
        ...metadata,
    };
}
export function responseSuggestsReconnect(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value;
    if (record.shouldReconnect === true) {
        return true;
    }
    const message = typeof record.message === "string" ? record.message : "";
    return /reconnect|connection expired|start a fresh company connection/i.test(message);
}
