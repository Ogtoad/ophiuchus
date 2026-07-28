// The familiar roster: named familiar configs — provider, model, endpoint —
// persisted to one hand-editable JSON in the home directory. Instances are
// created lazily and kept, so toggling between familiars keeps each one's
// conversation. OPHI_* env vars seed the file on first run; after that the
// file is the truth (edit it by hand or through §familiar / §set).
//
// Note: apiKey, when set, is stored in this file in plain text — same trust
// model as ~/.netrc or shell profiles. Prefer provider-side auth (claude-code)
// or env where that matters.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider, providerIds, providerList } from "./providerRegistry.js";
import { createFamiliar } from "./familiarManager.js";
import { parseTagStream, tagText } from "./familiarTags.js";

const EDITABLE = ["provider", "model", "baseUrl", "apiKey"];

export function createRoster({ router, lang = "python", env = process.env, file = (process.env.OPHI_CONFIG || join(homedir(), ".ophiuchus.json")) } = {}) {
  let cfg = null;
  let firstRun = false;   // true only on the boot that seeded the config — the setup guide's cue
  try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
  const save = () => { try { writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n"); } catch {} };
  if (!cfg || !cfg.familiars) {
    firstRun = true;
    const name = env.OPHI_FAMILIAR || "familiar";
    cfg = {
      user: (env.OPHI_USER || env.USERNAME || env.USER || "user").toLowerCase(),
      active: name,
      familiars: { [name]: {
        provider: env.OPHI_PROVIDER || "",   // no default — §setup drives the choice
        model: env.OPHI_MODEL || "",
        baseUrl: env.OPHI_BASE_URL || "",
        apiKey: env.OPHI_API_KEY || "",
      } },
    };
    save();
  }

  // Sessions: each familiar's conversation survives restarts, one file per
  // familiar beside the config (~/.ophiuchus.sessions/<name>.json), loaded
  // when the instance is first created and saved after every turn.
  const sessionsDir = file.replace(/\.json$/, "") + ".sessions";
  const sessionFile = (name) => join(sessionsDir, name.replace(/[^a-z0-9_-]/gi, "_") + ".json");
  function loadSession(name) {
    try { return JSON.parse(readFileSync(sessionFile(name), "utf8")); } catch { return []; }
  }
  // Capped — a session is a working memory, not an archive.
  function saveSession(name) {
    if (!instances.has(name)) return;   // nothing in memory beyond what the file has
    try {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(sessionFile(name), JSON.stringify(instances.get(name).history.slice(-200)) + "\n");
    } catch {}
  }

  // Snapshots: §save/§load bundle the familiar's conversation (saved here as
  // JSON) with the kernel namespace (dumped by the console as <name>.dill via
  // dill — the path is handed back for the caller to run the dump/load cell).
  const snapshotsDir = file.replace(/\.json$/, "") + ".snapshots";
  const snapFile = (name, ext) => join(snapshotsDir, name.replace(/[^a-z0-9_-]/gi, "_") + ext);

  const instances = new Map();   // name → live familiar, holding its own history
  function instance(name) {
    if (!instances.has(name)) {
      // Provider config is resolved AT CALL TIME, not baked in: the model or
      // endpoint is a parameter of the next request, nothing more. §provider /
      // §model edits apply on the next turn; the instance — and with it the
      // conversation — is never touched. (Cached per config generation so a
      // provider with internal state, like mock's turn counter, keeps it
      // between calls under an unchanged config.)
      let cache = { key: null, fn: null };
      const provider = (messages, opts) => {
        const fc = cfg.familiars[name];
        const key = [fc.provider, fc.model, fc.baseUrl, fc.apiKey].join("\0");
        if (cache.key !== key) {
          cache = { key, fn: createProvider({ id: fc.provider, model: fc.model || undefined, baseUrl: fc.baseUrl || undefined, apiKey: fc.apiKey || undefined }) };
        }
        return cache.fn(messages, opts);
      };
      instances.set(name, createFamiliar({ router, provider, lang, name, history: loadSession(name) }));
    }
    return instances.get(name);
  }

  return {
    get firstRun() { return firstRun; },
    get user() { return cfg.user; },
    setUser(name) { cfg.user = String(name || "").trim().toLowerCase() || cfg.user; save(); },
    get activeName() { return cfg.active; },
    active() { return instance(cfg.active); },
    list() {
      return Object.entries(cfg.familiars).map(([name, fc]) => ({
        name, active: name === cfg.active, provider: fc.provider, model: fc.model || "",
      }));
    },
    use(name) {
      if (!cfg.familiars[name]) return { error: "no familiar named " + name };
      cfg.active = name; save();
      return { ok: true };
    },
    // A new familiar clones the active one's config — edit from there.
    create(name) {
      if (!/^[a-z][a-z0-9_-]*$/i.test(name || "")) return { error: "names are letters, digits, - and _" };
      if (cfg.familiars[name]) return { error: name + " already exists" };
      cfg.familiars[name] = { ...cfg.familiars[cfg.active] };
      cfg.active = name; save();
      return { ok: true };
    },
    edit(name, key, value) {
      const fc = cfg.familiars[name];
      if (!fc) return { error: "no familiar named " + name };
      if (!EDITABLE.includes(key)) return { error: "editable: " + EDITABLE.join(" ") };
      if (key === "provider") {
        try { createProvider({ id: value }); } catch (e) { return { error: e.message }; }
      }
      fc[key] = value; save();
      // That's all: the provider reads this config on its next call.
      return { ok: true };
    },
    providers: () => providerIds(),
    providerList: () => providerList(),
    snapshots() {
      try { return readdirSync(snapshotsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)); }
      catch { return []; }
    },
    snapshotSave(name) {
      if (!/^[a-z][a-z0-9_-]*$/i.test(name || "")) return { error: "snapshot names are letters, digits, - and _" };
      try {
        mkdirSync(snapshotsDir, { recursive: true });
        writeFileSync(snapFile(name, ".json"), JSON.stringify({ familiar: cfg.active, history: instance(cfg.active).history.slice(-200) }) + "\n");
        return { ok: true, dillPath: snapFile(name, ".dill") };
      } catch (e) { return { error: "snapshot failed: " + e.message }; }
    },
    // Restores the conversation INTO the active familiar (whoever that is now)
    // and returns the dill path for the caller to load the namespace from.
    snapshotLoad(name) {
      let s;
      try { s = JSON.parse(readFileSync(snapFile(name, ".json"), "utf8")); }
      catch { return { error: "no snapshot named " + name }; }
      const inst = instance(cfg.active);
      inst.history.length = 0;
      inst.history.push(...(s.history || []));
      saveSession(cfg.active);
      return { ok: true, dillPath: snapFile(name, ".dill") };
    },
    activeConfig() { return { name: cfg.active, ...cfg.familiars[cfg.active] }; },
    saveActive() { instance(cfg.active); saveSession(cfg.active); },
    // The active conversation as the chat panel shows it: what each side said.
    // Console exchanges (the <console_history> feedback) stay out — they live
    // in the console's own transcript.
    transcript() {
      const out = [];
      for (const m of instance(cfg.active).history) {
        if (m.role === "user" && !m.content.startsWith("<console_history>")) out.push({ who: "you", text: m.content });
        else if (m.role === "assistant") {
          const said = tagText(parseTagStream(m.content), "chat");
          if (said) out.push({ who: "familiar", text: said });
        }
      }
      return out;
    },
    // What models the active provider can actually offer. Ollama answers for
    // itself (its daemon knows what's pulled); the others take any model id,
    // so the caller shows the current value and a hint instead of a list.
    async models() {
      const fc = cfg.familiars[cfg.active];
      if (fc.provider !== "ollama") return { listable: false, current: fc.model || "" };
      try {
        const base = (fc.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
        const res = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(4000) });
        const names = ((await res.json()).models || []).map((m) => m.name);
        return { listable: true, current: fc.model || "", models: names };
      } catch (e) {
        return { listable: false, current: fc.model || "", error: "ollama daemon unreachable: " + e.message };
      }
    },
  };
}

