interface StatusResponse {
  serverUrl: string;
  version: string;
  protocolVersion: string;
  connected: boolean;
  tabs: Array<{ tabId: number; provider: string; title: string; url: string; active: boolean }>;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

async function refresh(): Promise<void> {
  const statusEl = $("status");
  const versionEl = $("version");
  const serverInput = $<HTMLInputElement>("serverUrl");
  const tabsList = $("tabsList");

  let res: StatusResponse;
  try {
    res = (await chrome.runtime.sendMessage({ from: "popup", action: "getStatus" })) as StatusResponse;
  } catch {
    statusEl.className = "status err";
    statusEl.querySelector(".label")!.textContent = "Could not reach the extension background";
    return;
  }

  versionEl.textContent = `v${res.version}`;
  if (document.activeElement !== serverInput) serverInput.value = res.serverUrl;
  statusEl.className = `status ${res.connected ? "ok" : "err"}`;
  statusEl.querySelector(".label")!.textContent = res.connected
    ? `Connected to ${res.serverUrl}`
    : `Not connected — waiting for the Claude Code plugin at ${res.serverUrl}`;

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
      title.textContent = `${t.title || t.url}${t.active ? "  ·  active" : ""}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${t.provider}  ·  tab ${t.tabId}`;
      li.appendChild(title);
      li.appendChild(meta);
      tabsList.appendChild(li);
    }
  }
}

$("saveBtn").addEventListener("click", async () => {
  const url = $<HTMLInputElement>("serverUrl").value.trim();
  await chrome.runtime.sendMessage({ from: "popup", action: "setServerUrl", url });
  await refresh();
});

$("refreshTabsBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ from: "popup", action: "refreshTabs" });
  await refresh();
});

void refresh();
const interval = window.setInterval(refresh, 2000);
window.addEventListener("unload", () => window.clearInterval(interval));
