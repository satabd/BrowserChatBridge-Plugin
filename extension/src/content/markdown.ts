import TurndownService from "turndown";
import type { ReturnFormat } from "../../../shared/protocol.js";
import { blockText } from "./dom.js";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  turndown.addRule("fencedCodeBlock", {
    filter: (node) => node.nodeName === "PRE" && !!node.querySelector("code"),
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector("code");
      const text = (code?.textContent ?? "").replace(/\n$/, "");
      const cls = code?.className ?? "";
      const lang = /language-([^\s]+)/.exec(cls)?.[1] ?? (node as HTMLElement).dataset.lang ?? "";
      const fence = text.includes("```") ? "````" : "```";
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });
  // Keep tables readable instead of collapsing to inline text.
  turndown.addRule("tableCell", {
    filter: ["th", "td"],
    replacement: (content) => ` ${content.trim().replace(/\n+/g, " ")} |`,
  });
  turndown.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const row = `|${content}\n`;
      const isHeader = (node as HTMLElement).parentElement?.tagName === "THEAD" ||
        (node as HTMLElement).querySelector("th") !== null;
      if (!isHeader) return row;
      const cells = (node as HTMLElement).children.length;
      return `${row}|${" --- |".repeat(cells)}\n`;
    },
  });
  turndown.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement: (content) => content,
  });
  turndown.addRule("table", {
    filter: "table",
    replacement: (content) => `\n\n${content.trim().replace(/\n{2,}/g, "\n")}\n\n`,
  });
  turndown.remove((node) => ["SCRIPT", "STYLE", "BUTTON", "svg", "SVG"].includes(node.nodeName));
  return turndown;
}

/**
 * Render a (prepared, detached) clone in the requested format.
 * Callers are responsible for normalising provider-specific widgets into
 * plain <pre><code class="language-x"> and removing chrome (buttons etc.).
 */
export function renderNode(clone: HTMLElement, format: ReturnFormat): string {
  if (format === "html") return clone.innerHTML.trim();
  if (format === "text") return blockText(clone);
  const md = getTurndown().turndown(clone);
  return md
    .replace(/\n[ \t]+\n/g, "\n")      // blank-but-indented lines inside lists (Gemini wraps <li> text in <p>)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Build a normalised <pre><code> block the markdown renderer understands. */
export function makeCodeBlock(lang: string, code: string): HTMLElement {
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  const cleanLang = lang.trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, "");
  if (cleanLang) codeEl.className = `language-${cleanLang}`;
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  return pre;
}
