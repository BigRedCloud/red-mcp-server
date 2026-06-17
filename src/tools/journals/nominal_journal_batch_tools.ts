import { z } from "zod";
import type { ServerType } from "../../server.js";
import {
  brcFetch,
  brcJsonRequest,
  companyNameSchema,
  jsonResponse,
  textResponse,
} from "../../shared.js";

const nominalJournalBatchIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Nominal Journal Batch id.");

const timestampSchema = z
  .string()
  .min(1)
  .describe("Base64 timestamp returned by the Nominal Journal Batch, for example 7aIZQIbL3gg=.");

const isoDateTimeSchema = z
  .string()
  .min(1)
  .describe("Date/time string, for example 2024-01-15T00:00:00.");

const accountTransactionCreateSchema = z.object({
  acCode: z
    .string()
    .min(1)
    .describe("Nominal account code, for example 400 or 800."),
  description: z
    .string()
    .min(1)
    .describe("Line description, for example Sales or Expenses."),
  procDate: isoDateTimeSchema.describe("Processing date for this transaction line."),
  reference: z
    .string()
    .min(1)
    .describe("Journal reference, for example NJ0001."),
  debit: z
    .number()
    .min(0)
    .describe("Debit amount for this line."),
  credit: z
    .number()
    .min(0)
    .describe("Credit amount for this line."),
  firstDetail: z
    .string()
    .optional()
    .default("")
    .describe("First detail text for this line."),
  secondDetail: z
    .string()
    .optional()
    .default("")
    .describe("Second detail text for this line."),
});

const accountTransactionUpdateSchema = accountTransactionCreateSchema.extend({
  id: z
    .number()
    .int()
    .positive()
    .describe("Existing account transaction line id."),
  timeStamp: timestampSchema.describe("Base64 timestamp for this account transaction line."),
});

const nominalJournalBatchCreateSchema = z.object({
  bookTranTypeId: z
    .number()
    .int()
    .positive()
    .default(7)
    .describe("Book transaction type id. Nominal Journal Batch is usually 7."),
  entryDate: isoDateTimeSchema.describe("Entry date, for example 2024-01-15T00:00:00."),
  procDate: isoDateTimeSchema.describe("Processing date, for example 2024-01-15T00:00:00."),
  total: z
    .number()
    .min(0)
    .describe("Total journal amount."),
  accountTransactions: z
    .array(accountTransactionCreateSchema)
    .min(2)
    .describe("Nominal journal account transaction lines. Debits and credits should balance."),
});

