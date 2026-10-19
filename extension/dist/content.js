"use strict";
(() => {
  // shared/protocol.ts
  var DEFAULT_PORT = 17361;
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  var PROVIDERS = ["chatgpt", "gemini"];
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

  // extension/src/content/dom.ts
  function queryFirst(selectors, root2 = document, opts = {}) {
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = root2.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const n of nodes) {
        if (opts.visible && !isVisible(n)) continue;
        return n;
      }
    }
    return null;
  }
  function queryAllFirst(selectors, root2 = document) {
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = root2.querySelectorAll(sel);
      } catch {
        continue;
      }
      if (nodes.length) return Array.from(nodes);
    }
    return [];
  }
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }
  function setTextInEditable(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const input = el;
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    el.focus();
    document.execCommand("selectAll", false, void 0);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || normalize(el.textContent ?? "") !== normalize(text)) {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      if (normalize(el.textContent ?? "") !== normalize(text)) el.textContent = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
  function normalize(s) {
    return s.replace(/\s+/g, " ").trim();
  }
  function pressEnter(el) {
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  function scrollToBottom(selectors) {
    try {
      window.scrollTo(0, document.body.scrollHeight);
    } catch {
    }
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      nodes.forEach((el) => {
        try {
          el.scrollTo(0, el.scrollHeight);
        } catch {
        }
      });
    }
  }
  function waitForMutation(pred, timeoutMs, root2 = document.body) {
    const first = pred();
    if (first) return Promise.resolve(first);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
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
      obs.observe(root2, { childList: true, subtree: true, attributes: true });
      const timer = setTimeout(() => finish(pred() || null), timeoutMs);
    });
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function sortByDocumentOrder(nodes) {
    return nodes.slice().sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }
  var BLOCK_TAGS = /* @__PURE__ */ new Set(["P", "DIV", "LI", "UL", "OL", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TABLE", "BLOCKQUOTE", "SECTION", "ARTICLE", "BR", "HR"]);
  function blockText(root2) {
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue ?? "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const block = BLOCK_TAGS.has(el.tagName);
      if (block) parts.push("\n");
      if (el.tagName === "BR") return;
      el.childNodes.forEach(walk);
      if (block) parts.push("\n");
    };
    walk(root2);
    return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // node_modules/turndown/lib/turndown.browser.es.js
  function extend(destination) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) destination[key] = source[key];
      }
    }
    return destination;
  }
  function repeat(character, count) {
    return Array(count + 1).join(character);
  }
  function trimLeadingNewlines(string) {
    return string.replace(/^\n*/, "");
  }
  function trimTrailingNewlines(string) {
    var indexEnd = string.length;
    while (indexEnd > 0 && string[indexEnd - 1] === "\n") indexEnd--;
    return string.substring(0, indexEnd);
  }
  function trimNewlines(string) {
    return trimTrailingNewlines(trimLeadingNewlines(string));
  }
  var blockElements = ["ADDRESS", "ARTICLE", "ASIDE", "AUDIO", "BLOCKQUOTE", "BODY", "CANVAS", "CENTER", "DD", "DIR", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "FRAMESET", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "HTML", "ISINDEX", "LI", "MAIN", "MENU", "NAV", "NOFRAMES", "NOSCRIPT", "OL", "OUTPUT", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"];
  function isBlock(node) {
    return is(node, blockElements);
  }
  var voidElements = ["AREA", "BASE", "BR", "COL", "COMMAND", "EMBED", "HR", "IMG", "INPUT", "KEYGEN", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"];
  function isVoid(node) {
    return is(node, voidElements);
  }
  function hasVoid(node) {
    return has(node, voidElements);
  }
  var meaningfulWhenBlankElements = ["A", "TABLE", "THEAD", "TBODY", "TFOOT", "TH", "TD", "IFRAME", "SCRIPT", "AUDIO", "VIDEO"];
  function isMeaningfulWhenBlank(node) {
    return is(node, meaningfulWhenBlankElements);
  }
  function hasMeaningfulWhenBlank(node) {
    return has(node, meaningfulWhenBlankElements);
  }
  function is(node, tagNames) {
    return tagNames.indexOf(node.nodeName) >= 0;
  }
  function has(node, tagNames) {
    return node.getElementsByTagName && tagNames.some(function(tagName) {
      return node.getElementsByTagName(tagName).length;
    });
  }
  var markdownEscapes = [[/\\/g, "\\\\"], [/\*/g, "\\*"], [/^-/g, "\\-"], [/^\+ /g, "\\+ "], [/^(=+)/g, "\\$1"], [/^(#{1,6}) /g, "\\$1 "], [/`/g, "\\`"], [/^~~~/g, "\\~~~"], [/\[/g, "\\["], [/\]/g, "\\]"], [/^>/g, "\\>"], [/_/g, "\\_"], [/^(\d+)\. /g, "$1\\. "]];
  function escapeMarkdown(string) {
    return markdownEscapes.reduce(function(accumulator, escape) {
      return accumulator.replace(escape[0], escape[1]);
    }, string);
  }
  var rules = {};
  rules.paragraph = {
    filter: "p",
    replacement: function(content) {
      return "\n\n" + content + "\n\n";
    }
  };
  rules.lineBreak = {
    filter: "br",
    replacement: function(content, node, options) {
      return options.br + "\n";
    }
  };
  rules.heading = {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: function(content, node, options) {
      var hLevel = Number(node.nodeName.charAt(1));
      if (options.headingStyle === "setext" && hLevel < 3) {
        var underline = repeat(hLevel === 1 ? "=" : "-", content.length);
        return "\n\n" + content + "\n" + underline + "\n\n";
      } else {
        return "\n\n" + repeat("#", hLevel) + " " + content + "\n\n";
      }
    }
  };
  rules.blockquote = {
    filter: "blockquote",
    replacement: function(content) {
      content = trimNewlines(content).replace(/^/gm, "> ");
      return "\n\n" + content + "\n\n";
    }
  };
  rules.list = {
    filter: ["ul", "ol"],
    replacement: function(content, node) {
      var parent = node.parentNode;
      if (parent.nodeName === "LI" && parent.lastElementChild === node) {
        return "\n" + content;
      } else {
        return "\n\n" + content + "\n\n";
      }
    }
  };
  rules.listItem = {
    filter: "li",
    replacement: function(content, node, options) {
      var prefix = options.bulletListMarker + "   ";
      var parent = node.parentNode;
      if (parent.nodeName === "OL") {
        var start = parent.getAttribute("start");
        var index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + ".  ";
      }
      var isParagraph = /\n$/.test(content);
      content = trimNewlines(content) + (isParagraph ? "\n" : "");
      content = content.replace(/\n/gm, "\n" + " ".repeat(prefix.length));
      return prefix + content + (node.nextSibling ? "\n" : "");
    }
  };
  rules.indentedCodeBlock = {
    filter: function(node, options) {
      return options.codeBlockStyle === "indented" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
    },
    replacement: function(content, node, options) {
      return "\n\n    " + node.firstChild.textContent.replace(/\n/g, "\n    ") + "\n\n";
    }
  };
  rules.fencedCodeBlock = {
    filter: function(node, options) {
      return options.codeBlockStyle === "fenced" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
    },
    replacement: function(content, node, options) {
      var className = node.firstChild.getAttribute("class") || "";
      var language = (className.match(/language-(\S+)/) || [null, ""])[1];
      var code = node.firstChild.textContent;
      var fenceChar = options.fence.charAt(0);
      var fenceSize = 3;
      var fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");
      var match;
      while (match = fenceInCodeRegex.exec(code)) {
        if (match[0].length >= fenceSize) {
          fenceSize = match[0].length + 1;
        }
      }
      var fence = repeat(fenceChar, fenceSize);
      return "\n\n" + fence + language + "\n" + code.replace(/\n$/, "") + "\n" + fence + "\n\n";
    }
  };
  rules.horizontalRule = {
    filter: "hr",
    replacement: function(content, node, options) {
      return "\n\n" + options.hr + "\n\n";
    }
  };
  rules.inlineLink = {
    filter: function(node, options) {
      return options.linkStyle === "inlined" && node.nodeName === "A" && node.getAttribute("href");
    },
    replacement: function(content, node) {
      var href = escapeLinkDestination(node.getAttribute("href"));
      var title = escapeLinkTitle(cleanAttribute(node.getAttribute("title")));
      var titlePart = title ? ' "' + title + '"' : "";
      return "[" + content + "](" + href + titlePart + ")";
    }
  };
  rules.referenceLink = {
    filter: function(node, options) {
      return options.linkStyle === "referenced" && node.nodeName === "A" && node.getAttribute("href");
    },
    replacement: function(content, node, options) {
      var href = escapeLinkDestination(node.getAttribute("href"));
      var title = cleanAttribute(node.getAttribute("title"));
      if (title) title = ' "' + escapeLinkTitle(title) + '"';
      var replacement;
      var reference;
      switch (options.linkReferenceStyle) {
        case "collapsed":
          replacement = "[" + content + "][]";
          reference = "[" + content + "]: " + href + title;
          break;
        case "shortcut":
          replacement = "[" + content + "]";
          reference = "[" + content + "]: " + href + title;
          break;
        default:
          var id = this.references.length + 1;
          replacement = "[" + content + "][" + id + "]";
          reference = "[" + id + "]: " + href + title;
      }
      this.references.push(reference);
      return replacement;
    },
    references: [],
    append: function(options) {
      var references = "";
      if (this.references.length) {
        references = "\n\n" + this.references.join("\n") + "\n\n";
        this.references = [];
      }
      return references;
    }
  };
  rules.emphasis = {
    filter: ["em", "i"],
    replacement: function(content, node, options) {
      if (!content.trim()) return "";
      return options.emDelimiter + content + options.emDelimiter;
    }
  };
  rules.strong = {
    filter: ["strong", "b"],
    replacement: function(content, node, options) {
      if (!content.trim()) return "";
      return options.strongDelimiter + content + options.strongDelimiter;
    }
  };
  rules.code = {
    filter: function(node) {
      var hasSiblings = node.previousSibling || node.nextSibling;
      var isCodeBlock = node.parentNode.nodeName === "PRE" && !hasSiblings;
      return node.nodeName === "CODE" && !isCodeBlock;
    },
    replacement: function(content) {
      if (!content) return "";
      content = content.replace(/\r?\n|\r/g, " ");
      var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? " " : "";
      var delimiter = "`";
      var matches = content.match(/`+/gm) || [];
      while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + "`";
      return delimiter + extraSpace + content + extraSpace + delimiter;
    }
  };
  rules.image = {
    filter: "img",
    replacement: function(content, node) {
      var alt = escapeMarkdown(cleanAttribute(node.getAttribute("alt")));
      var src = escapeLinkDestination(node.getAttribute("src") || "");
      var title = cleanAttribute(node.getAttribute("title"));
      var titlePart = title ? ' "' + escapeLinkTitle(title) + '"' : "";
      return src ? "![" + alt + "](" + src + titlePart + ")" : "";
    }
  };
  function cleanAttribute(attribute) {
    return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
  }
  function escapeLinkDestination(destination) {
    var escaped = destination.replace(/([<>()])/g, "\\$1");
    return escaped.indexOf(" ") >= 0 ? "<" + escaped + ">" : escaped;
  }
  function escapeLinkTitle(title) {
    return title.replace(/"/g, '\\"');
  }
  function Rules(options) {
    this.options = options;
    this._keep = [];
    this._remove = [];
    this.blankRule = {
      replacement: options.blankReplacement
    };
    this.keepReplacement = options.keepReplacement;
    this.defaultRule = {
      replacement: options.defaultReplacement
    };
    this.array = [];
    for (var key in options.rules) this.array.push(options.rules[key]);
  }
  Rules.prototype = {
    add: function(key, rule) {
      this.array.unshift(rule);
    },
    keep: function(filter) {
      this._keep.unshift({
        filter,
        replacement: this.keepReplacement
      });
    },
    remove: function(filter) {
      this._remove.unshift({
        filter,
        replacement: function() {
          return "";
        }
      });
    },
    forNode: function(node) {
      if (node.isBlank) return this.blankRule;
      var rule;
      if (rule = findRule(this.array, node, this.options)) return rule;
      if (rule = findRule(this._keep, node, this.options)) return rule;
      if (rule = findRule(this._remove, node, this.options)) return rule;
      return this.defaultRule;
    },
    forEach: function(fn) {
      for (var i = 0; i < this.array.length; i++) fn(this.array[i], i);
    }
  };
  function findRule(rules2, node, options) {
    for (var i = 0; i < rules2.length; i++) {
      var rule = rules2[i];
      if (filterValue(rule, node, options)) return rule;
    }
    return void 0;
  }
  function filterValue(rule, node, options) {
    var filter = rule.filter;
    if (typeof filter === "string") {
      if (filter === node.nodeName.toLowerCase()) return true;
    } else if (Array.isArray(filter)) {
      if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true;
    } else if (typeof filter === "function") {
      if (filter.call(rule, node, options)) return true;
    } else {
      throw new TypeError("`filter` needs to be a string, array, or function");
    }
  }
  function collapseWhitespace(options) {
    var element = options.element;
    var isBlock2 = options.isBlock;
    var isVoid2 = options.isVoid;
    var isPre = options.isPre || function(node2) {
      return node2.nodeName === "PRE";
    };
    if (!element.firstChild || isPre(element)) return;
    var prevText = null;
    var keepLeadingWs = false;
    var prev = null;
    var node = next(prev, element, isPre);
    while (node !== element) {
      if (node.nodeType === 3 || node.nodeType === 4) {
        var text = node.data.replace(/[ \r\n\t]+/g, " ");
        if ((!prevText || / $/.test(prevText.data)) && !keepLeadingWs && text[0] === " ") {
          text = text.substr(1);
        }
        if (!text) {
          node = remove(node);
          continue;
        }
        node.data = text;
        prevText = node;
      } else if (node.nodeType === 1) {
        if (isBlock2(node) || node.nodeName === "BR") {
          if (prevText) {
            prevText.data = prevText.data.replace(/ $/, "");
          }
          prevText = null;
          keepLeadingWs = false;
        } else if (isVoid2(node) || isPre(node)) {
          prevText = null;
          keepLeadingWs = true;
        } else if (prevText) {
          keepLeadingWs = false;
        }
      } else {
        node = remove(node);
        continue;
      }
      var nextNode = next(prev, node, isPre);
      prev = node;
      node = nextNode;
    }
    if (prevText) {
      prevText.data = prevText.data.replace(/ $/, "");
      if (!prevText.data) {
        remove(prevText);
      }
    }
  }
  function remove(node) {
    var next2 = node.nextSibling || node.parentNode;
    node.parentNode.removeChild(node);
    return next2;
  }
  function next(prev, current, isPre) {
    if (prev && prev.parentNode === current || isPre(current)) {
      return current.nextSibling || current.parentNode;
    }
    return current.firstChild || current.nextSibling || current.parentNode;
  }
  var root = typeof window !== "undefined" ? window : {};
  function canParseHTMLNatively() {
    var Parser = root.DOMParser;
    var canParse = false;
    try {
      if (new Parser().parseFromString("", "text/html")) {
        canParse = true;
      }
    } catch (e) {
    }
    return canParse;
  }
  function createHTMLParser() {
    var Parser = function() {
    };
    {
      if (shouldUseActiveX()) {
        Parser.prototype.parseFromString = function(string) {
          var doc = new window.ActiveXObject("htmlfile");
          doc.designMode = "on";
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      } else {
        Parser.prototype.parseFromString = function(string) {
          var doc = document.implementation.createHTMLDocument("");
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      }
    }
    return Parser;
  }
  function shouldUseActiveX() {
    var useActiveX = false;
    try {
      document.implementation.createHTMLDocument("").open();
    } catch (e) {
      if (root.ActiveXObject) useActiveX = true;
    }
    return useActiveX;
  }
  var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();
  function RootNode(input, options) {
    var root2;
    if (typeof input === "string") {
      var doc = htmlParser().parseFromString(
        // DOM parsers arrange elements in the <head> and <body>.
        // Wrapping in a custom element ensures elements are reliably arranged in
        // a single element.
        '<x-turndown id="turndown-root">' + input + "</x-turndown>",
        "text/html"
      );
      root2 = doc.getElementById("turndown-root");
    } else {
      root2 = input.cloneNode(true);
    }
    collapseWhitespace({
      element: root2,
      isBlock,
      isVoid,
      isPre: options.preformattedCode ? isPreOrCode : null
    });
    return root2;
  }
  var _htmlParser;
  function htmlParser() {
    _htmlParser = _htmlParser || new HTMLParser();
    return _htmlParser;
  }
  function isPreOrCode(node) {
    return node.nodeName === "PRE" || node.nodeName === "CODE";
  }
  function Node2(node, options) {
    node.isBlock = isBlock(node);
    node.isCode = node.nodeName === "CODE" || node.parentNode.isCode;
    node.isBlank = isBlank(node);
    node.flankingWhitespace = flankingWhitespace(node, options);
    return node;
  }
  function isBlank(node) {
    return !isVoid(node) && !isMeaningfulWhenBlank(node) && /^\s*$/i.test(node.textContent) && !hasVoid(node) && !hasMeaningfulWhenBlank(node);
  }
  function flankingWhitespace(node, options) {
    if (node.isBlock || options.preformattedCode && node.isCode) {
      return {
        leading: "",
        trailing: ""
      };
    }
    var edges = edgeWhitespace(node.textContent);
    if (edges.leadingAscii && isFlankedByWhitespace("left", node, options)) {
      edges.leading = edges.leadingNonAscii;
    }
    if (edges.trailingAscii && isFlankedByWhitespace("right", node, options)) {
      edges.trailing = edges.trailingNonAscii;
    }
    return {
      leading: edges.leading,
      trailing: edges.trailing
    };
  }
  function edgeWhitespace(string) {
    var m = string.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);
    return {
      leading: m[1],
      // whole string for whitespace-only strings
      leadingAscii: m[2],
      leadingNonAscii: m[3],
      trailing: m[4],
      // empty for whitespace-only strings
      trailingNonAscii: m[5],
      trailingAscii: m[6]
    };
  }
  function isFlankedByWhitespace(side, node, options) {
    var sibling;
    var regExp;
    var isFlanked;
    if (side === "left") {
      sibling = node.previousSibling;
      regExp = / $/;
    } else {
      sibling = node.nextSibling;
      regExp = /^ /;
    }
    if (sibling) {
      if (sibling.nodeType === 3) {
        isFlanked = regExp.test(sibling.nodeValue);
      } else if (options.preformattedCode && sibling.nodeName === "CODE") {
        isFlanked = false;
      } else if (sibling.nodeType === 1 && !isBlock(sibling)) {
        isFlanked = regExp.test(sibling.textContent);
      }
    }
    return isFlanked;
  }
  var reduce = Array.prototype.reduce;
  function TurndownService(options) {
    if (!(this instanceof TurndownService)) return new TurndownService(options);
    var defaults = {
      rules,
      headingStyle: "setext",
      hr: "* * *",
      bulletListMarker: "*",
      codeBlockStyle: "indented",
      fence: "```",
      emDelimiter: "_",
      strongDelimiter: "**",
      linkStyle: "inlined",
      linkReferenceStyle: "full",
      br: "  ",
      preformattedCode: false,
      blankReplacement: function(content, node) {
        return node.isBlock ? "\n\n" : "";
      },
      keepReplacement: function(content, node) {
        return node.isBlock ? "\n\n" + node.outerHTML + "\n\n" : node.outerHTML;
      },
      defaultReplacement: function(content, node) {
        return node.isBlock ? "\n\n" + content + "\n\n" : content;
      }
    };
    this.options = extend({}, defaults, options);
    this.rules = new Rules(this.options);
  }
  TurndownService.prototype = {
    /**
     * The entry point for converting a string or DOM node to Markdown
     * @public
     * @param {String|HTMLElement} input The string or DOM node to convert
     * @returns A Markdown representation of the input
     * @type String
     */
    turndown: function(input) {
      if (!canConvert(input)) {
        throw new TypeError(input + " is not a string, or an element/document/fragment node.");
      }
      if (input === "") return "";
      var output = process.call(this, new RootNode(input, this.options));
      return postProcess.call(this, output);
    },
    /**
     * Add one or more plugins
     * @public
     * @param {Function|Array} plugin The plugin or array of plugins to add
     * @returns The Turndown instance for chaining
     * @type Object
     */
    use: function(plugin) {
      if (Array.isArray(plugin)) {
        for (var i = 0; i < plugin.length; i++) this.use(plugin[i]);
      } else if (typeof plugin === "function") {
        plugin(this);
      } else {
        throw new TypeError("plugin must be a Function or an Array of Functions");
      }
      return this;
    },
    /**
     * Adds a rule
     * @public
     * @param {String} key The unique key of the rule
     * @param {Object} rule The rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    addRule: function(key, rule) {
      this.rules.add(key, rule);
      return this;
    },
    /**
     * Keep a node (as HTML) that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    keep: function(filter) {
      this.rules.keep(filter);
      return this;
    },
    /**
     * Remove a node that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */
    remove: function(filter) {
      this.rules.remove(filter);
      return this;
    },
    /**
     * Escapes Markdown syntax
     * @public
     * @param {String} string The string to escape
     * @returns A string with Markdown syntax escaped
     * @type String
     */
    escape: function(string) {
      return escapeMarkdown(string);
    }
  };
  function process(parentNode) {
    var self = this;
    return reduce.call(parentNode.childNodes, function(output, node) {
      node = new Node2(node, self.options);
      var replacement = "";
      if (node.nodeType === 3) {
        replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue);
      } else if (node.nodeType === 1) {
        replacement = replacementForNode.call(self, node);
      }
      return join(output, replacement);
    }, "");
  }
  function postProcess(output) {
    var self = this;
    this.rules.forEach(function(rule) {
      if (typeof rule.append === "function") {
        output = join(output, rule.append(self.options));
      }
    });
    return output.replace(/^[\t\r\n]+/, "").replace(/[\t\r\n\s]+$/, "");
  }
  function replacementForNode(node) {
    var rule = this.rules.forNode(node);
    var content = process.call(this, node);
    var whitespace = node.flankingWhitespace;
    if (whitespace.leading || whitespace.trailing) content = content.trim();
    return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing;
  }
  function join(output, replacement) {
    var s1 = trimTrailingNewlines(output);
    var s2 = trimLeadingNewlines(replacement);
    var nls = Math.max(output.length - s1.length, replacement.length - s2.length);
    var separator = "\n\n".substring(0, nls);
    return s1 + separator + s2;
  }
  function canConvert(input) {
    return input != null && (typeof input === "string" || input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11));
  }

  // extension/src/content/markdown.ts
  var turndown = null;
  function getTurndown() {
    if (turndown) return turndown;
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*"
    });
    turndown.addRule("fencedCodeBlock", {
      filter: (node) => node.nodeName === "PRE" && !!node.querySelector("code"),
      replacement: (_content, node) => {
        const code = node.querySelector("code");
        const text = (code?.textContent ?? "").replace(/\n$/, "");
        const cls = code?.className ?? "";
        const lang = /language-([^\s]+)/.exec(cls)?.[1] ?? node.dataset.lang ?? "";
        const fence = text.includes("```") ? "````" : "```";
        return `

${fence}${lang}
${text}
${fence}

`;
      }
    });
    turndown.addRule("tableCell", {
      filter: ["th", "td"],
      replacement: (content) => ` ${content.trim().replace(/\n+/g, " ")} |`
    });
    turndown.addRule("tableRow", {
      filter: "tr",
      replacement: (content, node) => {
        const row = `|${content}
`;
        const isHeader = node.parentElement?.tagName === "THEAD" || node.querySelector("th") !== null;
        if (!isHeader) return row;
        const cells = node.children.length;
        return `${row}|${" --- |".repeat(cells)}
`;
      }
    });
    turndown.addRule("tableSection", {
      filter: ["thead", "tbody", "tfoot"],
      replacement: (content) => content
    });
    turndown.addRule("table", {
      filter: "table",
      replacement: (content) => `

${content.trim().replace(/\n{2,}/g, "\n")}

`
    });
    turndown.remove((node) => ["SCRIPT", "STYLE", "BUTTON", "svg", "SVG"].includes(node.nodeName));
    return turndown;
  }
  function renderNode(clone, format) {
    if (format === "html") return clone.innerHTML.trim();
    if (format === "text") return blockText(clone);
    const md = getTurndown().turndown(clone);
    return md.replace(/\n[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function makeCodeBlock(lang, code) {
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    const cleanLang = lang.trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, "");
    if (cleanLang) codeEl.className = `language-${cleanLang}`;
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    return pre;
  }

  // extension/src/content/adapters/chatgpt.ts
  var SEL = {
    composer: [
      'form div.ProseMirror[contenteditable="true"][role="textbox"]',
      "#prompt-textarea",
      'form [contenteditable="true"][role="textbox"]',
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      "form textarea"
    ],
    send: [
      'form button[type="submit"][aria-label="Send"]',
      'button[data-testid="send-button"]',
      'form button[aria-label*="Send" i]',
      'button[aria-label*="Send prompt" i]'
    ],
    stop: [
      'form button[aria-label="Stop"]',
      'button[data-testid="stop-button"]',
      'form button[aria-label*="Stop" i]',
      'button[aria-label*="Stop streaming" i]'
    ],
    userTurn: ["[data-user-message-bubble]", '[data-message-author-role="user"]'],
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
      "main"
    ]
  };
  var ChatGPTAdapter = class {
    provider = "chatgpt";
    scrollSelectors = SEL.scroll;
    findComposer() {
      return queryFirst(SEL.composer, document, { visible: true }) ?? queryFirst(SEL.composer);
    }
    getTurnCounts() {
      return { user: this.userTurns().length, assistant: this.assistantTurns().length };
    }
    async send(prompt) {
      const input = this.findComposer();
      if (!input) return { ok: false, code: "input_not_found", message: "ChatGPT composer not found (is the page signed in and fully loaded?)" };
      setTextInEditable(input, prompt);
      const sendBtn = await waitForMutation(() => enabledButton(SEL.send), 1500);
      if (sendBtn) {
        sendBtn.click();
        return { ok: true, via: "button" };
      }
      pressEnter(input);
      return { ok: true, via: "enter" };
    }
    isGenerating() {
      const stop = queryFirst(SEL.stop, document, { visible: true });
      if (stop) return true;
      const states = queryAllFirst(SEL.turnState);
      const last = states[states.length - 1];
      if (last && /progress|stream|pending/i.test(last.getAttribute("data-talvt-turn-state") ?? "")) return true;
      return false;
    }
    getLastResponseText(format) {
      const turns = this.assistantTurns();
      const last = turns[turns.length - 1];
      return last ? this.renderAssistant(last, format) : "";
    }
    scrape(format) {
      const users = this.userTurns().map((el) => ({ el, role: "user" }));
      const assistants = this.assistantTurns().map((el) => ({ el, role: "assistant" }));
      const ordered = sortByDocumentOrder([...users, ...assistants].map((x) => Object.assign(x.el, { __bcbRole: x.role })));
      return ordered.map((el, index) => {
        const role = el.__bcbRole;
        const text = role === "user" ? this.renderUser(el, format) : this.renderAssistant(el, format);
        return { role, text, index };
      });
    }
    /* ------------------------------- internals ------------------------------ */
    userTurns() {
      return queryAllFirst(SEL.userTurn);
    }
    /** Assistant message containers: parent of the sr-only "ChatGPT said:" heading. */
    assistantTurns() {
      const headings = queryAllFirst(SEL.assistantHeading);
      if (headings.length) {
        const out = [];
        for (const h of headings) {
          const container = h.parentElement ?? h;
          if (!out.includes(container)) out.push(container);
        }
        return out;
      }
      return queryAllFirst(SEL.assistantTurnLegacy);
    }
    renderUser(el, format) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
      return renderNode(clone, format);
    }
    renderAssistant(container, format) {
      const roots = queryAllFirst(SEL.assistantMarkdown, container);
      const sources = roots.length ? roots : [container];
      const wrapper = document.createElement("div");
      for (const src of sources) wrapper.appendChild(this.prepareClone(src));
      return renderNode(wrapper, format);
    }
    prepareClone(src) {
      const clone = src.cloneNode(true);
      const liveBlocks = Array.from(src.querySelectorAll(SEL.codeBlock[0]));
      const cloneBlocks = Array.from(clone.querySelectorAll(SEL.codeBlock[0]));
      cloneBlocks.forEach((cb, i) => {
        const live = liveBlocks[i] ?? cb;
        const cm = live.querySelector(".cm-content");
        const lang = cm?.dataset.language ?? live.querySelector('[data-markdown-copy="exclude"]')?.textContent?.trim().split(/\s+/)[0] ?? "";
        const lines = cm ? Array.from(cm.querySelectorAll(".cm-line")).map((l) => l.textContent ?? "") : [];
        const code = lines.length ? lines.join("\n") : live.querySelector("pre, code")?.textContent ?? live.textContent ?? "";
        cb.replaceWith(makeCodeBlock(lang, code));
      });
      clone.querySelectorAll(SEL.exclude).forEach((n) => n.remove());
      return clone;
    }
  };
  function enabledButton(selectors) {
    const b = queryFirst(selectors, document, { visible: true });
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }

  // extension/src/content/adapters/gemini.ts
  var SEL2 = {
    composer: [
      'rich-textarea div.ql-editor[contenteditable="true"][role="textbox"]',
      'div.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"][aria-label*="Gemini" i]',
      '[contenteditable="true"][role="textbox"]',
      "textarea"
    ],
    send: [
      'button[aria-label="Send message"]',
      "button.send-button",
      'button[aria-label*="Send" i]',
      'button[mattooltip*="Send" i]'
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
      "chat-window"
    ]
  };
  var GeminiAdapter = class {
    provider = "gemini";
    scrollSelectors = SEL2.scroll;
    findComposer() {
      return queryFirst(SEL2.composer, document, { visible: true }) ?? queryFirst(SEL2.composer);
    }
    getTurnCounts() {
      return { user: this.userTurns().length, assistant: this.assistantTurns().length };
    }
    async send(prompt) {
      const input = this.findComposer();
      if (!input) return { ok: false, code: "input_not_found", message: "Gemini composer not found (is the page signed in and fully loaded?)" };
      setTextInEditable(input, prompt);
      const sendBtn = await waitForMutation(() => {
        const b = queryFirst(SEL2.send, document, { visible: true });
        return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
      }, 1500);
      if (sendBtn) {
        sendBtn.click();
        return { ok: true, via: "button" };
      }
      pressEnter(input);
      return { ok: true, via: "enter" };
    }
    isGenerating() {
      if (queryFirst(SEL2.stop, document, { visible: true })) return true;
      const turns = this.assistantTurns();
      const last = turns[turns.length - 1];
      if (!last) return false;
      for (const sel of SEL2.busy) {
        try {
          if (last.matches(sel) || last.querySelector(sel)) return true;
        } catch {
        }
      }
      return false;
    }
    getLastResponseText(format) {
      const turns = this.assistantTurns();
      const last = turns[turns.length - 1];
      return last ? this.renderAssistant(last, format) : "";
    }
    scrape(format) {
      const tagged = [
        ...this.userTurns().map((el) => Object.assign(el, { __bcbRole: "user" })),
        ...this.assistantTurns().map((el) => Object.assign(el, { __bcbRole: "assistant" }))
      ];
      return sortByDocumentOrder(tagged).map((el, index) => {
        const role = el.__bcbRole;
        const text = role === "user" ? this.renderUser(el, format) : this.renderAssistant(el, format);
        return { role, text, index };
      });
    }
    /* ------------------------------- internals ------------------------------ */
    userTurns() {
      return queryAllFirst(SEL2.userTurn);
    }
    assistantTurns() {
      return queryAllFirst(SEL2.assistantTurn);
    }
    renderUser(el, format) {
      const src = queryFirst(SEL2.userText, el) ?? el;
      const clone = src.cloneNode(true);
      clone.querySelectorAll(SEL2.exclude).forEach((n) => n.remove());
      return renderNode(clone, format);
    }
    renderAssistant(turn, format) {
      const roots = queryAllFirst(SEL2.assistantMarkdown, turn);
      const sources = roots.length ? roots : [turn];
      const wrapper = document.createElement("div");
      for (const src of sources) wrapper.appendChild(this.prepareClone(src));
      return renderNode(wrapper, format);
    }
    prepareClone(src) {
      const clone = src.cloneNode(true);
      clone.querySelectorAll(SEL2.codeBlock[0]).forEach((cb) => {
        const lang = queryFirst(SEL2.codeLang, cb)?.textContent?.trim() ?? "";
        const code = cb.querySelector("pre code")?.textContent ?? cb.querySelector("pre")?.textContent ?? cb.textContent ?? "";
        cb.replaceWith(makeCodeBlock(lang, code.replace(/\n$/, "")));
      });
      clone.querySelectorAll(SEL2.exclude).forEach((n) => n.remove());
      return clone;
    }
  };

  // extension/src/content/entry.ts
  var adapter = pickAdapter(window.location.hostname);
  if (!window.__BCB_CONTENT_INSTALLED__) {
    window.__BCB_CONTENT_INSTALLED__ = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      handleCommand(msg).then(sendResponse).catch((err) => sendResponse({ ok: false, error: { code: "internal_error", message: String(err?.message ?? err) } }));
      return true;
    });
  }
  async function handleCommand(cmd) {
    if (!adapter) {
      return { ok: false, error: { code: "provider_not_supported", message: `No adapter for ${window.location.hostname}` } };
    }
    switch (cmd.action) {
      case "ping": {
        const data = {
          provider: adapter.provider,
          url: window.location.href,
          title: document.title,
          turnCounts: adapter.getTurnCounts(),
          composerFound: !!adapter.findComposer()
        };
        return { ok: true, data };
      }
      case "send": {
        const baseline = adapter.getTurnCounts();
        const outcome = await adapter.send(cmd.prompt);
        if (!outcome.ok) return { ok: false, error: { code: outcome.code, message: outcome.message } };
        const data = { baseline, via: outcome.via };
        return { ok: true, data };
      }
      case "observe": {
        scrollToBottom(adapter.scrollSelectors);
        const text = adapter.getLastResponseText("text");
        const data = {
          turnCounts: adapter.getTurnCounts(),
          generating: adapter.isGenerating(),
          textLength: text.length,
          textHash: hashString(text),
          visibility: document.visibilityState === "visible" ? "visible" : "hidden"
        };
        return { ok: true, data };
      }
      case "getLastResponse": {
        const data = { text: adapter.getLastResponseText(cmd.format), format: cmd.format };
        return { ok: true, data };
      }
      case "scrape": {
        const data = { turns: adapter.scrape(cmd.format), format: cmd.format };
        return { ok: true, data };
      }
    }
  }
  function pickAdapter(hostname) {
    switch (providerForHost(hostname)) {
      case "chatgpt":
        return new ChatGPTAdapter();
      case "gemini":
        return new GeminiAdapter();
      default:
        return null;
    }
  }
})();
