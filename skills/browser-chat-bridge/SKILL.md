---
name: browser-chat-bridge
description: Use ChatGPT or Gemini from Claude Code through the user's own signed-in browser tabs (tools chatgpt_ask, gemini_ask, list_tabs, get_last_response, scrape_conversation, health_check). Use when the user asks for a second opinion from ChatGPT/Gemini, wants to compare models, wants to continue or read a conversation they have open in ChatGPT/Gemini, or mentions "ask ChatGPT", "ask Gemini", "what does GPT think".
---

# BrowserChatBridge

The `bcb` MCP server drives the real chatgpt.com and gemini.google.com web apps in the user's browser through a small extension. There is no API key: replies come from whatever model and plan the user is signed into.

## Tools

| Tool | Use it for |
|---|---|
| `chatgpt_ask` / `gemini_ask` | Send a prompt, get the finished reply (markdown by default). |
| `list_tabs` | See which provider tabs are open and their ids. |
| `get_last_response` | Read the newest reply in a tab without sending anything (after a timeout, or when the user chatted manually). |
| `scrape_conversation` | Pull the whole visible thread from a tab. |
| `health_check` | First thing to call when something fails. |

## How to ask well

- **Default to continuing the user's open tab.** It carries their context. Pass `new_conversation: true` when the question is unrelated or you want a clean comparison.
- **Write the prompt for a human chat UI**: self-contained, with the code or text pasted inline. The other model cannot see this repo or this conversation.
- **Quote, don't paraphrase.** Return the reply to the user largely verbatim, labelled with the model ("ChatGPT said: …"). Add your own assessment separately.
- **Timeouts.** Default is 180 s. Reasoning-heavy prompts ("think hard", deep research) can take longer: pass `timeout_ms: 600000`. If a reply comes back marked `TIMED OUT`, call `get_last_response` on the same tab a bit later rather than re-sending.
- **One question at a time per tab.** The bridge serialises on the composer; parallel asks to the same provider should use different tabs or `new_conversation`.
- **Don't send secrets.** Prompts go to the user's ChatGPT/Gemini account like anything they type there.

## When it breaks

`health_check` tells you which layer failed:

- extension NOT connected → tell the user to reload the extension at chrome://extensions, or run `/bcb:setup` if it was never installed.
- no tabs → open one with `new_conversation: true`, or ask the user to sign in.
- `send_failed` / `input_not_found` → the page is probably showing a login wall, a modal, or a UI update changed the composer. Ask the user to look at the tab. Selector chains live in `extension/src/content/adapters/`.
- Gemini only finalises a reply when its tab is visible; the bridge brings the tab to the front automatically, so don't minimise the browser mid-ask.
