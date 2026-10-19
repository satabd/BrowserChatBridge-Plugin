"use strict";
(() => {
  // shared/protocol.ts
  var PROTOCOL_VERSION = "2.0.0";
  var DEFAULT_PORT = 17361;
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  var WS_EXTENSION_PATH = "/extension";
  var PROVIDERS = ["chatgpt", "gemini"];
  var PROVIDER_HOME_URL = {
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/app"
  };
  var PROVIDER_HOST_PATTERNS = {
    chatgpt: [/^chatgpt\.com$/, /^chat\.openai\.com$/],
    gemini: [/^gemini\.google\.com$/]
  };
  function providerForHost(hostname) {
    for (const p of PROVIDERS) {
      if (PROVIDER_HOST_PATTERNS[p].some((re) => re.test(hostname))) return p;
    }
    return null;
  }

  // extension/src/background.ts
  var STORAGE_KEY = "bcb.serverUrl";
  var EXTENSION_VERSION = chrome.runtime.getManifest().version;
  var KEEPALIVE_ALARM = "bcb-keepalive";
  var MAX_RECONNECT_DELAY_MS = 5e3;
  var ws = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var lastTabsHash = "";
  async function getServerUrl() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? DEFAULT_BASE_URL;
  }
  async function setServerUrl(url) {
    await chrome.storage.local.set({ [STORAGE_KEY]: url });
  }
  function toWsUrl(httpBase) {
    return `${httpBase.replace(/\/$/, "").replace(/^http/i, "ws")}${WS_EXTENSION_PATH}`;
  }
  async function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const url = toWsUrl(await getServerUrl());
    let next;
    try {
      next = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = next;
    next.onopen = () => {
      reconnectAttempts = 0;
      sendHello();
      void broadcastTabs(true);
    };
    next.onmessage = (ev) => {
      void handleMessage(String(ev.data));
    };
    next.onclose = () => {
      if (ws === next) ws = null;
      scheduleReconnect();
    };
    next.onerror = () => {
    };
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(reconnectAttempts, 4));
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }
  function safeSend(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
    }
  }
  function sendHello() {
    safeSend({
      id: crypto.randomUUID(),
      kind: "event",
      type: "hello",
      data: { extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION, userAgent: navigator.userAgent }
    });
  }
  var handlers = {
    async listTabs(data) {
      return { tabs: await listProviderTabs(data.provider) };
    },
    async openTab(data) {
      const created = await chrome.tabs.create({ url: PROVIDER_HOME_URL[data.provider], active: true });
      if (!created.id) throw bcbError("internal_error", "Browser did not return a tab id");
      await waitForTabComplete(created.id, 2e4);
      await sleep(1500);
      const tabs = await listProviderTabs(data.provider);
      const tab = tabs.find((t) => t.tabId === created.id);
      if (!tab) throw bcbError("tab_not_found", "Opened tab vanished before it finished loading");
      return { tab };
    },
    async ask(data) {
      return runAsk(data);
    },
    async getLastResponse(data) {
      return callContent(data.tabId, { action: "getLastResponse", format: data.format });
    },
    async scrape(data) {
      return callContent(data.tabId, { action: "scrape", format: data.format });
    }
  };
  async function handleMessage(raw) {
    let msg;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.kind !== "request") return;
      msg = parsed;
    } catch {
      return;
    }
    const handler = handlers[msg.type];
    if (!handler) {
      respond(msg, { ok: false, code: "invalid_request", message: `Unknown request type ${String(msg.type)}` });
      return;
    }
    try {
      const data = await handler(msg.data);
      respond(msg, { ok: true, data });
    } catch (err) {
      respond(msg, {
        ok: false,
        code: err.code ?? "internal_error",
        message: err?.message ?? String(err)
      });
    }
  }
  function respond(req, r) {
    const env = r.ok ? { id: req.id, kind: "response", type: req.type, ok: true, data: r.data } : { id: req.id, kind: "response", type: req.type, ok: false, error: { code: r.code, message: r.message } };
    safeSend(env);
  }
  async function runAsk(data) {
    const startedAt = Date.now();
    const ceiling = startedAt + Math.max(5e3, data.timeoutMs);
    const p = await provider(data.tabId);
    if (data.activate) await activateTab(data.tabId, p);
    const sent = await callContent(data.tabId, { action: "send", prompt: data.prompt });
    const minUser = sent.baseline.user + 1;
    const minAssistant = sent.baseline.assistant + 1;
    await sleep(2e3);
    let prevHash = -1;
    let stable = 0;
    let ticks = 0;
    let completed = false;
    let warnedHidden = false;
    let note;
    while (Date.now() < ceiling) {
      const obs = await callContentFast(data.tabId, { action: "observe" });
      ticks++;
      if (obs.textHash === prevHash) stable++;
      else {
        stable = 0;
        prevHash = obs.textHash;
      }
      const elapsed = Date.now() - startedAt;
      if (obs.turnCounts.user < minUser && elapsed > 8e3) {
        throw bcbError("send_failed", `Prompt was inserted (${sent.via}) but no new user turn appeared after 8 s. The page may be showing a login wall, a modal, or a rate-limit notice.`);
      }
      if (obs.visibility === "hidden" && !warnedHidden && elapsed > 15e3) {
        warnedHidden = true;
        await activateTab(data.tabId, p, { focusWindow: true });
      }
      const hasNewTurn = obs.turnCounts.user >= minUser && obs.turnCounts.assistant >= minAssistant;
      const isStable = stable >= 5;
      if (hasNewTurn && !obs.generating && (obs.textLength > 0 ? isStable : isStable && ticks > 20)) {
        completed = true;
        break;
      }
      if (obs.visibility === "hidden" && hasNewTurn && obs.textLength > 0 && stable >= 40) {
        note = "The browser tab never became visible, so the reply could not be confirmed as final. Text may be partial; bring the browser window to the front and use get_last_response to re-read.";
        break;
      }
      await sleep(500);
    }
    const read = await callContent(data.tabId, { action: "getLastResponse", format: data.format });
    const final = await callContentFast(data.tabId, { action: "observe" }).catch(() => null);
    return {
      text: read.text,
      format: data.format,
      turnCounts: final?.turnCounts ?? { user: minUser, assistant: minAssistant },
      elapsedMs: Date.now() - startedAt,
      completed,
      note
    };
  }
  var tabProviderCache = /* @__PURE__ */ new Map();
  async function provider(tabId) {
    const cached = tabProviderCache.get(tabId);
    if (cached) return cached;
    try {
      const t = await chrome.tabs.get(tabId);
      const p = t.url ? providerForHost(new URL(t.url).hostname) : null;
      if (p) tabProviderCache.set(tabId, p);
      return p ?? void 0;
    } catch {
      return void 0;
    }
  }
  async function listProviderTabs(provider2) {
    const tabs = await chrome.tabs.query({});
    const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
    const out = [];
    for (const t of tabs) {
      if (!t.id || !t.url) continue;
      let host;
      try {
        host = new URL(t.url).hostname;
      } catch {
        continue;
      }
      const matched = providerForHost(host);
      if (!matched || provider2 && matched !== provider2) continue;
      tabProviderCache.set(t.id, matched);
      out.push({
        tabId: t.id,
        provider: matched,
        url: t.url,
        title: t.title ?? "",
        active: !!t.active,
        focused: !!(focusedWindow && t.windowId === focusedWindow.id)
      });
    }
    return out;
  }
  async function activateTab(tabId, p, opts = {}) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId !== void 0) {
        const win = await chrome.windows.get(tab.windowId).catch(() => null);
        const wantFocus = opts.focusWindow || p === "gemini";
        if (win?.state === "minimized") await chrome.windows.update(tab.windowId, { state: "normal", focused: wantFocus });
        else if (wantFocus && !win?.focused) await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/No tab with id/i.test(msg)) throw bcbError("tab_not_found", `Tab ${tabId} no longer exists`);
    }
  }
  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      };
      const listener = (id, info) => {
        if (id === tabId && info.status === "complete") done();
      };
      const timer = setTimeout(done, timeoutMs);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then((t) => {
        if (t.status === "complete") done();
      }).catch(done);
    });
  }
  async function broadcastTabs(force = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const tabs = await listProviderTabs();
    const hash = JSON.stringify(tabs.map((t) => [t.tabId, t.url, t.title, t.active, t.focused]));
    if (!force && hash === lastTabsHash) return;
    lastTabsHash = hash;
    safeSend({ id: crypto.randomUUID(), kind: "event", type: "tabsChanged", data: { tabs } });
  }
  var NON_RETRYABLE = /* @__PURE__ */ new Set(["provider_not_supported", "input_not_found", "send_failed", "timeout"]);
  async function callContent(tabId, cmd, maxRetries = 3) {
    await safeInject(tabId);
    let lastErr = { code: "internal_error", message: "no attempts made" };
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, cmd);
        if (res && res.ok) return res.data;
        if (res && !res.ok) {
          lastErr = res.error;
          if (NON_RETRYABLE.has(res.error.code)) throw bcbError(res.error.code, res.error.message);
        } else {
          lastErr = { code: "internal_error", message: "no response from content script" };
        }
      } catch (err) {
        const code = err.code;
        if (code && NON_RETRYABLE.has(code)) throw err;
        lastErr = { code: code ?? "internal_error", message: err?.message ?? String(err) };
      }
      await sleep(1e3);
      await safeInject(tabId);
    }
    throw bcbError(lastErr.code, lastErr.message);
  }
  async function callContentFast(tabId, cmd) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, cmd);
        if (res && res.ok) return res.data;
        if (res && !res.ok) throw bcbError(res.error.code, res.error.message);
      } catch (err) {
        const code = err.code;
        if (code && NON_RETRYABLE.has(code)) throw err;
        if (attempt === 1) throw err;
      }
      await safeInject(tabId);
    }
    throw bcbError("internal_error", "unreachable");
  }
  async function safeInject(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/No tab with id/i.test(msg)) throw bcbError("tab_not_found", `Tab ${tabId} no longer exists`);
      if (/Cannot access|chrome-extension|chrome:\/\//i.test(msg)) {
        throw bcbError("provider_not_supported", `Cannot inject into tab ${tabId}: ${msg}`);
      }
      throw err;
    }
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.from !== "popup") return false;
    if (msg.action === "getStatus") {
      (async () => {
        sendResponse({
          serverUrl: await getServerUrl(),
          version: EXTENSION_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          connected: ws?.readyState === WebSocket.OPEN,
          tabs: await listProviderTabs()
        });
      })().catch((err) => sendResponse({ error: String(err?.message ?? err) }));
      return true;
    }
    if (msg.action === "setServerUrl") {
      (async () => {
        await setServerUrl(String(msg.url ?? "").trim() || DEFAULT_BASE_URL);
        try {
          ws?.close();
        } catch {
        }
        reconnectAttempts = 0;
        await connect();
        sendResponse({ ok: true });
      })().catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }
    if (msg.action === "refreshTabs") {
      (async () => {
        await broadcastTabs(true);
        sendResponse({ tabs: await listProviderTabs() });
      })();
      return true;
    }
    return false;
  });
  chrome.tabs.onUpdated.addListener(() => {
    void broadcastTabs();
  });
  chrome.tabs.onRemoved.addListener(() => {
    void broadcastTabs();
  });
  chrome.tabs.onActivated.addListener(() => {
    void broadcastTabs();
  });
  chrome.windows.onFocusChanged.addListener(() => {
    void broadcastTabs();
  });
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEPALIVE_ALARM) return;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) void connect();
  });
  chrome.runtime.onStartup.addListener(() => {
    void connect();
  });
  chrome.runtime.onInstalled.addListener(() => {
    void connect();
  });
  void connect();
  function bcbError(code, message) {
    return Object.assign(new Error(message), { code });
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
