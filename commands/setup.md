---
description: Install the BrowserChatBridge browser extension (one-time) and verify ChatGPT/Gemini are reachable
argument-hint: "[--browser chrome|msedge|brave]"
allowed-tools: Bash(node *)
---

Set up BrowserChatBridge for this machine. Do these steps in order and report plainly.

1. Run the setup script (it stages the extension in a stable folder and opens the browser's extensions page plus chatgpt.com and gemini.google.com):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --data "${CLAUDE_PLUGIN_DATA}" --json $ARGUMENTS
```

2. Show the user the exact folder path the script printed and the three manual steps: enable Developer mode, click "Load unpacked", pick that folder. If the script says the extension is already installed, tell them to click the extension's reload button instead.

3. Tell the user to say "done" when the extension is loaded. Then call the `health_check` tool. If `extensionConnected` is false, wait a few seconds and call it again (up to 3 tries) before concluding anything.

4. When connected, call `list_tabs`. If no ChatGPT or Gemini tab is listed, remind them to sign in on the tabs that were opened.

5. Finish with a one-line confirmation and an example: "Try: ask ChatGPT what it thinks of this function."

Notes: the extension only talks to 127.0.0.1 on port 17361. Nothing is sent anywhere except the user's own ChatGPT/Gemini sessions. Both Chrome and Edge work (Edge shows edge://extensions).
