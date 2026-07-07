import assert from "node:assert/strict";
import test from "node:test";
import { getBrcMcpServerInstructions } from "./mcp_config.js";
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
    assert.match(instructions, /if one company has no sales or purchases in the period, report zero or no data/i);
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
