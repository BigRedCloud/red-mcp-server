import { z } from "zod";
import type { ServerType } from "../server.js";
import {
  brcFetch,
  brcJsonRequest,
  companyNameSchema,
  jsonResponse,
  textResponse,
} from "../shared.js";

const accrualIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Parent accrual id.");

const timestampSchema = z
  .string()
  .min(1)
  .describe("Base64 timestamp returned by the accrual, for example K94UQIbL3gg=.");

const isoDateTimeSchema = z
  .string()
  .min(1)
  .describe("Date/time string, for example 2024-03-01T00:00:00.");

const accrualCreateSchema = z.object({
  acCode: z
    .string()
    .min(1)
    .describe("Nominal account code, for example 4000."),
  entryDate: isoDateTimeSchema.describe("Entry date, for example 2024-03-01T00:00:00."),
  procDate: isoDateTimeSchema.describe("Processing date, for example 2024-03-15T00:00:00."),
  reference: z
    .string()
    .min(1)
    .describe("Accrual reference, for example ACC0001."),
  total: z
    .number()
    .describe("Accrual total amount."),
  firstDetail: z
    .string()
    .optional()
    .default("")
    .describe("First detail text."),
  secondDetail: z
    .string()
    .optional()
    .default("")
    .describe("Second detail text."),
});

const accrualUpdateSchema = accrualCreateSchema.extend({
  id: accrualIdSchema,
  timestamp: timestampSchema,
});

