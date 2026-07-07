export const ACTIVE_CONNECTION_STATUS = "active" as const;
export const EMPTY_RESULT_REASON = "no_matching_records" as const;

export const EMPTY_READ_RESULT_MESSAGE =
  "The Red connection is active. No matching records were returned for this company/filter.";

export const CONNECTION_REF_REMINDER =
  "Keep passing activeConnectionRef as connectionRef on every later Red tool call in this chat. Do not reconnect while this works.";

export type ReadConnectionMetadataOptions = {
  companyName?: string;
  /** True when the caller supplied a connectionRef for this request. */
  connectionRefUsed?: boolean;
  /** Echo the active ref back to hosted clients that lose context between turns. */
  activeConnectionRef?: string;
};

export type ReadConnectionMetadata = {
  connectionStatus: typeof ACTIVE_CONNECTION_STATUS;
  shouldReconnect: false;
  connectionRefUsed?: boolean;
  companyName?: string;
  activeConnectionRef?: string;
  connectionRefReminder?: string;
  emptyResultReason?: typeof EMPTY_RESULT_REASON;
  message?: string;
};

export function appendConnectionPersistenceMetadata<
  T extends Record<string, unknown>,
>(metadata: T, options: ReadConnectionMetadataOptions = {}): T & ReadConnectionMetadata {
  const companyName = options.companyName?.trim();
  const activeRef = options.activeConnectionRef?.trim();
  const connectionRefUsed =
    options.connectionRefUsed ?? Boolean(activeRef);

  const result: T & ReadConnectionMetadata = {
    ...metadata,
    connectionStatus: ACTIVE_CONNECTION_STATUS,
    shouldReconnect: false,
    connectionRefUsed,
    ...(companyName ? { companyName } : {}),
  };

  if (activeRef && connectionRefUsed) {
    result.activeConnectionRef = activeRef;
    result.connectionRefReminder = CONNECTION_REF_REMINDER;
  }

  return result;
}

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
  options: ReadConnectionMetadataOptions = {}
): ReadConnectionMetadata {
  const metadata = appendConnectionPersistenceMetadata({}, options);

  if (!isEmptyListResponse(data)) {
    return metadata;
  }

  const companyName = options.companyName?.trim();
  const companySuffix = companyName
    ? ` for ${companyName}`
    : " for this company/filter";

  return {
    ...metadata,
    emptyResultReason: EMPTY_RESULT_REASON,
    message: `The Red connection is active. No matching records were returned${companySuffix}.`,
  };
}

export function enrichWriteResponseBody(
  data: unknown,
  options: ReadConnectionMetadataOptions = {}
): Record<string, unknown> {
  const metadata = appendConnectionPersistenceMetadata({}, options);

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

export function enrichReadResponseBody(
  data: unknown,
  options: ReadConnectionMetadataOptions = {}
): Record<string, unknown> {
  const metadata = buildReadConnectionMetadata(data, options);

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
