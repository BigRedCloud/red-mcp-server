import { z } from "zod";
import type { ServerType } from "../../server.js";
import {
  brcFetch,
  companyNameSchema,
  jsonResponse,
  textResponse,
  type JsonRecord,
} from "../../shared.js";
import {
  resolveTransactionDocumentKind,
  type BookTranType,
} from "../../routing/transaction-document-kind.js";
import {
  getCustomerDeploymentCapabilities,
  redServerConfig,
} from "../../config/server_config.js";
import { formatCredentialTtlForUser } from "../../auth/connection_presentation.js";
import {
  dateWithinRange,
  deriveFinancialYear,
  runCompanyReadinessCheck,
} from "./company_readiness.js";

export type TransactionDatePosition = "within" | "before" | "after" | "unknown";

export interface TransactionDateValidation {
  inFinancialYear: boolean | null;
  position: TransactionDatePosition;
  message: string;
}

/**
 * Builds the customer-facing transaction date validation result. Returns a
 * success message when the date is within the current financial year, and an
 * actionable message (distinguishing before/after where possible) otherwise, so
 * the model does not invent wording.
 */
export function buildTransactionDateValidation(
  transactionDate: string,
  start?: string | null,
  end?: string | null
): TransactionDateValidation {
  const inFinancialYear = dateWithinRange(transactionDate, start, end);

  if (inFinancialYear === true) {
    return {
      inFinancialYear,
      position: "within",
      message: "This transaction date is within the current financial year.",
    };
  }

  if (inFinancialYear === false) {
    let position: TransactionDatePosition = "unknown";
    let detail = "";

    if (start && transactionDate < start) {
      position = "before";
      detail = " The date falls before the current financial year starts.";
    } else if (end && transactionDate > end) {
      position = "after";
      detail = " The date falls after the current financial year ends.";
    }

    return {
      inFinancialYear,
      position,
      message:
        `This transaction date is outside the company's current financial year.${detail} ` +
        "This is a warning, not an automatic block. Historical transactions may be supported by this specific BRC endpoint. " +
        "If the user has confirmed the action, use the appropriate Red transaction tool and report the exact BRC response if the API rejects the historical date.",
    };
  }

  return {
    inFinancialYear,
    position: "unknown",
    message:
      "Red could not determine the company's current financial year. Do not assume the transaction is unsupported. " +
      "Proceed only after confirming the requested date and let the relevant BRC endpoint determine whether that operation is allowed.",
  };
}


