#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_TIMEOUT_MS,
  PROVIDER_LABEL,
  PROVIDERS,
  type Provider,
  type ReturnFormat,
  type TabDescriptor,
} from "../../shared/protocol.js";
import { BcbError, Bridge } from "./bridge.js";
import { log } from "./logger.js";

const VERSION = "0.2.0";
const EXTENSION_WAIT_MS = Number(process.env.BCB_EXTENSION_WAIT_MS ?? 25_000);

const bridge = new Bridge(VERSION, Number(process.env.BCB_PORT ?? 17361));
const lastUsedTab = new Map<Provider, number>();

const SETUP_HINT =
  "The BrowserChatBridge browser extension is not connected. " +
  "Run /bcb:setup (or /bcb:doctor) in Claude Code: it opens your browser's extensions page so you can load the extension once. " +
  "If it is already installed, open chrome://extensions and click its reload button.";

/* --------------------------------- tools --------------------------------- */

const server = new McpServer({ name: "browser-chat-bridge", version: VERSION });

const formatSchema = z.enum(["markdown", "text", "html"]).default("markdown")
  .describe("How to render the reply. markdown keeps code fences, lists and tables.");

const askInput = {
  prompt: z.string().min(1).describe("The message to send. Sent verbatim into the chat composer."),
  tab_id: z.number().int().optional()
    .describe("Browser tab to use (from list_tabs). Omit to reuse the last tab used for this provider, or the first signed-in tab found."),
  new_conversation: z.boolean().default(false)
    .describe("Open a fresh chat in a new tab instead of continuing an existing one. Use for isolated questions."),
  timeout_ms: z.number().int().min(5_000).max(900_000).default(DEFAULT_TIMEOUT_MS)
    .describe("How long to wait for the reply to finish streaming. Long reasoning replies may need 300000+."),
  format: formatSchema,
};

for (const provider of PROVIDERS) {
  const label = PROVIDER_LABEL[provider];
  server.registerTool(
    `${provider}_ask`,
    {
      title: `Ask ${label}`,
      description:
        `Send a prompt to ${label} through the user's signed-in browser tab and return the full reply once it finishes streaming. ` +
        `Continues the conversation already open in that tab unless new_conversation is true. ` +
        `Good for second opinions, cross-checking facts or code, or using ${label}-specific features the user is subscribed to. ` +
        `No API key involved; this is the user's own ${label} session, so avoid sending secrets.`,
      inputSchema: askInput,
    },
    async (args) => ask(provider, args),
  );
}

server.registerTool(
  "list_tabs",
  {
    title: "List ChatGPT / Gemini tabs",
    description: "List the open browser tabs the bridge can drive (chatgpt.com and gemini.google.com), with tab ids for the *_ask and scrape tools.",
    inputSchema: { provider: z.enum(PROVIDERS).optional().describe("Filter to one provider.") },
  },
  async ({ provider }) => {
    await requireExtension();
    const { tabs } = await bridge.call("listTabs", { provider }, 10_000);
    if (!tabs.length) {
      return text(`No ${provider ? PROVIDER_LABEL[provider] : "ChatGPT or Gemini"} tabs are open. Ask with new_conversation=true to open one, or open the site in the browser and sign in.`);
    }
    return text(tabs.map(describeTab).join("\n"));
  },
);

server.registerTool(
  "get_last_response",
  {
    title: "Read the latest reply in a tab",
    description: "Return the most recent assistant reply currently shown in a ChatGPT or Gemini tab, without sending anything. Useful after a timeout or when the user generated a reply manually.",
    inputSchema: { tab_id: z.number().int().describe("Tab id from list_tabs."), format: formatSchema },
  },
  async ({ tab_id, format }) => {
    await requireExtension();
    const res = await bridge.call("getLastResponse", { tabId: tab_id, format: format as ReturnFormat }, 20_000);
    return text(res.text || "(the tab has no assistant reply yet)");
  },
);

server.registerTool(
  "scrape_conversation",
  {
    title: "Scrape a whole conversation",
    description: "Return every user and assistant turn currently rendered in a ChatGPT or Gemini tab, in order. Long chats may be virtualised; scroll the tab to the top first if early turns are missing.",
    inputSchema: { tab_id: z.number().int().describe("Tab id from list_tabs."), format: formatSchema },
  },
  async ({ tab_id, format }) => {
    await requireExtension();
    const res = await bridge.call("scrape", { tabId: tab_id, format: format as ReturnFormat }, 30_000);
    if (!res.turns.length) return text("(no turns found in that tab)");
    const body = res.turns.map((t) => `### ${t.role === "user" ? "User" : "Assistant"} (turn ${t.index + 1})\n\n${t.text}`).join("\n\n");
    return text(body);
  },
);

