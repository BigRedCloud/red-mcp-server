import assert from "node:assert/strict";
import test from "node:test";

import { getBrcMcpServerInstructions, MANDATORY_ROUTING_INSTRUCTION } from "./mcp_config.js";
import { formatCredentialTtlForUser } from "../auth/connection_presentation.js";

test("MCP server instructions keep connectionRef after successful lookups", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, /keep using that same connectionRef/i);
  assert.match(instructions, /Empty lists, zero results, or partial data do not mean the connection expired/i);
  assert.match(instructions, /Do not use brc_start_company_connection when connectionRef already works/i);
});

test("MCP server instructions include Vibe/Mistral connectionRef persistence rules", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, /Red connectionRef persistence rules/i);
  assert.match(instructions, /Vibe\/Mistral/i);
  assert.match(instructions, /brc_list_sales_invoices/i);
  assert.match(instructions, /Do not call brc_start_company_connection after successful lookups/i);
});

test("MCP server instructions treat missing company data as not expired during comparisons", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(
    instructions,
    /if one company has no sales or purchases in the period, report zero or no data/i
  );
  assert.match(instructions, /Do not call brc_start_company_connection mid-comparison/i);
});

test("MCP server instructions hide connectionRef from normal users", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, /connectionRef user presentation rules/i);
  assert.match(instructions, /Never mention connectionRef/i);
  assert.match(instructions, /redconn_/i);
});

test("MCP server instructions derive session duration from configured TTL", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, new RegExp(formatCredentialTtlForUser()));
});

test("MCP server instructions auto-retrieve screenshots for BRC tutorials", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, /includeImages=true/i);
  assert.match(instructions, /imagePresentation=links/i);
  assert.match(instructions, /even when the user did not explicitly ask for images/i);
  assert.match(instructions, /Sources/i);
  assert.match(instructions, /Do this through Red/i);
  assert.match(instructions, /https:\/\/bigredcloud\.com\/contact\//);
  assert.equal(/helpInteractionMode/i.test(instructions), false);
});

test("MCP server instructions define red-help mode and block auto transactional actions", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.ok(instructions.startsWith("MANDATORY ROUTING:"));
  assert.match(instructions, /Transactional tools reject requests without a valid routeToken/i);
  assert.match(instructions, /Never invent a placeholder routeToken/i);
  assert.match(instructions, /do not call brc_route_request with only that confirmation word/i);
  assert.match(
    instructions,
    /routeToken does not replace preview-before-posting/i,
  );
  assert.match(instructions, /REQUEST ROUTING \(mandatory\)/i);
  assert.match(instructions, /brc_route_request/i);
  assert.match(instructions, /Two behaviours \(mandatory\)/i);
  assert.match(instructions, /how do I/i);
  assert.match(
    instructions,
    /Do not let add\/create\/post\/update force action mode/i,
  );
  assert.match(
    instructions,
    /Help mode does not persist into the next/i,
  );
  assert.match(instructions, /RED-HELP SHORTCUT/i);
  assert.match(instructions, /red-help how do I add a customer/i);
  assert.match(
    instructions,
    /classifiers alone cannot force tool selection/i,
  );
});

test("MCP server instructions include correction/undo planning before another write", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(instructions, /Red correction, undo, and reversal rules/i);
  assert.match(instructions, /first request is not write confirmation/i);
  assert.match(instructions, /Never invent previous values/i);
  assert.match(
    instructions,
    /Undo \/ reverse \/ put it back \/ change it back \/ restore \/ cancel what you just did/i
  );
  assert.match(
    instructions,
    /Undo, reverse, put it back, change it back, restore, and cancel-what-you-just-did are not confirmation/i
  );
  assert.match(instructions, /change the quote reference to QT0003/i);
  assert.match(instructions, /correct invoice 123 amount to €20/i);
});

test("routing instructions forbid paraphrasing the original request", () => {
  assert.match(
    MANDATORY_ROUTING_INSTRUCTION,
    /complete original message verbatim/i
  );

  assert.match(
    MANDATORY_ROUTING_INSTRUCTION,
    /do not paraphrase/i
  );

  assert.match(
    MANDATORY_ROUTING_INSTRUCTION,
    /do not.*retry.*different wording/i
  );
});
