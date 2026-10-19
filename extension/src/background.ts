import {
  DEFAULT_BASE_URL,
  PROTOCOL_VERSION,
  PROVIDER_HOME_URL,
  WS_EXTENSION_PATH,
  providerForHost,
  type ContentCommand,
  type ContentResponse,
  type ErrorCode,
  type ObserveResult,
  type Provider,
  type RequestMap,
  type RequestType,
  type SendResult,
  type TabDescriptor,
  type WsEvent,
  type WsRequest,
  type WsResponse,
} from "../../shared/protocol.js";

/**
 * MV3 service worker. Holds the WebSocket to the plugin's MCP server
 * (extension is the client so it owns reconnect), lists provider tabs,
 * and relays commands to the on-demand content script.
 */

const STORAGE_KEY = "bcb.serverUrl";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const KEEPALIVE_ALARM = "bcb-keepalive";
/** Loopback connects are cheap; a short cap keeps "plugin just started" latency low. */
const MAX_RECONNECT_DELAY_MS = 5_000;

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastTabsHash = "";

/* ----------------------------- WebSocket I/O ----------------------------- */

async function getServerUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as string | undefined) ?? DEFAULT_BASE_URL;
}

async function setServerUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: url });
}

function toWsUrl(httpBase: string): string {
  return `${httpBase.replace(/\/$/, "").replace(/^http/i, "ws")}${WS_EXTENSION_PATH}`;
}

async function connect(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = toWsUrl(await getServerUrl());
  let next: WebSocket;
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
  next.onmessage = (ev) => { void handleMessage(String(ev.data)); };
  next.onclose = () => {
    if (ws === next) ws = null;
    scheduleReconnect();
  };
  next.onerror = () => { /* close follows */ };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(reconnectAttempts, 4));
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

function safeSend(payload: WsResponse | WsEvent): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* reconnect will follow */ }
}

function sendHello(): void {
  safeSend({
    id: crypto.randomUUID(),
    kind: "event",
    type: "hello",
    data: { extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION, userAgent: navigator.userAgent },
  });
}

/* ------------------------------ dispatch -------------------------------- */

type Handlers = { [K in RequestType]: (data: RequestMap[K]["req"]) => Promise<RequestMap[K]["res"]> };

const handlers: Handlers = {
  async listTabs(data) {
    return { tabs: await listProviderTabs(data.provider) };
  },

  async openTab(data) {
    const created = await chrome.tabs.create({ url: PROVIDER_HOME_URL[data.provider], active: true });
    if (!created.id) throw bcbError("internal_error", "Browser did not return a tab id");
    await waitForTabComplete(created.id, 20_000);
    await sleep(1500); // let the SPA mount its composer
    const tabs = await listProviderTabs(data.provider);
    const tab = tabs.find((t) => t.tabId === created.id);
    if (!tab) throw bcbError("tab_not_found", "Opened tab vanished before it finished loading");
    return { tab };
  },

  async ask(data) {
    return runAsk(data);
  },

  async getLastResponse(data) {
    return callContent<RequestMap["getLastResponse"]["res"]>(data.tabId, { action: "getLastResponse", format: data.format });
  },

  async scrape(data) {
    return callContent<RequestMap["scrape"]["res"]>(data.tabId, { action: "scrape", format: data.format });
  },
};

async function handleMessage(raw: string): Promise<void> {
  let msg: WsRequest;
  try {
    const parsed = JSON.parse(raw) as { kind?: string };
    if (parsed?.kind !== "request") return;
    msg = parsed as WsRequest;
  } catch {
    return;
  }

  const handler = handlers[msg.type] as ((d: unknown) => Promise<unknown>) | undefined;
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
      code: ((err as { code?: ErrorCode }).code ?? "internal_error"),
      message: (err as Error)?.message ?? String(err),
    });
  }
}

function respond(req: WsRequest, r: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string }): void {
  const env: WsResponse = r.ok
    ? ({ id: req.id, kind: "response", type: req.type, ok: true, data: r.data } as WsResponse)
    : { id: req.id, kind: "response", type: req.type, ok: false, error: { code: r.code, message: r.message } };
  safeSend(env);
}

/* -------------------------------- ask loop ------------------------------- */

/**
 * Hybrid completion gate (DualMind lineage), driven from the service worker so
 * page timer throttling can't stall it:
 *   1. activate the tab (Gemini only finalises a reply once it has painted);
 *   2. `send` → baseline turn counts;
 *   3. 2 s settle, then `observe` every 500 ms;
 *   4. done when: not generating AND user+assistant counts passed the baseline
 *      AND the reply text unchanged for 5 ticks (2.5 s). Empty replies need 10 s.
 *   5. if no new user turn within 8 s → send_failed; hard ceiling → completed:false.
 */
