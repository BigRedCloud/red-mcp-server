import { z } from "zod";
import type { ServerType } from "../server.js";
import {
  brcFetch,
  brcJsonRequest,
  companyNameSchema,
  jsonResponse,
  textResponse,
} from "../shared.js";

const bookTranIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Book transaction id to allocate from, for example 1001.");

const allocationResolverIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Allocation resolver id to reverse/delete.");

const allocationResolverUpdateSchema = z.object({
  id: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Existing allocation id, or 0 for a new allocation."),
  allocated: z
    .number()
    .min(0)
    .describe("Amount to allocate to the receiver transaction."),
  discount: z
    .number()
    .min(0)
    .default(0)
    .describe("Discount amount to apply to this allocation."),
  bookTranIdReceiver: z
    .number()
    .int()
    .positive()
    .describe("Receiver book transaction id, for example the invoice being allocated against."),
});

const allocationResolversPayloadSchema = z.object({
  bookTranId: bookTranIdSchema,
  allocationResolvers: z
    .array(allocationResolverUpdateSchema)
    .min(1)
    .describe("Allocations to create or update for the sender book transaction."),
});

function buildAllocationSummary(args: {
  companyName: string;
  bookTranId: number;
  allocationResolvers: Array<{
    id: number;
    allocated: number;
    discount: number;
    bookTranIdReceiver: number;
  }>;
}): string {
  const totalAllocated = args.allocationResolvers.reduce(
    (sum, item) => sum + item.allocated,
    0
  );

  const totalDiscount = args.allocationResolvers.reduce(
    (sum, item) => sum + item.discount,
    0
  );

  return [
    "Allocation update draft — not posted yet",
    "",
    `Company: ${args.companyName}`,
    `Sender book transaction id: ${args.bookTranId}`,
    `Number of receiver transactions: ${args.allocationResolvers.length}`,
    `Total allocated amount: ${totalAllocated}`,
    `Total discount amount: ${totalDiscount}`,
    "",
    "Receiver allocations:",
    ...args.allocationResolvers.map((item, index) =>
      [
        `${index + 1}. Receiver book transaction id: ${item.bookTranIdReceiver}`,
        `   Allocation id: ${item.id}`,
        `   Allocated: ${item.allocated}`,
        `   Discount: ${item.discount}`,
      ].join("\n")
    ),
    "",
    "If this is correct, confirm that you want to post/update these allocations.",
  ].join("\n");
}

export function registerAllocationResolverTools(server: ServerType) {
  server.tool(
    "brc_list_allocation_resolvers",
    [
      "Returns transactions eligible for allocation from the specified sender book transaction.",
      "Use this before updating allocations so the user can see which receiver transactions are available.",
      "Requires bookTranId.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      bookTranId: bookTranIdSchema,
    },
    async ({ companyName, bookTranId }) => {
      const params = new URLSearchParams();
      params.set("bookTranId", String(bookTranId));

      const data = await brcFetch(
        companyName,
        `/v1/allocationResolvers?${params.toString()}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_update_allocations",
    [
      "Creates or updates allocations for a sender book transaction.",
      "Use brc_list_allocation_resolvers first to identify eligible receiver transactions.",
      "Do not call with confirmWrite=true until the user has reviewed the allocation draft and explicitly confirmed posting.",
      "Required fields: bookTranId and allocationResolvers with allocated amounts and receiver book transaction ids.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      bookTranId: bookTranIdSchema,
      allocationResolvers: z
        .array(allocationResolverUpdateSchema)
        .min(1)
        .describe("Allocations to create or update."),
      confirmWrite: z
        .boolean()
        .optional()
        .describe(
          "Must be true only after the user explicitly confirms posting the allocation update."
        ),
    },
    async ({ companyName, bookTranId, allocationResolvers, confirmWrite }) => {
      const payload = allocationResolversPayloadSchema.parse({
        bookTranId,
        allocationResolvers,
      });

      if (confirmWrite !== true) {
        return textResponse(
          buildAllocationSummary({
            companyName,
            bookTranId: payload.bookTranId,
            allocationResolvers: payload.allocationResolvers,
          })
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "PUT",
        "/v1/allocationResolvers",
        payload
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_list_allocated_transactions",
    [
      "Returns transactions already allocated from the specified sender book transaction.",
      "Use this to review existing allocations before reversing/deleting one.",
      "Requires bookTranId.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      bookTranId: bookTranIdSchema,
    },
    async ({ companyName, bookTranId }) => {
      const params = new URLSearchParams();
      params.set("bookTranId", String(bookTranId));

      const data = await brcFetch(
        companyName,
        `/v1/allocationResolvers/allocated?${params.toString()}`
      );

      return jsonResponse(data);
    }
  );

  server.tool(
    "brc_delete_allocation_resolver",
    [
      "Reverses/deletes a single allocation by allocation resolver id.",
      "Use brc_list_allocated_transactions first to find the allocation id.",
      "Do not call with confirmWrite=true until the user explicitly confirms the reversal/deletion.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      id: allocationResolverIdSchema,
      confirmWrite: z
        .boolean()
        .optional()
        .describe(
          "Must be true only after the user explicitly confirms reversing/deleting this allocation."
        ),
    },
    async ({ companyName, id, confirmWrite }) => {
      if (confirmWrite !== true) {
        return textResponse(
          [
            "Allocation reversal draft — not posted yet",
            "",
            `Company: ${companyName}`,
            `Allocation resolver id: ${id}`,
            "",
            "This will reverse/delete the selected allocation.",
            "",
            "If this is correct, confirm that you want to reverse/delete this allocation.",
          ].join("\n")
        );
      }

      const data = await brcJsonRequest(
        companyName,
        "DELETE",
        `/v1/allocationResolvers/${encodeURIComponent(String(id))}`
      );

      return jsonResponse(data);
    }
  );
}
