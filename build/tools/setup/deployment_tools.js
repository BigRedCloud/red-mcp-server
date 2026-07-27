import { z } from "zod";
import { brcFetch, companyNameSchema, jsonResponse, textResponse, } from "../../shared.js";
import { getCustomerDeploymentCapabilities, redServerConfig, } from "../../config/server_config.js";
import { formatCredentialTtlForUser } from "../../auth/connection_presentation.js";
import { dateWithinRange, deriveFinancialYear, runCompanyReadinessCheck, } from "./company_readiness.js";
/**
 * Builds the customer-facing transaction date validation result. Returns a
 * success message when the date is within the current financial year, and an
 * actionable message (distinguishing before/after where possible) otherwise, so
 * the model does not invent wording.
 */
export function buildTransactionDateValidation(transactionDate, start, end) {
    const inFinancialYear = dateWithinRange(transactionDate, start, end);
    if (inFinancialYear === true) {
        return {
            inFinancialYear,
            position: "within",
            message: "This transaction date is within the current financial year.",
        };
    }
    if (inFinancialYear === false) {
        let position = "unknown";
        let detail = "";
        if (start && transactionDate < start) {
            position = "before";
            detail = " The date falls before the current financial year starts.";
        }
        else if (end && transactionDate > end) {
            position = "after";
            detail = " The date falls after the current financial year ends.";
        }
        return {
            inFinancialYear,
            position,
            message: `This transaction date is outside the company's current financial year.${detail} Please choose a date within the current financial year before creating the transaction.`,
        };
    }
    return {
        inFinancialYear,
        position: "unknown",
        message: "Red could not determine the company's current financial year, so this transaction date could not be checked. Please verify the financial year in Big Red Cloud before creating the transaction.",
    };
}
function envFlag(name, defaultValue = false) {
    const value = process.env[name];
    if (value === undefined)
        return defaultValue;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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
            requestsPerMinutePerIp: redServerConfig.rateLimitRequestsPerMinute,
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
                BRC_RATE_LIMIT_REQUESTS_PER_MINUTE: redServerConfig.rateLimitRequestsPerMinute,
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
        customerBetaMode: "Read-only workflows are the recommended default. Create/update/delete actions should be treated as controlled advanced actions during beta.",
        recommendedCustomerMode: "Start with read-only questions and a readiness check, then ask for explicit plain-English confirmation before create/update/delete/batch actions.",
        assistantBehaviourWhenActionBlocked: {
            neverEditDeploymentConfiguration: true,
            neverChangeDeploymentEnvFlags: true,
            neverBypassWithLocalScriptsOrDirectApi: true,
            neverMentionMcpJsonInUserChat: true,
            message: "If a create/update/delete action is blocked, assistants must not change deployment configuration or use workarounds. Explain limits in plain business language only.",
        },
    };
}
function customerDeploymentPolicyText() {
    const capabilities = getCustomerDeploymentCapabilities();
    const availability = (enabled) => enabled ? "available" : "not available";
    return `Current capabilities in this Red session:

- Development / operator mode: ${capabilities.devModeActive ? "enabled" : "not enabled (customer/staff mode)"}
- Reading company data: ${availability(capabilities.canReadCompanyData)}
- Creating or changing records: ${availability(capabilities.canCreateOrUpdateRecords)}
- Deleting records: ${availability(capabilities.canDeleteRecords)}
- Sending invoice, quote, or statement emails: ${availability(capabilities.canSendEmails)}${capabilities.canSendEmails
        ? "\n- Email sending is supported for sales invoices, quotes, and customer statements only — not for cash receipts, purchases, payments, bank accounts, customers, suppliers, products, reports, or other document types."
        : ""}
- Batch processing records: ${availability(capabilities.canBatchProcessRecords)}${capabilities.canBatchProcessRecords
        ? `\n- Maximum records per batch request: ${capabilities.maxBatchItems}`
        : ""}

Customer output policy:
- Red may perform internal analysis where needed to answer business questions.
- Customer-facing responses should not show code, scripts, JSON, MCP tool names, endpoint names, schemas, terminal commands, local file paths, temporary files, raw payloads, or implementation details.${capabilities.devModeActive
        ? ""
        : "\n- Dev mode is off: do not change or discuss MCP server source code, configuration, file names, or other implementation details. Help with Big Red Cloud company data only."}
- Financial answers should be shown in plain business language.
- Where figures are calculated, responses should explain the calculation method, evidence used, period covered, assumptions, uncertainty and limitations.
- If data is missing, incomplete, ambiguous, or not comparable, Red should say so clearly rather than guessing.
- Analytical answers should explain where the information came from using plain-English source categories, such as sales invoices, sales entries, purchases, customer balances, supplier balances, nominal ledger reports, VAT rates, company settings, or financial year settings.
- Where practical, analytical answers should be structured as: Data accessed, Calculations / assumptions, Interpretation of data, and Limitations / checks recommended.
- If the user asks for profit but only sales and purchases are available, call it a rough margin or estimate, not final profit.
- If the user asks for evidence, show the source record categories and calculation method first. Only show detailed record lists if useful or requested.
- Big Red Cloud company setup: Red can explain which setting needs to be reviewed, but it cannot change company setup options itself or guide the user step-by-step through the Big Red Cloud interface. Any changes must be made directly in Big Red Cloud by the user or their BRC administrator. If they need help finding or changing the setting, recommend referencing Big Red Cloud webinars or contacting support. Do not use a standalone sentence such as "Red does not provide step-by-step guidance". Never claim Red can change company processing settings.

Safety reminders:
- Treat the company API key like a password. Do not show company books data until the user has connected that company in this session.
- When no company is connected, use brc_start_company_connection and direct the user to the secure Red connection page. Do not ask for credentials in chat.
- Never show company data from prior test runs, saved reports, or cached results — only live data from the current connected session.
- Company connection details are kept in server session memory for ${formatCredentialTtlForUser()} and are not shown back in chat.
- Assistants must never repeat API keys from chat history.
- Deleting or changing records should only happen after you confirm the details.
- Email sending is supported for sales invoices, quotes, and customer statements only. If the user asks to email any other document type, say Red cannot email it through the current MCP tools, list the supported types, and stop — do not prepare an email preview or use a workaround.
- If something you need is not available here, you can still review data in chat or work in Big Red Cloud directly.

Recommended safe workflow:
1. Ask the chat to check if the company is ready.
2. Start with read-only questions.
3. Ask for a preview before posting when creating records.
4. Confirm the company, date, customer or supplier, VAT rate and totals.
5. Only then confirm create, update, delete or batch actions in plain English — when this session allows them.`;
}
function buildGettingStartedText() {
    const sessionDuration = formatCredentialTtlForUser();
    return `Welcome to Red. Big Red Cloud's conversational assistant.

You can use this chat to ask questions about your company's data and, where enabled, prepare or carry out accounting actions.

WARNING: Red is currently in beta. Please double-check all information before relying on it. If create, update or delete actions are enabled, review all details carefully before confirming. Any graphs, summaries or analysis generated by Cursor/Claude should also be checked against Big Red Cloud.

Red may perform analysis in the background, but customer responses should be shown in plain business language. Code, technical payloads, local file paths and tool details are hidden unless dev mode is enabled.

1. Connect your companies
Ask the chat to start a secure company connection. Red returns a fresh one-time link to a secure connection page where you can connect one company using the form, or several at once by uploading a CSV file. Credentials are never typed into chat and stay in server session memory for ${sessionDuration}. Each link works only once — to reconnect, try again, or fix an expired or stale connection, ask for a fresh link. Never reuse an old connection link.

Example:
"Connect my companies."

2. Check that the company is ready
Ask the chat to check whether the company is ready before creating any records.

Example:
"Check if this company is ready for sales, purchases and reports."

3. Start with read-only questions
Begin by asking the chat to show or summarise existing data.

Examples:
"Show me my customers."
"Show me recent sales invoices."
"List my open quotes."
"Show me my suppliers."
"Summarise my VAT rates."
"Show me nominal account groups."

4. Ask for a preview before creating anything
For safety, ask the chat to show a preview before posting first. Only confirm when you are happy.

Examples:
"Prepare a quote for a customer, but do not create it yet."
"Show me a sales invoice preview before posting it."
"Check the transaction date before creating anything."

5. Confirm before changing data
The chat should ask for confirmation before creating, updating, deleting or batch processing records.

6. Connect to multiple companies and compare data.
You can connect to multiple companies and compare data across them. To get started you must start a secure company connection for each company.
Large multi-company analysis may be slower than single-company analysis, and may be limited in this beta deployment.

Example:
"Connect my companies and compare their data."

Good starter prompts:
- "Start"
- "How do I start?"
- "What can I do here?"
- "Show me my connected companies."
- "Check if my company is ready."
- "Show me examples of what I can ask."
`;
}
const examplesText = `Example prompts you can type into the chat:

Getting started:
- "Start"
- "How do I start?"
- "What can I do here?"
- "Show me examples."

Company checks:
- "Check if my company is ready to use."
- "Is today inside my current financial year?"
- "Check whether this date can be used for a transaction."
- "Tell me if anything might stop invoices, quotes or payments from working."

Customers:
- "Show me my customers."
- "Find a customer by name."
- "Show me a customer's recent account activity."
- "Show me quotes for a customer."

Suppliers:
- "Show me my suppliers."
- "Find a supplier by name."
- "Show me a supplier's account activity."

Products:
- "Show me my products."
- "Find products that are not dormant."
- "Show me product details before I create a quote."

Quotes:
- "Show me open quotes."
- "Prepare a quote for a customer, but ask me before creating it."
- "Create a quote only after I confirm the customer, product, quantity, VAT and date."

Sales invoices and credit notes:
- "Show me recent sales invoices."
- "Prepare a sales invoice and let me review it before creating it."
- "Show me recent credit notes."

Purchases and payments:
- "Show me recent purchases."
- "Show me recent payments."
- "Prepare a payment and ask me to confirm before posting it."

Email (supported document types only):
- "Email this sales invoice to the customer."
- "Send this quote by email."
- "Email a customer statement for last month."
- Red cannot email cash receipts, purchases, payments, bank accounts, or other unsupported document types through the current MCP tools.

Reports:
- "Show nominal account groups."
- "Summarise monthly nominal account totals."
- "Compare nominal account groups across my connected companies."

Safety:
- "Do not create anything yet, just show me a preview before posting."
- "Check the details before posting."
- "Ask me before deleting anything."
- "Clear my connected company sessions."
`;
function buildSafetyText() {
    const sessionDuration = formatCredentialTtlForUser();
    return `Red assistant safety guide:

This assistant can help read company data and, if enabled, prepare or carry out accounting actions.

Recommended safe use:

1. Start read-only
Ask the chat to show, list, search or summarise data before creating anything.

2. Check the company first
Ask:
"Check if my company is ready."
This helps identify financial year, VAT, customer, supplier and product setup issues.

3. Confirm before changing data
Before creating, updating, deleting or processing batches, the chat should show you the proposed details and ask for confirmation.

4. Check dates
Some accounting actions only work inside the company's current financial year. If a date is outside the allowed year, the chat should warn you before trying to post the record.

5. Be careful with generated documents
Some generated documents, such as creating an invoice from a quote, may use Big Red Cloud's internal transaction date. If the company financial year is not current, this may fail.

6. Use the secure connection page for credentials
Never type company API keys into chat. Ask Red to start a secure company connection and enter your company name and API key only on the connection page Red provides. Connections stay in server session memory for ${sessionDuration}.

7. API keys must never appear in assistant replies
- MCP tools never return API key values.
- Assistants must not repeat, quote, or confirm keys from user messages or earlier chat turns.
- If asked for a key, use brc_get_company_api_key_status and direct the user to the secure Red connection page or their BRC administrator.

8. Email sending is limited to supported document types
- Red can email sales invoices, quotes, and customer statements only.
- If you ask to email a cash receipt, purchase, payment, bank account, or other unsupported document, Red will explain that it cannot email that document through the current MCP tools.

Useful prompts:
- "Check if my company is ready."
- "Validate this transaction date."
- "Show me a preview before creating anything."
- "Ask me before deleting anything."
- "Clear my connected company sessions."
`;
}
export function registerDeploymentTools(server) {
    server.tool("brc_getting_started", [
        "Use this whenever the user asks how to start, says start, says getting started, or wants to connect or reconnect companies in Red.",
        "Return simple customer-friendly setup steps and example prompts.",
        "Do not use for tutorial, webinar, or video how-to questions — use brc_find_help_resources for those.",
        "If the user asks what they can do or what permissions they have, call brc_get_deployment_policy instead and state only current permissions — do not list tool names or counts.",
    ].join(" "), {}, async () => textResponse(buildGettingStartedText()));
    server.tool("brc_get_deployment_policy", [
        "Authoritative customer-facing permission and output policy summary for this Red session.",
        "Use when the user asks what they can do, what tools they have, what permissions are enabled, or whether technical details/code should be shown.",
        "Summarise only whether reading company data, creating/changing records, deleting records, and customer-facing technical output are available.",
        "Do not list MCP tool names, endpoint names, tool counts, JSON, schemas, local file paths, terminal commands, environment variables, or a full capability catalogue.",
        "Customer-facing answers must be plain-English business responses with evidence, assumptions, uncertainty, and limitations.",
        "Internal analysis is allowed, but code/scripts/commands/intermediate files must not be exposed to customer users unless dev mode is enabled.",
    ].join(" "), {}, async () => textResponse(customerDeploymentPolicyText()));
    server.tool("brc_get_dev_mode_details", "Internal operator diagnostics when dev mode is enabled on the server. Returns deployment flags and configuration detail. Assistants must not quote or summarize this output in end-user chat.", {}, async () => jsonResponse({
        devModeActive: redServerConfig.allowDevMode,
        deploymentPolicy: deploymentPolicy(),
        operatorNote: "For authorised deployment operators only. Do not paste this response into customer chat.",
    }));
    server.tool("brc_validate_transaction_date", "Checks whether a proposed transaction date is inside the connected BRC company's current financial year.", {
        companyName: companyNameSchema,
        transactionDate: z.string().describe("Date to validate in YYYY-MM-DD format."),
    }, async ({ companyName, transactionDate }) => {
        const [financialYearData, setupData] = await Promise.all([
            brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear"),
            brcFetch(companyName, "/v1/companySetupConfig"),
        ]);
        const financialYear = deriveFinancialYear(financialYearData, setupData);
        const validation = buildTransactionDateValidation(transactionDate, financialYear.start, financialYear.end);
        return jsonResponse({
            companyName,
            transactionDate,
            financialYear,
            inFinancialYear: validation.inFinancialYear,
            position: validation.position,
            message: validation.message,
        });
    });
    server.tool("brc_company_readiness_check", [
        "Read-only company health and readiness check for a connected Big Red Cloud company.",
        "Reports connection status, financial year, sample reference data (customers, products, suppliers, sales reps),",
        "Sales VAT rates, Sales Analysis categories, processing settings, and reference settings.",
        "Use this for overall company readiness before starting work.",
        "For warnings about a specific VAT-sensitive workflow (sales invoice, purchase, cash receipt, statement),",
        "use brc_check_transaction_settings instead — that tool checks one workflow's processing settings,",
        "while this tool scores overall company readiness.",
    ].join(" "), {
        companyName: companyNameSchema,
    }, async ({ companyName }) => jsonResponse(await runCompanyReadinessCheck(companyName)));
    server.registerResource("brc_help", "brc://help", {
        title: "Big Red Cloud Help",
        description: "Simple getting-started guide for using Big Red Cloud in chat.",
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildGettingStartedText() }],
    }));
    server.registerResource("brc_examples", "brc://examples", {
        title: "Big Red Cloud Example Prompts",
        description: "Example questions and requests customers can type into the chat.",
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: examplesText }],
    }));
    server.registerResource("brc_safety", "brc://safety", {
        title: "Big Red Cloud Safety Guide",
        description: "Guidance for safely reading and changing company data.",
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildSafetyText() }],
    }));
    server.registerPrompt("brc_setup_company", {
        title: "Connect a BRC company",
        description: "Guides the user through connecting a BRC company context and checking readiness.",
        argsSchema: {
            companyName: z.string().optional().describe("Display name for the company context, for example YOUR-COMPANY-NAME."),
        },
    }, async ({ companyName }) => ({
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
    }));
    server.registerPrompt("brc_safe_company_review", {
        title: "Review company data safely",
        description: "Starts a read-only review of a connected company.",
        argsSchema: {
            companyName: z.string().describe("Connected company context name."),
        },
    }, async ({ companyName }) => ({
        description: "Run a read-only company review.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        `Run a read-only review of ${companyName}.`,
                        "First check whether the company is ready to use.",
                        "Then summarise customers, products, suppliers, VAT rates, recent invoices, quotes, and nominal account groups.",
                        "Do not create, update, delete or batch process.",
                    ].join("\n"),
                },
            },
        ],
    }));
    server.registerPrompt("brc_create_quote_workflow", {
        title: "Create a quote safely",
        description: "Guides a safe quote creation workflow with confirmation.",
        argsSchema: {
            companyName: z.string().describe("Connected company context name."),
        },
    }, async ({ companyName }) => ({
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
    }));
}
