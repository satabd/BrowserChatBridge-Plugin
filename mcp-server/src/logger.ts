/** stderr-only logger: stdout belongs to the MCP stdio transport. */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const level: LogLevel = ((process.env.BCB_LOG_LEVEL as LogLevel | undefined) ?? "info");

function emit(l: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[l] < ORDER[level]) return;
  const extra = meta && Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  process.stderr.write(`[bcb ${l}] ${msg}${extra}\n`);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};
