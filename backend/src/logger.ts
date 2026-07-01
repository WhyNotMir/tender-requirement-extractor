// Structured logger: one JSON line per event, so every meaningful step is
// machine-readable (the brief asks for logs it can read).
type Level = "info" | "warn" | "error";

function emit(level: Level, stage: string, msg: string, data?: unknown): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    stage,
    msg,
    ...(data !== undefined ? { data } : {}),
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (stage: string, msg: string, data?: unknown) => emit("info", stage, msg, data),
  warn: (stage: string, msg: string, data?: unknown) => emit("warn", stage, msg, data),
  error: (stage: string, msg: string, data?: unknown) => emit("error", stage, msg, data),
};
