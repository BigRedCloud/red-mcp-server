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
import { getDisabledSkillMessage, getToolSkillGroup, isToolEnabled } from "./server_config.js";
function createFilteredServer(server) {
    const originalTool = server.tool.bind(server);
    const filteredServer = Object.create(server);
    filteredServer.tool = (toolName, ...args) => {
        if (!isToolEnabled(toolName)) {
            console.warn(`Red Connect: registering disabled ${getToolSkillGroup(toolName)} blocker for "${toolName}".`);
            const description = "This Red Connect action is disabled in the current deployment. It returns a permission message and does not call Big Red Cloud. Assistants must not change deployment configuration to enable it.";
            const emptySchema = {};
            return originalTool(toolName, description, emptySchema, async () => ({
                content: [
                    {
                        type: "text",
                        text: getDisabledSkillMessage(toolName),
                    },
                ],
            }));
        }
        return originalTool(toolName, ...args);
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
}
