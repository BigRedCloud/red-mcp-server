import { brcFetch } from "../shared.js";

export type DraftDetailField = {
  label: string;
  value: string | null;
  provided: boolean;
};

export type DocumentDraftDetails = {
  customerDetails: {
    phone: DraftDetailField;
    email: DraftDetailField;
  };
  missingOrNotProvided: string[];
  warnings: string[];
  missingOrNotProvidedSection: string;
};

const QUOTE_OR_INVOICE_CREATE_TOOLS = new Set([
  "brc_create_quote",
  "brc_create_quote_gen_ref",
  "brc_create_sales_invoice",
  "brc_create_sales_invoice_gen_ref",
]);

function isProvided(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function detailField(label: string, value: unknown): DraftDetailField {
  const text = isProvided(value) ? String(value).trim() : null;
  return { label, value: text, provided: text !== null };
}

function getWriteBody(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  return payload;
}

export function isQuoteOrSalesInvoiceCreateTool(toolName: string): boolean {
  return QUOTE_OR_INVOICE_CREATE_TOOLS.has(toolName);
}

function getCustomerIdFromPayload(
  toolName: string,
  payload: Record<string, unknown>
): number | null {
  const body = getWriteBody(payload);
  const rawId = toolName.includes("quote")
    ? body.customerOwnerId ?? body.customerId
    : body.customerId ?? body.customerOwnerId;

  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function buildMissingOrNotProvidedSection(missingLabels: string[]): string {
  if (missingLabels.length === 0) {
    return "";
  }

  return [
    "Missing or not provided:",
    ...missingLabels.map((label) => `- ${label}`),
    "",
    "These contact fields are warnings only for create/post. These values will not be invented.",
    "Missing customer email does not block create/post, but email sending will require a recipient override unless a customer email is on file.",
  ].join("\n");
}

function buildContactWarning(label: string): string {
  if (label === "Customer email") {
    return [
      `${label} is missing or not provided.`,
      "This value will not be invented.",
      "You can still create or post the document, but email sending will require a recipient override unless a customer email is added later.",
    ].join(" ");
  }

  return `${label} is missing or not provided. This value will not be invented.`;
}

export async function buildQuoteOrSalesInvoiceDraftDetails(
  toolName: string,
  companyName: string | undefined,
  payload: Record<string, unknown>
): Promise<{
  documentDraftDetails?: DocumentDraftDetails;
  missingOrNotProvidedSection?: string;
  draftWarnings?: string[];
}> {
  if (!companyName || !isQuoteOrSalesInvoiceCreateTool(toolName)) {
    return {};
  }

  const customerDetails = {
    phone: detailField("Customer phone", null),
    email: detailField("Customer email", null),
  };

  const customerId = getCustomerIdFromPayload(toolName, payload);
  if (customerId) {
    try {
      const customer = await brcFetch(
        companyName,
        `/v1/customers/${encodeURIComponent(String(customerId))}`
      );

      if (customer && typeof customer === "object" && !Array.isArray(customer)) {
        const record = customer as Record<string, unknown>;
        customerDetails.phone = detailField(
          "Customer phone",
          record.phone ?? record.mobile
        );
        customerDetails.email = detailField("Customer email", record.email);
      }
    } catch {
      // Leave customer fields as not provided — do not invent values.
    }
  }

  const contactFields = Object.values(customerDetails);
  const missingOrNotProvided = contactFields
    .filter((field) => !field.provided)
    .map((field) => field.label);

  const warnings = missingOrNotProvided.map((label) => buildContactWarning(label));

  const missingOrNotProvidedSection =
    buildMissingOrNotProvidedSection(missingOrNotProvided);

  if (missingOrNotProvided.length === 0) {
    return {
      documentDraftDetails: {
        customerDetails,
        missingOrNotProvided,
        warnings,
        missingOrNotProvidedSection,
      },
    };
  }

  return {
    documentDraftDetails: {
      customerDetails,
      missingOrNotProvided,
      warnings,
      missingOrNotProvidedSection,
    },
    missingOrNotProvidedSection,
    draftWarnings: warnings,
  };
}

export async function fetchCustomerEmailById(
  companyName: string,
  customerId: number
): Promise<string | null> {
  try {
    const customer = await brcFetch(
      companyName,
      `/v1/customers/${encodeURIComponent(String(customerId))}`
    );

    if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
      return null;
    }

    const email = (customer as Record<string, unknown>).email;
    return typeof email === "string" && email.trim() ? email.trim() : null;
  } catch {
    return null;
  }
}

export async function resolveCustomerEmailForEmailDocument(args: {
  companyName: string;
  path: string;
  documentArgs: Record<string, unknown>;
}): Promise<string | null> {
  const { companyName, path, documentArgs } = args;

  if (path === "/v1/email/sendEmailStatement") {
    const customerId = Number(documentArgs.customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return null;
    }

    return fetchCustomerEmailById(companyName, customerId);
  }

  if (path === "/v1/email/sendSalesInvoice") {
    const salesInvoiceId = Number(documentArgs.salesInvoiceId);
    if (!Number.isFinite(salesInvoiceId) || salesInvoiceId <= 0) {
      return null;
    }

    const invoice = await brcFetch(
      companyName,
      `/v1/salesInvoices/${encodeURIComponent(String(salesInvoiceId))}`
    );

    if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) {
      return null;
    }

    const customerId = Number((invoice as Record<string, unknown>).customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return null;
    }

    return fetchCustomerEmailById(companyName, customerId);
  }

  if (path === "/v1/email/sendQuote") {
    const quoteId = Number(documentArgs.quoteId);
    if (!Number.isFinite(quoteId) || quoteId <= 0) {
      return null;
    }

    const quote = await brcFetch(
      companyName,
      `/v1/quotes/${encodeURIComponent(String(quoteId))}`
    );

    if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
      return null;
    }

    const customerId = Number(
      (quote as Record<string, unknown>).customerOwnerId ??
        (quote as Record<string, unknown>).customerId
    );
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return null;
    }

    return fetchCustomerEmailById(companyName, customerId);
  }

  return null;
}

export function buildRecipientEmailRequiredResponse(args: {
  documentLabel: string;
  documentTypeLabel: string;
}): {
  status: string;
  message: string;
  documentLabel: string;
  recipientEmailRequired: true;
} {
  return {
    status: "recipient_email_required",
    message: [
      `Red cannot send this ${args.documentTypeLabel} email because no recipient email address is available.`,
      "",
      "There is no customer email on file and no recipient override was provided.",
      "Please provide a recipient email address before sending.",
      "",
      "Do not call this tool with confirmSend=true until a recipient email address has been supplied.",
      "Creating or posting the document and sending the email are separate steps — confirm each separately.",
    ].join("\n"),
    documentLabel: args.documentLabel,
    recipientEmailRequired: true,
  };
}
