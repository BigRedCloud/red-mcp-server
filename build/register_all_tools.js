import { registerAuditTools } from "./tools/audit_session_tools.js";
import { registerCashPaymentTools } from "./tools/cash_payments_tools.js";
import { registerCompanyContextTools } from "./tools/company_context_tools.js";
import { registerCompanySetupTools } from "./tools/company_setup_tools.js";
import { registerCustomerTools } from "./tools/customer_tools.js";
import { registerDeploymentTools } from "./tools/deployment_tools.js";
import { registerBatchTools } from "./tools/general/batch_tools.js";
import { registerTools } from "./tools/general/list_tools.js";
import { registerNominalReportTools } from "./tools/nominal_report_tools.js";
import { registerProductTools } from "./tools/product_tools.js";
import { registerPurchaseTools } from "./tools/purchases_tools.js";
import { registerQuoteTools } from "./tools/quotes_tools.js";
import { registerSalesCreditNoteAndRepTools } from "./tools/sales_cn_rep_tools.js";
import { registerSalesEntryInvoiceTools } from "./tools/sales_entry_inv_tools.js";
import { registerSupplierTools } from "./tools/supplier_tools.js";
import { registerSalesVatTools } from "./tools/vat_sales_tools.js";
import { registerBankTools } from "./tools/bank_tools.js";
import { registerEmailTools } from "./tools/email_tools.js";
import { registerCompanyProcessingSettingsTools } from "./tools/company_processing_settings_tools.js";
import { getToolSkillGroup, isToolEnabled } from "./server_config.js";
import { appendWriteConfirmationDescription, confirmCounterpartyExplicitSchema, confirmWriteSchema, requiresCounterpartyConfirmation, requiresWriteConfirmation, wrapWriteToolHandler, } from "./write_confirmation.js";
function createFilteredServer(server) {
    const originalTool = server.tool.bind(server);
    const filteredServer = Object.create(server);
    filteredServer.tool = (toolName, ...args) => {
        if (!isToolEnabled(toolName)) {
            console.warn(`Red Connect: skipping disabled ${getToolSkillGroup(toolName)} tool "${toolName}".`);
            return undefined;
        }
        if (args.length < 3) {
            return originalTool(toolName, ...args);
        }
        const [description, schema, handler] = args;
        if (!requiresWriteConfirmation(toolName)) {
            return originalTool(toolName, description, schema, handler);
        }
        const wrappedSchema = {
            ...schema,
            confirmWrite: schema.confirmWrite ?? confirmWriteSchema,
            ...(requiresCounterpartyConfirmation(toolName)
                ? {
                    confirmCounterpartyExplicit: schema.confirmCounterpartyExplicit ?? confirmCounterpartyExplicitSchema,
                }
                : {}),
        };
        const wrappedHandler = wrapWriteToolHandler(toolName, handler);
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
    registerAuditTools(filteredServer);
    registerEmailTools(filteredServer);
    registerCompanyProcessingSettingsTools(filteredServer);
}
