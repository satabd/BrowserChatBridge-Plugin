#!/usr/bin/env node
/**
 * Stand-in for the browser extension, for testing the MCP server without a
 * browser. Connects to the bridge, says hello, answers listTabs/ask/etc.
 * Run:  node tests/fake-extension.mjs [ws://127.0.0.1:17361/extension]
 */
import WebSocket from "ws";

// Test port, NOT the production 17361: connecting a fake extension to a real
// running bridge would displace the user's real extension socket.
export const TEST_PORT = Number(process.env.BCB_PORT ?? 17399);
const url = process.argv[2] ?? `ws://127.0.0.1:${TEST_PORT}/extension`;
const tabs = [
  { tabId: 101, provider: "chatgpt", url: "https://chatgpt.com/c/fake", title: "Fake ChatGPT", active: true, focused: true, lastAccessed: 2 },
  { tabId: 202, provider: "gemini", url: "https://gemini.google.com/app/fake", title: "Fake Gemini", active: false, focused: false, lastAccessed: 1 },
];

function connect() {
  const ws = new WebSocket(url);
  ws.on("open", () => {
    console.error("[fake-ext] connected");
    ws.send(JSON.stringify({ id: "h", kind: "event", type: "hello", data: { extensionVersion: "fake", protocolVersion: "2.0.0" } }));
    ws.send(JSON.stringify({ id: "t", kind: "event", type: "tabsChanged", data: { tabs } }));
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.kind !== "request") return;
    const reply = (ok, data, error) => ws.send(JSON.stringify({ id: msg.id, kind: "response", type: msg.type, ok, data, error }));
    switch (msg.type) {
      case "listTabs": return reply(true, { tabs: tabs.filter((t) => !msg.data.provider || t.provider === msg.data.provider) });
      case "openTab": return reply(true, { tab: { ...tabs[0], tabId: 303, provider: msg.data.provider } });
      case "ask": return setTimeout(() => reply(true, {
        text: `echo(${msg.data.provider ?? "?"}): ${msg.data.prompt}`, format: msg.data.format,
        turnCounts: { user: 1, assistant: 1 }, elapsedMs: 250, completed: true,
      }), 250);
      case "getLastResponse": return reply(true, { text: "last reply", format: msg.data.format });
      case "scrape": return reply(true, { turns: [{ role: "user", text: "hi", index: 0 }, { role: "assistant", text: "hello", index: 1 }], format: msg.data.format });
      default: return reply(false, undefined, { code: "invalid_request", message: `unknown ${msg.type}` });
    }
  });
  ws.on("close", () => { console.error("[fake-ext] closed; reconnecting"); setTimeout(connect, 1000); });
  ws.on("error", () => {});
}
connect();