// Self-check — `bun src/familiarRoster.js`. Config logic only; no instances
// are spawned (active() is never called), so no providers or kernels needed.
if (import.meta.main) {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const dir = mkdtempSync(join(tmpdir(), "ophi-roster-"));
  const file = join(dir, "cfg.json");
  const env = { OPHI_USER: "Tester", OPHI_PROVIDER: "mock", OPHI_FAMILIAR: "imp" };

  const r = createRoster({ router: null, env, file });
  assert(r.user === "tester", "env seeds and lowercases the user");
  assert(r.activeName === "imp" && r.list()[0].provider === "mock", "env seeds the first familiar");

  assert(r.create("imp").error, "duplicate names rejected");
  assert(r.create("bad name").error, "invalid names rejected");
  assert(r.create("owl").ok && r.activeName === "owl", "create clones and switches");
  assert(r.list().length === 2, "both familiars listed");
  assert(r.edit("owl", "provider", "nope").error, "unknown provider rejected");
  assert(r.edit("owl", "model", "qwen3").ok, "model edit lands");
  assert(r.use("imp").ok && r.use("ghost").error, "toggle by name, unknown rejected");

  // Snapshot round-trip: the conversation goes out and comes back; the dill
  // path is where the console dumps the kernel side.
  assert(r.snapshots().length === 0, "no snapshots at first");
  assert(r.snapshotSave("bad name").error, "invalid snapshot names rejected");
  r.active().history.push({ role: "user", content: "hello" });
  const saved = r.snapshotSave("t1");
  assert(saved.ok && saved.dillPath.endsWith("t1.dill"), "save returns the dill path");
  r.active().history.length = 0;
  const loaded = r.snapshotLoad("t1");
  assert(loaded.ok && r.active().history[0].content === "hello", "load restores the conversation");
  assert(r.snapshotLoad("ghost").error, "unknown snapshot rejected");
  assert(r.snapshots().join() === "t1", "snapshot listed");

  const r2 = createRoster({ router: null, env: {}, file });
  assert(r2.activeName === "imp" && r2.list().length === 2, "file survives a restart and beats env");
  assert(r2.list().find((f) => f.name === "owl").model === "qwen3", "edits persisted");

  rmSync(dir, { recursive: true, force: true });
  console.log("familiarRoster self-check passed");
}
