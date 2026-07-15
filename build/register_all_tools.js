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
import { wrapHttpSessionAwareToolHandler } from "./auth/mcp_http_session.js";
import { connectionRefSchema } from "./auth/connection_ref.js";
import { getToolSkillGroup, isToolEnabled } from "./config/server_config.js";
import { appendWriteConfirmationDescription, confirmCounterpartyExplicitSchema, confirmWriteSchema, requiresCounterpartyConfirmation, requiresWriteConfirmation, wrapWriteToolHandler, } from "./guards/write_confirmation.js";
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
    "brc_getting_started",
    "brc_get_deployment_policy",
    "brc_find_help_resources",
    "brc_get_help_resource_details",
]);
function createFilteredServer(server) {
    const originalTool = server.tool.bind(server);
    const filteredServer = Object.create(server);
    filteredServer.tool = (toolName, ...args) => {
        if (!isToolEnabled(toolName)) {
            console.warn(`Red: skipping disabled ${getToolSkillGroup(toolName)} tool "${toolName}".`);
            return undefined;
        }
        if (args.length < 3) {
            const [description, handler] = args;
            return originalTool(toolName, description, wrapHttpSessionAwareToolHandler(handler, { toolName }));
        }
        const [description, schema, handler] = args;
        const httpAwareHandler = wrapHttpSessionAwareToolHandler(handler, { toolName });
        const schemaWithConnectionRef = withConnectionRefSchema(schema);
        if (!requiresWriteConfirmation(toolName)) {
            return originalTool(toolName, description, schemaWithConnectionRef, httpAwareHandler);
        }
        const wrappedSchema = {
            ...schemaWithConnectionRef,
            confirmWrite: schema.confirmWrite ?? confirmWriteSchema,
            ...(requiresCounterpartyConfirmation(toolName)
                ? {
                    confirmCounterpartyExplicit: schema.confirmCounterpartyExplicit ?? confirmCounterpartyExplicitSchema,
                }
                : {}),
        };
        const wrappedHandler = wrapWriteToolHandler(toolName, httpAwareHandler);
        return originalTool(toolName, appendWriteConfirmationDescription(description, toolName), wrappedSchema, wrappedHandler);
    };
    return filteredServer;
}
export function registerAllTools(server) {
    const filteredServer = createFilteredServer(server);
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
    registerDeploymentTools(filteredServer);
    registerHelpResourcesTools(filteredServer);
    registerAuditTools(filteredServer);
    registerEmailTools(filteredServer);
    registerCompanyProcessingSettingsTools(filteredServer);
    registerAllocationResolverTools(filteredServer);
    registerNominalJournalBatchTools(filteredServer);
    registerAccrualTools(filteredServer);
    registerPrepaymentTools(filteredServer);
}
