# BrowserChatBridge-Plugin — session handoff

Last updated: 2026-10-20. Supersedes the handoff in the old `BrowserChatBridge` repo (v0.1, library design, abandoned).

## TL;DR

**v0.2.1 is shipped, public, installed, and verified end to end against the real browser.** Both `chatgpt_ask` and `gemini_ask` return correct replies through the installed plugin and the loaded extension. There is no known blocker. Remaining work is polish.

- Repo: https://github.com/satabd/BrowserChatBridge-Plugin (public, `main`, 3 commits)
- Installed via marketplace `bcb`, plugin `bcb@bcb` v0.2.1, user scope
- Extension loaded unpacked from `C:\Users\satab\.bcb\extension` (v0.2.1)
- User's browser is **Edge**

## Verification status

| Layer | Status |
|---|---|
| Plugin manifests (`plugin.json`, `marketplace.json`, `.mcp.json`) | `claude plugin validate` passes; install from GitHub works |
| MCP server: tools, stdio, leader/follower election | Node e2e (`tests/`) passes on port 17399; real multi-session follower verified |
| ChatGPT: send, completion gate, markdown (lists, fenced code w/ language, tables) | Real round trips through the installed plugin, incl. on a long Arabic thread that Edge had put to sleep |
| Gemini: send, completion gate, markdown | Real round trips, incl. `new_conversation=true` (5.6 s) |
| Extension background: WS client, tab activation, worker-driven ask loop | Running live as v0.2.1 |

## Fixed since the previous handoff

- **False `send_failed` on sleeping tabs.** Edge discards inactive tabs; injecting the content script wakes and reloads them, so the user bubble can take >8 s to appear. v0.2.1 accepts a send if any of: new user bubble, newest user bubble text matches the prompt, composer emptied. Rejection only after 30 s with the prompt still in the composer.
- **Counts vs. virtualisation.** Long ChatGPT threads virtualise the message list, so turn counts can stay flat. Both adapters now expose a stable id for the newest assistant message (`data-chatgpt-selection-message-id` / Gemini `message-content` id); counts are a fallback.
- **Auto-pick chose the oldest tab.** Extension now reports `lastAccessed` and sorts MRU-first; the server prefers remembered → active+focused → active → MRU.
- **Test harness hijacked the real bridge.** The fake extension used to connect to 17361 and displace the user's real extension socket. Tests now use port 17399.

## Things learned (do not re-derive)

- **ChatGPT DOM (2026-10-13):** composer `form div.ProseMirror[role=textbox]` (no id); send `form button[type=submit][aria-label=Send]` exists only while composer has text; stop `form button[aria-label=Stop]`; user text `[data-user-message-bubble]`; assistant turn = parent of sr-only `h4[data-conversation-role=assistant]`, markdown in `[data-markdown-text-style=assistant-message]`; code blocks are CodeMirror (`[data-code-block] .cm-content[data-language]`, lines `.cm-line`), no `<pre>`; `[data-talvt-turn-state]` is briefly `complete` right after send before going `in_progress`.
- **Gemini DOM:** composer `rich-textarea div.ql-editor[role=textbox]`; send `button[aria-label="Send message"]`; stop `button[aria-label="Stop response"]` lives <1 s (useless as a gate); exchange = `div.conversation-container` > `user-query` + `model-response`; reply `message-content .markdown[aria-busy]` with `.pending` children while streaming; `code-block` has real `pre > code` and language in `.code-block-decoration`.
- **Gemini only finalises when the tab paints.** Hidden tab ⇒ `aria-busy` stays true forever. `activateTab` focuses the window for Gemini; a 20 s stable-text bail-out returns the text with a `note` if the tab never becomes visible.
- **Hidden tabs throttle `setTimeout` to 1/min after 5 min.** Never run wait loops in the content script; the service worker owns the clock (`runAsk` in `background.ts`). The content script is timer-free and uses MutationObserver to wait for the send button.
- **Leader election is per process, not per version.** A stale leader from an older session keeps serving until it exits; followers proxy to it. "Restart to apply" means restarting the session that holds 17361.
- **Never load the extension from the plugin cache** (`~/.claude/plugins/cache/bcb/bcb/<ver>/extension/dist`): that folder vanishes on update. `/bcb:setup` stages to `~/.bcb/extension` (or `${CLAUDE_PLUGIN_DATA}/extension`) for exactly this reason.
- GitHub pushes from this machine need the noreply author email (`1293086+satabd@users.noreply.github.com`); the account blocks pushes that expose the real address.

## How to work on it

```bash
npm install && npm run build && npm run typecheck
node tests/fake-extension.mjs &      # port 17399, never touches a real bridge
node tests/mcp-client.mjs --two      # leader + follower e2e
```

Release: bump the version in `.claude-plugin/plugin.json`, `package.json`, `extension/public/manifest.json`, and `VERSION` in `mcp-server/src/index.ts`; `npm run build`; commit both `dist/` folders; push; then `claude plugin marketplace update bcb && claude plugin update bcb@bcb`. Users re-stage the extension with `/bcb:setup` (or `node scripts/setup.mjs --no-open`) and click reload at `edge://extensions`.

## Next steps (all optional)

1. Extension icons: none shipped; Chrome shows a grey placeholder.
2. `new_conversation` for Gemini could click "New chat" in the existing tab instead of opening a new tab.
3. Long CodeMirror blocks in ChatGPT may be virtualised (only visible lines in `.cm-line`). If a long code reply comes back truncated, scroll the block into view before reading, or fall back to the Copy button via clipboard.
4. `scripts/setup.mjs` prefers Chrome when both Chrome and Edge are installed; consider detecting the default browser.
5. Consider a `.gitattributes` with `* text=auto eol=lf` to silence CRLF warnings on Windows.
