import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import {
  appendWriteConfirmationDescription,
  confirmCounterpartyExplicitSchema,
  confirmWriteSchema,
  requiresCounterpartyConfirmation,
  requiresWriteConfirmation,
  wrapWriteToolHandler,
} from "./guards/write_confirmation.js";
import {
  appendRouteTokenDescription,
  requiresRouteToken,
  routeTokenSchema,
  wrapRouteTokenHandler,
} from "./routing/route-token.js";

export function withConnectionRefSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
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

function createFilteredServer(server: McpServer): McpServer {
  const originalTool = server.tool.bind(server) as (...args: any[]) => any;

  const filteredServer = Object.create(server) as McpServer & {
    tool: (...args: any[]) => any;
  };

  filteredServer.tool = (toolName: string, ...args: any[]) => {
    if (!isToolEnabled(toolName)) {
      console.warn(
        `Red: skipping disabled ${getToolSkillGroup(toolName)} tool "${toolName}".`
      );

      return undefined as unknown;
    }

    if (args.length < 3) {
      const [description, handler] = args as [
        string,
        (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
      ];

      return originalTool(
        toolName,
        description,
        wrapHttpSessionAwareToolHandler(handler, { toolName })
      );
    }

    const [description, schema, handler] = args as [
      string,
      Record<string, unknown>,
      (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
    ];

    const schemaWithConnectionRef = CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(
      toolName
    )
      ? schema
      : withConnectionRefSchema(schema);

    const needsRouteToken = requiresRouteToken(toolName);
    const schemaWithRouteToken = needsRouteToken
      ? {
          ...schemaWithConnectionRef,
          routeToken: schema.routeToken ?? routeTokenSchema,
        }
      : schemaWithConnectionRef;

    const descriptionWithRoute = needsRouteToken
      ? appendRouteTokenDescription(description)
      : description;

    if (!requiresWriteConfirmation(toolName)) {
      const guardedHandler = needsRouteToken
        ? wrapRouteTokenHandler(toolName, handler)
        : handler;

      return originalTool(
        toolName,
        descriptionWithRoute,
        schemaWithRouteToken,
        wrapHttpSessionAwareToolHandler(guardedHandler, { toolName })
      );
    }

    const wrappedSchema = {
      ...schemaWithRouteToken,
      confirmWrite: schema.confirmWrite ?? confirmWriteSchema,
      ...(requiresCounterpartyConfirmation(toolName)
        ? {
            confirmCounterpartyExplicit:
              schema.confirmCounterpartyExplicit ?? confirmCounterpartyExplicitSchema,
          }
        : {}),
    };

    // Order (outer → inner): HTTP session / connectionRef → routeToken guard →
    // write confirmation. Route token fails before any company lookup or write.
    const writeWrappedHandler = wrapWriteToolHandler(toolName, handler);
    const routeWrappedHandler = wrapRouteTokenHandler(
      toolName,
      writeWrappedHandler
    );
    const httpAwareHandler = wrapHttpSessionAwareToolHandler(routeWrappedHandler, {
      toolName,
    });

    return originalTool(
      toolName,
      appendWriteConfirmationDescription(descriptionWithRoute, toolName),
      wrappedSchema,
      httpAwareHandler
    );
  };

  return filteredServer as McpServer;
}

export function registerAllTools(server: McpServer): void {
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
}