async function runAsk(data: RequestMap["ask"]["req"]): Promise<RequestMap["ask"]["res"]> {
  const startedAt = Date.now();
  const ceiling = startedAt + Math.max(5_000, data.timeoutMs);
  const p = await provider(data.tabId);
  if (data.activate) await activateTab(data.tabId, p);

  const sent = await callContent<SendResult>(data.tabId, { action: "send", prompt: data.prompt });
  const minUser = sent.baseline.user + 1;
  const minAssistant = sent.baseline.assistant + 1;

  await sleep(2000);
  let prevHash = -1;
  let stable = 0;
  let ticks = 0;
  let completed = false;
  let warnedHidden = false;
  let note: string | undefined;

  while (Date.now() < ceiling) {
    const obs = await callContentFast<ObserveResult>(data.tabId, { action: "observe" });
    ticks++;
    if (obs.textHash === prevHash) stable++; else { stable = 0; prevHash = obs.textHash; }

    const elapsed = Date.now() - startedAt;
    if (obs.turnCounts.user < minUser && elapsed > 8_000) {
      throw bcbError("send_failed", `Prompt was inserted (${sent.via}) but no new user turn appeared after 8 s. The page may be showing a login wall, a modal, or a rate-limit notice.`);
    }
    if (obs.visibility === "hidden" && !warnedHidden && elapsed > 15_000) {
      warnedHidden = true;
      // One more nudge: a minimised or fully covered window never paints.
      await activateTab(data.tabId, p, { focusWindow: true });
    }

    const hasNewTurn = obs.turnCounts.user >= minUser && obs.turnCounts.assistant >= minAssistant;
    const isStable = stable >= 5;
    if (hasNewTurn && !obs.generating && (obs.textLength > 0 ? isStable : isStable && ticks > 20)) {
      completed = true;
      break;
    }
    // A page that never becomes visible (other virtual desktop, remote session…) can keep
    // Gemini's "pending" markers forever. Don't burn the whole timeout: 20 s of unchanged text is our answer.
    if (obs.visibility === "hidden" && hasNewTurn && obs.textLength > 0 && stable >= 40) {
      note = "The browser tab never became visible, so the reply could not be confirmed as final. Text may be partial; bring the browser window to the front and use get_last_response to re-read.";
      break;
    }
    await sleep(500);
  }

  const read = await callContent<RequestMap["getLastResponse"]["res"]>(data.tabId, { action: "getLastResponse", format: data.format });
  const final = await callContentFast<ObserveResult>(data.tabId, { action: "observe" }).catch(() => null);
  return {
    text: read.text,
    format: data.format,
    turnCounts: final?.turnCounts ?? { user: minUser, assistant: minAssistant },
    elapsedMs: Date.now() - startedAt,
    completed,
    note,
  };
}

const tabProviderCache = new Map<number, Provider>();
async function provider(tabId: number): Promise<Provider | undefined> {
  const cached = tabProviderCache.get(tabId);
  if (cached) return cached;
  try {
    const t = await chrome.tabs.get(tabId);
    const p = t.url ? providerForHost(new URL(t.url).hostname) : null;
    if (p) tabProviderCache.set(tabId, p);
    return p ?? undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------ tab plumbing ----------------------------- */

async function listProviderTabs(provider?: Provider): Promise<TabDescriptor[]> {
  const tabs = await chrome.tabs.query({});
  const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
  const out: TabDescriptor[] = [];
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    let host: string;
    try { host = new URL(t.url).hostname; } catch { continue; }
    const matched = providerForHost(host);
    if (!matched || (provider && matched !== provider)) continue;
    tabProviderCache.set(t.id, matched);
    out.push({
      tabId: t.id,
      provider: matched,
      url: t.url,
      title: t.title ?? "",
      active: !!t.active,
      focused: !!(focusedWindow && t.windowId === focusedWindow.id),
    });
  }
  return out;
}

/**
 * Make the tab the active one in its window. Gemini additionally needs the
 * window to actually paint (its reply reveal runs on animation frames), and a
 * window that is minimised or fully covered by another app never does, so for
 * Gemini we also bring the window to the front.
 */
async function activateTab(tabId: number, p: Provider | undefined, opts: { focusWindow?: boolean } = {}): Promise<void> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      const wantFocus = opts.focusWindow || p === "gemini";
      if (win?.state === "minimized") await chrome.windows.update(tab.windowId, { state: "normal", focused: wantFocus });
      else if (wantFocus && !win?.focused) await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (/No tab with id/i.test(msg)) throw bcbError("tab_not_found", `Tab ${tabId} no longer exists`);
    // Non-fatal otherwise: the content script will still try.
  }
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") done(); }).catch(done);
  });
}

