"use strict";
(() => {
  // extension/src/popup/popup.ts
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    return el;
  }
  async function refresh() {
    const statusEl = $("status");
    const versionEl = $("version");
    const serverInput = $("serverUrl");
    const tabsList = $("tabsList");
    let res;
    try {
      res = await chrome.runtime.sendMessage({ from: "popup", action: "getStatus" });
    } catch {
      statusEl.className = "status err";
      statusEl.querySelector(".label").textContent = "Could not reach the extension background";
      return;
    }
    versionEl.textContent = `v${res.version}`;
    if (document.activeElement !== serverInput) serverInput.value = res.serverUrl;
    statusEl.className = `status ${res.connected ? "ok" : "err"}`;
    statusEl.querySelector(".label").textContent = res.connected ? `Connected to ${res.serverUrl}` : `Not connected \u2014 waiting for the Claude Code plugin at ${res.serverUrl}`;
    tabsList.innerHTML = "";
    if (!res.tabs.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No ChatGPT or Gemini tabs detected. Open chatgpt.com or gemini.google.com and sign in.";
      tabsList.appendChild(li);
    } else {
      for (const t of res.tabs) {
        const li = document.createElement("li");
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = `${t.title || t.url}${t.active ? "  \xB7  active" : ""}`;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${t.provider}  \xB7  tab ${t.tabId}`;
        li.appendChild(title);
        li.appendChild(meta);
        tabsList.appendChild(li);
      }
    }
  }
  $("saveBtn").addEventListener("click", async () => {
    const url = $("serverUrl").value.trim();
    await chrome.runtime.sendMessage({ from: "popup", action: "setServerUrl", url });
    await refresh();
  });
  $("refreshTabsBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ from: "popup", action: "refreshTabs" });
    await refresh();
  });
  void refresh();
  var interval = window.setInterval(refresh, 2e3);
  window.addEventListener("unload", () => window.clearInterval(interval));
})();
