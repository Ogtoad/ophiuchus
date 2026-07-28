// Generic marker-protocol transport. Spawns spec.cmd (a process that speaks the
// ___OPHI_ protocol — a marker driver OR the jupyter broker), serializes cells,
// parses framed markers into a uniform result shape. Language-agnostic: it never
// learns Python, IPython, or Jupyter. A backend = { cmd, config?, capabilities? }.

const M = "___OPHI_";

export function createTransport(spec) {
  const cmd = spec.cmd;
  const configLine = JSON.stringify(spec.config || {}) + "\n";

  let proc, buf, ready, readyWaiters;
  let fatal = null;       // the backend can never become ready — every call fails fast with this
  let stderrTail = "";    // last stderr of the current spawn, for exit-before-READY diagnostics
  let active = null;      // the job currently owning the wire
  const jobs = [];        // pending jobs

  // A backend that dies (or never starts) must fail EVERY caller immediately,
  // now and later — rejecting only the waiters present at that instant left
  // the next cell hanging forever on a READY that could never come. §restart
  // clears this and tries again, which is the retry path after installing
  // whatever was missing.
  function fail(err) {
    fatal = err;
    readyWaiters.forEach((r) => r(err));
    readyWaiters = [];
    const dead = { stdout: "", stderr: "", error: err.message, errorBundle: null, displays: [] };
    if (active) { active.resolve(dead); active = null; }
    for (const j of jobs) j.resolve(dead);
    jobs.length = 0;
  }

  function spawnProc() {
    buf = "";
    ready = false;
    fatal = null;
    stderrTail = "";
    readyWaiters = [];
    active = null;
    jobs.length = 0;
    try {
      proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    } catch (e) {
      fail(new Error((spec.label || cmd[0]) + " could not start: " + e.message));
      return;
    }
    write(configLine); // read before the driver/broker prints READY
    readStdout();
    readStderr();
    // Exit before READY without a FATAL marker: a missing interpreter, the
    // Windows Store python alias (prints its nag and exits), a crash on boot.
    // The stderr tail is the diagnosis — surface it.
    const p = proc;
    p.exited.then((code) => {
      if (p !== proc || ready || fatal) return;
      const tail = stderrTail.trim().split("\n").slice(-4).join("\n");
      fail(new Error(`${spec.label || cmd[0]} exited before READY (code ${code})${tail ? ":\n" + tail : ""}`));
    });
  }

  function write(s) { proc.stdin.write(s); proc.stdin.flush(); }

  async function readStderr() {
    const p = proc;
    const reader = p.stderr.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = dec.decode(value);
      if (p === proc && !ready) stderrTail = (stderrTail + text).slice(-2000);
      process.stderr.write("[kernel:" + (spec.label || "?") + " stderr] " + text);
    }
  }

  async function readStdout() {
    const p = proc;
    const reader = p.stdout.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      // A bare \r is a line break too — it's how progress bars (tqdm, pip)
      // repaint in place, and without it their output sat in the buffer until
      // the cell ended. Such a line is flagged `cr` so the view overwrites the
      // previous update instead of stacking them. \r\n stays one plain break;
      // a \r at the very end of the buffer waits for the next chunk, since
      // only the next byte says which of the two it is.
      for (;;) {
        const n = buf.indexOf("\n"), r = buf.indexOf("\r");
        let i = n, cr = false;
        if (r >= 0 && (n < 0 || r < n)) {
          if (r === buf.length - 1) break;           // undecidable until more arrives
          i = r; cr = buf[r + 1] !== "\n";
        }
        if (i < 0) break;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!cr && i === r && buf[0] === "\n") buf = buf.slice(1);   // consume the \n of \r\n
        onLine(line, cr);
      }
    }
  }

  function pump() {
    if (active || !jobs.length) return;
    active = jobs.shift();
    active.send();
  }

  function finish(result) {
    const job = active;
    active = null;
    job.resolve(result);
    pump();
  }

  // The human's console is never queued behind the familiar.
  //
  //   front       — head of the queue rather than the tail.
  //   preempt     — and if a preemptible cell is mid-flight, interrupt it so
  //                 this one runs NOW. One interpreter runs one cell at a time,
  //                 so "immediately" can only mean taking the kernel back.
  //   preemptible — this job may be interrupted for the human (familiar cells).
  //
  // An interrupted cell still completes: the driver raises KeyboardInterrupt in
  // the running cell, IPython turns it into a traceback, and the job resolves
  // with that error — so the queue drains rather than deadlocking, and the
  // familiar sees the interruption in its console history.
  function enqueue(job, opts = {}) {
    return new Promise((resolve) => {
      const entry = { ...job, resolve, preemptible: !!opts.preemptible };
      if (opts.front) jobs.unshift(entry); else jobs.push(entry);
      if (opts.preempt && active && active.preemptible) interrupt();
      pump();
    });
  }

  function onLine(line, cr = false) {
    if (!ready) {
      if (line === M + "READY___") {
        ready = true;
        readyWaiters.forEach((r) => r());
        readyWaiters = [];
      } else if (line.startsWith(M + "FATAL___")) {
        fail(new Error(line.slice((M + "FATAL___").length)));
      }
      return;
    }
    if (!active) return;

    const job = active;
    if (job.type === "exec") {
      // Everything is still accumulated into the final result (the authority,
      // and what the familiar's loop reads) — onOutput is a live tap on the
      // same lines, so a running cell is visible while it runs. A pending `cr`
      // line means "the next update overwrites me": the accumulator keeps only
      // the final state of a progress bar, the way a terminal would show it.
      const put = (arr, flag, text, cr) => {
        if (job[flag]) arr[arr.length - 1] = text; else arr.push(text);
        job[flag] = cr;
      };
      if (line === M + "CELL_START___") return;
      if (line === M + "CELL_END___") return finish({ ...collect(job), success: true });
      if (line === M + "CELL_ERROR___") return finish({ ...collect(job), success: false });
      if (line.startsWith(M + "STDERRCR___")) { const t = line.slice((M + "STDERRCR___").length); put(job.stderr, "_crErr", t, true); job.onOutput?.({ kind: "stderr", text: t, cr: true }); return; }
      if (line.startsWith(M + "STDERR___")) { const t = line.slice((M + "STDERR___").length); put(job.stderr, "_crErr", t, false); job.onOutput?.({ kind: "stderr", text: t }); return; }
      if (line.startsWith(M + "DISPLAY___")) { const b = safeJson(line.slice((M + "DISPLAY___").length)); job.displays.push(b); job.onOutput?.({ kind: "display", bundle: b }); return; }
      if (line.startsWith(M + "ERROR___")) { job.error = safeJson(line.slice((M + "ERROR___").length)); job.onOutput?.({ kind: "error", text: job.error && job.error.traceback }); return; }
      put(job.stdout, "_crOut", line, cr);
      job.onOutput?.({ kind: "stdout", text: line, cr });
      return;
    }
    if (job.type === "complete" && line.startsWith(M + "COMPLETE_RESULT___")) {
      return finish(safeJson(line.slice((M + "COMPLETE_RESULT___").length)) || { matches: [], start: 0, end: 0 });
    }
    if (job.type === "split" && line.startsWith(M + "SPLIT_RESULT___")) {
      return finish(safeJson(line.slice((M + "SPLIT_RESULT___").length)) || { parts: [] });
    }
    if (job.type === "inspect" && line.startsWith(M + "INSPECT_RESULT___")) {
      return finish(safeJson(line.slice((M + "INSPECT_RESULT___").length)) || { found: false });
    }
    if (job.type === "check") {
      if (line === M + "CHECK_OK___") return finish({ complete: true });
      if (line.startsWith(M + "CHECK_FAIL___")) return finish({ complete: false, ...(safeJson(line.slice((M + "CHECK_FAIL___").length)) || {}) });
    }
  }

  function collect(job) {
    return {
      stdout: job.stdout.join("\n"),
      stderr: job.stderr.join("\n"),
      error: job.error ? job.error.traceback : null,
      errorBundle: job.error || null,
      displays: job.displays,
    };
  }

  function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

  function whenReady() {
    if (fatal) return Promise.reject(fatal);
    if (ready) return Promise.resolve();
    return new Promise((resolve, reject) => readyWaiters.push((err) => (err ? reject(err) : resolve())));
  }

  async function run(code, opts = {}) {
    await whenReady();
    return enqueue({ type: "exec", stdout: [], stderr: [], displays: [], error: null, onOutput: opts.onOutput,
      send() { write(M + "EXEC_START___\n" + code + "\n" + M + "EXEC_END___\n"); } }, opts);
  }
  async function complete(code, cursor) {
    await whenReady();
    // Completion is interactive: never let it sit behind a familiar turn.
    return enqueue({ type: "complete", send() { write(M + "COMPLETE___" + JSON.stringify({ code, cursor }) + "\n"); } }, { front: true });
  }
  // Ask the kernel where each top-level declaration begins and ends.
  async function split(code) {
    await whenReady();
    return enqueue({ type: "split", send() { write(M + "SPLIT___" + JSON.stringify({ code }) + "\n"); } }, { front: true });
  }
  async function inspect(name) {
    await whenReady();
    return enqueue({ type: "inspect", send() { write(M + "INSPECT___" + JSON.stringify({ name }) + "\n"); } });
  }
  async function checkComplete(code) {
    await whenReady();
    return enqueue({ type: "check", send() { write(M + "CHECK_START___\n" + code + "\n" + M + "CHECK_END___\n"); } });
  }
  // Interrupt at the OS level where the platform can deliver one: a real SIGINT
  // to the child on posix (spec.interruptSignal — the marker driver). Elsewhere
  // the marker line goes down the wire and the backend does the real thing:
  // the jupyter broker translates it into km.interrupt_kernel(), which IS the
  // system interrupt for any language kernel (SIGINT / win32 interrupt event),
  // and the driver's reader thread simulates SIGINT in-process — the same
  // C-level flag, the only per-process option Windows offers a bare child.
  function interrupt() {
    if (!proc) return;
    if (spec.interruptSignal && process.platform !== "win32") {
      try { proc.kill("SIGINT"); return; } catch {}
    }
    write(M + "INTERRUPT___\n");
  }
  function restart() {
    try { proc.kill(); } catch {}
    const dead = { stdout: "", stderr: "", error: "kernel restarted", errorBundle: null, displays: [] };
    if (active) { active.resolve(dead); active = null; }
    for (const j of jobs) j.resolve(dead);
    spawnProc();
  }

  spawnProc();
  return { run, split, complete, inspect, checkComplete, interrupt, restart, capabilities: spec.capabilities || {} };
}