function buildQuery(args: {
  filter?: string;
  orderBy?: string;
  top?: number;
  skip?: number;
}): string {
  const params = new URLSearchParams();

  if (args.filter) {
    params.set("$filter", args.filter);
  }

  if (args.orderBy) {
    params.set("$orderby", args.orderBy);
  }

  if (args.top !== undefined) {
    params.set("$top", String(args.top));
  }

  if (args.skip !== undefined) {
    params.set("$skip", String(args.skip));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildAccrualSummary(args: {
  companyName: string;
  action: "create" | "update";
  id?: number;
  acCode: string;
  entryDate: string;
  procDate: string;
  reference: string;
  total: number;
  firstDetail?: string;
  secondDetail?: string;
  timestamp?: string;
}): string {
  return [
    args.action === "create"
      ? "Accrual create draft — not posted yet"
      : "Accrual update draft — not posted yet",
    "",
    `Company: ${args.companyName}`,
    args.id ? `Accrual id: ${args.id}` : undefined,
    `Account code: ${args.acCode}`,
    `Entry date: ${args.entryDate}`,
    `Processing date: ${args.procDate}`,
    `Reference: ${args.reference}`,
    `Total: ${args.total}`,
    args.timestamp ? `Timestamp: ${args.timestamp}` : undefined,
    args.firstDetail ? `Detail 1: ${args.firstDetail}` : undefined,
    args.secondDetail ? `Detail 2: ${args.secondDetail}` : undefined,
    "",
    args.action === "create"
      ? "If this is correct, confirm that you want to create this accrual."
      : "If this is correct, confirm that you want to update this accrual.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function registerAccrualTools(server: ServerType) {
  server.tool(
    "brc_list_accruals",
    [
      "Returns a list of the company's Accruals.",
      "Supports optional OData filtering by entryDate.",
      "Supports optional ordering by id.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      filter: z
        .string()
        .optional()
        .describe(
          "Optional OData filter. Filtering is allowed by entryDate, for example: entryDate ge 2024-03-01T00:00:00."
        ),
      orderBy: z
        .string()
        .optional()
        .describe("Optional OData order by. Ordering is allowed by id, for example: id desc."),
      top: z.number().int().positive().optional().describe("Optional page size."),
      skip: z.number().int().min(0).optional().describe("Optional number of records to skip."),
    },
    async ({ companyName, filter, orderBy, top, skip }) => {
      const query = buildQuery({ filter, orderBy, top, skip });

      const data = await brcFetch(companyName, `/v1/accruals${query}`);

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_get_accrual",
    "Returns information about a single parent Accrual by id. Child accruals are not exposed by the public API.",
    {
      companyName: companyNameSchema,
      id: accrualIdSchema,
    },
    async ({ companyName, id }) => {
      const data = await brcFetch(
        companyName,
        `/v1/accruals/${encodeURIComponent(String(id))}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_create_accrual",
    [
      "Creates a new parent Accrual.",
      "The API accepts only the parent transaction shape and relies on shared logic to generate the reversing child transaction.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed creation.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      acCode: accrualCreateSchema.shape.acCode,
      entryDate: accrualCreateSchema.shape.entryDate,
      procDate: accrualCreateSchema.shape.procDate,
      reference: accrualCreateSchema.shape.reference,
      total: accrualCreateSchema.shape.total,
      firstDetail: accrualCreateSchema.shape.firstDetail,
      secondDetail: accrualCreateSchema.shape.secondDetail,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms creating this accrual."),
    },
    async ({
      companyName,
      acCode,
      entryDate,
      procDate,
      reference,
      total,
      firstDetail,
      secondDetail,
      confirmWrite,
    }) => {
      const payload = accrualCreateSchema.parse({
        acCode,
        entryDate,
        procDate,
        reference,
        total,
        firstDetail,
        secondDetail,
      });

      if (confirmWrite !== true) {
        return textResponse(
          buildAccrualSummary({
            companyName,
            action: "create",
            ...payload,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/accruals",
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_update_accrual",
    [
      "Updates an existing parent Accrual by id.",
      "Use brc_get_accrual first to retrieve the current accrual and timestamp.",
      "Child accruals are not exposed by the public API.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed the update.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: accrualUpdateSchema.shape.id,
      acCode: accrualUpdateSchema.shape.acCode,
      entryDate: accrualUpdateSchema.shape.entryDate,
      procDate: accrualUpdateSchema.shape.procDate,
      reference: accrualUpdateSchema.shape.reference,
      total: accrualUpdateSchema.shape.total,
      timestamp: accrualUpdateSchema.shape.timestamp,
      firstDetail: accrualUpdateSchema.shape.firstDetail,
      secondDetail: accrualUpdateSchema.shape.secondDetail,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms updating this accrual."),
    },
    async ({
      companyName,
      id,
      acCode,
      entryDate,
      procDate,
      reference,
      total,
      timestamp,
      firstDetail,
      secondDetail,
      confirmWrite,
    }) => {
      const payload = accrualUpdateSchema.parse({
        id,
        acCode,
        entryDate,
        procDate,
        reference,
        total,
        timestamp,
        firstDetail,
        secondDetail,
      });

      if (confirmWrite !== true) {
        return textResponse(
          buildAccrualSummary({
            companyName,
            action: "update",
            ...payload,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "PUT",
        `/v1/accruals/${encodeURIComponent(String(id))}`,
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_delete_accrual",
    [
      "Removes an existing parent Accrual by id.",
      "Requires the accrual timestamp in Base64 string format.",
      "Use brc_get_accrual first to retrieve the current timestamp.",
      "Do not call with confirmWrite=true until the user explicitly confirms deletion.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: accrualIdSchema,
      timestamp: timestampSchema,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms deleting this accrual."),
    },
    async ({ companyName, id, timestamp, confirmWrite }) => {
      if (confirmWrite !== true) {
        return textResponse(
          [
            "Accrual delete draft — not deleted yet",
            "",
            `Company: ${companyName}`,
            `Accrual id: ${id}`,
            `Timestamp: ${timestamp}`,
            "",
            "This will permanently remove the selected parent accrual.",
            "",
            "If this is correct, confirm that you want to delete this accrual.",
          ].join("\n")
        );
      }

      const params = new URLSearchParams();
      params.set("timestamp", timestamp);

      const data = await brcJsonRequest(
        companyName,
        "DELETE",
        `/v1/accruals/${encodeURIComponent(String(id))}?${params.toString()}`
      );

      return jsonResponse(data);
    }
  );
}