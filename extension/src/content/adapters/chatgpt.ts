import type { ConversationTurn, ReturnFormat, TurnCounts } from "../../../../shared/protocol.js";
import type { ProviderAdapter, SendOutcome } from "../adapter.js";
import { isVisible, pressEnter, queryAllFirst, queryFirst, setTextInEditable, sortByDocumentOrder, waitForMutation } from "../dom.js";
import { makeCodeBlock, renderNode } from "../markdown.js";

/**
 * ChatGPT adapter. Selector chains were re-derived against the live DOM on
 * 2026-10-13; the first entry in each chain is what the page used that day,
 * the rest are historical shapes kept as fallbacks.
 *
 * Verified facts worth remembering:
 *  - Composer: div.ProseMirror[role=textbox] (aria-label "Work with ChatGPT"),
 *    inside a <form>. `#prompt-textarea` and data-testid="send-button" are gone.
 *  - Send button only exists while the composer has text; it's
 *    form button[type=submit][aria-label=Send]. Stop is form button[aria-label=Stop].
 *  - Messages: user text is [data-user-message-bubble]; each assistant message
 *    has an sr-only h4[data-conversation-role=assistant] whose parent wraps the
 *    reply, which renders in [data-markdown-text-style=assistant-message].
 *  - Code blocks are CodeMirror editors ([data-code-block] .cm-content
 *    [data-language]) — no <pre><code>. Lines are .cm-line.
 *  - [data-talvt-turn-state] flips complete → in_progress → complete, but it is
 *    briefly "complete" right after send, so it's a gate, not the sole signal.
 */
const SEL = {
  composer: [
    'form div.ProseMirror[contenteditable="true"][role="textbox"]',
    "#prompt-textarea",
    'form [contenteditable="true"][role="textbox"]',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    "form textarea",
  ],
  send: [
    'form button[type="submit"][aria-label="Send"]',
    'button[data-testid="send-button"]',
    'form button[aria-label*="Send" i]',
    'button[aria-label*="Send prompt" i]',
  ],
  stop: [
    'form button[aria-label="Stop"]',
    'button[data-testid="stop-button"]',
    'form button[aria-label*="Stop" i]',
    'button[aria-label*="Stop streaming" i]',
  ],
  userTurn: ['[data-user-message-bubble]', '[data-message-author-role="user"]'],
  assistantHeading: ['h4[data-conversation-role="assistant"]', '[data-conversation-role="assistant"]'],
  assistantTurnLegacy: ['[data-message-author-role="assistant"]'],
  assistantMarkdown: ['[data-markdown-text-style="assistant-message"]', ".markdown"],
  turnState: ["[data-talvt-turn-state]"],
  codeBlock: ["[data-code-block]", "pre"],
  exclude: '[data-markdown-copy="exclude"], button, .sr-only, h4, [role="toolbar"], .action-buttons, .copy-button',
  scroll: [
    '[role="region"][aria-label="Conversation"]',
    ".thread-scroll-container",
    "main .overflow-y-auto",
    "main",
  ],
} as const;

export class ChatGPTAdapter implements ProviderAdapter {
  readonly provider = "chatgpt" as const;
  readonly scrollSelectors = SEL.scroll;

  findComposer(): HTMLElement | null {
    return queryFirst(SEL.composer, document, { visible: true }) ?? queryFirst(SEL.composer);
  }

  getTurnCounts(): TurnCounts {
    return { user: this.userTurns().length, assistant: this.assistantTurns().length };
  }

  getLastAssistantKey(): string {
    const turns = this.assistantTurns();
    const last = turns[turns.length - 1];
    if (!last) return "";
    const keyed = last.matches("[data-chatgpt-selection-message-id],[data-message-id]")
      ? last
      : last.querySelector<HTMLElement>("[data-chatgpt-selection-message-id],[data-message-id]");
    return keyed?.getAttribute("data-chatgpt-selection-message-id")
      ?? keyed?.getAttribute("data-message-id")
      ?? last.closest("[data-turn-key]")?.getAttribute("data-turn-key")
      ?? "";
  }

  getLastUserText(): string {
    const turns = this.userTurns();
    const last = turns[turns.length - 1];
    return last ? this.renderUser(last, "text") : "";
  }

