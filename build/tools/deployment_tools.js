import { z } from "zod";
import { isVatOnCashReceiptEnabled } from "../cash_receipt_settings.js";
import { brcFetch, companyNameSchema, extractListItems, getCompanyApiContexts, jsonResponse, normaliseCompanyName, textResponse, } from "../shared.js";
import { getCustomerDeploymentCapabilities, redConnectServerConfig, } from "../server_config.js";
function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function pad2(value) {
    return String(value).padStart(2, "0");
}
function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function findNumberByKeys(obj, keys) {
    if (!obj || typeof obj !== "object")
        return null;
    for (const [key, value] of Object.entries(obj)) {
        if (keys.includes(key)) {
            const n = asNumber(value);
            if (n !== null)
                return n;
        }
        if (value && typeof value === "object") {
            const nested = findNumberByKeys(value, keys);
            if (nested !== null)
                return nested;
        }
    }
    return null;
}
function findDateByLikelyKeys(obj, keys) {
    if (!obj || typeof obj !== "object")
        return null;
    for (const [key, value] of Object.entries(obj)) {
        if (keys.includes(key) && (typeof value === "string" || typeof value === "number")) {
            const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
            if (match)
                return match[0];
        }
        if (value && typeof value === "object") {
            const nested = findDateByLikelyKeys(value, keys);
            if (nested)
                return nested;
        }
    }
    return null;
}
function deriveFinancialYear(financialYearData, setupData) {
    const sources = [financialYearData, setupData];
    const explicitStart = findDateByLikelyKeys(sources, [
        "startDate",
        "financialYearStartDate",
        "financialYearStart",
        "fromDate",
        "periodStart",
    ]);
    const explicitEnd = findDateByLikelyKeys(sources, [
        "endDate",
        "financialYearEndDate",
        "financialYearEnd",
        "toDate",
        "periodEnd",
    ]);
    if (explicitStart) {
        return {
            start: explicitStart,
            end: explicitEnd,
            method: "explicit-date-fields",
        };
    }
    for (const source of sources) {
        const startMonth = findNumberByKeys(source, [
            "startMonth",
            "firstMonth",
            "financialYearStartMonth",
            "fYearStartMonth",
        ]);
        const startYear = findNumberByKeys(source, [
            "startYear",
            "financialYearStartYear",
            "fYearStartYear",
        ]);
        if (startMonth && startMonth >= 1 && startMonth <= 12 && startYear && startYear > 1900) {
            const start = `${startYear}-${pad2(startMonth)}-01`;
            const endMonth = startMonth === 1 ? 12 : startMonth - 1;
            const endYear = startMonth === 1 ? startYear : startYear + 1;
            const end = `${endYear}-${pad2(endMonth)}-${pad2(lastDayOfMonth(endYear, endMonth))}`;
            return {
                start,
                end,
                method: "start-year-start-month",
            };
        }
    }
    return {
        start: null,
        end: null,
        method: "not-detected",
    };
}
function dateWithinRange(dateOnly, start, end) {
    if (!dateOnly || !start || !end)
        return null;
    return dateOnly >= start && dateOnly <= end;
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
            sessionTtlMinutes: redConnectServerConfig.sessionTtlMinutes,
            apiKeyStorage: "session-memory-only",
            apiKeysReturnedInResponses: false,
            apiKeysMustNotBeRepeatedInChat: true,
        },
        rateLimiting: {
            enabled: true,
            requestsPerMinutePerIp: redConnectServerConfig.rateLimitRequestsPerMinute,
        },
        apiKeyBlacklist: {
            enabled: redConnectServerConfig.apiKeyBlacklistSha256.length > 0,
            storage: "fixed server configuration for beta",
            rawApiKeysStored: false,
            format: "SHA-256 hashes only",
        },
        skillConfiguration: {
            allowTestingSkills: redConnectServerConfig.allowTestingSkills,
            allowReadSkills: redConnectServerConfig.allowReadSkills,
            allowUpdateSkills: redConnectServerConfig.allowUpdateSkills,
            allowDeleteSkills: redConnectServerConfig.allowDeleteSkills,
            allowDevMode: redConnectServerConfig.allowDevMode,
            disabledSkillsHiddenFromMcpClients: true,
            cachedDisabledSkillRequestsRejected: true,
            environmentVariables: {
                BRC_ALLOW_TESTING_SKILLS: redConnectServerConfig.allowTestingSkills,
                BRC_ALLOW_READ_SKILLS: redConnectServerConfig.allowReadSkills,
                BRC_ALLOW_UPDATE_SKILLS: redConnectServerConfig.allowUpdateSkills,
                BRC_ALLOW_DELETE_SKILLS: redConnectServerConfig.allowDeleteSkills,
                BRC_ALLOW_DEV_MODE: redConnectServerConfig.allowDevMode,
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
    return `Current capabilities in this Red Connect session:

- Reading company data: ${availability(capabilities.canReadCompanyData)}
- Creating or changing records: ${availability(capabilities.canCreateOrUpdateRecords)}
- Deleting records: ${availability(capabilities.canDeleteRecords)}

Customer output policy:
- Red Connect may perform internal analysis where needed to answer business questions.
- Customer-facing responses should not show code, scripts, JSON, MCP tool names, endpoint names, schemas, terminal commands, local file paths, temporary files, raw payloads, or implementation details.
- Financial answers should be shown in plain business language.
- Where figures are calculated, responses should explain the calculation method, evidence used, period covered, assumptions, uncertainty and limitations.
- If data is missing, incomplete, ambiguous, or not comparable, Red Connect should say so clearly rather than guessing.
- Analytical answers should explain where the information came from using plain-English source categories, such as sales invoices, sales entries, purchases, customer balances, supplier balances, nominal ledger reports, VAT rates, company settings, or financial year settings.
- Where practical, analytical answers should be structured as: Data accessed, Calculations / assumptions, Interpretation of data, and Limitations / checks recommended.
- If the user asks for profit but only sales and purchases are available, call it a rough margin or estimate, not final profit.
- If the user asks for evidence, show the source record categories and calculation method first. Only show detailed record lists if useful or requested.

Safety reminders:
- Company connection details are kept only for the active server session and are not shown back in chat.
- Assistants must never repeat API keys from chat history.
- Deleting or changing records should only happen after you confirm the details.
- If something you need is not available here, you can still review data in chat or work in Big Red Cloud directly.

Recommended safe workflow:
1. Ask the chat to check if the company is ready.
2. Start with read-only questions.
3. Ask for a draft before creating records.
4. Confirm the company, date, customer or supplier, VAT rate and totals.
5. Only then confirm create, update, delete or batch actions in plain English — when this session allows them.`;
}
const gettingStartedText = `Welcome to the RED Connect. Big Red Cloud's conversational assistant.

You can use this chat to ask questions about your company's data and, where enabled, prepare or carry out accounting actions.

WARNING: Red Connect is currently in beta. Please double-check all information before relying on it. If create, update or delete actions are enabled, review all details carefully before confirming. Any graphs, summaries or analysis generated by Cursor/Claude should also be checked against Big Red Cloud.

Red Connect may perform analysis in the background, but customer responses should be shown in plain business language. Code, technical payloads, local file paths and tool details are hidden unless dev mode is enabled.

1. Connect your company
Tell the chat which company you want to connect and provide the connection details requested by your administrator.

Example:
"Connect my company <Company Name> using the API key <API Key>  provided by my Big Red Cloud."
"<Company Name>: <API Key>"

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

4. Ask for a draft before creating anything
For safety, ask the chat to prepare a draft first. Only confirm when you are happy.

Examples:
"Prepare a quote for a customer, but do not create it yet."
"Draft a sales invoice and show me the details before posting it."
"Check the transaction date before creating anything."

5. Confirm before changing data
The chat should ask for confirmation before creating, updating, deleting or batch processing records.

6. Connect to multiple companies and compare data.
You can connect to multiple companies and compare data across them. To get started you must provide the names and corresponding API key for each company. 
Large multi-company analysis may be slower than single-company analysis, and may be limited in this beta deployment.

Example:
"Connect these two companies and compare their data. Company A: <API key>, Company B: <API key>."
"Compare the data for my companies. Company A: <API key>, Company B: <API key>."

Good starter prompts:
- "Start"
- "How do I start?"
- "What can I do here?"
- "Show me my connected companies."
- "Check if my company is ready."
- "Show me examples of what I can ask."
`;
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

Reports:
- "Show nominal account groups."
- "Summarise monthly nominal account totals."
- "Compare nominal account groups across my connected companies."

Safety:
- "Do not create anything yet, just show me a draft."
- "Check the details before posting."
- "Ask me before deleting anything."
- "Clear my connected company sessions."
`;
const safetyText = `RED Connect assistant safety guide:

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

6. Do not share connection details unnecessarily
Only provide company connection details when you intend to connect a company for the current session.

7. API keys must never appear in assistant replies
- MCP tools never return API key values.
- Assistants must not repeat, quote, or confirm keys from user messages or earlier chat turns.
- If asked for a key, use brc_get_company_api_key_status and tell the user to get it from their BRC administrator.

Useful prompts:
- "Check if my company is ready."
- "Validate this transaction date."
- "Show me a draft before creating anything."
- "Ask me before deleting anything."
- "Clear my connected company sessions."
`;
export function registerDeploymentTools(server) {
    server.tool("brc_getting_started", [
        "Use this whenever the user asks how to start, says start, says getting started, or asks for help using Big Red Cloud.",
        "Return simple customer-friendly setup steps and example prompts.",
        "If the user asks what they can do or what permissions they have, call brc_get_deployment_policy instead and state only current permissions — do not list tool names or counts.",
    ].join(" "), {}, async () => textResponse(gettingStartedText));
    server.tool("brc_get_deployment_policy", [
        "Authoritative customer-facing permission and output policy summary for this Red Connect session.",
        "Use when the user asks what they can do, what tools they have, what permissions are enabled, or whether technical details/code should be shown.",
        "Summarise only whether reading company data, creating/changing records, deleting records, and customer-facing technical output are available.",
        "Do not list MCP tool names, endpoint names, tool counts, JSON, schemas, local file paths, terminal commands, environment variables, or a full capability catalogue.",
        "Customer-facing answers must be plain-English business responses with evidence, assumptions, uncertainty, and limitations.",
        "Internal analysis is allowed, but code/scripts/commands/intermediate files must not be exposed to customer users unless dev mode is enabled.",
    ].join(" "), {}, async () => textResponse(customerDeploymentPolicyText()));
    server.tool("brc_get_dev_mode_details", "Internal operator diagnostics when dev mode is enabled on the server. Returns deployment flags and configuration detail. Assistants must not quote or summarize this output in end-user chat.", {}, async () => jsonResponse({
        devModeActive: redConnectServerConfig.allowDevMode,
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
        const inRange = dateWithinRange(transactionDate, financialYear.start, financialYear.end);
        return jsonResponse({
            companyName,
            transactionDate,
            financialYear,
            inFinancialYear: inRange,
            warning: inRange === false
                ? "This transaction date is outside the company's current financial year and BRC may reject create/generate requests."
                : undefined,
        });
    });
    server.tool("brc_company_readiness_check", "Checks whether a connected Big Red Cloud company appears ready for read-only and transaction workflows. Highlights financial-year, VAT and reference-data considerations.", {
        companyName: companyNameSchema,
    }, async ({ companyName }) => {
        const today = new Date().toISOString().slice(0, 10);
        const [financialYearData, setupData, customersData, productsData, suppliersData, vatRatesData] = await Promise.all([
            brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear"),
            brcFetch(companyName, "/v1/companySetupConfig"),
            brcFetch(companyName, "/v1/customers?page=1&pageSize=5"),
            brcFetch(companyName, "/v1/products?page=1&pageSize=5"),
            brcFetch(companyName, "/v1/suppliers?page=1&pageSize=5"),
            brcFetch(companyName, "/v1/vatRates?page=1&pageSize=20"),
        ]);
        const financialYear = deriveFinancialYear(financialYearData, setupData);
        const todayInFinancialYear = dateWithinRange(today, financialYear.start, financialYear.end);
        const customers = extractListItems(customersData);
        const products = extractListItems(productsData);
        const suppliers = extractListItems(suppliersData);
        const vatRates = extractListItems(vatRatesData);
        const vatOnCashReceiptEnabled = await isVatOnCashReceiptEnabled(companyName);
        const warnings = [];
        if (todayInFinancialYear === false) {
            warnings.push("Today's date is outside this company's current financial year. Some actions may fail unless the company financial year is updated or a valid transaction date is used.");
        }
        if (customers.length === 0)
            warnings.push("No customers were returned on page 1; customer workflows may need setup data.");
        if (products.length === 0)
            warnings.push("No products were returned on page 1; product-based invoice/quote workflows may need setup data.");
        if (vatRates.length === 0)
            warnings.push("No VAT rates were returned; VAT-bearing transactions may fail.");
        if (!vatOnCashReceiptEnabled) {
            warnings.push("VOCR (VAT on Cash Receipt, vocrSettingValue) appears disabled. Cash receipt tools will post without VAT rate fields.");
        }
        const readiness = {
            readOnlyReady: true,
            createCustomerSupplierProductReady: true,
            transactionReady: Boolean(financialYear.start && vatRates.length > 0),
            generatedDocumentReady: todayInFinancialYear !== false,
        };
        return jsonResponse({
            companyName,
            connectedContextFound: getCompanyApiContexts().has(normaliseCompanyName(companyName)),
            today,
            financialYear,
            todayInFinancialYear,
            vatOnCashReceiptEnabled,
            referenceDataSampleCounts: {
                customersOnFirstPage: customers.length,
                productsOnFirstPage: products.length,
                suppliersOnFirstPage: suppliers.length,
                vatRatesOnFirstPage: vatRates.length,
            },
            readiness,
            warnings,
            deploymentCapabilities: getCustomerDeploymentCapabilities(),
            recommendedNextPrompts: [
                "Show me my customers.",
                "Check whether a transaction date is valid.",
                "Show me my VAT rates.",
                "Show me recent sales invoices.",
                "Prepare a quote draft, but do not create it yet.",
            ],
        });
    });
    server.registerResource("brc_help", "brc://help", {
        title: "Big Red Cloud Help",
        description: "Simple getting-started guide for using Big Red Cloud in chat.",
        mimeType: "text/markdown",
    }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: gettingStartedText }],
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
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: safetyText }],
    }));
    server.registerPrompt("brc_setup_company", {
        title: "Connect a BRC company",
        description: "Guides the user through connecting a BRC company context and checking readiness.",
        argsSchema: {
            companyName: z.string().optional().describe("Display name for the company context, for example Company A."),
        },
    }, async ({ companyName }) => ({
        description: "Connect a Big Red Cloud company and run a safe readiness check.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        `Help me connect ${companyName || "a company"} to this RED Connect session.`,
                        "Ask me for the company display name and connection details if they are not already provided.",
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