async function broadcastTabs(force = false): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const tabs = await listProviderTabs();
  const hash = JSON.stringify(tabs.map((t) => [t.tabId, t.url, t.title, t.active, t.focused]));
  if (!force && hash === lastTabsHash) return;
  lastTabsHash = hash;
  safeSend({ id: crypto.randomUUID(), kind: "event", type: "tabsChanged", data: { tabs } });
}

/* ----------------------------- content script ---------------------------- */

const NON_RETRYABLE: ReadonlySet<string> = new Set(["provider_not_supported", "input_not_found", "send_failed", "timeout"]);

async function callContent<T>(tabId: number, cmd: ContentCommand, maxRetries = 3): Promise<T> {
  await safeInject(tabId);
  let lastErr: { code: ErrorCode; message: string } = { code: "internal_error", message: "no attempts made" };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, cmd)) as ContentResponse<T> | undefined;
      if (res && res.ok) return res.data;
      if (res && !res.ok) {
        lastErr = res.error;
        if (NON_RETRYABLE.has(res.error.code)) throw bcbError(res.error.code, res.error.message);
      } else {
        lastErr = { code: "internal_error", message: "no response from content script" };
      }
    } catch (err) {
      const code = (err as { code?: ErrorCode }).code;
      if (code && NON_RETRYABLE.has(code)) throw err;
      lastErr = { code: code ?? "internal_error", message: (err as Error)?.message ?? String(err) };
    }
    await sleep(1000);
    await safeInject(tabId);
  }
  throw bcbError(lastErr.code, lastErr.message);
}

/** Hot-path variant for the observe loop: no injection, one retry with re-injection. */
async function callContentFast<T>(tabId: number, cmd: ContentCommand): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, cmd)) as ContentResponse<T> | undefined;
      if (res && res.ok) return res.data;
      if (res && !res.ok) throw bcbError(res.error.code, res.error.message);
    } catch (err) {
      const code = (err as { code?: ErrorCode }).code;
      if (code && NON_RETRYABLE.has(code)) throw err;
      if (attempt === 1) throw err;
    }
    await safeInject(tabId); // page navigated or script lost; re-arm once
  }
  throw bcbError("internal_error", "unreachable");
}

async function safeInject(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (/No tab with id/i.test(msg)) throw bcbError("tab_not_found", `Tab ${tabId} no longer exists`);
    if (/Cannot access|chrome-extension|chrome:\/\//i.test(msg)) {
      throw bcbError("provider_not_supported", `Cannot inject into tab ${tabId}: ${msg}`);
    }
    throw err;
  }
}

/* --------------------------- popup channel & boot ------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.from !== "popup") return false;

  if (msg.action === "getStatus") {
    (async () => {
      sendResponse({
        serverUrl: await getServerUrl(),
        version: EXTENSION_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        connected: ws?.readyState === WebSocket.OPEN,
        tabs: await listProviderTabs(),
      });
    })().catch((err) => sendResponse({ error: String((err as Error)?.message ?? err) }));
    return true;
  }

  if (msg.action === "setServerUrl") {
    (async () => {
      await setServerUrl(String(msg.url ?? "").trim() || DEFAULT_BASE_URL);
      try { ws?.close(); } catch { /* noop */ }
      reconnectAttempts = 0;
      await connect();
      sendResponse({ ok: true });
    })().catch((err) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }));
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

chrome.tabs.onUpdated.addListener(() => { void broadcastTabs(); });
chrome.tabs.onRemoved.addListener(() => { void broadcastTabs(); });
chrome.tabs.onActivated.addListener(() => { void broadcastTabs(); });
chrome.windows.onFocusChanged.addListener(() => { void broadcastTabs(); });

// MV3 workers get suspended; the alarm both keeps us warm and re-dials after a nap.
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) void connect();
});

chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.runtime.onInstalled.addListener(() => { void connect(); });
void connect();

/* --------------------------------- utils --------------------------------- */

function bcbError(code: ErrorCode, message: string): Error & { code: ErrorCode } {
  return Object.assign(new Error(message), { code });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
