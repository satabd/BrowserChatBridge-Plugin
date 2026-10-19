import type { ConversationTurn, ReturnFormat, TurnCounts } from "../../../../shared/protocol.js";
import type { ProviderAdapter, SendOutcome } from "../adapter.js";
import { pressEnter, queryAllFirst, queryFirst, setTextInEditable, sortByDocumentOrder, waitForMutation } from "../dom.js";
import { makeCodeBlock, renderNode } from "../markdown.js";

/**
 * Gemini adapter. Derived against the live gemini.google.com DOM on 2026-10-13.
 *
 * Verified facts worth remembering:
 *  - Composer: <rich-textarea> wrapping a Quill editor
 *    div.ql-editor[role=textbox][contenteditable] (aria-label "Enter a prompt for Gemini").
 *  - Send: button[aria-label="Send message"]. Stop: button[aria-label="Stop response"]
 *    — but Stop is visible for well under a second, so it is NOT a usable gate.
 *  - Each exchange is div.conversation-container holding <user-query> and
 *    <model-response>. Reply markdown is message-content .markdown and carries
 *    aria-busy="true" plus `.pending` children while generating.
 *  - The reply only finalises (aria-busy→false, .pending removed) once the tab
 *    has painted. Background tabs stall forever, so the service worker
 *    activates the tab before asking.
 *  - Code blocks are <code-block> with a real <pre><code>; the language label
 *    lives in the block's header (.code-block-decoration).
 */
const SEL = {
  composer: [
    'rich-textarea div.ql-editor[contenteditable="true"][role="textbox"]',
    'div.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"][aria-label*="Gemini" i]',
    '[contenteditable="true"][role="textbox"]',
    "textarea",
  ],
  send: [
    'button[aria-label="Send message"]',
    "button.send-button",
    'button[aria-label*="Send" i]',
    'button[mattooltip*="Send" i]',
  ],
  stop: ['button[aria-label="Stop response"]', "button.stop-button", 'button[aria-label*="Stop" i]'],
  userTurn: ["user-query", ".user-query"],
  userText: [".query-text", ".user-query-container", "user-query-content"],
  assistantTurn: ["model-response", ".model-response"],
  assistantMarkdown: ["message-content .markdown", ".markdown-main-panel", "message-content", ".model-response-text"],
  busy: ['model-response .markdown[aria-busy="true"]', "model-response .pending", 'message-content [aria-busy="true"]'],
  codeBlock: ["code-block", "pre"],
  codeLang: [".code-block-decoration span", ".code-block-decoration", "[class*='code-block-decoration']"],
  exclude: "button, mat-icon, .sr-only, .cdk-visually-hidden, [class*='visually-hidden'], .response-footer, message-actions, sensitive-memories-banner, .code-block-decoration, hallucination-disclaimer, sources-list, .sources-list",
  scroll: [
    'infinite-scroller[data-test-id="chat-history-container"]',
    ".chat-history",
    "div.content-container",
    "chat-window",
  ],
} as const;

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;
  readonly scrollSelectors = SEL.scroll;

  findComposer(): HTMLElement | null {
    return queryFirst(SEL.composer, document, { visible: true }) ?? queryFirst(SEL.composer);
  }

  getTurnCounts(): TurnCounts {
    return { user: this.userTurns().length, assistant: this.assistantTurns().length };
  }

  async send(prompt: string): Promise<SendOutcome> {
    const input = this.findComposer();
    if (!input) return { ok: false, code: "input_not_found", message: "Gemini composer not found (is the page signed in and fully loaded?)" };

    setTextInEditable(input, prompt);
    const sendBtn = await waitForMutation(() => {
      const b = queryFirst<HTMLButtonElement>(SEL.send, document, { visible: true });
      return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
    }, 1500);
    if (sendBtn) { sendBtn.click(); return { ok: true, via: "button" }; }
    pressEnter(input);
    return { ok: true, via: "enter" };
  }

  isGenerating(): boolean {
    if (queryFirst(SEL.stop, document, { visible: true })) return true;
    const turns = this.assistantTurns();
    const last = turns[turns.length - 1];
    if (!last) return false;
    for (const sel of SEL.busy) {
      try { if (last.matches(sel) || last.querySelector(sel)) return true; } catch { /* bad selector */ }
    }
    return false;
  }

  getLastResponseText(format: ReturnFormat): string {
    const turns = this.assistantTurns();
    const last = turns[turns.length - 1];
    return last ? this.renderAssistant(last, format) : "";
  }

  scrape(format: ReturnFormat): ConversationTurn[] {
    const tagged = [
      ...this.userTurns().map((el) => Object.assign(el, { __bcbRole: "user" as const })),
      ...this.assistantTurns().map((el) => Object.assign(el, { __bcbRole: "assistant" as const })),
    ];
    return sortByDocumentOrder(tagged).map((el, index) => {
      const role = (el as HTMLElement & { __bcbRole: "user" | "assistant" }).__bcbRole;
      const text = role === "user" ? this.renderUser(el, format) : this.renderAssistant(el, format);
      return { role, text, index };
    });
  }

  /* ------------------------------- internals ------------------------------ */

  private userTurns(): HTMLElement[] {
    return queryAllFirst<HTMLElement>(SEL.userTurn);
  }

  private assistantTurns(): HTMLElement[] {
    return queryAllFirst<HTMLElement>(SEL.assistantTurn);
  }

  private renderUser(el: HTMLElement, format: ReturnFormat): string {
    const src = queryFirst<HTMLElement>(SEL.userText, el) ?? el;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
    return renderNode(clone, format);
  }

  private renderAssistant(turn: HTMLElement, format: ReturnFormat): string {
    const roots = queryAllFirst<HTMLElement>(SEL.assistantMarkdown, turn);
    const sources = roots.length ? roots : [turn];
    const wrapper = document.createElement("div");
    for (const src of sources) wrapper.appendChild(this.prepareClone(src));
    return renderNode(wrapper, format);
  }

  private prepareClone(src: HTMLElement): HTMLElement {
    const clone = src.cloneNode(true) as HTMLElement;
    clone.querySelectorAll<HTMLElement>(SEL.codeBlock[0]).forEach((cb) => {
      const lang = queryFirst<HTMLElement>(SEL.codeLang, cb)?.textContent?.trim() ?? "";
      const code = cb.querySelector("pre code")?.textContent ?? cb.querySelector("pre")?.textContent ?? cb.textContent ?? "";
      cb.replaceWith(makeCodeBlock(lang, code.replace(/\n$/, "")));
    });
    clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
    return clone;
  }
}
