/**
 * DOM helpers shared by provider adapters. Every lookup takes a *chain* of
 * selectors, most-specific first, so a single UI change doesn't take the
 * whole adapter down.
 */

export function queryFirst<T extends Element = HTMLElement>(
  selectors: readonly string[],
  root: ParentNode = document,
  opts: { visible?: boolean } = {},
): T | null {
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>;
    try { nodes = root.querySelectorAll(sel); } catch { continue; }
    for (const n of nodes) {
      if (opts.visible && !isVisible(n as HTMLElement)) continue;
      return n as unknown as T;
    }
  }
  return null;
}

/** All matches for the first selector in the chain that matches anything. */
export function queryAllFirst<T extends Element = HTMLElement>(
  selectors: readonly string[],
  root: ParentNode = document,
): T[] {
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>;
    try { nodes = root.querySelectorAll(sel); } catch { continue; }
    if (nodes.length) return Array.from(nodes) as unknown as T[];
  }
  return [];
}

export function isVisible(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/**
 * The single most valuable trick in this codebase: ChatGPT's composer is a
 * ProseMirror contenteditable and Gemini's is Quill. Assigning textContent
 * does NOT update their React/Angular state. focus + execCommand does.
 */
export function setTextInEditable(el: HTMLElement, text: string): void {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const input = el as HTMLTextAreaElement;
    const proto = Object.getPrototypeOf(input) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(input, text); else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.focus();
  document.execCommand("selectAll", false, undefined);
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted || normalize(el.textContent ?? "") !== normalize(text)) {
    // Fallback for editors that reject execCommand: paste-like beforeinput/input pair.
    el.textContent = "";
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    if (normalize(el.textContent ?? "") !== normalize(text)) el.textContent = text;
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function pressEnter(el: HTMLElement): void {
  const init: KeyboardEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

export function scrollToBottom(selectors: readonly string[]): void {
  try { window.scrollTo(0, document.body.scrollHeight); } catch { /* noop */ }
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>;
    try { nodes = document.querySelectorAll(sel); } catch { continue; }
    nodes.forEach((el) => {
      try { (el as HTMLElement).scrollTo(0, (el as HTMLElement).scrollHeight); } catch { /* noop */ }
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve as soon as `pred()` is true, re-checking after every DOM mutation.
 * MutationObserver callbacks are microtasks, so unlike setTimeout they are not
 * throttled in hidden tabs. The timeout is only a safety net.
 */
export function waitForMutation<T>(pred: () => T | null | false, timeoutMs: number, root: Node = document.body): Promise<T | null> {
  const first = pred();
  if (first) return Promise.resolve(first);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const obs = new MutationObserver(() => {
      const v = pred();
      if (v) finish(v);
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(pred() || null), timeoutMs);
  });
}

/** Cheap string hash for change detection (FNV-1a, 32-bit). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Document-order sort for a mixed list of elements. */
export function sortByDocumentOrder<T extends Node>(nodes: T[]): T[] {
  return nodes.slice().sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TABLE", "BLOCKQUOTE", "SECTION", "ARTICLE", "BR", "HR"]);

/** innerText-like extraction that works on detached clones (no layout needed). */
export function blockText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { parts.push(node.nodeValue ?? ""); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const block = BLOCK_TAGS.has(el.tagName);
    if (block) parts.push("\n");
    if (el.tagName === "BR") return;
    el.childNodes.forEach(walk);
    if (block) parts.push("\n");
  };
  walk(root);
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
