export const ACTIVE_CONNECTION_STATUS = "active" as const;
export const EMPTY_RESULT_REASON = "no_matching_records" as const;

export const EMPTY_READ_RESULT_MESSAGE =
  "The Red connection is active. No matching records were returned for this company/filter.";

export type ReadConnectionMetadata = {
  connectionStatus: typeof ACTIVE_CONNECTION_STATUS;
  shouldReconnect: false;
  emptyResultReason?: typeof EMPTY_RESULT_REASON;
  message?: string;
};

function extractListItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const items = record.items ?? record.Items;
    if (Array.isArray(items)) {
      return items;
    }
  }

  return [];
}

export function isListPayload(data: unknown): boolean {
  if (Array.isArray(data)) {
    return true;
  }

  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    "items" in record ||
    "Items" in record ||
    "count" in record ||
    "Count" in record
  );
}

export function isEmptyListResponse(data: unknown): boolean {
  const items = extractListItems(data);
  if (items.length > 0) {
    return false;
  }

  if (!isListPayload(data)) {
    return false;
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const count = record.Count ?? record.count;
    if (typeof count === "number") {
      return count === 0;
    }
  }

  return items.length === 0;
}

export function buildReadConnectionMetadata(
  data: unknown,
  companyName?: string
): ReadConnectionMetadata {
  const metadata: ReadConnectionMetadata = {
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

export function enrichReadResponseBody(
  data: unknown,
  companyName?: string
): Record<string, unknown> {
  const metadata = buildReadConnectionMetadata(data, companyName);

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return {
      ...(data as Record<string, unknown>),
      ...metadata,
    };
  }

  return {
    result: data,
    ...metadata,
  };
}

export function responseSuggestsReconnect(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.shouldReconnect === true) {
    return true;
  }

  const message = typeof record.message === "string" ? record.message : "";
  return /reconnect|connection expired|start a fresh company connection/i.test(message);
}
