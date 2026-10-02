import { createHash } from "node:crypto";
import { z } from "zod";

// Copilot-only paging. BRC uses OData offsets, not the legacy page parameter.
export const pagingSchema = z.object({
  offset: z.number().int().nonnegative(),
  previous: z.array(z.string()).max(50),
  first: z.string().optional(),
  recent: z.array(z.string()).max(4),
  pages: z.number().int().nonnegative(),
}).strict();
export type Paging = z.infer<typeof pagingSchema>;
export const freshPaging = (): Paging => ({ offset: 0, previous: [], recent: [], pages: 0 });
export const pagingArgs = (state: Paging, size: number) => ({ top: size, skip: state.offset, orderBy: "id asc" });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);

export function advancePage(state: Paging, rows: Record<string, unknown>[], size: number, identity: (row: Record<string, unknown>) => string | undefined) {
  const keys = rows.map(row => hash(identity(row) ?? Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
  const fingerprint = hash([...new Set(keys)].sort());
  const seen = new Set(state.previous);
  const unique = rows.filter((_, index) => {
    if (seen.has(keys[index])) return false;
    seen.add(keys[index]); return true;
  });
  const stalled = rows.length > 0 && (!unique.length || state.first === fingerprint || state.recent.includes(fingerprint));
  const limited = state.pages >= 999 && rows.length === size;
  return {
    rows: stalled ? [] : unique,
    warning: stalled ? "pagination_stalled" : limited ? "pagination_limit" : undefined,
    done: rows.length < size || stalled || limited,
    // Advance by raw records examined, never by matches or deduplicated rows.
    state: { offset: state.offset + rows.length, previous: [...new Set(keys)], first: state.first ?? fingerprint,
      recent: [...state.recent, fingerprint].slice(-4), pages: state.pages + 1 } satisfies Paging,
  };
}
