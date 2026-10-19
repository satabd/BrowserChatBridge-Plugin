import {
  providerForHost,
  type ContentCommand,
  type ContentResponse,
  type ObserveResult,
  type PingResult,
  type RequestMap,
  type SendResult,
} from "../../../shared/protocol.js";
import type { ProviderAdapter } from "./adapter.js";
import { ChatGPTAdapter } from "./adapters/chatgpt.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { hashString, scrollToBottom } from "./dom.js";

/**
 * Content script. Injected on demand by the service worker via
 * chrome.scripting.executeScript, possibly many times per page — the window
 * flag keeps the message listener bound exactly once.
 *
 * Deliberately timer-free: every command answers from the current DOM state.
 * The service worker owns the clock (see background.ts → runAsk), because a
 * hidden tab's setTimeout can be throttled to one wake-up per minute.
 */

declare global {
  interface Window { __BCB_CONTENT_INSTALLED__?: boolean; }
}

const adapter: ProviderAdapter | null = pickAdapter(window.location.hostname);

if (!window.__BCB_CONTENT_INSTALLED__) {
  window.__BCB_CONTENT_INSTALLED__ = true;
  chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, sendResponse: (r: ContentResponse) => void) => {
    handleCommand(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: { code: "internal_error", message: String((err as Error)?.message ?? err) } }));
    return true;
  });
}

async function handleCommand(cmd: ContentCommand): Promise<ContentResponse> {
  if (!adapter) {
    return { ok: false, error: { code: "provider_not_supported", message: `No adapter for ${window.location.hostname}` } };
  }

  switch (cmd.action) {
    case "ping": {
      const data: PingResult = {
        provider: adapter.provider,
        url: window.location.href,
        title: document.title,
        turnCounts: adapter.getTurnCounts(),
        composerFound: !!adapter.findComposer(),
      };
      return { ok: true, data };
    }

    case "send": {
      const baseline = adapter.getTurnCounts();
      const outcome = await adapter.send(cmd.prompt);
      if (!outcome.ok) return { ok: false, error: { code: outcome.code, message: outcome.message } };
      const data: SendResult = { baseline, via: outcome.via };
      return { ok: true, data };
    }

    case "observe": {
      scrollToBottom(adapter.scrollSelectors); // ChatGPT virtualises long replies; unscrolled reads go stale.
      const text = adapter.getLastResponseText("text");
      const data: ObserveResult = {
        turnCounts: adapter.getTurnCounts(),
        generating: adapter.isGenerating(),
        textLength: text.length,
        textHash: hashString(text),
        visibility: document.visibilityState === "visible" ? "visible" : "hidden",
      };
      return { ok: true, data };
    }

    case "getLastResponse": {
      const data: RequestMap["getLastResponse"]["res"] = { text: adapter.getLastResponseText(cmd.format), format: cmd.format };
      return { ok: true, data };
    }

    case "scrape": {
      const data: RequestMap["scrape"]["res"] = { turns: adapter.scrape(cmd.format), format: cmd.format };
      return { ok: true, data };
    }
  }
}

function pickAdapter(hostname: string): ProviderAdapter | null {
  switch (providerForHost(hostname)) {
    case "chatgpt": return new ChatGPTAdapter();
    case "gemini": return new GeminiAdapter();
    default: return null;
  }
}