function deploymentPolicy() {
  return {
    mcpSession: {
      sessionStorage: "MCP server session memory",
      sessionTtlMinutes: redServerConfig.sessionTtlMinutes,
      apiKeyTtlMinutes: redServerConfig.apiKeyTtlMinutes,
      apiKeyStorage: "session-memory-only",
      apiKeysReturnedInResponses: false,
      apiKeysMustNotBeRepeatedInChat: true,
    },

    rateLimiting: {
      enabled: true,
      requestsPerMinutePerIp:
        redServerConfig.rateLimitRequestsPerMinute,
    },

    apiKeyBlacklist: {
      enabled: redServerConfig.apiKeyBlacklistSha256.length > 0,
      storage: "fixed server configuration for beta",
      rawApiKeysStored: false,
      format: "SHA-256 hashes only",
    },

    limits: {
      maxBatchItems: redServerConfig.maxBatchItems,
      maxAuditEntries: redServerConfig.maxAuditEntries,
    },

    skillConfiguration: {
      allowReadSkills: redServerConfig.allowReadSkills,
      allowUpdateSkills: redServerConfig.allowUpdateSkills,
      allowDeleteSkills: redServerConfig.allowDeleteSkills,
      allowEmailSkills: redServerConfig.allowEmailSkills,
      allowBatchSkills: redServerConfig.allowBatchSkills,
      allowDevMode: redServerConfig.allowDevMode,
      disabledSkillsHiddenFromMcpClients: true,
      cachedDisabledSkillRequestsRejected: true,
      environmentVariables: {
        BRC_MCP_SESSION_TTL_MINUTES: redServerConfig.sessionTtlMinutes,
        BRC_API_KEY_TTL_MINUTES: redServerConfig.apiKeyTtlMinutes,
        BRC_RATE_LIMIT_REQUESTS_PER_MINUTE:
          redServerConfig.rateLimitRequestsPerMinute,
        BRC_MAX_BATCH_ITEMS: redServerConfig.maxBatchItems,
        BRC_MAX_AUDIT_ENTRIES: redServerConfig.maxAuditEntries,
        BRC_ALLOW_READ_SKILLS: redServerConfig.allowReadSkills,
        BRC_ALLOW_UPDATE_SKILLS: redServerConfig.allowUpdateSkills,
        BRC_ALLOW_DELETE_SKILLS: redServerConfig.allowDeleteSkills,
        BRC_ALLOW_EMAIL_SKILLS: redServerConfig.allowEmailSkills,
        BRC_ALLOW_BATCH_SKILLS: redServerConfig.allowBatchSkills,
        BRC_ALLOW_DEV_MODE: redServerConfig.allowDevMode,
      },
    },

    customerBetaMode:
      "Read-only workflows are the recommended default. Create/update/delete actions should be treated as controlled advanced actions during beta.",

    recommendedCustomerMode:
      "Start with read-only questions and a readiness check, then ask for explicit plain-English confirmation before create/update/delete/batch actions.",

    assistantBehaviourWhenActionBlocked: {
      neverEditDeploymentConfiguration: true,
      neverChangeDeploymentEnvFlags: true,
      neverBypassWithLocalScriptsOrDirectApi: true,
      neverMentionMcpJsonInUserChat: true,
      message:
        "If a create/update/delete action is blocked, assistants must not change deployment configuration or use workarounds. Explain limits in plain business language only.",
    },
  };
}

