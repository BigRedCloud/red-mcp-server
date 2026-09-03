import { getToolMetadata } from "./tool_annotations.js";
import { registerAuditTools } from "./tools/audit_session_tools.js";
import { registerCashPaymentTools } from "./tools/bank-payments/cash_payments_tools.js";
import { registerCompanyContextTools } from "./tools/setup/company_context_tools.js";
import { registerCompanySetupTools } from "./tools/setup/company_setup_tools.js";
import { registerCustomerTools } from "./tools/customer_tools.js";
import { registerDeploymentTools } from "./tools/setup/deployment_tools.js";
import { registerBatchTools } from "./tools/general/batch_tools.js";
import { registerTools } from "./tools/general/list_tools.js";
import { registerNominalReportTools } from "./tools/journals/nominal_report_tools.js";
import { registerProductTools } from "./tools/product_tools.js";
import { registerPurchaseTools } from "./tools/purchases/purchases_tools.js";
import { registerQuoteTools } from "./tools/sales-emails/quotes_tools.js";
import { registerSalesCreditNoteAndRepTools } from "./tools/sales-emails/sales_cn_rep_tools.js";
import { registerSalesEntryInvoiceTools } from "./tools/sales-emails/sales_entry_inv_tools.js";
import { registerSupplierTools } from "./tools/purchases/supplier_tools.js";
import { registerSalesVatTools } from "./tools/vat_sales_tools.js";
import { registerBankTools } from "./tools/bank-payments/bank_tools.js";
import { registerEmailTools } from "./tools/sales-emails/email_tools.js";
import { registerCompanyProcessingSettingsTools } from "./tools/setup/company_processing_settings_tools.js";
import { registerAllocationResolverTools } from "./tools/alloc_tools.js";
import { registerNominalJournalBatchTools } from "./tools/journals/nominal_journal_batch_tools.js";
import { registerAccrualTools } from "./tools/accrual_tools.js";
import { registerPrepaymentTools } from "./tools/prepayment_tools.js";
import { registerHelpResourcesTools } from "./tools/edu/help_resources_tools.js";
import { registerEduAdminTools } from "./tools/edu/edu_admin_tools.js";
import { registerRouteRequestTools } from "./tools/routing/route_request_tools.js";
import { wrapHttpSessionAwareToolHandler } from "./auth/mcp_http_session.js";
import { connectionRefSchema } from "./auth/connection_ref.js";
import { getToolSkillGroup, isToolEnabled } from "./config/server_config.js";
import { appendWriteConfirmationDescription, confirmCounterpartyExplicitSchema, confirmWriteSchema, requiresCounterpartyConfirmation, requiresWriteConfirmation, wrapWriteToolHandler, } from "./guards/write_confirmation.js";
import { appendRouteTokenDescription, requiresRouteToken, routeTokenSchema, wrapRouteTokenHandler, } from "./routing/route-token.js";
import { toAnthropicCompliantToolDescription } from "./tool_description_policy.js";
import { getPublicToolDescription } from "./tool_description_overrides.js";
import { isToolAllowedByProfile, resolveRedMcpToolProfile, } from "./tool_profiles.js";
export function withConnectionRefSchema(schema) {
    if (schema.connectionRef) {
        return schema;
    }
    return {
        connectionRef: connectionRefSchema,
        ...schema,
    };
}
/** Tools that do not accept company credentials — connectionRef is optional but omitted from schema checks. */
export const CONNECTION_REF_SCHEMA_EXEMPT_TOOLS = new Set([
    "brc_get_deployment_policy",
    "brc_route_request",
    "brc_red_help",
    "brc_find_help_resources",
    "brc_get_help_resource_details",
    "brc_open_edu_admin",
]);
export function createFilteredServer(server, options = {}) {
    const profile = options.profile ?? "full";
    const originalRegisterTool = server.registerTool.bind(server);
    const filteredServer = Object.create(server);
    filteredServer.tool = (toolName, ...args) => {
        if (!isToolAllowedByProfile(toolName, profile)) {
            return undefined;
        }
        if (!isToolEnabled(toolName)) {
            console.warn(`Red: skipping disabled ${getToolSkillGroup(toolName)} tool "${toolName}".`);
            return undefined;
        }
        const registerTool = (config, handler) => {
            const registration = originalRegisterTool(toolName, config, handler);
            options.onRegistered?.(toolName);
            return registration;
        };
        const { title, annotations } = getToolMetadata(toolName);
        if (args.length < 3) {
            const [description, handler] = args;
            return registerTool({
                title,
                description: toAnthropicCompliantToolDescription(toolName, getPublicToolDescription(toolName, description)),
                annotations,
            }, wrapHttpSessionAwareToolHandler(handler, { toolName }));
        }
        const [description, schema, handler] = args;
        const schemaWithConnectionRef = CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(toolName)
            ? schema
            : withConnectionRefSchema(schema);
        const needsRouteToken = requiresRouteToken(toolName);
        const schemaWithRouteToken = needsRouteToken
            ? {
                ...schemaWithConnectionRef,
                routeToken: schema.routeToken ?? routeTokenSchema,
            }
            : schemaWithConnectionRef;
        const publicDescription = getPublicToolDescription(toolName, description);
        const descriptionWithRoute = needsRouteToken
            ? appendRouteTokenDescription(publicDescription)
            : publicDescription;
        if (!requiresWriteConfirmation(toolName)) {
            const guardedHandler = needsRouteToken
                ? wrapRouteTokenHandler(toolName, handler)
                : handler;
            return registerTool({
                title,
                description: toAnthropicCompliantToolDescription(toolName, descriptionWithRoute),
                inputSchema: schemaWithRouteToken,
                annotations,
            }, wrapHttpSessionAwareToolHandler(guardedHandler, { toolName }));
        }
        const wrappedSchema = {
            ...schemaWithRouteToken,
            confirmWrite: schema.confirmWrite ?? confirmWriteSchema,
            ...(requiresCounterpartyConfirmation(toolName)
                ? {
                    confirmCounterpartyExplicit: schema.confirmCounterpartyExplicit ?? confirmCounterpartyExplicitSchema,
                }
                : {}),
        };
        // Order (outer → inner): HTTP session / connectionRef → routeToken guard →
        // write confirmation. Route token fails before any company lookup or write.
        const writeWrappedHandler = wrapWriteToolHandler(toolName, handler);
        const routeWrappedHandler = wrapRouteTokenHandler(toolName, writeWrappedHandler);
        const httpAwareHandler = wrapHttpSessionAwareToolHandler(routeWrappedHandler, {
            toolName,
        });
        return registerTool({
            title,
            description: toAnthropicCompliantToolDescription(toolName, appendWriteConfirmationDescription(descriptionWithRoute, toolName)),
            inputSchema: wrappedSchema,
            annotations,
        }, httpAwareHandler);
    };
    return filteredServer;
}
export function registerAllTools(server, options = {}) {
    const profile = options.profile ?? resolveRedMcpToolProfile();
    const advertisedToolNames = new Set();
    const filteredServer = createFilteredServer(server, {
        profile,
        onRegistered: (toolName) => advertisedToolNames.add(toolName),
    });
    registerCompanyContextTools(filteredServer);
    registerTools(filteredServer);
    registerCompanySetupTools(filteredServer);
    registerCustomerTools(filteredServer);
    registerSupplierTools(filteredServer);
    registerPurchaseTools(filteredServer);
    registerSalesEntryInvoiceTools(filteredServer);
    registerQuoteTools(filteredServer);
    registerSalesCreditNoteAndRepTools(filteredServer);
    registerNominalReportTools(filteredServer);
    registerCashPaymentTools(filteredServer);
    registerBankTools(filteredServer);
    registerProductTools(filteredServer);
    registerBatchTools(filteredServer);
    registerSalesVatTools(filteredServer);
    registerDeploymentTools(filteredServer, {
        profile,
        getRegisteredToolCount: () => advertisedToolNames.size,
    });
    registerRouteRequestTools(filteredServer);
    registerHelpResourcesTools(filteredServer);
    registerEduAdminTools(filteredServer);
    registerAuditTools(filteredServer);
    registerEmailTools(filteredServer);
    registerCompanyProcessingSettingsTools(filteredServer);
    registerAllocationResolverTools(filteredServer);
    registerNominalJournalBatchTools(filteredServer);
    registerAccrualTools(filteredServer);
    registerPrepaymentTools(filteredServer);
    console.info(`Red MCP tool profile "${profile}" selected; advertising ${advertisedToolNames.size} tools.`);
}
