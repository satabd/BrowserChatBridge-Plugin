#!/usr/bin/env node
/**
 * Minimal MCP client: spawns the server over stdio exactly like Claude Code
 * does and calls tools. Prints each result.
 *
 *   node tests/mcp-client.mjs health_check
 *   node tests/mcp-client.mjs list_tabs
 *   node tests/mcp-client.mjs chatgpt_ask '{"prompt":"Reply with OK","new_conversation":false}'
 *   node tests/mcp-client.mjs --two   # spawns two servers to exercise leader/follower
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(root, "mcp-server/dist/index.js");

async function spawnClient(name) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, BCB_LOG_LEVEL: process.env.BCB_LOG_LEVEL ?? "warn" }, stderr: "inherit" });
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client, tool, args) {
  const started = Date.now();
  const res = await client.callTool({ name: tool, arguments: args });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== ${tool} (${secs}s)${res.isError ? " [ERROR]" : ""} ===`);
  for (const c of res.content ?? []) console.log(c.type === "text" ? c.text : JSON.stringify(c));
  return res;
}

const [, , first, second] = process.argv;

if (first === "--two") {
  const a = await spawnClient("a");
  const b = await spawnClient("b");
  await call(a, "health_check", {});
  await call(b, "health_check", {});
  await call(b, "list_tabs", {});
  await call(b, "chatgpt_ask", { prompt: "hello from follower" });
  await a.close();
  await b.close();
  process.exit(0);
}

const client = await spawnClient("test");
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
if (first) await call(client, first, second ? JSON.parse(second) : {});
await client.close();
process.exit(0);
