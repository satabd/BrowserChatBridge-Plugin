#!/usr/bin/env node
/**
 * /bcb:setup helper.
 *
 *  1. Copies the pre-built extension to a STABLE directory (the plugin's data
 *     dir, or ~/.bcb/extension) so a plugin update doesn't break the unpacked
 *     extension Chrome has loaded.
 *  2. Opens the browser's extensions page plus chatgpt.com and
 *     gemini.google.com so the only manual step is "Load unpacked".
 *  3. Prints what the user has to do, then a machine-readable JSON summary.
 *
 * Usage: node setup.mjs [--data <dir>] [--browser chrome|msedge|brave|chromium] [--no-open] [--json]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const dataDir = args.data && args.data !== "${CLAUDE_PLUGIN_DATA}" ? args.data : join(homedir(), ".bcb");
const targetDir = join(dataDir, "extension");
const sourceDir = join(root, "extension", "dist");

const summary = { ok: true, extensionDir: targetDir, browser: null, opened: [], bridge: null, warnings: [] };

/* 1. copy extension to a stable path */
if (!existsSync(join(sourceDir, "manifest.json"))) {
  console.error(`Extension build missing at ${sourceDir}. Run "npm run build" in the plugin repo.`);
  process.exit(1);
}
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true, force: true });
const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"));
await writeFile(join(targetDir, "INSTALLED_FROM.txt"), `${root}\n${new Date().toISOString()}\n`);

/* 2. find a browser and open the pages */
const browser = findBrowser(args.browser);
summary.browser = browser ? browser.name : null;
const scheme = browser?.name === "msedge" ? "edge" : "chrome";
const urls = [`${scheme}://extensions/`, "https://chatgpt.com/", "https://gemini.google.com/app"];
if (browser && !args["no-open"]) {
  for (const url of urls) {
    try {
      const child = spawn(browser.path, [url], { detached: true, stdio: "ignore" });
      child.unref();
      summary.opened.push(url);
    } catch (err) {
      summary.warnings.push(`could not open ${url}: ${err.message}`);
    }
  }
} else if (!browser) {
  summary.warnings.push("No Chromium-based browser found automatically; open the extensions page yourself.");
}

/* 3. is a bridge already running? */
try {
  const r = await fetch("http://127.0.0.1:17361/health", { signal: AbortSignal.timeout(1500) });
  summary.bridge = await r.json();
} catch {
  summary.bridge = null;
}

/* 4. tell the human */
const steps = [
  `BrowserChatBridge extension v${manifest.version} is staged at:`,
  ``,
  `    ${targetDir}`,
  ``,
  summary.opened.length ? `In the extensions page that just opened (${urls[0]}):` : `Open ${urls[0]} in your browser, then:`,
  `  1. Turn on "Developer mode" (top-right toggle).`,
  `  2. Click "Load unpacked" and pick the folder above.`,
  `     (Already installed? Click the extension's reload ↻ button instead.)`,
  `  3. Make sure you are signed in on the chatgpt.com and gemini.google.com tabs.`,
  ``,
  summary.bridge
    ? `Bridge is running (${summary.bridge.role ?? "leader"}); extension ${summary.bridge.extensionConnected ? "is connected ✓" : "not connected yet — it connects within a few seconds of loading"}.`
    : `No bridge is listening yet; it starts automatically with any Claude Code session that has the bcb plugin enabled.`,
  ``,
  `Verify with /bcb:doctor or the health_check tool.`,
];
console.log(steps.join("\n"));
if (summary.warnings.length) console.log("\nWarnings:\n" + summary.warnings.map((w) => `  - ${w}`).join("\n"));
if (args.json) console.log("\n" + JSON.stringify(summary, null, 2));

/* --------------------------------- helpers -------------------------------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

function findBrowser(preferred) {
  const os = platform();
  const candidates = [];
  const add = (name, paths) => paths.forEach((p) => candidates.push({ name, path: p }));

  if (os === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
    add("chrome", [join(pf, "Google/Chrome/Application/chrome.exe"), join(pf86, "Google/Chrome/Application/chrome.exe"), join(local, "Google/Chrome/Application/chrome.exe")]);
    add("msedge", [join(pf86, "Microsoft/Edge/Application/msedge.exe"), join(pf, "Microsoft/Edge/Application/msedge.exe")]);
    add("brave", [join(pf, "BraveSoftware/Brave-Browser/Application/brave.exe"), join(local, "BraveSoftware/Brave-Browser/Application/brave.exe")]);
  } else if (os === "darwin") {
    add("chrome", ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]);
    add("msedge", ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]);
    add("brave", ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]);
    add("chromium", ["/Applications/Chromium.app/Contents/MacOS/Chromium"]);
  } else {
    const bins = { chrome: ["google-chrome", "google-chrome-stable"], msedge: ["microsoft-edge"], brave: ["brave-browser"], chromium: ["chromium", "chromium-browser"] };
    for (const [name, list] of Object.entries(bins)) {
      for (const b of list) for (const dir of (process.env.PATH ?? "").split(":")) add(name, [join(dir, b)]);
    }
  }

  const existing = candidates.filter((c) => existsSync(c.path));
  if (preferred) return existing.find((c) => c.name === preferred) ?? null;
  // Prefer whichever browser the user most likely uses: Chrome, then Edge, Brave, Chromium.
  const order = ["chrome", "msedge", "brave", "chromium"];
  return order.map((n) => existing.find((c) => c.name === n)).find(Boolean) ?? null;
}