function customerDeploymentPolicyText() {
  const capabilities = getCustomerDeploymentCapabilities();

  const availability = (enabled: boolean) =>
    enabled ? "available" : "not available";

  return `Current capabilities in this Red session:

- Reading connected company data: ${availability(capabilities.canReadCompanyData)}
- Creating or changing records: ${availability(capabilities.canCreateOrUpdateRecords)}
- Deleting records: ${availability(capabilities.canDeleteRecords)}
- Sending supported customer emails: ${availability(capabilities.canSendEmails)}${
    capabilities.canSendEmails
      ? `
- Supported email actions are sales invoices, quotes, and customer statements.`
      : ""
  }
- Batch processing records: ${availability(capabilities.canBatchProcessRecords)}${
    capabilities.canBatchProcessRecords
      ? `
- Maximum records per batch request: ${capabilities.maxBatchItems}`
      : ""
  }
- Development / operator mode: ${
    capabilities.devModeActive ? "enabled" : "not enabled"
  }

How Red should respond:
- Use plain business language. Do not show MCP tool names, endpoint names, schemas, JSON payloads, scripts, terminal commands, local file paths, temporary files, or implementation details to customers.
- Red may analyse data internally, but the customer-facing answer should explain the result, the period covered, the records used, important assumptions, uncertainty, and any checks still recommended.
- Never guess when information is missing, incomplete, ambiguous, stale, or not comparable.
- For financial analysis, identify the source categories used, such as sales invoices, sales entries, purchases, customer or supplier balances, nominal ledger reports, VAT rates, company settings, or financial year settings.
- When practical, structure analytical answers as: Summary, Data reviewed, Calculations and assumptions, Interpretation, and Limitations or checks.
- If only sales and purchases are available, describe the result as a rough margin or estimate rather than final profit.
- Do not expose internal connection references or other technical connection metadata to the customer.
- Big Red Cloud setup settings can be reviewed and compared, but Red cannot directly change company processing settings. The user or their Big Red Cloud administrator must make those changes in Big Red Cloud.

Help and training:
- Red can answer Big Red Cloud how-to questions using official Freshdesk articles, customer documentation, screenshots, YouTube videos, recorded webinars, and upcoming webinar information.
- Help and training searches do not require a connected company.
- Prefer the most relevant official source and provide a direct link where available.
- Excluded admin-managed help resources must not be presented to customers.
- Recorded webinars are not upcoming webinars. If an upcoming-webinar search returns no listings, do not claim no webinars are scheduled — point the customer to the Upcoming Webinars section of the Big Red Cloud website and their email inbox.

Connection and data safety:
- Treat every company API key like a password.
- Never ask the user to paste credentials into chat.
- When no company is connected, start a fresh secure company connection and direct the user to the one-time Red connection page.
- Never reuse an old, completed, expired, failed, or stale connection link. Ask for a fresh link when reconnecting.
- After a successful connection, company access remains available in this Red session for ${formatCredentialTtlForUser()}. Credentials are entered only on the secure Red connection page and are not shown back in chat.
- Never repeat API keys or internal connection references from current or earlier chat turns.
- Only use live data from companies connected in the current Red session. Do not use company data from previous test runs, saved reports, or unrelated sessions.
- Red may compare multiple connected companies, but it must state when fields are unavailable or not directly comparable.

Write-action safety:
- Supported create, update, delete, batch, and email actions require explicit plain-English confirmation before posting.
- Where the relevant tool supports it, show a clear plain-English preview of what will be posted before asking for confirmation.
- Confirm the company, transaction date, customer or supplier, products or accounts, VAT treatment, amounts, references, and totals as relevant.
- Check transaction dates against the current financial year.
- A date outside the current financial year is a warning, not by itself a reason to refuse the action.
- Historical create, update, and delete support is endpoint-specific. After explicit user confirmation, use the appropriate Red tool and let the BRC API determine whether the operation is supported.
- If BRC rejects a historical operation, report the actual API error. Do not invent a blanket rule that Red cannot work with previous financial years.
- Do not bypass disabled actions with direct API calls, scripts, or configuration changes.
- Delete, update, batch, and email actions depend on the current deployment capabilities above.
- If an action is unavailable, explain that plainly and offer a read-only review or instructions for completing it directly in Big Red Cloud.
- Email sending is limited to sales invoices, quotes, and customer statements when email skills are available. Do not prepare or simulate an unsupported email action.

Recommended workflow:
1. Connect the required company or companies using a fresh secure link.
2. Check company readiness and any workflow-specific settings.
3. Review data or ask the business question.
4. Request a preview for any proposed change where preview is supported.
5. Check the key details and warnings.
6. Confirm the action only when satisfied.`;
}

export function buildGettingStartedText(): string {
  const sessionDuration = formatCredentialTtlForUser();

  return `Welcome to Red, Big Red Cloud's conversational assistant.

Red works with supported AI assistants including ChatGPT, Claude, and Mistral/Vibe. You can ask questions in plain English, review connected Big Red Cloud data, compare connected companies, and—where enabled—prepare and carry out accounting actions with confirmation.

Red can also answer Big Red Cloud how-to and training questions using official support articles, screenshots, YouTube videos, recorded webinars, customer documentation, and upcoming webinar information. Help searches do not require a connected company.

Red is currently in beta. Check important figures and proposed accounting changes against Big Red Cloud before relying on them.

1. Connect your company or companies
Ask Red to start a secure company connection. Red gives you a fresh one-time link to a secure page where you can:
- connect one company using the form; or
- connect several companies by uploading a CSV file.

Enter company credentials only on that secure page, never in chat. The secure link can only be used once. After you successfully connect, the company remains available in this Red session for ${sessionDuration}. Do not reuse a used, expired, failed, or stale link — ask Red for a fresh link when reconnecting.

Example:
"Connect my companies."

2. Check company readiness
Before creating records, ask Red to check the company. The readiness check reviews the financial year, VAT and analysis setup, sample customers, suppliers, products and sales representatives, processing settings, and reference settings.

Examples:
"Check whether Company A is ready to use."
"Compare the setup of Company A and Company B."
"Check whether anything might block a sales invoice or cash receipt."

3. Review and analyse data
Start with read-only questions. Red can review customers, suppliers, products, invoices, quotes, purchases, payments, cash records, nominal reports, VAT information, company settings, and other connected data.

Examples:
"Show me recent sales invoices."
"Which customers owe the most?"
"Summarise monthly nominal account movements."
"Compare sales across my connected companies."
"Explain the main differences between these companies' setup."

4. Ask Red for help and training
You can ask product how-to questions even when no company is connected.

Examples:
"How do I complete the year-end routine?"
"Show me help for bank feeds."
"Find a recorded webinar about sales invoices."
"Are there any upcoming webinars?"
"Show me the official Freshdesk steps and screenshots for adding a customer."

5. Preview and confirm before posting
For supported create, update, delete, batch, and email actions, Red requires explicit confirmation before anything is posted. Where the relevant action supports it, ask Red to show a plain-English preview of the proposed details first.

Examples:
"Prepare a sales invoice, but do not create it yet."
"Show me a quote preview."
"Check the transaction date and VAT before posting."
"Show me what would be deleted before I confirm."

6. Confirm changes explicitly
Red should ask for confirmation before changing data. Review the company, date, customer or supplier, products or accounts, VAT treatment, amounts, references, and totals.

7. Review what Red changed
Red keeps a session audit trail of write actions made through Red. You can ask for a summary of changes made during the current session.

Examples:
"Show me what Red changed in this session."
"Summarise today's Red activity for my connected companies."

Good starter prompts:
- "Start"
- "Connect my companies."
- "What can I do here?"
- "Show me my connected companies."
- "Check if my company is ready."
- "Compare my connected companies."
- "Find help for bank reconciliation."
- "Show me examples of what I can ask."`;
}

