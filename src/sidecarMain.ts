// ophi-core: the application core as a Tauri sidecar. One ordered JSON-lines
// stream on stdio — {id, method, args} in; {id, result|error} and
// {push, payload} out. Responses and pushes share the stream, so a cell's
// final result can never overtake its own streamed output.
//
// stdout IS the protocol: all logging is rebound to stderr before anything
// else loads, or a single stray console.log corrupts the pipe.
console.log = (...a: unknown[]) => console.error(...a);

import { createApp } from "./appCore.js";

const out = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");
const app = createApp({ push: (name: string, payload: unknown) => out({ push: name, payload }) });

async function handle(msg: { id: number; method: string; args?: unknown }) {
  const fn = (app.handlers as Record<string, (a: unknown) => unknown>)[msg.method];
  if (!fn) return out({ id: msg.id, error: "unknown method: " + msg.method });
  try {
    out({ id: msg.id, result: (await fn(msg.args ?? {})) ?? null });
  } catch (e: any) {
    out({ id: msg.id, error: e?.message ?? String(e) });
  }
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { console.error("[core] bad frame:", line.slice(0, 120)); }
  }
});

// Parent gone (window closed, shell crashed): kill every kernel and leave.
process.stdin.on("end", () => { app.shutdown(); process.exit(0); });
process.on("exit", app.shutdown);
console.error("[core] ophi-core up");
