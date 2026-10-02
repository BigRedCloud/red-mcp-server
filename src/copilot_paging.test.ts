import test from "node:test";
import assert from "node:assert/strict";
import { advancePage, freshPaging, pagingArgs } from "./copilot_paging.js";

const rows = (...ids: number[]) => ids.map(id => ({ id }));
const identity = (row: Record<string, unknown>) => String(row.id);
test("first request uses skip 0 and later requests advance by the raw records examined", () => {
  const start = freshPaging();
  assert.deepEqual(pagingArgs(start, 20), { top: 20, skip: 0, orderBy: "id asc" });
  const first = advancePage(start, rows(1, 2, 3), 3, identity);
  assert.equal(first.done, false);
  assert.deepEqual(pagingArgs(first.state, 3), { top: 3, skip: 3, orderBy: "id asc" });
  const last = advancePage(first.state, rows(4, 5), 3, identity);
  assert.equal(last.done, true);
  assert.equal(last.state.offset, 5);
  assert.deepEqual(pagingArgs(last.state, 3), { top: 3, skip: 5, orderBy: "id asc" });
});
test("paging removes within-page and adjacent overlap but advances by raw count", () => {
  const first = advancePage(freshPaging(), rows(1, 1, 2), 3, identity);
  assert.deepEqual(first.rows, rows(1, 2));
  const next = advancePage(JSON.parse(JSON.stringify(first.state)), rows(2, 3, 4), 3, identity);
  assert.deepEqual(next.rows, rows(3, 4));
  assert.equal(next.state.offset, 6);
  const repeated = advancePage(next.state, rows(4, 2, 3), 3, identity);
  assert.equal(repeated.warning, "pagination_stalled");
  assert.deepEqual(repeated.rows, []);
  assert.equal(advancePage(freshPaging(), rows(1, 2), 3, identity).rows.length, 2, "company reset retains same IDs in other companies");
});
test("empty and short final pages terminate without stalling", () => {
  const empty = advancePage(freshPaging(), [], 20, identity);
  assert.equal(empty.done, true);
  assert.equal(empty.warning, undefined);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.state.offset, 0);
  const short = advancePage(freshPaging(), rows(1, 2), 20, identity);
  assert.equal(short.done, true);
  assert.equal(short.warning, undefined);
  assert.deepEqual(short.rows, rows(1, 2));
  assert.equal(short.state.offset, 2);
});
test("serialized continuation state still detects a repeated page", () => {
  const first = advancePage(freshPaging(), rows(1, 2), 2, identity);
  const resumed = advancePage(JSON.parse(JSON.stringify(first.state)), rows(1, 2), 2, identity);
  assert.equal(resumed.warning, "pagination_stalled");
  assert.equal(resumed.done, true);
  assert.deepEqual(resumed.rows, []);
});
test("paging detects cycles and caps otherwise unbounded scans", () => {
  let progress = advancePage(freshPaging(), rows(1), 1, identity);
  for (let id = 2; id < 8; id++) progress = advancePage(progress.state, rows(id), 1, identity);
  assert.equal(advancePage(progress.state, rows(1), 1, identity).warning, "pagination_stalled");
  const limited = advancePage({ ...freshPaging(), pages: 999 }, rows(1000), 1, identity);
  assert.equal(limited.warning, "pagination_limit");
  assert.equal(limited.done, true);
});
