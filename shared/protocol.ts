/**
 * Wire protocol shared by the MCP server (Node) and the browser extension.
 * Both sides bundle this file, so keep it dependency-free.
 */

export const PROTOCOL_VERSION = "2.0.0";

export const DEFAULT_PORT = 17361;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
export const WS_EXTENSION_PATH = "/extension";

export const DEFAULT_TIMEOUT_MS = 180_000;

export const PROVIDERS = ["chatgpt", "gemini"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<Provider, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

export const PROVIDER_HOME_URL: Record<Provider, string> = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
};

export const PROVIDER_HOST_PATTERNS: Record<Provider, RegExp[]> = {
  chatgpt: [/^chatgpt\.com$/, /^chat\.openai\.com$/],
  gemini: [/^gemini\.google\.com$/],
};

export function providerForHost(hostname: string): Provider | null {
  for (const p of PROVIDERS) {
    if (PROVIDER_HOST_PATTERNS[p].some((re) => re.test(hostname))) return p;
  }
  return null;
}

export type ReturnFormat = "markdown" | "text" | "html";
export type ConversationRole = "user" | "assistant";

export interface TabDescriptor {
  tabId: number;
  provider: Provider;
  url: string;
  title: string;
  active: boolean;
  focused: boolean;
  /** ms epoch the tab was last foregrounded (Chrome 121+); 0 when unknown. */
  lastAccessed: number;
}

export interface TurnCounts {
  user: number;
  assistant: number;
}

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
  index: number;
}

export type ErrorCode =
  | "extension_disconnected"
  | "tab_not_found"
  | "no_tab"
  | "provider_not_supported"
  | "input_not_found"
  | "send_failed"
  | "timeout"
  | "internal_error"
  | "invalid_request";

/* ------------------------- request / response map ------------------------ */

export interface RequestMap {
  listTabs: {
    req: { provider?: Provider };
    res: { tabs: TabDescriptor[] };
  };
  openTab: {
    req: { provider: Provider };
    res: { tab: TabDescriptor };
  };
  ask: {
    req: {
      tabId: number;
      prompt: string;
      format: ReturnFormat;
      timeoutMs: number;
      /** Bring the tab to the front while waiting (Gemini needs paint to finish). */
      activate: boolean;
    };
    res: {
      text: string;
      format: ReturnFormat;
      turnCounts: TurnCounts;
      elapsedMs: number;
      /** false when the hard timeout fired and `text` is whatever was on screen. */
      completed: boolean;
      /** Human-readable caveat (e.g. tab stayed hidden so the reply could not finalise). */
      note?: string;
    };
  };
  getLastResponse: {
    req: { tabId: number; format: ReturnFormat };
    res: { text: string; format: ReturnFormat };
  };
  scrape: {
    req: { tabId: number; format: ReturnFormat };
    res: { turns: ConversationTurn[]; format: ReturnFormat };
  };
}

export type RequestType = keyof RequestMap;

export interface WsRequest<T extends RequestType = RequestType> {
  id: string;
  kind: "request";
  type: T;
  data: RequestMap[T]["req"];
}

export interface WsResponse<T extends RequestType = RequestType> {
  id: string;
  kind: "response";
  type: T;
  ok: boolean;
  data?: RequestMap[T]["res"];
  error?: { code: ErrorCode; message: string };
}

export interface HelloEventData {
  extensionVersion: string;
  protocolVersion: string;
  userAgent?: string;
}

export interface TabsChangedEventData {
  tabs: TabDescriptor[];
}

export type WsEvent =
  | { id: string; kind: "event"; type: "hello"; data: HelloEventData }
  | { id: string; kind: "event"; type: "tabsChanged"; data: TabsChangedEventData };

export type WsMessage = WsRequest | WsResponse | WsEvent;

/* ---------------------- background <-> content script --------------------- */

/**
 * The content script never waits on page timers: hidden tabs get their
 * setTimeout throttled to once a minute. Instead the service worker drives the
 * ask as  send → (observe every 500 ms) → read, using its own un-throttled clock.
 */
export type ContentCommand =
  | { action: "ping" }
  | { action: "send"; prompt: string }
  | { action: "observe" }
  | { action: "getLastResponse"; format: ReturnFormat }
  | { action: "scrape"; format: ReturnFormat };

export interface TurnSnapshot extends TurnCounts {
  /** Stable id of the newest assistant message ("" when the page exposes none). */
  lastAssistantKey: string;
  /** Normalised text of the newest user message (first 300 chars). */
  lastUserText: string;
}

export interface SendResult {
  /** Snapshot captured BEFORE the prompt was submitted. */
  baseline: TurnSnapshot;
  /** How the submit was triggered. */
  via: "button" | "enter";
}

export interface ObserveResult extends TurnSnapshot {
  generating: boolean;
  /** Plain-text length + cheap hash of the latest assistant reply, for stability checks. */
  textLength: number;
  textHash: number;
  /** Normalised composer contents (first 300 chars); non-empty after a send means it was rejected. */
  composerText: string;
  visibility: "visible" | "hidden";
}

export type ContentResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface PingResult {
  provider: Provider;
  url: string;
  title: string;
  turnCounts: TurnCounts;
  composerFound: boolean;
}
