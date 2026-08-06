// The router: one kernel — the IPython marker driver. The console and the
// familiar talk only to this, never to the driver process directly.

import { kernelPython } from "./kernelPython.js";

export function createRouter() {
  let live = null;

  function get() {
    if (!live) live = kernelPython();
    return live;
  }

  return {
    // opts.front — jump the queue (interactive input; see kernelTransport).
    run: (_langId, code, opts) => get().run(code, opts),
    // Top-level statements of a block, so each declaration runs as its own
    // cell. `ok` is false while the buffer is still half-written (or genuinely
    // malformed) — callers streaming code use it to hold back.
    split: async (_langId, code) => {
      const k = get();
      const whole = [{ text: code, end: code.split("\n").length }];
      // Gate on the CAPABILITY, not the method: the transport exposes split(),
      // but a driver that ignores the marker would never answer and the job
      // would hang forever.
      if (!k.capabilities || !k.capabilities.split) return { parts: whole, ok: true };
      try {
        const r = await k.split(code);
        return { parts: (r && r.parts && r.parts.length) ? r.parts : whole, ok: !!(r && r.ok) };
      } catch { return { parts: whole, ok: true }; }
    },
    complete: (_langId, code, cursor) => get().complete(code, cursor),
    inspect: (_langId, name) => get().inspect(name),
    checkComplete: (_langId, code) => get().checkComplete(code),
    interrupt: () => get().interrupt(),
    restart: () => { if (live) live.restart(); },
    // App exit: kill the kernel process — it is a child of this process and
    // nothing else will reap it.
    shutdown: () => { if (live) { try { live.shutdown(); } catch {} } live = null; },
  };
}

// Self-check — `bun src/kernelRouter.js`. The router always gives back the
// marker-driver python.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const r = createRouter();
  assert(typeof r.run === "function", "run exposed");
  assert(typeof r.shutdown === "function", "shutdown exposed");
  console.log("kernelRouter self-check passed · python-only");
}