server.registerTool(
  "health_check",
  {
    title: "Bridge health",
    description: "Report whether the browser extension is connected, which process owns the bridge, and which provider tabs are visible. Use this first when another tool fails.",
    inputSchema: {},
  },
  async () => {
    // Give a freshly-started bridge a moment: the extension re-dials every ≤5 s.
    await bridge.waitForExtension(6_000);
    const h = await bridge.health();
    const lines = [
      `bridge: ${h.role}${h.role === "follower" ? ` (leader pid ${h.leaderPid})` : ` (pid ${process.pid})`} v${h.version}, port ${h.port}`,
      `extension: ${h.extensionConnected ? `connected (v${h.extensionVersion ?? "?"}, protocol ${h.extensionProtocolVersion ?? "?"})` : "NOT connected"}`,
      `tabs: ${h.tabs.length ? "\n" + h.tabs.map(describeTab).join("\n") : "none"}`,
    ];
    if (!h.extensionConnected) lines.push("", SETUP_HINT);
    return text(lines.join("\n"));
  },
);

/* -------------------------------- helpers -------------------------------- */

async function ask(
  provider: Provider,
  args: { prompt: string; tab_id?: number; new_conversation: boolean; timeout_ms: number; format: string },
) {
  await requireExtension();
  const tab = await resolveTab(provider, args.tab_id, args.new_conversation);
  const started = Date.now();
  log.info("ask", { provider, tabId: tab.tabId, chars: args.prompt.length });

  const res = await bridge.call(
    "ask",
    { tabId: tab.tabId, prompt: args.prompt, format: args.format as ReturnFormat, timeoutMs: args.timeout_ms, activate: true },
    args.timeout_ms + 15_000,
  );
  lastUsedTab.set(provider, tab.tabId);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const caveat = res.completed ? "" : res.note ? ` · NOT CONFIRMED FINAL: ${res.note}` : " · TIMED OUT, reply may be partial";
  const meta = `[${PROVIDER_LABEL[provider]} · tab ${tab.tabId} · ${secs}s · ${res.turnCounts.assistant} replies in thread${caveat}]`;
  const body = res.text.trim() || "(empty reply — the page may have shown an error or a login wall; check the tab)";
  return { content: [{ type: "text" as const, text: body }, { type: "text" as const, text: meta }] };
}

async function resolveTab(provider: Provider, tabId: number | undefined, fresh: boolean): Promise<TabDescriptor> {
  if (fresh) {
    const { tab } = await bridge.call("openTab", { provider }, 30_000);
    return tab;
  }
  const { tabs } = await bridge.call("listTabs", { provider }, 10_000);
  if (tabId !== undefined) {
    const t = tabs.find((x) => x.tabId === tabId);
    if (!t) throw new BcbError("tab_not_found", `Tab ${tabId} is not an open ${PROVIDER_LABEL[provider]} tab. Open tabs:\n${tabs.map(describeTab).join("\n") || "(none)"}`);
    return t;
  }
  const remembered = lastUsedTab.get(provider);
  const pick = tabs.find((t) => t.tabId === remembered) ?? tabs.find((t) => t.active && t.focused) ?? tabs.find((t) => t.active) ?? tabs[0];
  if (pick) return pick;
  log.info("no tab open; opening one", { provider });
  const { tab } = await bridge.call("openTab", { provider }, 30_000);
  return tab;
}

async function requireExtension(): Promise<void> {
  const ok = await bridge.waitForExtension(EXTENSION_WAIT_MS);
  if (!ok) throw new BcbError("extension_disconnected", SETUP_HINT);
}

function describeTab(t: TabDescriptor): string {
  const flags = [t.active ? "active" : null, t.focused ? "focused" : null].filter(Boolean).join(", ");
  return `- tab ${t.tabId} [${t.provider}]${flags ? ` (${flags})` : ""}: ${t.title || "(untitled)"} — ${t.url}`;
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/* ---------------------------------- boot --------------------------------- */

async function main(): Promise<void> {
  // Bind early so the extension can attach while Claude is still thinking.
  bridge.ensureRole().catch((err) => log.warn("initial bind failed", { err: String(err) }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server ready", { version: VERSION, pid: process.pid });

  const shutdown = async (reason: string) => {
    log.info("shutting down", { reason });
    try { await bridge.close(); } catch { /* noop */ }
    process.exit(0);
  };
  process.stdin.on("end", () => void shutdown("stdin closed"));
  process.stdin.on("close", () => void shutdown("stdin closed"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { err: String((err as Error)?.stack ?? err) });
  process.exit(1);
});