const nominalJournalBatchUpdateSchema = z.object({
  id: nominalJournalBatchIdSchema,
  bookTranTypeId: z
    .number()
    .int()
    .positive()
    .default(7)
    .describe("Book transaction type id. Nominal Journal Batch is usually 7."),
  entryDate: isoDateTimeSchema,
  procDate: isoDateTimeSchema,
  total: z.number().min(0),
  timestamp: timestampSchema.describe("Base64 timestamp for the nominal journal batch."),
  accountTransactions: z
    .array(accountTransactionUpdateSchema)
    .min(2)
    .describe("Updated nominal journal account transaction lines."),
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

function getTotals(
  accountTransactions: Array<{ debit: number; credit: number }>
): { totalDebit: number; totalCredit: number } {
  return accountTransactions.reduce(
    (totals, line) => ({
      totalDebit: totals.totalDebit + line.debit,
      totalCredit: totals.totalCredit + line.credit,
    }),
    { totalDebit: 0, totalCredit: 0 }
  );
}

function validateBalancedJournal(
  accountTransactions: Array<{ debit: number; credit: number }>
): void {
  const { totalDebit, totalCredit } = getTotals(accountTransactions);

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    throw new Error(
      `Nominal journal is not balanced. Total debit is ${totalDebit}, total credit is ${totalCredit}.`
    );
  }
}

function buildJournalSummary(args: {
  companyName: string;
  action: "create" | "update";
  id?: number;
  bookTranTypeId: number;
  entryDate: string;
  procDate: string;
  total: number;
  accountTransactions: Array<{
    acCode: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    firstDetail?: string;
    secondDetail?: string;
  }>;
}): string {
  const { totalDebit, totalCredit } = getTotals(args.accountTransactions);

  return [
    args.action === "create"
      ? "Nominal Journal Batch create draft — not posted yet"
      : "Nominal Journal Batch update draft — not posted yet",
    "",
    `Company: ${args.companyName}`,
    args.id ? `Batch id: ${args.id}` : undefined,
    `Book transaction type id: ${args.bookTranTypeId}`,
    `Entry date: ${args.entryDate}`,
    `Processing date: ${args.procDate}`,
    `Total: ${args.total}`,
    `Total debit: ${totalDebit}`,
    `Total credit: ${totalCredit}`,
    "",
    "Journal lines:",
    ...args.accountTransactions.map((line, index) =>
      [
        `${index + 1}. Account: ${line.acCode}`,
        `   Description: ${line.description}`,
        `   Reference: ${line.reference}`,
        `   Debit: ${line.debit}`,
        `   Credit: ${line.credit}`,
        line.firstDetail ? `   Detail 1: ${line.firstDetail}` : undefined,
        line.secondDetail ? `   Detail 2: ${line.secondDetail}` : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    "",
    args.action === "create"
      ? "If this is correct, confirm that you want to create this Nominal Journal Batch."
      : "If this is correct, confirm that you want to update this Nominal Journal Batch.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function registerNominalJournalBatchTools(server: ServerType) {
  server.tool(
    "brc_list_nominal_journal_batches",
    [
      "Returns a list of the company's Nominal Journal Batches.",
      "Supports optional OData filtering by entryDate and ordering by id.",
      "Use this before updating or deleting a nominal journal batch so the user can identify the correct id and timestamp.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      filter: z
        .string()
        .optional()
        .describe(
          "Optional OData filter. Filtering is allowed by entryDate, for example: entryDate ge 2024-01-01T00:00:00"
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

      const data = await brcFetch(
        companyName,
        `/v1/nominalJournalBatches${query}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_get_nominal_journal_batch",
    "Returns information about a single Nominal Journal Batch by id.",
    {
      companyName: companyNameSchema,
      id: nominalJournalBatchIdSchema,
    },
    async ({ companyName, id }) => {
      const data = await brcFetch(
        companyName,
        `/v1/nominalJournalBatches/${encodeURIComponent(String(id))}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_create_nominal_journal_batch",
    [
      "Creates a new Nominal Journal Batch.",
      "The journal should contain balanced debit and credit lines.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed creation.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      bookTranTypeId: nominalJournalBatchCreateSchema.shape.bookTranTypeId,
      entryDate: nominalJournalBatchCreateSchema.shape.entryDate,
      procDate: nominalJournalBatchCreateSchema.shape.procDate,
      total: nominalJournalBatchCreateSchema.shape.total,
      accountTransactions:
        nominalJournalBatchCreateSchema.shape.accountTransactions,
      confirmWrite: z
        .boolean()
        .optional()
        .describe(
          "Must be true only after the user explicitly confirms creating this Nominal Journal Batch."
        ),
    },
    async ({
      companyName,
      bookTranTypeId,
      entryDate,
      procDate,
      total,
      accountTransactions,
      confirmWrite,
    }) => {
      const payload = nominalJournalBatchCreateSchema.parse({
        bookTranTypeId,
        entryDate,
        procDate,
        total,
        accountTransactions,
      });

      validateBalancedJournal(payload.accountTransactions);

      if (confirmWrite !== true) {
        return textResponse(
          buildJournalSummary({
            companyName,
            action: "create",
            bookTranTypeId: payload.bookTranTypeId,
            entryDate: payload.entryDate,
            procDate: payload.procDate,
            total: payload.total,
            accountTransactions: payload.accountTransactions,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/nominalJournalBatches",
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_update_nominal_journal_batch",
    [
      "Updates an existing Nominal Journal Batch by id.",
      "Use brc_get_nominal_journal_batch first to retrieve the current batch, including timestamp and account transaction line timestamps.",
      "Do not call with confirmWrite=true until the user has reviewed the draft and explicitly confirmed the update.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: nominalJournalBatchUpdateSchema.shape.id,
      bookTranTypeId: nominalJournalBatchUpdateSchema.shape.bookTranTypeId,
      entryDate: nominalJournalBatchUpdateSchema.shape.entryDate,
      procDate: nominalJournalBatchUpdateSchema.shape.procDate,
      total: nominalJournalBatchUpdateSchema.shape.total,
      timestamp: nominalJournalBatchUpdateSchema.shape.timestamp,
      accountTransactions:
        nominalJournalBatchUpdateSchema.shape.accountTransactions,
      confirmWrite: z
        .boolean()
        .optional()
        .describe(
          "Must be true only after the user explicitly confirms updating this Nominal Journal Batch."
        ),
    },
    async ({
      companyName,
      id,
      bookTranTypeId,
      entryDate,
      procDate,
      total,
      timestamp,
      accountTransactions,
      confirmWrite,
    }) => {
      const payload = nominalJournalBatchUpdateSchema.parse({
        id,
        bookTranTypeId,
        entryDate,
        procDate,
        total,
        timestamp,
        accountTransactions,
      });

      validateBalancedJournal(payload.accountTransactions);

      if (confirmWrite !== true) {
        return textResponse(
          buildJournalSummary({
            companyName,
            action: "update",
            id: payload.id,
            bookTranTypeId: payload.bookTranTypeId,
            entryDate: payload.entryDate,
            procDate: payload.procDate,
            total: payload.total,
            accountTransactions: payload.accountTransactions,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "PUT",
        `/v1/nominalJournalBatches/${encodeURIComponent(String(id))}`,
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_delete_nominal_journal_batch",
    [
      "Removes an existing Nominal Journal Batch by id.",
      "Requires the batch timestamp in Base64 string format.",
      "Use brc_get_nominal_journal_batch first to retrieve the current timestamp.",
      "Do not call with confirmWrite=true until the user explicitly confirms deletion.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: nominalJournalBatchIdSchema,
      timestamp: timestampSchema,
      confirmWrite: z
        .boolean()
        .optional()
        .describe(
          "Must be true only after the user explicitly confirms deleting this Nominal Journal Batch."
        ),
    },
    async ({ companyName, id, timestamp, confirmWrite }) => {
      if (confirmWrite !== true) {
        return textResponse(
          [
            "Nominal Journal Batch delete draft — not deleted yet",
            "",
            `Company: ${companyName}`,
            `Batch id: ${id}`,
            `Timestamp: ${timestamp}`,
            "",
            "This will permanently remove the selected Nominal Journal Batch.",
            "",
            "If this is correct, confirm that you want to delete this Nominal Journal Batch.",
          ].join("\n")
        );
      }

      const params = new URLSearchParams();
      params.set("timestamp", timestamp);

      const data = await brcJsonRequest(
        companyName,
        "DELETE",
        `/v1/nominalJournalBatches/${encodeURIComponent(
          String(id)
        )}?${params.toString()}`
      );

      return jsonResponse(data);
    }
  );
}