import { spawn } from "node:child_process";
import { redactString } from "./redact.mjs";
import { DEFAULT_TEST_SERVER_ENTRY } from "./connection_env.mjs";

export class McpStdioClient {
  constructor(options = {}) {
    this.serverEntry = options.serverEntry || DEFAULT_TEST_SERVER_ENTRY;
    this.env = { ...process.env, ...options.env };
    this.child = null;
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.tools = new Set();
    this.ready = false;
  }

  start() {
    this.child = spawn(process.execPath, [this.serverEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: this.env,
    });

    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      if (/apikey|api_key|password|secret|authorization/i.test(text)) {
        console.error("[server]", "<REDACTED server message>");
        return;
      }
      console.error("[server]", redactString(text));
    });

    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;

        try {
          const message = JSON.parse(line);
          if (message.id && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) pending.reject(message.error);
            else pending.resolve(message.result);
          }
        } catch {
          // Ignore non-JSON stdout.
        }
      }
    });
  }

  req(method, params = {}, timeoutMs = 45000) {
    const id = this.nextId++;
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
    );

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, timeoutMs);
    });
  }

  async init(clientInfo = { name: "brc-legacy-regression", version: "1.0.0" }) {
    if (this.ready) return;

    if (!this.child) {
      this.start();
    }

    await this.req("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo,
    });

    this.child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }) + "\n"
    );

    const toolList = await this.req("tools/list", {});
    this.tools = new Set((toolList.tools || []).map((tool) => tool.name));
    this.ready = true;
  }

  async call(name, args = {}, timeoutMs = 45000) {
    return this.req("tools/call", { name, arguments: args }, timeoutMs);
  }

  toolText(result) {
    if (!result?.content) return JSON.stringify(result);
    return result.content
      .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
      .join("\n");
  }

  parsed(result) {
    try {
      return JSON.parse(this.toolText(result));
    } catch {
      return { rawText: this.toolText(result) };
    }
  }

  isFailure(result, data) {
    const text = this.toolText(result).toLowerCase();
    return Boolean(
      result?.isError ||
        data?.error ||
        data?.status === "error" ||
        text.includes("failed") ||
        text.includes("bad request") ||
        text.includes("internal server error") ||
        text.includes("unprocessable") ||
        text.includes("validation")
    );
  }

  arr(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.Items)) return data.Items;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  close() {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

export function defaultRegressionServerEnv(overrides = {}) {
  return {
    BRC_ALLOW_READ_SKILLS: "true",
    BRC_ALLOW_UPDATE_SKILLS: "true",
    BRC_ALLOW_DELETE_SKILLS: "true",
    BRC_ALLOW_EMAIL_SKILLS: "true",
    BRC_ALLOW_BATCH_SKILLS: "true",
    BRC_ALLOW_DEV_MODE: "false",
    RED_CONNECT_CONNECTION_STORE: "memory",
    ...overrides,
  };
}
