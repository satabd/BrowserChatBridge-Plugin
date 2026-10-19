import type { ConversationTurn, Provider, ReturnFormat, TurnCounts } from "../../../shared/protocol.js";

export type SendOutcome =
  | { ok: true; via: "button" | "enter" }
  | { ok: false; code: "input_not_found"; message: string };

export interface ProviderAdapter {
  readonly provider: Provider;
  /** Scroll containers to keep pinned to the bottom while streaming. */
  readonly scrollSelectors: readonly string[];

  findComposer(): HTMLElement | null;
  getTurnCounts(): TurnCounts;
  /** Stable id of the newest assistant message, or "" if the page has no usable id. */
  getLastAssistantKey(): string;
  /** Plain text of the newest user message, or "". */
  getLastUserText(): string;
  /**
   * Insert the prompt and trigger submit. Must not wait on page timers beyond
   * a short MutationObserver-backed wait for the send control to appear; the
   * service worker confirms acceptance by watching turn counts.
   */
  send(prompt: string): Promise<SendOutcome>;
  /** True while the provider is visibly still producing the latest reply. */
  isGenerating(): boolean;
  getLastResponseText(format: ReturnFormat): string;
  scrape(format: ReturnFormat): ConversationTurn[];
}
