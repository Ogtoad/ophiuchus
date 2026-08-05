// The router: langId -> backend, lazy-spawned, one live process per language.
// The console/familiar talk only to this — never to a specific backend.

import { kernelPython } from "./kernelPython.js";
import { kernelJupyter } from "./kernelJupyter.js";
import { kernelC, tccAvailable } from "./kernelC.js";

// Static registry: the fast marker-driver python, always. Everything else is
// DISCOVERED — every installed jupyter kernelspec becomes a language through
// the broker, with zero per-language code: install a kernelspec (julia, go via
// gophernotes, rust via evcxr, deno…), restart nothing, §lang it.
const REGISTRY = {
  python: () => kernelPython(),                  // marker-driver backend (dep-free)
};
// C via `tcc -run` — its own marker driver, no jupyter involved. Only offered
// when a tcc binary is actually present.
if (tccAvailable()) REGISTRY.c = () => kernelC();

// Discovery asks jupyter_client's own API (the same library the broker runs
// on) rather than the `jupyter` CLI, which need not be on PATH. Lazy, cached,
// and a host without jupyter_client just keeps the static registry.
const DISCOVER = ["python", "-c",
  "from jupyter_client.kernelspec import KernelSpecManager; import json; print(json.dumps(list(KernelSpecManager().find_kernel_specs())))"];
let discovered = null;
function discover() {
  discovered ||= (async () => {
    try {
      const proc = Bun.spawn(DISCOVER, { stdout: "pipe", stderr: "ignore" });
      const out = await Promise.race([
        new Response(proc.stdout).text(),
        new Promise((r) => setTimeout(() => r("[]"), 15000)),
      ]);
      for (const name of JSON.parse(out)) {
        if (!REGISTRY[name]) REGISTRY[name] = () => kernelJupyter(name);
      }
    } catch { /* no python or no jupyter_client — static registry stands */ }
    return REGISTRY;
  })();
  return discovered;
}

export function createRouter() {
  const live = new Map();

  function get(langId) {
    const id = langId || "python";
    if (!live.has(id)) {
      const factory = REGISTRY[id];
      if (!factory) throw new Error("no kernel registered for language: " + id);
      live.set(id, factory());
    }
    return live.get(id);
  }

  return {
    languages: async () => Object.keys(await discover()),
    // opts.front — jump the queue (interactive input; see kernelTransport).
    run: (langId, code, opts) => get(langId).run(code, opts),
    // Top-level statements of a block, so each declaration runs as its own
    // cell. `ok` is false while the buffer is still half-written (or genuinely
    // malformed) — callers streaming code use it to hold back. Kernels without
    // the capability report the whole block as one part.
    split: async (langId, code) => {
      const k = get(langId);
      const whole = [{ text: code, end: code.split("\n").length }];
      // Gate on the CAPABILITY, not the method: every transport exposes
      // split(), but a backend whose process ignores the marker would never
      // answer and the job would hang forever.
      if (!k.capabilities || !k.capabilities.split) return { parts: whole, ok: true };
      try {
        const r = await k.split(code);
        return { parts: (r && r.parts && r.parts.length) ? r.parts : whole, ok: !!(r && r.ok) };
      } catch { return { parts: whole, ok: true }; }
    },
    complete: (langId, code, cursor) => get(langId).complete(code, cursor),
    inspect: (langId, name) => get(langId).inspect(name),
    checkComplete: (langId, code) => get(langId).checkComplete(code),
    interrupt: (langId) => get(langId).interrupt(),
    restart: (langId) => { if (live.has(langId || "python")) live.get(langId || "python").restart(); },
    // App exit: kill every live kernel process — they are children of this
    // process and nothing else will reap them.
    shutdown: () => { for (const k of live.values()) { try { k.shutdown(); } catch {} } live.clear(); },
  };
}

// Self-check — `bun src/kernelRouter.js`. Discovery merges installed
// kernelspecs over the static registry; a host without jupyter_client must
// still report the marker-driver python.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const r = createRouter();
  const langs = await r.languages();
  assert(langs.includes("python"), "marker-driver python always present");
  assert(langs[0] === "python", "python listed first (the default)");
  console.log("kernelRouter self-check passed · languages: " + langs.join(" "));
}