export function buildExamplesText(): string {
  const capabilities = getCustomerDeploymentCapabilities();

  const emailSection = capabilities.canSendEmails
    ? `

Supported email actions:
- "Email this sales invoice to the customer."
- "Send this quote by email."
- "Email a customer statement for last month."

Red can email sales invoices, quotes, and customer statements only. It cannot email purchases, payments, cash receipts, bank accounts, reports, customers, suppliers, products, or other unsupported document types through the current tools.`
    : `

Email sending is not available in this Red session.`;

  const writeNote = capabilities.canCreateOrUpdateRecords
    ? ""
    : `

Creating or changing records is not available in this Red session — use read-only review prompts instead.`;

  return `Example prompts you can type into Red:

Getting started and connections:
- "Start."
- "Connect my companies."
- "Show me my connected companies."
- "How long will these companies stay connected?"
- "Clear my connected company sessions."

Company readiness and setup:
- "Check whether this company is ready to use."
- "Check whether this date is inside the current financial year."
- "Check the settings needed for a sales invoice."
- "Check the VAT settings for a cash receipt."
- "Compare the setup of Company A and Company B."
- "Explain the practical effect of the setup differences."

Customers and suppliers:
- "Show me my customers."
- "Find a customer by name."
- "Show this customer's recent account activity."
- "Which customers have the largest balances?"
- "Show me my suppliers."
- "Find a supplier by name."
- "Show this supplier's recent account activity."

Products and reference data:
- "Show active products."
- "Find a product by code or description."
- "Show sales representatives."
- "Show Sales VAT rates."
- "Show Sales Analysis categories."

Sales and quotes:
- "Show recent sales invoices."
- "Show open quotes."
- "Prepare a quote and let me review it before creating it."
- "Prepare a multi-line sales invoice and show me the preview."
- "Show recent sales credit notes."
- "Generate an invoice from this quote only after I confirm."

Purchases, payments, and cash:
- "Show recent purchases."
- "Prepare a purchase and show me the preview."
- "Show recent payments."
- "Prepare a payment and ask me to confirm."
- "Show recent cash receipts."
- "Check whether VAT on cash receipts affects this transaction."

Reports and analysis:
- "Show nominal account groups."
- "Summarise monthly nominal account movements."
- "Compare nominal account groups across my connected companies."
- "Summarise sales and purchases for this period."
- "Explain the calculation, assumptions, and limitations."
- "Highlight unusual or incomplete data without guessing."

Help, screenshots, and webinars:
- "How do I complete my year-end routine?"
- "Find official help for bank feeds."
- "Show the Freshdesk steps and screenshots for creating a customer."
- "Find a recorded webinar about sales invoices."
- "Are there any upcoming webinars?"${emailSection}${writeNote}

Audit and safety:
- "Do not create anything yet."
- "Show me a preview before posting."
- "Check the transaction date, VAT, and totals."
- "Ask me before deleting anything."
- "Show me what Red changed in this session."
- "Summarise Red activity for the currently connected companies."`;
}

