import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  WS_EXTENSION_PATH,
  type ErrorCode,
  type HelloEventData,
  type RequestMap,
  type RequestType,
  type TabDescriptor,
  type WsMessage,
  type WsRequest,
} from "../../shared/protocol.js";
import { log } from "./logger.js";

/**
 * One browser extension, many Claude Code sessions.
 *
 * Every session spawns its own MCP server process, but only one process can
 * own the extension's WebSocket. The first to bind the port becomes the
 * LEADER (WS server + tiny HTTP API). Later processes become FOLLOWERS and
 * forward their calls over HTTP to the leader. If the leader exits, the next
 * call from any follower retries the bind, so leadership heals itself.
 */

export class BcbError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "BcbError";
  }
}

export interface HealthInfo {
  ok: true;
  role: "leader" | "follower";
  version: string;
  protocolVersion: string;
  port: number;
  extensionConnected: boolean;
  extensionVersion?: string;
  extensionProtocolVersion?: string;
  tabs: TabDescriptor[];
  leaderPid?: number;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class Bridge {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private extension: HelloEventData | null = null;
  private pending = new Map<string, Pending>();
  private lastTabs: TabDescriptor[] = [];
  private role: "leader" | "follower" | "unknown" = "unknown";
  private bindInFlight: Promise<void> | null = null;

  constructor(
    private readonly version: string,
    private readonly port = DEFAULT_PORT,
    private readonly host = DEFAULT_HOST,
  ) {}

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /** Try to become leader; on EADDRINUSE become a follower. Idempotent. */
  async ensureRole(): Promise<"leader" | "follower"> {
    if (this.isLeader()) return "leader";
    if (this.bindInFlight) await this.bindInFlight;
    if (this.isLeader()) return "leader";
    this.bindInFlight = this.tryBind();
    try {
      await this.bindInFlight;
    } finally {
      this.bindInFlight = null;
    }
    return this.isLeader() ? "leader" : "follower";
  }

  private isLeader(): boolean {
    return this.role === "leader";
  }

  private async tryBind(): Promise<void> {
    const http = createServer((req, res) => { void this.handleHttp(req, res); });
    const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      const path = (req.url ?? "").split("?")[0];
      const remote = req.socket.remoteAddress ?? "";
      if (path !== WS_EXTENSION_PATH || !isLoopback(remote)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(this.port, this.host, () => {
          http.off("error", reject);
          resolve();
        });
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" || code === "EACCES") {
        this.role = "follower";
        log.info("Port busy; running as follower", { port: this.port });
        wss.close();
        return;
      }
      throw err;
    }
    this.http = http;
    this.wss = wss;
    this.role = "leader";
    log.info("Leader: listening for the extension", { url: this.baseUrl, ws: WS_EXTENSION_PATH });
  }

