#!/usr/bin/env node
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const extOut = resolve(root, "extension/dist");
const mcpOut = resolve(root, "mcp-server/dist");

/**
 * Every output is a single self-contained file. The extension needs that for
 * chrome.scripting.executeScript; the MCP server needs it so the plugin runs
 * straight from git with no `npm install` on the user's machine.
 */
const extensionEntries = [
  { in: "extension/src/background.ts", out: "background.js" },
  { in: "extension/src/content/entry.ts", out: "content.js" },
  { in: "extension/src/popup/popup.ts", out: "popup.js" },
].map((e) => ({
  entryPoints: [resolve(root, e.in)],
  outfile: resolve(extOut, e.out),
  bundle: true,
  platform: "browser",
  target: "chrome120",
  format: "iife",
  legalComments: "none",
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
}));

const mcpEntry = {
  entryPoints: [resolve(root, "mcp-server/src/index.ts")],
  outfile: resolve(mcpOut, "index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  // Optional native accelerators for `ws`; not needed on loopback.
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __bcbCreateRequire } from 'node:module';\nconst require = __bcbCreateRequire(import.meta.url);",
  },
};

async function copyPublic() {
  await cp(resolve(root, "extension/public"), extOut, { recursive: true });
}

await rm(extOut, { recursive: true, force: true });
await rm(mcpOut, { recursive: true, force: true });
await mkdir(extOut, { recursive: true });
await mkdir(mcpOut, { recursive: true });

if (watch) {
  const ctxs = await Promise.all([...extensionEntries, mcpEntry].map((o) => context(o)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyPublic();
  setInterval(() => copyPublic().catch(() => {}), 1500);
  console.log("[bcb] watching…");
} else {
  await Promise.all([...extensionEntries, mcpEntry].map((o) => build(o)));
  await copyPublic();
  console.log(`[bcb] built extension → ${extOut}\n[bcb] built mcp-server → ${mcpOut}`);
}