export function buildSafetyText(): string {
  const sessionDuration = formatCredentialTtlForUser();
  const capabilities = getCustomerDeploymentCapabilities();

  const emailSafety = capabilities.canSendEmails
    ? `9. Understand email limits
Red can email sales invoices, quotes, and customer statements only when email sending is available. It cannot email purchases, payments, cash receipts, bank accounts, reports, or other unsupported document types through the current tools. Supported emails use a plain-English preview and explicit confirmation before sending.`
    : `9. Understand email limits
Email sending is not available in this Red session. Red does not send purchases, payments, cash receipts, bank-account information, arbitrary messages, or unsupported document types.`;

  return `Red safety guide

Red can review connected company data and, where enabled, prepare or carry out accounting actions. It can also answer Big Red Cloud help and training questions from official resources.

1. Keep credentials out of chat
Never paste a company API key into chat. Ask Red for a fresh secure connection link and enter credentials only on the Red connection page. Red does not request or repeat API keys in chat.

2. Use a fresh one-time connection link
The secure link can only be used once. After you successfully connect, the company remains available in this Red session for ${sessionDuration}. Do not reuse an old, completed, expired, failed, or stale link — ask Red for a fresh link when reconnecting.

3. Start with a readiness check
Ask Red to check the company before creating records. This can identify financial year, VAT, analysis, reference, customer, supplier, product, and sales-representative setup issues.

4. Begin read-only
Review, search, compare, or summarise data before making changes. For multi-company work, confirm which companies and periods are being compared. Company access is limited to companies connected in the current Red session.

5. Confirm before changing data
Supported create, update, delete, batch, and email actions require explicit plain-English confirmation before posting. Where the relevant tool supports it, Red shows a plain-English preview of what will be posted before asking you to confirm. Delete, update, batch, and email actions depend on the current deployment capabilities.

6. Confirm explicitly
Check the company, transaction date, customer or supplier, products or nominal accounts, VAT treatment, amounts, references, totals, and any warnings before confirming.

7. Check transaction dates
Accounting actions outside the current financial year may be supported depending on the BRC endpoint. Check the date, warn the user when it is outside the current year, and after confirmation attempt the requested supported action. If BRC rejects it, explain the API response.

8. Treat analysis as decision support
Check important figures against Big Red Cloud. Red should explain the records used, calculations, assumptions, uncertainty, and limitations, and should never fill gaps by guessing.

${emailSafety}

10. Use official help sources
Red can search official Freshdesk articles, screenshots, customer documentation, YouTube videos, recorded webinars, and upcoming webinars. Help searches do not require a connected company. Recorded webinars are not the same as upcoming webinars.

11. Review the session audit trail
Ask Red to summarise write actions made during the current session. Audit results are limited to the current session and currently connected companies.

12. Protect technical connection details
API keys and internal connection references must never appear in customer-facing responses. Red does not bypass disabled actions.

Useful prompts:
- "Connect my companies."
- "Check if this company is ready."
- "Compare these companies' setup."
- "Validate this transaction date."
- "Show me a preview before creating anything."
- "Ask me before deleting anything."
- "Find official help for this task."
- "Show me what Red changed in this session."
- "Clear my connected company sessions."`;
}

export { customerDeploymentPolicyText };