  async send(prompt: string): Promise<SendOutcome> {
    const input = this.findComposer();
    if (!input) return { ok: false, code: "input_not_found", message: "ChatGPT composer not found (is the page signed in and fully loaded?)" };

    setTextInEditable(input, prompt);
    // The send button is rendered only once React sees text. React commits via
    // MessageChannel, which hidden-tab throttling leaves alone, so a mutation wait is safe.
    const sendBtn = await waitForMutation(() => enabledButton(SEL.send), 1500);
    if (sendBtn) { sendBtn.click(); return { ok: true, via: "button" }; }
    pressEnter(input);
    return { ok: true, via: "enter" };
  }

  isGenerating(): boolean {
    const stop = queryFirst<HTMLElement>(SEL.stop, document, { visible: true });
    if (stop) return true;
    const states = queryAllFirst(SEL.turnState);
    const last = states[states.length - 1];
    if (last && /progress|stream|pending/i.test(last.getAttribute("data-talvt-turn-state") ?? "")) return true;
    return false;
  }

  getLastResponseText(format: ReturnFormat): string {
    const turns = this.assistantTurns();
    const last = turns[turns.length - 1];
    return last ? this.renderAssistant(last, format) : "";
  }

  scrape(format: ReturnFormat): ConversationTurn[] {
    const users = this.userTurns().map((el) => ({ el, role: "user" as const }));
    const assistants = this.assistantTurns().map((el) => ({ el, role: "assistant" as const }));
    const ordered = sortByDocumentOrder([...users, ...assistants].map((x) => Object.assign(x.el, { __bcbRole: x.role })));
    return ordered.map((el, index) => {
      const role = (el as HTMLElement & { __bcbRole: "user" | "assistant" }).__bcbRole;
      const text = role === "user" ? this.renderUser(el, format) : this.renderAssistant(el, format);
      return { role, text, index };
    });
  }

  /* ------------------------------- internals ------------------------------ */

  private userTurns(): HTMLElement[] {
    return queryAllFirst<HTMLElement>(SEL.userTurn);
  }

  /** Assistant message containers: parent of the sr-only "ChatGPT said:" heading. */
  private assistantTurns(): HTMLElement[] {
    const headings = queryAllFirst<HTMLElement>(SEL.assistantHeading);
    if (headings.length) {
      const out: HTMLElement[] = [];
      for (const h of headings) {
        const container = h.parentElement ?? h;
        if (!out.includes(container)) out.push(container);
      }
      return out;
    }
    return queryAllFirst<HTMLElement>(SEL.assistantTurnLegacy);
  }

  private renderUser(el: HTMLElement, format: ReturnFormat): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
    return renderNode(clone, format);
  }

  private renderAssistant(container: HTMLElement, format: ReturnFormat): string {
    // Prefer the markdown root(s); the container also holds "Thinking…" widgets and toolbars.
    const roots = queryAllFirst<HTMLElement>(SEL.assistantMarkdown, container);
    const sources = roots.length ? roots : [container];
    const wrapper = document.createElement("div");
    for (const src of sources) wrapper.appendChild(this.prepareClone(src));
    return renderNode(wrapper, format);
  }

  private prepareClone(src: HTMLElement): HTMLElement {
    const clone = src.cloneNode(true) as HTMLElement;
    // CodeMirror code blocks → <pre><code class="language-x">. Read lines from the LIVE
    // node (clones of CodeMirror keep text, but we want the language too).
    const liveBlocks = Array.from(src.querySelectorAll<HTMLElement>(SEL.codeBlock[0]));
    const cloneBlocks = Array.from(clone.querySelectorAll<HTMLElement>(SEL.codeBlock[0]));
    cloneBlocks.forEach((cb, i) => {
      const live = liveBlocks[i] ?? cb;
      const cm = live.querySelector<HTMLElement>(".cm-content");
      const lang = cm?.dataset.language
        ?? live.querySelector<HTMLElement>('[data-markdown-copy="exclude"]')?.textContent?.trim().split(/\s+/)[0]
        ?? "";
      const lines = cm ? Array.from(cm.querySelectorAll(".cm-line")).map((l) => l.textContent ?? "") : [];
      const code = lines.length ? lines.join("\n") : (live.querySelector("pre, code")?.textContent ?? live.textContent ?? "");
      cb.replaceWith(makeCodeBlock(lang, code));
    });
    clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
    return clone;
  }
}

export function chatgptLooksReady(): boolean {
  return isVisible(queryFirst(SEL.composer));
}

function enabledButton(selectors: readonly string[]): HTMLButtonElement | null {
  const b = queryFirst<HTMLButtonElement>(selectors, document, { visible: true });
  return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
}