  async close(): Promise<void> {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BcbError("internal_error", "bridge shutting down"));
      this.pending.delete(id);
    }
    try { this.socket?.close(1001, "bridge shutting down"); } catch { /* noop */ }
    this.socket = null;
    if (this.wss) await new Promise<void>((r) => this.wss!.close(() => r()));
    if (this.http) await new Promise<void>((r) => this.http!.close(() => r()));
    this.wss = null;
    this.http = null;
    this.role = "unknown";
  }

  /* ------------------------------ public API ------------------------------ */

  async health(): Promise<HealthInfo> {
    const role = await this.ensureRole();
    if (role === "leader") {
      return {
        ok: true,
        role,
        version: this.version,
        protocolVersion: PROTOCOL_VERSION,
        port: this.port,
        extensionConnected: this.socket !== null,
        extensionVersion: this.extension?.extensionVersion,
        extensionProtocolVersion: this.extension?.protocolVersion,
        tabs: this.lastTabs,
        leaderPid: process.pid,
      };
    }
    const res = await this.fetchLeader("/health", "GET");
    return { ...(res as HealthInfo), role: "follower" };
  }

  /** Wait for the extension to attach (covers its reconnect backoff after we start). */
  async waitForExtension(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const h = await this.health();
      if (h.extensionConnected) return true;
      if (Date.now() >= deadline) return false;
      await sleep(500);
    }
  }

  async call<T extends RequestType>(type: T, data: RequestMap[T]["req"], timeoutMs: number): Promise<RequestMap[T]["res"]> {
    const role = await this.ensureRole();
    if (role === "leader") return this.sendToExtension(type, data, timeoutMs);
    const res = await this.fetchLeader("/rpc", "POST", { type, data, timeoutMs }, timeoutMs + 5000);
    return res as RequestMap[T]["res"];
  }

  /* ------------------------------ leader side ----------------------------- */

  private attach(ws: WebSocket): void {
    if (this.socket) {
      log.warn("Extension reconnected; replacing previous socket");
      try { this.socket.close(4000, "replaced"); } catch { /* noop */ }
      this.failAll(new BcbError("extension_disconnected", "extension socket replaced"));
    }
    this.socket = ws;
    this.extension = null;
    log.info("Extension connected");
    ws.on("message", (raw) => this.onMessage(raw.toString()));
    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
        this.extension = null;
        log.info("Extension disconnected");
        this.failAll(new BcbError("extension_disconnected", "extension disconnected mid-request"));
      }
    });
    ws.on("error", (err) => log.warn("Extension socket error", { err: String(err) }));
  }

  private onMessage(raw: string): void {
    let msg: WsMessage;
    try { msg = JSON.parse(raw) as WsMessage; } catch { return; }
    if (msg.kind === "event") {
      if (msg.type === "hello") { this.extension = msg.data; log.info("Extension hello", { ...msg.data, userAgent: undefined }); }
      else if (msg.type === "tabsChanged") this.lastTabs = msg.data.tabs;
      return;
    }
    if (msg.kind === "response") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new BcbError(msg.error?.code ?? "internal_error", msg.error?.message ?? "extension reported an error"));
    }
  }

  private sendToExtension<T extends RequestType>(type: T, data: RequestMap[T]["req"], timeoutMs: number): Promise<RequestMap[T]["res"]> {
    if (!this.socket) return Promise.reject(new BcbError("extension_disconnected", "extension is not connected"));
    const id = randomUUID();
    const envelope: WsRequest<T> = { id, kind: "request", type, data };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BcbError("timeout", `${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer });
      try {
        this.socket!.send(JSON.stringify(envelope));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BcbError("extension_disconnected", String((err as Error)?.message ?? err)));
      }
    });
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? "/").split("?")[0];
    if (!isLoopback(req.socket.remoteAddress ?? "")) { json(res, 403, { ok: false, code: "invalid_request", message: "loopback only" }); return; }

    if (req.method === "GET" && url === "/health") {
      json(res, 200, await this.health());
      return;
    }
    if (req.method === "POST" && url === "/rpc") {
      let body: { type?: RequestType; data?: unknown; timeoutMs?: number };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        json(res, 400, { ok: false, code: "invalid_request", message: "bad JSON" });
        return;
      }
      if (!body.type) { json(res, 400, { ok: false, code: "invalid_request", message: "missing type" }); return; }
      try {
        const data = await this.sendToExtension(body.type, body.data as never, body.timeoutMs ?? 30_000);
        json(res, 200, { ok: true, data });
      } catch (err) {
        const e = err as BcbError;
        json(res, 502, { ok: false, code: e.code ?? "internal_error", message: e.message });
      }
      return;
    }
    json(res, 404, { ok: false, code: "invalid_request", message: "not found" });
  }

  /* ----------------------------- follower side ---------------------------- */

  private async fetchLeader(path: string, method: "GET" | "POST", body?: unknown, timeoutMs = 10_000): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(this.baseUrl + path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const parsed = (await r.json()) as { ok: boolean; data?: unknown; code?: ErrorCode; message?: string } & Record<string, unknown>;
      if (path === "/health") return parsed;
      if (!parsed.ok) throw new BcbError(parsed.code ?? "internal_error", parsed.message ?? "leader error");
      return parsed.data;
    } catch (err) {
      if (err instanceof BcbError) throw err;
      // Leader vanished: drop to unknown so the next call retries the bind.
      this.role = "unknown";
      throw new BcbError("extension_disconnected", `Could not reach the bridge leader at ${this.baseUrl}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
