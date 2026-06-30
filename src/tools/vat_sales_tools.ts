import { z } from "zod";
import type { ServerType } from "../server.js";
import {
  brcJsonRequest,
  companyNameSchema,
  jsonResponse,
  textResponse,
} from "../shared.js";
import { registerListTool } from "./general/list_tools.js";

const vatRateItemSchema = z.object({
  id: z.number().int(),
  percentage: z.number(),
  orderIndex: z.number().int(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  vatCategoryId: z.number().int().positive(),
});

const vatCategoryRateSchema = z.object({
  vatCategoryId: z.number().int().positive(),
  vatRates: z.array(vatRateItemSchema).min(1),
});

export function registerSalesVatTools(server: ServerType) {
  registerListTool(
    server,
    "brc_list_sales",
    "Lists combined BRC sales entries, sales invoices and sales credit notes.",
    "/v1/sales"
  );

  server.tool(
    "brc_process_vat_category_rates",
    "Processes VAT rates for VAT categories via POST /v1/vatCategories/vatRates. Requires a full vatCategoryRates array and confirmProcess=true.",
    {
      companyName: companyNameSchema,
      vatCategoryRates: z
        .array(vatCategoryRateSchema)
        .min(1)
        .optional()
        .describe(
          "Full BRC payload array for POST /v1/vatCategories/vatRates, e.g. [{ vatCategoryId: 1, vatRates: [...] }]."
        ),
      effectiveDate: z
        .string()
        .optional()
        .describe("Not a valid standalone payload. Use vatCategoryRates instead."),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Deprecated. Use vatCategoryRates instead of a raw payload object."),
      confirmProcess: z.boolean().default(false),
    },
    async ({ companyName, vatCategoryRates, effectiveDate, payload, confirmProcess }) => {
      const legacyEffectiveDate =
        effectiveDate ??
        (payload &&
        typeof payload === "object" &&
        "effectiveDate" in payload &&
        Object.keys(payload).length === 1
          ? String(payload.effectiveDate)
          : undefined);

      if (!vatCategoryRates?.length) {
        if (legacyEffectiveDate) {
          return textResponse(
            "brc_process_vat_category_rates requires a full vatCategoryRates array matching POST /v1/vatCategories/vatRates. effectiveDate alone is not a valid BRC payload."
          );
        }

        throw new Error(
          "brc_process_vat_category_rates requires vatCategoryRates with at least one VAT category and its vatRates array."
        );
      }

      if (!confirmProcess) {
        return textResponse(
          "This is a setup-level VAT configuration action. Set confirmProcess: true to run it."
        );
      }

      const response = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/vatCategories/vatRates",
        vatCategoryRates
      );

      return jsonResponse({
        message: "VAT category rates process request sent to BRC.",
        companyName,
        endpoint: "POST /v1/vatCategories/vatRates",
        payloadSent: vatCategoryRates,
        response,
      });
    }
  );
}
