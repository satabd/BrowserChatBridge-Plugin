# BrowserChatBridge (`bcb`) — ChatGPT & Gemini as Claude Code tools

A Claude Code plugin that lets Claude talk to **your signed-in ChatGPT and Gemini browser tabs**. No API keys, no scraping services: a tiny browser extension types into the real web UI and reads the reply back.

```
Claude Code ──MCP stdio──► mcp-server ──WebSocket (127.0.0.1:17361)──► browser extension ──► chatgpt.com / gemini.google.com tabs
```

Tools exposed to Claude:

| Tool | What it does |
|---|---|
| `chatgpt_ask`, `gemini_ask` | Send a prompt, wait for the reply to finish streaming, return it as markdown |
| `list_tabs` | Open ChatGPT/Gemini tabs with ids |
| `get_last_response` | Read the newest reply in a tab without sending |
| `scrape_conversation` | Pull the whole visible thread |
| `health_check` | Is the extension connected? Which process owns the bridge? |

Plus two slash commands, `/bcb:setup` and `/bcb:doctor`, and a skill that teaches Claude when to reach for a second opinion.

## Install

Requires Node 20+ and a Chromium browser (Chrome, Edge, Brave).

```bash
claude plugin marketplace add satabd/BrowserChatBridge-Plugin
claude plugin install bcb@bcb
```

Or, for a local checkout:

```bash
claude --plugin-dir /path/to/BrowserChatBridge-Plugin
```

Then, inside Claude Code, run **`/bcb:setup`** once. It stages the extension in a stable folder, opens your browser's extensions page, and walks you through the single manual step: *Developer mode → Load unpacked → pick the folder*. Sign in to chatgpt.com and gemini.google.com and you're done.

Try it: *"Ask ChatGPT what it thinks of this function."*

## How it works (and why it's robust)

- **Extension is the WebSocket client**, so it reconnects on its own when a Claude Code session starts. A `chrome.alarms` heartbeat keeps the MV3 service worker from sleeping through it.
- **Many sessions, one extension.** Each Claude Code session spawns its own MCP server. The first to bind port 17361 becomes the *leader*; the rest proxy to it over loopback HTTP. If the leader exits, the next call re-elects.
- **Composer input** uses `focus → execCommand('selectAll') → execCommand('insertText')` plus a synthetic `InputEvent`. Setting `textContent` does not update ProseMirror (ChatGPT) or Quill (Gemini) state.
- **Completion** is a hybrid gate: provider "generating" signals (ChatGPT's Stop button and `data-talvt-turn-state`, Gemini's `aria-busy` / `.pending`) **and** user+assistant turn counts past a pre-send baseline **and** the extracted text unchanged for 2.5 s. Stop-button-alone is racy.
- **Selectors are fallback chains**, newest first, in `extension/src/content/adapters/`. When a site redesigns, add a new first entry; don't delete the old ones.
- **Gemini quirk:** replies only finalise once the tab paints. The extension activates the target tab for the duration of an ask.
- Everything binds to `127.0.0.1` only. Prompts go to your own ChatGPT/Gemini account exactly as if you typed them.

## Repo layout

```
.claude-plugin/plugin.json    plugin manifest (name: bcb)
.claude-plugin/marketplace.json  single-plugin marketplace so `claude plugin install bcb@bcb` works
.mcp.json                     declares the stdio MCP server (node mcp-server/dist/index.js)
mcp-server/src/               MCP tools + leader/follower bridge (bundled → mcp-server/dist, committed)
extension/src/                MV3 extension: background.ts, content/{entry,dom,markdown}.ts, adapters/{chatgpt,gemini}.ts
extension/dist/               built extension (committed; what you load unpacked)
shared/protocol.ts            wire types shared by both sides
scripts/setup.mjs             /bcb:setup helper
commands/, skills/            slash commands and the skill
tests/                        fake-extension + stdio MCP client for Node-side e2e
```

## Develop

```bash
npm install
npm run build        # bundles extension/dist and mcp-server/dist (commit both)
npm run typecheck
node tests/fake-extension.mjs &   # pretends to be the browser
node tests/mcp-client.mjs --two   # spawns two servers: leader + follower
```

After changing the extension, reload it at `chrome://extensions`. After changing the MCP server, run `/reload-plugins` or restart Claude Code.

## When a site changes its UI

Open the site, inspect the composer / send button / message containers, prepend the new selector to the relevant chain in `extension/src/content/adapters/<provider>.ts`, rebuild, reload the extension. The adapter header comments record what each selector looked like on the last verified date.

## License

MIT
