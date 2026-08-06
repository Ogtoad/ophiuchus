// The application core — everything the sidecar does: kernel router, familiar
// roster, turn/observer lifecycles, and the full request-handler map the view
// speaks. No shell, no window, no FFI — the same core runs inside the Tauri
// sidecar (bun process). `push(name, payload)` is the one seam: how the core
// streams events (cell output, familiar deltas) back to whatever view
// transport hosts it.

import { createRouter } from "./kernelRouter.js";
import { createRoster } from "./familiarRoster.js";

export function createApp({ push }) {
  // One kernel router, shared by the console and every familiar.
  const router = createRouter();

  // Familiars live in the roster: named configs in ~/.ophiuchus.json (seeded
  // from OPHI_* env on first run), instances kept per name so §familiar
  // toggling keeps each conversation. No default provider — §setup drives.
  const roster = createRoster({ router, lang: "python" });

  // The live familiar turn, so ctrl+c can abort it. A turn holds the kernel
  // queue for as long as it loops — an unkillable one made cells look hung.
  let turn = null;
  // The live OBSERVER turn: after each human cell the familiar gets one look
  // at what ran and may react; the prompt teaches that silence is the default.
  let observerTurn = null;

  function abortTurns() {
    turn?.abort(); turn = null;
    observerTurn?.abort(); observerTurn = null;
  }

  // Session trace — every cell, who ran it, how long, how it ended.
  let seq = 0;
  async function trace(who, code, work) {
    const n = ++seq;
    const one = code.replace(/\s+/g, " ").slice(0, 70);
    const t0 = Date.now();
    console.log(`[cell ${n}] ${who} > ${one}`);
    try {
      const r = await work();
      const bits = [
        r?.stdout ? `stdout ${JSON.stringify(String(r.stdout).slice(0, 60))}` : "",
        r?.displays?.length ? `displays ${r.displays.length}` : "",
        r?.stderr ? "stderr" : "",
        r?.error ? `ERROR ${JSON.stringify(String(r.error).split("\n").filter(Boolean).pop()?.slice(0, 80))}` : "",
      ].filter(Boolean).join(" · ") || "(no output)";
      console.log(`[cell ${n}] ${who} < ${Date.now() - t0}ms ${bits}`);
      return r;
    } catch (e) {
      console.log(`[cell ${n}] ${who} < ${Date.now() - t0}ms THREW ${e.message}`);
      throw e;
    }
  }

  // Observer: fire-and-forget after a human cell; superseded by the next cell
  // or a real chat send; provider failures dropped silently (an unconfigured
  // provider must not turn every cell into an error note).
  function observeCell(code, result) {
    observerTurn?.abort();
    observerTurn = new AbortController();
    const signal = observerTurn.signal;
    const familiar = roster.active();
    familiar.observeCell(code, result, {
      signal,
      onDelta: (t) => push("familiarDelta", { text: t }),
      onConsoleStart: () => push("familiarConsoleStart", {}),
      onConsoleResult: (c, r) => push("familiarConsoleResult", { code: c, result: r }),
      onCell: (c) => trace("familiar", c, () => router.run("python", c, { preemptible: true })),
    }).then(() => {
      if (!signal.aborted) { push("familiarDone", {}); roster.saveActive(); }
    }).catch((e) => console.log(`[observe] dropped: ${e.message}`));
  }

  const handlers = {
    // Typed by the human: front of the queue, preempting a familiar cell
    // mid-flight. onOutput streams lines live; the result is authoritative.
    runCell: async ({ code }) => {
      const r = await trace("human", code, () =>
        router.run("python", code, { front: true, preempt: true, onOutput: (o) => push("cellOutput", o) }));
      observeCell(code, r);   // the cell's result never waits on the familiar
      return r;
    },
    complete: async ({ code, cursor }) => router.complete("python", code, cursor),
    inspect: async ({ name }) => router.inspect("python", name),
    // First-boot dependency probe: is python real (not the Windows Store
    // alias), and which packages exist. find_spec, not import — fast, no side
    // effects. The console turns this into install guidance.
    kernelHealth: async () => {
      const MODS = ["IPython", "jedi", "dill", "winpty", "matplotlib", "matplotlib_inline"];
      const probe = `import json,sys,importlib.util as u;print(json.dumps({"python":sys.version.split()[0],"exe":sys.executable,"mods":{m:bool(u.find_spec(m)) for m in ${JSON.stringify(MODS)}}}))`;
      try {
        const p = Bun.spawn(["python", "-c", probe], { stdout: "pipe", stderr: "pipe" });
        const out = await Promise.race([
          new Response(p.stdout).text(),
          new Promise((r) => setTimeout(() => { try { p.kill(); } catch {} r(""); }, 8000)),
        ]);
        const code = await p.exited;
        const line = (String(out).trim().split("\n").pop() || "");
        if (code !== 0 || !line.startsWith("{")) return { ok: false };
        return { ok: true, ...JSON.parse(line) };
      } catch {
        return { ok: false };
      }
    },
    restartKernel: () => { router.restart(); return { ok: true }; },
    interruptKernel: () => { router.interrupt(); return { ok: true }; },
    sendToFamiliar: async ({ text }) => {
      const familiar = roster.active();
      console.log(`[turn] start (${roster.activeName}): ${JSON.stringify(String(text).slice(0, 80))}`);
      const turnT0 = Date.now();
      // One turn at a time; a real question supersedes a mulling observer too.
      abortTurns();
      turn = new AbortController();
      const signal = turn.signal;
      await familiar.send(text, {
        signal,
        onDelta: (t) => push("familiarDelta", { text: t }),
        onStatus: (s) => { console.log(`[turn] status: ${s}`); push("familiarStatus", { text: s }); },
        onConsoleStart: () => push("familiarConsoleStart", {}),
        onConsoleResult: (code, result) => push("familiarConsoleResult", { code, result }),
        onCell: (code) => trace("familiar", code, () => router.run("python", code, { preemptible: true })),
      });
      push("familiarDone", {});
      console.log(`[turn] end after ${Date.now() - turnT0}ms`);
      turn = null;
      roster.saveActive();   // the conversation survives a restart
      return { ok: true };
    },
    // ctrl+c: stop the familiar's loop (the kernel interrupt travels separately).
    cancelFamiliar: () => {
      const had = !!turn || !!observerTurn;
      console.log(`[cancel] ctrl+c — familiar turn ${had ? "aborted" : "was idle"}`);
      abortTurns();
      return { aborted: had };
    },
    clearFamiliar: () => { roster.active().clear(); roster.saveActive(); return { ok: true }; },
    transcript: () => ({ items: roster.transcript() }),
    identity: () => ({ user: roster.user, familiar: roster.activeName }),
    config: () => ({ user: roster.user, active: roster.activeName, familiars: roster.list(), firstRun: roster.firstRun }),
    setUser: ({ name }) => { roster.setUser(name); return { ok: true, user: roster.user }; },
    // Switching, creating, or restoring mid-turn aborts the turn: it belongs
    // to the conversation that was speaking, not the one arriving.
    familiarUse: ({ name }) => { const r = roster.use(name); if (r.ok) abortTurns(); return r; },
    familiarNew: ({ name }) => { const r = roster.create(name); if (r.ok) abortTurns(); return r; },
    familiarEdit: ({ name, key, value }) => roster.edit(name, key, value),
    snapshots: () => ({ names: roster.snapshots() }),
    snapshotSave: ({ name }) => roster.snapshotSave(name),
    snapshotLoad: ({ name }) => { const r = roster.snapshotLoad(name); if (r.ok) abortTurns(); return r; },
    providers: () => ({ ids: roster.providers(), list: roster.providerList(), active: roster.activeConfig() }),
    models: () => roster.models(),
    // Renderer reports it mounted — the only in-app signal the boxed view
    // wired up cleanly.
    viewReady: (info) => {
      console.log(`view ready: ${info.boxes} boxes · console=${info.console} familiar=${info.familiar} · inputs=${info.inputs}${info.inputs === 1 ? " (single-input ok)" : " (EXPECTED 1)"} · layout=${info.layout} · drag=${info.drag}`);
      return { ok: true };
    },
  };

  // App exit: abort turns and kill every kernel — they are children of this
  // process and nothing else reaps them.
  function shutdown() {
    abortTurns();
    router.shutdown();
  }

  return { handlers, router, roster, trace, shutdown };
}