export async function resolveBookTransactionType(
  companyName: string,
  bookTranTypeId: number,
  deps: {
    brcFetch: typeof brcFetch;
  } = {
    brcFetch,
  }
) {
  const response = await deps.brcFetch(
    companyName,
    "/v1/bookTranTypes"
  );

  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    throw new Error(
      "Could not load BRC book transaction types."
    );
  }

  const items = Array.isArray(
    (response as JsonRecord).Items
  )
    ? ((response as JsonRecord).Items as BookTranType[])
    : [];

  const matchedType = items.find(
    (item) => item.id === bookTranTypeId
  );

  if (!matchedType) {
    return {
      resolved: false,
      mapped: false,
      companyName,
      bookTranTypeId,
      bookTranTypeDescription: null,
      documentKind: "unknown" as const,
      message:
        `bookTranTypeId ${bookTranTypeId} was not present in this company's live /v1/bookTranTypes response.`,
    };
  }

  const kind = resolveTransactionDocumentKind(
    bookTranTypeId,
    items
  );

  if (kind === "unknown") {
    return {
      resolved: true,
      mapped: false,
      companyName,
      bookTranTypeId,
      bookTranTypeDescription:
        matchedType.description,
      documentKind: "unknown" as const,
      message:
        `BRC returned transaction type "${matchedType.description}", but Red does not currently have a document-tool mapping for that transaction type.`,
    };
  }

  return {
    resolved: true,
    mapped: true,
    companyName,
    bookTranTypeId,
    bookTranTypeDescription:
      matchedType.description,
    documentKind: kind,
  };
}

