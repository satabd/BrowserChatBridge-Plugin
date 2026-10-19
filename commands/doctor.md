---
description: Diagnose the BrowserChatBridge connection (extension, bridge process, provider tabs)
---

Diagnose BrowserChatBridge and fix what you can.

1. Call the `health_check` tool.
2. Interpret the result for the user:
   - `extension: NOT connected` → the browser extension is not loaded or its service worker is asleep. Tell them to open chrome://extensions (edge://extensions on Edge), confirm "BrowserChatBridge" is present and enabled, and click its reload button. If it is not present at all, run `/bcb:setup`. Wait 5 seconds and call `health_check` again.
   - `bridge: follower` → another Claude Code session owns the bridge; that is normal and works.
   - `tabs: none` → ask them to open chatgpt.com and/or gemini.google.com and sign in, or offer to ask with `new_conversation=true`, which opens a tab automatically.
3. If everything is connected, run a smoke test only if the user agrees: `chatgpt_ask` or `gemini_ask` with the prompt "Reply with the single word OK." and `new_conversation=true`.
4. Report in a few lines: what is connected, what is not, and the one thing to do next.
