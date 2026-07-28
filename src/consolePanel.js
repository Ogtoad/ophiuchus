// THE console — one kernel, one namespace, therefore one session view. Cells
// from the human and from the familiar land in the same transcript, numbered by
// the same In[n] counter, because that is literally what the kernel sees. The
// familiar has no console of its own to mirror; this is its console too.
//
// This input is the app's ONLY text entry — logos's design, and the reason the
// familiar panel has no composer. The keybinding decides the destination:
//   ctrl+↵        run the code in the kernel
//   alt/altgr+↵   send the same text to the familiar
//   ↵             newline
// The empty field is the manual: the placeholder always names the two gestures
// and changes to report state (executing, kernel down, familiar streaming).

import { createKeybindings } from "./workspaceKeys.js";
import { highlight } from "./consoleText.js";

export function initConsole(electrobun, familiar) {
  const req = electrobun.rpc.request;
  const $ = (id) => document.getElementById(id);
  const output = $("output"), input = $("input"), overlay = $("overlay");
  const inputRow = $("inputRow"), ps1 = $("ps1");

  const keys = createKeybindings();
  const consoleHint = keys.format("sendToConsole");   // ctrl+↵
  const chatHint = keys.format("sendToChat");         // alt/altgr+↵

  let lang = "python";
  let executing = false;
  let kernelUp = true;
  const history = [];          // submitted lines, for ArrowUp/Down recall
  let historyIndex = -1;

  const trimEnd = (s) => String(s || "").replace(/\n+$/, "");
  const stick = () => { output.scrollTop = output.scrollHeight; };

  // ── Output rendering ────────────────────────────────────────────────
  // Everything is inserted BEFORE the live prompt: it is always the last line,
  // the way a terminal keeps its cursor at the bottom.
  const place = (el) => { output.insertBefore(el, inputRow); stick(); };

  // One session counter for both parties — In[n] is the kernel's own numbering,
  // so it must not restart or fork per author.
  let cellNo = 0;
  const promptLabel = (n) => `In [${n}]:`;

  // ── Session: the transcript survives restarts ───────────────────────
  // Data, not DOM: every cell records {n, who, code, outs}, saved debounced to
  // localStorage and replayed on boot. The kernel's namespace does NOT survive
  // — the restored record ends by saying so.
  const STORE = "ophi.transcript.v1";
  const log = [];
  let saveT = 0;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        let slice = log.slice(-150);
        let json = JSON.stringify({ cellNo, entries: slice });
        while (json.length > 3_500_000 && slice.length > 1) {  // localStorage budget; oldest (and their images) fall off first
          slice = slice.slice(Math.ceil(slice.length / 4));
          json = JSON.stringify({ cellNo, entries: slice });
        }
        localStorage.setItem(STORE, json);
      } catch { /* storage full or denied — the session just won't persist */ }
    }, 400);
  }
  function restoreSession() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE) || ""); } catch {}
    if (!s || !s.entries || !s.entries.length) return;
    for (const rec of s.entries) {
      cellNo = (rec.n || cellNo + 1) - 1;        // addEntry re-increments; keeps original numbering
      const entry = addEntry(rec.code, rec.who);
      for (const o of rec.outs || []) {
        if (o.d) addDisplay(entry, o.d);
        else addOutput(entry, o.t, o.k);
      }
    }
    cellNo = Math.max(cellNo, s.cellNo || 0);
    updatePrompt();
    addNote("— session restored · kernel state does not persist, re-run what you need —");
  }

  // An entry renders as IPython does: In [n]: with ...: continuations, output
  // beneath, Out[n]: for the echoed value. `who` only tints the prompt.
  function addEntry(code, who) {
    cellNo += 1;
    const entry = document.createElement("div");
    entry.className = "entry " + (who || "human");
    entry._n = cellNo;
    entry._rec = { n: cellNo, who: who || "human", code, outs: [] };
    log.push(entry._rec); saveSoon();
    const line = document.createElement("div");
    line.className = "input-line";
    const ps = document.createElement("span");
    ps.className = "ps";
    ps.textContent = promptLabel(cellNo);
    const pre = document.createElement("pre");
    pre.appendChild(highlight(code, lang));
    line.append(ps, pre);
    entry.appendChild(line);
    if (who === "familiar") {
      const tag = document.createElement("span");
      tag.className = "by";
      tag.textContent = "familiar";
      line.appendChild(tag);
    }
    place(entry);
    updatePrompt();
    return entry;
  }

  function addOutput(entry, text, type) {
    if (!text) return null;
    if (entry._rec) { entry._rec.outs.push({ k: type || "", t: text }); saveSoon(); }
    const pre = document.createElement("pre");
    pre.className = "out-line" + (type ? " " + type : "");
    // stdout/result read as code; errors stay literal.
    if (type === "stderr" || type === "error") pre.textContent = trimEnd(text);
    else pre.appendChild(highlight(trimEnd(text), lang));
    entry.appendChild(pre);
    stick();
    return pre;
  }

  function addDisplay(entry, bundle) {
    if (entry._rec) { entry._rec.outs.push({ d: bundle }); saveSoon(); }
    const data = (bundle && bundle.data) || {};
    if (data["image/png"]) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + data["image/png"];
      entry.appendChild(img); stick(); return;
    }
    // execute_result is the echoed value of the last expression — Out[n].
    if (data["text/plain"]) {
      const isResult = bundle && bundle.kind === "result";
      const pre = document.createElement("pre");
      pre.className = "out-line" + (isResult ? " result" : "");
      if (isResult) {
        const lbl = document.createElement("span");
        lbl.className = "outlabel";
        lbl.textContent = `Out[${entry._n}]: `;
        pre.appendChild(lbl);
      }
      pre.appendChild(highlight(trimEnd(data["text/plain"]), lang));
      entry.appendChild(pre); stick();
    }
  }

  // Attach a whole kernel result to an entry, in kernel order.
  function attachResult(entry, r) {
    addOutput(entry, r.stdout, "");
    for (const d of r.displays || []) addDisplay(entry, d);
    addOutput(entry, r.stderr, "stderr");
    addOutput(entry, r.error, "error");
  }

  function addNote(text) {
    const el = document.createElement("pre");
    el.className = "out-line info";
    el.textContent = text;
    place(el);
  }

  // No status bar to report into: the live prompt itself carries kernel state —
  // it stops glowing while a cell runs, and the placeholder says why.
  function setKernelState(state) {
    kernelUp = state !== "dead";
    inputRow.classList.toggle("busy", state === "busy" || state === "dead");
    paintOverlay();
  }

  // ── Input: no instructions in the field ─────────────────────────────
  // The empty prompt is empty — §help is the manual. Only a dead kernel still
  // speaks, because silence there reads as the app being broken.
  function placeholder() {
    return kernelUp ? "" : `${lang} not running`;
  }

  // The live prompt is the session's next cell number.
  function updatePrompt() { ps1.textContent = promptLabel(cellNo + 1); }

  // Typed characters are born glowing and cool to ink — the same phosphor the
  // familiar speaks with. Identity across repaints comes from a per-character
  // birth time and a NEGATIVE animation-delay: each repaint resumes a glyph's
  // settle mid-flight instead of restarting it. Any edit re-births everything
  // after the edit point, so ages always run old-prefix → young-tail, and the
  // settled prefix can be syntax highlighted as one piece.
  const SETTLE_MS = 1000;              // matches the charSettle animation
  let borns = [];                      // birth time per character of input.value
  let prevVal = "";
  let settleTimer = 0;

  function trackBirths() {
    const v = input.value, now = performance.now();
    let p = 0;
    while (p < v.length && p < prevVal.length && v[p] === prevVal[p]) p++;
    borns.length = p;
    while (borns.length < v.length) borns.push(now);
    prevVal = v;
  }

  function paintOverlay() {
    trackBirths();
    clearTimeout(settleTimer); settleTimer = 0;
    overlay.replaceChildren();
    const v = input.value;
    if (!v) {
      const t = placeholder();
      if (t) {
        const ph = document.createElement("span");
        ph.className = "placeholder";
        ph.textContent = t;
        overlay.appendChild(ph);
      }
      overlay.scrollTop = input.scrollTop;
      return;
    }
    const now = performance.now();
    let split = v.length;
    for (let i = 0; i < v.length; i++) if (now - borns[i] < SETTLE_MS) { split = i; break; }
    if (split > 0) overlay.appendChild(highlight(v.slice(0, split), lang));
    for (let i = split; i < v.length; i++) {
      if (v[i] === "\n") { overlay.appendChild(document.createTextNode("\n")); continue; }
      const s = document.createElement("span");
      s.className = "ch";
      s.style.animationDelay = -(now - borns[i]) + "ms";
      s.textContent = v[i];
      overlay.appendChild(s);
    }
    // A trailing newline renders no line box in pre-wrap, so the overlay (the
    // row's height authority) wouldn't grow and the caret would have no
    // visible new line to land on. A zero-width space gives the empty last
    // line a line box without occupying a column.
    if (v.endsWith("\n")) overlay.appendChild(document.createTextNode("\u200b"));
    // Re-paint as the oldest glowing glyph settles, folding it into syntax.
    if (split < v.length) settleTimer = setTimeout(paintOverlay, SETTLE_MS - (now - borns[split]) + 30);
    overlay.scrollTop = input.scrollTop;
  }

  // ── Submit paths — same text, two destinations ──────────────────────
  // `?name` / `name?` — IPython's own help gesture. It asks the LIVE kernel,
  // so it answers for whatever the session actually holds right now, including
  // things the familiar declared a moment ago.
  async function inspectName(name) {
    const entry = addEntry("?" + name, "human");
    try {
      const r = await req.inspect({ name, lang });
      if (!r || !r.found) { addOutput(entry, "no object named " + name + " in this session", "stderr"); return; }
      const head = [r.type && ("type: " + r.type), r.signature].filter(Boolean).join("\n");
      if (head) addOutput(entry, head, "");
      addOutput(entry, r.doc || "(no docstring)", r.doc ? "info" : "");
    } catch (e) {
      addOutput(entry, "inspect failed: " + ((e && e.message) || e), "error");
    }
  }

  // The entry of the human cell currently executing — where streamed output
  // lands. Output streams line by line while the cell runs (the transport taps
  // the same lines it accumulates), so a long cell is visibly alive instead of
  // a bare blinking cursor. One at a time by the `executing` guard.
  let liveEntry = null;
  function liveOutput(o) {
    if (!liveEntry || !o) return;
    if (o.kind === "display") return addDisplay(liveEntry, o.bundle);
    if (o.kind === "error") liveEntry._streamedError = true;
    const cls = o.kind === "stdout" ? "" : o.kind;
    // A `cr` line is a progress update (tqdm, pip): while one is pending, the
    // next line of the same stream OVERWRITES it — a terminal's carriage
    // return, not a thousand stacked lines.
    if (liveEntry._crEl && liveEntry._crCls === cls) {
      liveEntry._crEl.textContent = o.text;
      const outs = liveEntry._rec && liveEntry._rec.outs;
      if (outs && outs.length) outs[outs.length - 1] = { k: cls, t: o.text };
      if (!o.cr) liveEntry._crEl = null;
      stick();
      return;
    }
    // A blank stdout line is a line — keep the vertical gap it printed.
    const el = addOutput(liveEntry, o.text === "" ? " " : o.text, cls);
    if (o.cr && el) { liveEntry._crEl = el; liveEntry._crCls = cls; }
  }

  async function runCode(code) {
    if (executing) return;
    const t = code.trim();
    if (t.startsWith("§")) return meta(t);
    // Bare % — the kernel's own magic listing answers (%lsmagic in IPython).
    if (t === "%") return runCode("%lsmagic");
    // ?name or name? — but not a bare "?" and not multi-line code.
    const q = !t.includes("\n") && (/^\?\s*(\S.*)$/.exec(t) || /^(\S.*?)\s*\?$/.exec(t));
    if (q) return inspectName(q[1].trim());

    const entry = addEntry(code, "human");
    executing = true; liveEntry = entry; setKernelState("busy"); paintOverlay();
    const cursor = document.createElement("div");
    cursor.className = "executing";
    cursor.textContent = "|";
    place(cursor);
    try {
      const r = await req.runCell({ code, lang });
      // Everything already streamed in; only an error that never crossed the
      // stream (a restart resolving the queue, a backend without the tap)
      // still needs attaching, or it would vanish.
      if (r && r.error && !entry._streamedError) addOutput(entry, r.error, "error");
    } catch (e) {
      addOutput(entry, "kernel error: " + ((e && e.message) || e), "error");
    } finally {
      cursor.remove(); liveEntry = null;
      executing = false; setKernelState("ready"); input.focus();
    }
  }

  function submitConsole() {
    const code = input.value.trimEnd();
    if (!code.trim() || executing) return;
    history.push(code); historyIndex = -1;
    input.value = ""; autogrow(); paintOverlay();
    runCode(code);
  }

  function submitChat() {
    const text = input.value.trim();
    if (!text) return;
    history.push(text); historyIndex = -1;
    input.value = ""; autogrow(); paintOverlay();
    // The lang rides along: the familiar writes for the kernel the console is on.
    if (familiar) familiar.sendFromConsole(text, lang);
    else addNote("(familiar not mounted)");
  }

  // § lines are meta-commands, handled here — never sent to the kernel.
  // Bare § lists the commands; bare §lang / §set / §familiar list their
  // subjects. This on-demand text is the manual the idle UI no longer carries.
  async function meta(cmd) {
    const [name, ...rest] = cmd.slice(1).trim().split(/\s+/).filter(Boolean);
    try {
      if (!name) {
        addNote([
          "§lang [name] — list kernels | switch",
          "§provider [id] — list providers | set the active familiar's",
          "§model [name] — list/show models | set the active familiar's",
          "§set [key value] — list settings | change one",
          "§familiar [name | new <name> | <name> <key> <value> | clear]",
          "§clear [chat|all] — console | chat | both + kernel restart",
          "§save / §load [name] — snapshot / restore kernel + conversation (python, needs dill)",
          "§setup — provider/model setup guide",
          "§restart · §interrupt",
          `?name inspects · ${consoleHint} run · ${chatHint} chat`,
        ].join("\n"));
      }
      // Clear the history but never the live prompt — it IS the input.
      // The saved session goes with it: clear means clear. `all` also restarts
      // the kernel, so console, chat and namespace start over together.
      else if (name === "clear") {
        const scope = rest[0] || "console";
        if (!["console", "chat", "all"].includes(scope)) { addNote("§clear [chat|all] — console (default) | chat | both + kernel restart"); }
        else {
          if (scope !== "chat") { output.replaceChildren(inputRow); cellNo = 0; log.length = 0; saveSoon(); updatePrompt(); }
          if (scope !== "console") { familiar && familiar.clearTranscript(); addNote("— familiar transcript cleared —"); }
          if (scope === "all") { req.restartKernel({ lang }); addNote("— " + lang + " kernel restarted —"); }
        }
      }
      else if (name === "setup") { await setupGuide(); }
      // §save/§load — the kernel namespace is dumped/loaded IN the kernel (a
      // visible dill cell, so failures speak as tracebacks); the familiar's
      // conversation rides along via the roster. Python-only: dill is the
      // serializer, and it must run inside the session that owns the objects.
      else if (name === "save" || name === "load") {
        const snap = rest[0];
        if (!snap) {
          const s = await req.snapshots({});
          addNote(s.names.length
            ? "snapshots: " + s.names.join("  ") + "\n§save <name> stores · §load <name> restores"
            : "no snapshots yet — §save <name> stores kernel state + familiar conversation");
        } else if (lang !== "python") {
          addNote("§save/§load need the python kernel — §lang python first");
        } else if (name === "save") {
          const r = await req.snapshotSave({ name: snap });
          if (r.error) addNote(r.error);
          else {
            await runCode("import dill; dill.dump_session(r'" + r.dillPath + "')");
            addNote("— snapshot " + snap + ": kernel + conversation (dill missing? !pip install dill) —");
          }
        } else {
          const r = await req.snapshotLoad({ name: snap });
          if (r.error) addNote(r.error);
          else {
            familiar && familiar.endReply();
            const t = await req.transcript({});
            familiar && familiar.renderTranscript(t.items || []);
            await runCode("import dill; dill.load_session(r'" + r.dillPath + "')");
            addNote("— snapshot " + snap + " restored —");
          }
        }
      }
      else if (name === "restart") {
        req.restartKernel({ lang });
        addNote("— " + lang + " kernel restarted —");
        // The retry path after installing something: re-probe, lift the dead
        // state if the world is whole now.
        if (lang === "python" && await checkKernelDeps(false)) setKernelState("ready");
      }
      else if (name === "interrupt") { req.interruptKernel({ lang }); addNote("— interrupt sent —"); }
      else if (name === "lang") {
        if (!rest.length) addNote("languages: " + languages.map((l) => (l === lang ? "▸" + l : l)).join("  "));
        else switchLang(rest[0]);
      }
      else if (name === "provider") {
        const p = await req.providers({});
        if (!rest.length) {
          addNote("providers: " + p.ids.map((id) => (id === p.active.provider ? "▸" + id : id)).join("  ") +
            `\nactive familiar (${p.active.name}): ${p.active.provider}${p.active.model ? " · " + p.active.model : ""}`);
        } else {
          const r = await req.familiarEdit({ name: p.active.name, key: "provider", value: rest[0] });
          addNote(r.error ? r.error : "— " + p.active.name + " → " + rest[0] + " —");
        }
      }
      else if (name === "model") {
        const p = await req.providers({});
        if (!rest.length) {
          const m = await req.models({});
          if (m.listable) addNote("models (" + p.active.provider + "): " + m.models.map((x) => (x === m.current ? "▸" + x : x)).join("  "));
          else addNote("model: " + (m.current || "(provider default)") + (m.error ? "\n" + m.error : "\n(§model <id> sets it — " + p.active.provider + " takes any model id)"));
        } else {
          const r = await req.familiarEdit({ name: p.active.name, key: "model", value: rest[0] });
          addNote(r.error ? r.error : "— " + p.active.name + " model → " + rest[0] + " —");
        }
      }
      else if (name === "set") {
        if (!rest.length) {
          const c = await req.config({});
          const pad = (window.__pad && window.__pad.get()) ?? 0.6;
          addNote(`settings:\n  user ${c.user}\n  pad ${pad.toFixed(2)}  (vmin — also alt+wheel)`);
        } else if (rest[0] === "user" && rest[1]) {
          const r = await req.setUser({ name: rest[1] });
          familiar && familiar.setNames && familiar.setNames({ user: r.user });
          addNote("— user → " + r.user + " —");
        } else if (rest[0] === "pad" && rest[1] !== undefined) {
          const v = parseFloat(rest[1]);
          if (isNaN(v) || !window.__pad) addNote("pad is a number of vmin, e.g. §set pad 1.2");
          else { window.__pad.set(v); addNote("— pad → " + window.__pad.get().toFixed(2) + " —"); }
        } else addNote("no such setting: " + rest[0] + " (bare §set lists them)");
      }
      else if (name === "familiar") {
        if (!rest.length) {
          const c = await req.config({});
          addNote("familiars:\n" + c.familiars.map((f) =>
            `  ${f.active ? "▸" : " "} ${f.name} — ${f.provider}${f.model ? " · " + f.model : ""}`).join("\n"));
        } else if (rest[0] === "clear") {
          familiar && familiar.clearTranscript();
          addNote("— familiar transcript cleared —");
        } else if (rest[0] === "new" && rest[1]) {
          const r = await req.familiarNew({ name: rest[1] });
          if (r.error) addNote(r.error);
          else {
            familiar && familiar.setNames({ familiar: rest[1] });
            familiar && familiar.renderTranscript([]);
            addNote("— familiar → " + rest[1] + " (new, config cloned; edit with §familiar " + rest[1] + " <key> <value>) —");
          }
        } else if (rest.length === 3) {
          const r = await req.familiarEdit({ name: rest[0], key: rest[1], value: rest[2] });
          addNote(r.error ? r.error : "— " + rest[0] + "." + rest[1] + " → " + rest[2] + " —");
        } else if (rest.length === 1) {
          const r = await req.familiarUse({ name: rest[0] });
          if (r.error) addNote(r.error + " (§familiar new " + rest[0] + " creates it)");
          else {
            // Switch the chat panel to the arriving familiar's own conversation.
            familiar && familiar.setNames({ familiar: rest[0] });
            const t = await req.transcript({});
            familiar && familiar.renderTranscript(t.items || []);
            addNote("— familiar → " + rest[0] + " —");
          }
        } else addNote("§familiar [name | new <name> | <name> <key> <value> | clear]");
      }
      else addOutput(addEntry(cmd), "unknown § command: §" + name + " (bare § lists them)", "error");
    } catch (e) {
      addNote("§ failed: " + ((e && e.message) || e));
    }
    input.focus();
  }

  // The setup wizard, console-style: a printed walk through the § commands
  // that configure a familiar. Shown on the first-ever boot (fresh config)
  // and on demand via §setup — the § commands themselves ARE the wizard's
  // input fields, so no modal, no state machine.
  async function setupGuide() {
    try {
      const p = await req.providers({});
      const f = p.active;
      addNote([
        "— setup —",
        `familiar "${f.name}"`,
        `  provider ${f.provider || "(not set)"} · model ${f.model || "(provider default)"}`,
        `  endpoint ${f.baseUrl || "(provider default)"} · apiKey ${f.apiKey ? "set" : "not set"}`,
        "",
        "providers:",
        ...(p.list || p.ids.map((id) => ({ id, desc: "" }))).map(
          (x) => `  ${x.id === f.provider ? "▸" : " "} ${x.id}${x.desc ? " — " + x.desc : ""}`),
        "",
        `(type a command at the prompt below, run it with ${consoleHint})`,
        "",
        "1. §provider <id> — pick one",
        "2. §model <name> — set the model (bare §model shows what's available)",
        `3. §familiar ${f.name} apiKey <key> — if the provider needs one`,
        `4. §familiar ${f.name} baseUrl <url> — optional custom endpoint (any /v1-compatible server, ollama daemon, …)`,
        `5. ${chatHint} sends what you typed to the familiar — try: hi`,
        "",
        "§setup shows this again · bare § lists every command",
      ].join("\n"));
      await checkKernelDeps(true);   // console requirements, verbose form
    } catch (e) {
      addNote("setup guide unavailable: " + ((e && e.message) || e));
    }
  }

  // The console's own prerequisites, checked against reality at boot and after
  // §restart. Silent when healthy; when python or the core packages are
  // missing this is the guided path — exact commands, then §restart.
  const OPTIONAL = [
    ["dill", "dill", "§save/§load snapshots"],
    ["winpty", "pywinpty", "live ! command output"],
    ["jupyter_client", "jupyter_client ipykernel", "more languages via §lang"],
    ["matplotlib_inline", "matplotlib-inline", "inline plots"],
  ];
  async function checkKernelDeps(verbose) {
    try {
      const h = await req.kernelHealth({});
      if (!h.ok) {
        setKernelState("dead");
        addNote([
          "python was not found — the console needs it.",
          "  1. install python: https://python.org  (or: winget install Python.Python.3.12)",
          "  2. pip install ipython jedi",
          "  3. §restart",
        ].join("\n"));
        return false;
      }
      const core = ["IPython", "jedi"].filter((m) => !h.mods[m]);
      if (core.length) {
        setKernelState("dead");
        addNote(`python ${h.python} found, but the console needs ${core.join(" + ")}:\n  pip install ipython jedi   then §restart`);
        return false;
      }
      const opt = OPTIONAL.filter(([mod]) => !h.mods[mod]);
      if (verbose) {
        addNote(`console: python ${h.python} · ${h.exe}` + (opt.length
          ? "\noptional, not installed:" + opt.map(([, pkg, why]) => `\n  pip install ${pkg} — ${why}`).join("")
          : " · all optional packages present"));
      }
      return true;
    } catch { return true; /* probe is best-effort — never block a working console */ }
  }

  let languages = ["python"];
  function switchLang(name) {
    if (!name || !languages.includes(name)) { addNote("no such language: " + name); return; }
    lang = name;
    updatePrompt();   // In [n] is the prompt for every kernel, not >>>
    if (familiar && familiar.setLang) familiar.setLang(lang);
    setKernelState("ready");
    addNote("— language → " + lang + " —");
  }

  // ── Completion (kernel-backed, inline) ──────────────────────────────
  async function complete() {
    const code = input.value, cursor = input.selectionStart;
    try {
      const r = await req.complete({ code, cursor, lang });
      const matches = (r.matches || []).map((m) => m.text).filter(Boolean);
      if (!matches.length) return;
      let prefix = matches[0];
      for (const m of matches) while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
      if (prefix && r.start != null && r.end != null) {
        input.value = code.slice(0, r.start) + prefix + code.slice(r.end);
        const pos = r.start + prefix.length;
        input.setSelectionRange(pos, pos);
        paintOverlay();
      }
      if (matches.length > 1) addNote(matches.slice(0, 40).join("   "));
    } catch { /* completion is best-effort */ }
  }

  // No fixed input pane any more: the overlay sits in flow and defines the
  // row's height, so the prompt grows downward as you type and the scroll
  // follows it. Nothing to size by hand.
  function autogrow() { stick(); }

  // ── Key routing ─────────────────────────────────────────────────────
  input.addEventListener("input", () => { historyIndex = -1; paintOverlay(); stick(); });
  // Ctrl+C: the terminal contract. With text selected it copies (the OS default
  // does that for us); with nothing selected it cancels whatever is in flight —
  // the running cell AND the familiar's turn, since the turn is what holds the
  // kernel queue and makes a later cell look like a hang.
  async function cancelInFlight() {
    const busy = executing || (familiar && familiar.isStreaming && familiar.isStreaming());
    if (!busy) return false;
    try { await req.interruptKernel({ lang }); } catch {}
    try { await req.cancelFamiliar({}); } catch {}
    if (familiar && familiar.endReply) familiar.endReply();
    addNote("^C");
    executing = false; setKernelState("ready");
    return true;
  }

  input.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      if (String(window.getSelection())) return;   // a selection means copy
      e.preventDefault();
      cancelInFlight();
      return;
    }
    const action = keys.matchAction(e);
    if (action === "sendToConsole") { e.preventDefault(); submitConsole(); return; }
    if (action === "sendToChat") { e.preventDefault(); submitChat(); return; }

    // Plain enter: smart indent. The new line inherits the current line's
    // leading whitespace, plus one level when the line opens a block
    // (a trailing ":" in python, "{" elsewhere). Two spaces, matching Tab.
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const start = input.selectionStart, end = input.selectionEnd;
      const before = input.value.slice(0, start);
      const line = before.slice(before.lastIndexOf("\n") + 1);
      let indent = /^[ \t]*/.exec(line)[0];
      if (/[:{]\s*$/.test(line)) indent += "  ";
      input.value = before + "\n" + indent + input.value.slice(end);
      const pos = start + 1 + indent.length;
      input.setSelectionRange(pos, pos);
      historyIndex = -1;
      paintOverlay(); stick();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const start = input.selectionStart, end = input.selectionEnd;
      // Tab after a word asks the kernel; at a line start it indents.
      if (start === end && /[\w.)\]'"]$/.test(input.value.slice(0, start))) { complete(); return; }
      input.value = input.value.slice(0, start) + "  " + input.value.slice(end);
      input.setSelectionRange(start + 2, start + 2);
      paintOverlay();
      return;
    }

    if (e.key === "ArrowUp" && !e.shiftKey && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (!history.length) return;
      e.preventDefault();
      historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      input.value = history[historyIndex]; paintOverlay();
      return;
    }
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === "ArrowDown" && !e.shiftKey && atEnd && historyIndex >= 0) {
      e.preventDefault();
      historyIndex += 1;
      if (historyIndex >= history.length) { historyIndex = -1; input.value = ""; }
      else input.value = history[historyIndex];
      paintOverlay();
    }
  });

  // ── The familiar's cells, in this same session ──────────────────────
  // A console transcript is a RECORD: every In[n] in it has run, and what it
  // declared is in the session heap and callable. So the familiar's code is
  // only written here once the kernel has actually executed it — numbered at
  // execution time, so In[n] states the real order even when the human's cell
  // preempted this one. The "familiar is working" feedback lives in the chat
  // panel, where the familiar speaks — the console shows only what ran.
  function famResult(code, result) {
    if (!code) return;
    const entry = addEntry(code, "familiar");
    attachResult(entry, result);
  }

  // The topbar's buttons are gone; § commands were always the real interface
  // (§restart, §interrupt, §lang, §clear, §help), so nothing was lost with it.

  // WebView2 doesn't reliably honour autofocus; re-focus on clicks in this pane
  // that aren't text selections. Scoped so clicking the familiar doesn't steal.
  const focusInput = () => { if (!String(window.getSelection())) input.focus(); };
  window.addEventListener("load", () => input.focus());
  $("console").addEventListener("click", focusInput);

  restoreSession();

  (async () => {
    try { languages = (await req.languages()) || ["python"]; } catch { /* keep the default */ }
    setKernelState("ready");
    updatePrompt();
    paintOverlay();
    input.focus();
    // Unconfigured familiar (first boot, or the user closed the app without
    // finishing setup): walk the human through it before they hit a failed
    // turn. There is deliberately no default provider — this guide is the path.
    try {
      const c = await req.config({});
      const active = c.familiars.find((f) => f.active);
      if (c.firstRun || !(active && active.provider)) await setupGuide();   // includes the deps check, verbose
      else checkKernelDeps(false);   // healthy boots stay silent
    } catch {}
  })();

  // The familiar tells us when it starts/stops so the placeholder can report it,
  // and routes its cells here — this is the console it writes into.
  return {
    refreshPlaceholder: paintOverlay,
    note: addNote, liveOutput, famResult,
  };
}
