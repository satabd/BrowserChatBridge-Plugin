# BrowserChatBridge-Plugin — session handoff

Last updated: 2026-10-13. Supersedes the handoff in the old `BrowserChatBridge` repo (v0.1, library design, abandoned).

## State

v0.2.0 plugin rewrite is **complete and builds**; Node side is verified end to end; both provider adapters are verified against the live DOM by injecting the built content script into real signed-in tabs. **Not yet verified: the full path through a real loaded extension**, because loading an unpacked extension is a manual click the user has to do once (`/bcb:setup`).

| Layer | Verified how |
|---|---|
| Plugin manifests (`plugin.json`, `marketplace.json`, `.mcp.json`) | `claude plugin validate` passes for both |
| MCP server: tools, stdio, leader/follower election | `node tests/mcp-client.mjs --two` with `tests/fake-extension.mjs` |
| ChatGPT adapter: send, completion gate, markdown extraction (lists, fenced code w/ language, tables) | content bundle injected into a live chatgpt.com tab; full ask round-trip returned correct markdown |
| Gemini adapter: composer, send via button, turn counts, extraction (lists, fenced code) | same injection; send + observe + scrape verified; finalisation needs a visible tab (see below) |
| Extension background (WS client, tab activation, ask loop) | compiled + typechecked only; exercised against the fake path, not a real browser |

## Things learned this session (do not re-derive)

- **ChatGPT DOM (2026-10-13):** composer `form div.ProseMirror[role=textbox]` (no id); send `form button[type=submit][aria-label=Send]` exists only while composer has text; stop `form button[aria-label=Stop]`; user text `[data-user-message-bubble]`; assistant turn = parent of sr-only `h4[data-conversation-role=assistant]`, markdown in `[data-markdown-text-style=assistant-message]`; code blocks are CodeMirror (`[data-code-block] .cm-content[data-language]`, lines `.cm-line`), no `<pre>`; `[data-talvt-turn-state]` is briefly `complete` right after send before going `in_progress`.
- **Gemini DOM:** composer `rich-textarea div.ql-editor[role=textbox]`; send `button[aria-label="Send message"]`; stop `button[aria-label="Stop response"]` lives <1 s (useless as a gate); exchange = `div.conversation-container` > `user-query` + `model-response`; reply `message-content .markdown[aria-busy]` with `.pending` children while streaming; `code-block` has real `pre > code` and language in `.code-block-decoration`.
- **Gemini only finalises when the tab paints.** Hidden tab ⇒ `aria-busy` stays true forever. Fixed by `activateTab` focusing the window for Gemini, plus a 20 s stable-text bail-out with a `note` when the tab stays hidden.
- **Hidden tabs throttle `setTimeout` to 1/min after 5 min**, which stalled the first in-page ask loop. Fixed by moving the ask loop into the service worker (`runAsk` in `background.ts`); the content script is now timer-free (`send` / `observe` / `getLastResponse` / `scrape`) and uses MutationObserver to wait for the send button.
- **Multiple Claude Code sessions** each spawn an MCP server; first to bind 17361 is leader, others proxy over HTTP `/rpc`. Verified.
- Extension reconnect backoff capped at 5 s (was 30 s) so a freshly started session attaches fast; `health_check` waits up to 6 s, `*_ask` up to 25 s for the extension.
- The user's browser is **Edge** (`edge://` URLs); `scripts/setup.mjs` prefers Chrome if both exist — pass `--browser msedge` if needed.

## Next steps

1. User runs `/bcb:setup` (or `node scripts/setup.mjs`), loads `~/.bcb/extension` unpacked, reloads the old v0.1 extension away (or removes it — both would try to connect to 17361; the newer one wins but it's noisy).
2. `claude --plugin-dir D:/VibeProjects/BrowserChatBridge-Plugin`, then `/bcb:doctor`, then a real `chatgpt_ask` and `gemini_ask`. Watch for: service-worker lifetime during a 2-minute ask, window focus behaviour on Gemini, `send_failed` false positives.
3. Push to GitHub as `satabd/BrowserChatBridge-Plugin` so `claude plugin marketplace add satabd/BrowserChatBridge-Plugin` works. The marketplace entry uses `"source": "./"` (single-plugin repo); confirm install from git once pushed.
4. Nice-to-haves: extension icons (none shipped), `new_conversation` for Gemini could use the "New chat" button instead of a new tab, long CodeMirror blocks in ChatGPT may be virtualised (only visible lines in `.cm-line`) — if a long code reply comes back truncated, scroll the block into view before reading or fall back to the Copy button via clipboard.