export function registerDeploymentTools(server: ServerType) {
  server.tool(
    "brc_getting_started",
    [
      "Use this whenever the user asks how to start, says start or getting started, wants to connect or reconnect companies, or asks for a concise overview of Red.",
      "Return the current customer-friendly overview, connection steps, help options, safe workflow, and example prompts.",
      "For a specific tutorial, screenshot, article, YouTube video, or webinar question — or any red-help / /red-help command — use brc_red_help (or brc_find_help_resources for compatibility).",
      "If the user asks what they can do or what permissions they have, call brc_get_deployment_policy instead and state only current permissions — do not list tool names or counts.",
    ].join(" "),
    {},
    async () => textResponse(buildGettingStartedText())
  );

  server.tool(
    "brc_get_deployment_policy",
    [
      "Authoritative customer-facing permission and output policy summary for this Red session.",
      "Use when the user asks what they can do, what tools they have, what permissions are enabled, or whether technical details/code should be shown.",
      "Summarise the currently enabled read, write, delete, email, and batch capabilities in plain business language.",
      "Do not list MCP tool names, endpoint names, tool counts, JSON, schemas, local file paths, terminal commands, environment variables, or a full capability catalogue.",
      "Customer-facing answers must be plain-English business responses with evidence, assumptions, uncertainty, and limitations.",
      "Internal analysis is allowed, but code/scripts/commands/intermediate files must not be exposed to customer users unless dev mode is enabled.",
      "Assistant-only connection diagnostics (never include in customer answers): a missing result or empty list does not by itself mean the connection has expired; only a confirmed authentication failure should be treated as an invalid company credential.",
    ].join(" "),
    {},
    async () => textResponse(customerDeploymentPolicyText())
  );

  server.tool(
    "brc_get_dev_mode_details",
    "Internal operator diagnostics when dev mode is enabled on the server. Returns deployment flags and configuration detail. Assistants must not quote or summarize this output in end-user chat.",
    {},
    async () =>
      jsonResponse({
        devModeActive: redServerConfig.allowDevMode,
        deploymentPolicy: deploymentPolicy(),
        operatorNote:
          "For authorised deployment operators only. Do not paste this response into customer chat.",
      })
  );

  server.tool(
    "brc_validate_transaction_date",
    "Checks whether a proposed transaction date is inside the connected BRC company's current financial year.",
    {
      companyName: companyNameSchema,
      transactionDate: z.string().describe("Date to validate in YYYY-MM-DD format."),
    },
    async ({ companyName, transactionDate }) => {
      const [financialYearData, setupData] = await Promise.all([
        brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear"),
        brcFetch(companyName, "/v1/companySetupConfig"),
      ]);
      const financialYear = deriveFinancialYear(financialYearData, setupData);
      const validation = buildTransactionDateValidation(
        transactionDate,
        financialYear.start,
        financialYear.end
      );

      return jsonResponse({
        companyName,
        transactionDate,
        financialYear,
        inFinancialYear: validation.inFinancialYear,
        position: validation.position,
        message: validation.message,
      });
    }
  );

  server.tool(
    "brc_company_readiness_check",
    [
      "Read-only company health and readiness check for a connected Big Red Cloud company.",
      "Reports connection status, financial year, sample reference data (customers, products, suppliers, sales reps),",
      "Sales VAT rates, Sales Analysis categories, processing settings, and reference settings.",
      "Use this for overall company readiness before starting work.",
      "For warnings about a specific VAT-sensitive workflow (sales invoice, purchase, cash receipt, statement),",
      "use brc_check_transaction_settings instead — that tool checks one workflow's processing settings,",
      "while this tool scores overall company readiness.",
    ].join(" "),
    {
      companyName: companyNameSchema,
    },
    async ({ companyName }) => jsonResponse(await runCompanyReadinessCheck(companyName))
  );

  server.tool(
    "brc_resolve_book_transaction_type",
    [
      "Resolves a bookTranTypeId from a BRC customer or supplier account transaction against the connected company's live /v1/bookTranTypes list.",
      "Use this before choosing a get/update/delete transaction tool when accountTrans returns bookTranId and bookTranTypeId.",
      "Do not infer the document type from bookTypeDesc alone and do not assume transaction type ids are globally fixed across companies.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      bookTranTypeId: z.number().int().positive(),
    },
    async ({ companyName, bookTranTypeId }) =>
      jsonResponse(
        await resolveBookTransactionType(
          companyName,
          bookTranTypeId
        )
      )
  );


  server.registerResource(
    "brc_help",
    "brc://help",
    {
      title: "Big Red Cloud Help",
      description: "Current getting-started guide for using Red with Big Red Cloud.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildGettingStartedText() }],
    })
  );

  server.registerResource(
    "brc_examples",
    "brc://examples",
    {
      title: "Big Red Cloud Example Prompts",
      description: "Example questions and requests customers can type into the chat.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildExamplesText() }],
    })
  );

  server.registerResource(
    "brc_safety",
    "brc://safety",
    {
      title: "Big Red Cloud Safety Guide",
      description: "Guidance for safely reading and changing company data.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildSafetyText() }],
    })
  );

  server.registerPrompt(
    "brc_setup_company",
    {
      title: "Connect a BRC company",
      description: "Guides the user through connecting a BRC company context and checking readiness.",
      argsSchema: {
        companyName: z.string().optional().describe("Display name for the company context, for example YOUR-COMPANY-NAME."),
      },
    },
    async ({ companyName }) => ({
      description: "Connect a Big Red Cloud company and run a safe readiness check.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Help me connect ${companyName || "a company"} to this Red session.`,
              "Use brc_start_company_connection and give me the secure Red connection page link.",
              "I will enter my company name and API key on that page — do not ask for credentials in chat.",
              "After connecting, show me the connected company and check whether it is ready to use.",
              "Do not create, update, delete or batch process until I explicitly confirm.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "brc_safe_company_review",
    {
      title: "Review company data safely",
      description: "Starts a read-only review of a connected company.",
      argsSchema: {
        companyName: z.string().describe("Connected company context name."),
      },
    },
    async ({ companyName }) => ({
      description: "Run a read-only company review.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Run a read-only review of ${companyName}.`,
              "First check whether the company is ready to use.",
              "Then summarise customers, products, suppliers, VAT rates, recent invoices, quotes, purchases, and nominal account groups.",
              "Do not create, update, delete or batch process.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "brc_create_quote_workflow",
    {
      title: "Create a quote safely",
      description: "Guides a safe quote creation workflow with confirmation.",
      argsSchema: {
        companyName: z.string().describe("Connected company context name."),
      },
    },
    async ({ companyName }) => ({
      description: "Prepare and confirm a quote before creating it.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Help me prepare a quote in ${companyName}.`,
              "First gather the customer, product, quantity, price, VAT rate, sales rep, and transaction date.",
              "Check that the transaction date is valid for this company.",
              "Show me the proposed quote details and ask for confirmation before creating anything.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}