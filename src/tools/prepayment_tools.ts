import { z } from "zod";
import type { ServerType } from "../server.js";
import {
  brcFetch,
  brcJsonRequest,
  companyNameSchema,
  jsonResponse,
  textResponse,
} from "../shared.js";

const prepaymentIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Parent prepayment id.");

const timestampSchema = z
  .string()
  .min(1)
  .describe("Base64 timestamp returned by the prepayment, for example bgUcQIbL3gg=.");

const isoDateTimeSchema = z
  .string()
  .min(1)
  .describe("Date/time string, for example 2024-03-01T00:00:00.");

const prepaymentCreateSchema = z.object({
  acCode: z
    .string()
    .min(1)
    .describe("Nominal account code, for example 4000."),
  entryDate: isoDateTimeSchema.describe("Entry date, for example 2024-03-01T00:00:00."),
  procDate: isoDateTimeSchema.describe("Processing date, for example 2024-03-15T00:00:00."),
  reference: z
    .string()
    .min(1)
    .describe("Prepayment reference, for example PRE0001."),
  total: z
    .number()
    .describe("Prepayment total amount."),
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

const prepaymentUpdateSchema = prepaymentCreateSchema.extend({
  id: prepaymentIdSchema,
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

function buildPrepaymentSummary(args: {
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
      ? "Prepayment create draft — not posted yet"
      : "Prepayment update draft — not posted yet",
    "",
    `Company: ${args.companyName}`,
    args.id ? `Prepayment id: ${args.id}` : undefined,
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
      ? "If this is correct, confirm that you want to create this prepayment."
      : "If this is correct, confirm that you want to update this prepayment.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function registerPrepaymentTools(server: ServerType) {
  server.tool(
    "brc_list_prepayments",
    [
      "Returns a list of the company's Prepayments.",
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

      const data = await brcFetch(companyName, `/v1/prepayments${query}`);

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_get_prepayment",
    "Returns information about a single parent Prepayment by id. Child prepayments are not exposed by the public API.",
    {
      companyName: companyNameSchema,
      id: prepaymentIdSchema,
    },
    async ({ companyName, id }) => {
      const data = await brcFetch(
        companyName,
        `/v1/prepayments/${encodeURIComponent(String(id))}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_create_prepayment",
    [
      "Creates a new parent Prepayment.",
      "The API accepts only the parent transaction shape and relies on shared logic to generate the reversing child transaction.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed creation.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      acCode: prepaymentCreateSchema.shape.acCode,
      entryDate: prepaymentCreateSchema.shape.entryDate,
      procDate: prepaymentCreateSchema.shape.procDate,
      reference: prepaymentCreateSchema.shape.reference,
      total: prepaymentCreateSchema.shape.total,
      firstDetail: prepaymentCreateSchema.shape.firstDetail,
      secondDetail: prepaymentCreateSchema.shape.secondDetail,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms creating this prepayment."),
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
      const payload = prepaymentCreateSchema.parse({
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
          buildPrepaymentSummary({
            companyName,
            action: "create",
            ...payload,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/prepayments",
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_update_prepayment",
    [
      "Updates an existing parent Prepayment by id.",
      "Use brc_get_prepayment first to retrieve the current prepayment and timestamp.",
      "Child prepayments are not exposed by the public API.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed the update.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: prepaymentUpdateSchema.shape.id,
      acCode: prepaymentUpdateSchema.shape.acCode,
      entryDate: prepaymentUpdateSchema.shape.entryDate,
      procDate: prepaymentUpdateSchema.shape.procDate,
      reference: prepaymentUpdateSchema.shape.reference,
      total: prepaymentUpdateSchema.shape.total,
      timestamp: prepaymentUpdateSchema.shape.timestamp,
      firstDetail: prepaymentUpdateSchema.shape.firstDetail,
      secondDetail: prepaymentUpdateSchema.shape.secondDetail,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms updating this prepayment."),
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
      const payload = prepaymentUpdateSchema.parse({
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
          buildPrepaymentSummary({
            companyName,
            action: "update",
            ...payload,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "PUT",
        `/v1/prepayments/${encodeURIComponent(String(id))}`,
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_delete_prepayment",
    [
      "Removes an existing parent Prepayment by id.",
      "Requires the prepayment timestamp in Base64 string format.",
      "Use brc_get_prepayment first to retrieve the current timestamp.",
      "Do not call with confirmWrite=true until the user explicitly confirms deletion.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: prepaymentIdSchema,
      timestamp: timestampSchema,
      confirmWrite: z
        .boolean()
        .optional()
        .describe("Must be true only after the user explicitly confirms deleting this prepayment."),
    },
    async ({ companyName, id, timestamp, confirmWrite }) => {
      if (confirmWrite !== true) {
        return textResponse(
          [
            "Prepayment delete draft — not deleted yet",
            "",
            `Company: ${companyName}`,
            `Prepayment id: ${id}`,
            `Timestamp: ${timestamp}`,
            "",
            "This will permanently remove the selected parent prepayment.",
            "",
            "If this is correct, confirm that you want to delete this prepayment.",
          ].join("\n")
        );
      }

      const params = new URLSearchParams();
      params.set("timestamp", timestamp);

      const data = await brcJsonRequest(
        companyName,
        "DELETE",
        `/v1/prepayments/${encodeURIComponent(String(id))}?${params.toString()}`
      );

      return jsonResponse(data);
    }
  );
}