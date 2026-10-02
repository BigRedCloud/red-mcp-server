import assert from "node:assert/strict";
import test from "node:test";
import { parseCompanyCsv, COMPANY_CSV_MAX_BYTES, CompanyInputError } from "./company_csv.js";
import { renderConnectPage, renderSsoSignInPage, renderSsoResultPage, renderSsoErrorPage } from "./connection_page.js";

test("normal form keeps the anonymous code and CSV contract; SSO uses only CSRF", () => {
  const normal = renderConnectPage("legacy-code");
  assert.match(normal, /name="code" value="legacy-code"/);
  assert.match(normal, /action="\/connect"/);
  assert.match(normal, /name="companyFile"/);
  const sso = renderConnectPage("csrf-secret", { sso: true });
  assert.match(sso, /class="brand-bar"/);
  assert.match(sso, /name="csrfToken" value="csrf-secret"/);
  assert.match(sso, /action="\/connect\/sso\/complete"/);
  assert.match(sso, /multipart\/form-data/);
  assert.match(sso, /name="companyFile"/);
  assert.doesNotMatch(sso, /name="code"|confirmation code|telemetryClientId/i);
});

test("legacy CSV aliases, quoting and incomplete-row behavior remain unchanged", () => {
  for (const [name, key] of [["companyName", "apiKey"], ["Company Name", "API Key"], ["company", "api_key"], ["CompanyName", "ApiKey"], ["Company", "APIKey"]]) {
    const csv = Buffer.from(`${name},${key}\n" A, B ", secret \n`);
    assert.deepEqual(parseCompanyCsv(csv), [{ companyName: "A, B", apiKey: "secret" }]);
    assert.deepEqual(parseCompanyCsv(csv, true), parseCompanyCsv(csv));
  }
  assert.deepEqual(parseCompanyCsv(Buffer.from("companyName,apiKey,extra\nA,,ignored\nB,key,ignored")), [{ companyName: "B", apiKey: "key" }]);
});

const badCsv = [
  "companyName,apiKey\nA,",
  "companyName,apiKey\nA,credential,extra",
  'companyName,apiKey\nA,"credential',
  "companyName,apiKey,extra\nA,credential,x",
  "companyName,companyName\nA,credential",
  "unknown,apiKey\nA,credential",
  "companyName,apiKey",
  "",
  "companyName,apiKey\nA,credential\u0000",
  `companyName,apiKey\n${"A".repeat(201)},credential`,
  `companyName,apiKey\nA,${"credential".repeat(1000)}`,
];
for (const [index, csv] of badCsv.entries()) test(`strict CSV rejects malformed input ${index + 1} without echoing records`, () => {
  assert.throws(() => parseCompanyCsv(Buffer.from(csv), true), error => {
    assert.ok(error instanceof CompanyInputError);
    assert.doesNotMatch(error.message, /credential/);
    return true;
  });
});
test("strict CSV enforces size and company limits and accepts UTF-8 BOM", () => {
  assert.throws(() => parseCompanyCsv(Buffer.alloc(COMPANY_CSV_MAX_BYTES + 1), true), /too large/);
  assert.throws(() => parseCompanyCsv(Buffer.from("companyName,apiKey\n" + "A,secret\n".repeat(6)), true), /five/);
  assert.equal(parseCompanyCsv(Buffer.from("companyName,apiKey\n" + "A,secret\n".repeat(5)), true).length, 5);
  assert.deepEqual(parseCompanyCsv(Buffer.from("\ufeffcompanyName,apiKey\nA,secret"), true), [{ companyName: "A", apiKey: "secret" }]);
});
test("SSO output escapes names and has no internal identifiers or credential inputs", () => {
  const html = renderSsoResultPage(['<script>alert("x")</script>'], ['<img onerror=alert(1)>']);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|apiKey|csrfToken|tenantId|objectId|connectionId|req_/);
  assert.match(html, /Return to Microsoft Copilot and retry your question/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.match(html, /request a new connection link to try again/);
  assert.match(renderSsoErrorPage("<img>"), /&lt;img&gt;/);
  assert.match(renderSsoSignInPage(""), /id="sign-in" disabled/);
  assert.match(renderSsoErrorPage(), /class="brand-bar"/);
});

for (const [label, names, failed] of [
  ["all success", ["Connected A", "Connected B"], []],
  ["partial success", ["Connected A"], ["Failed B"]],
  ["all failed", [], ["Failed A", "Failed B"]],
] as const) test(`SSO result: ${label}`, () => {
  const html = renderSsoResultPage([...names], [...failed]);
  for (const name of [...names, ...failed]) assert.ok(html.includes(name));
  assert.doesNotMatch(html, /tenantId|objectId|connectionId|req_|csrfToken|HTTP|stack/);
  assert.match(html, /aria-hidden="true"/);
  if (names.length) {
    assert.match(html, /<h2>Companies connected<\/h2>/);
    assert.match(html, /Return to Microsoft Copilot and retry your question/);
  } else {
    assert.match(html, /<h2>Companies could not be connected<\/h2>/);
    assert.doesNotMatch(html, /Companies connected|RED is now connected|retry your question/);
  }
  if (failed.length) assert.match(html, /request a new connection link to try again/);
  else assert.doesNotMatch(html, /Could not connect|request a new connection link/);
});
