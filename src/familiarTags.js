// The familiar's reply is tagged TEXT (ported from logos): <think> reasoning,
// <chat> prose for the human, <console> code that runs in the shared kernel.
// The parser splits scopes tolerantly. Untagged text is NOT an error and is
// never taught back — familiarManager reads it by whether the reply had any
// tags at all. (§-program grammar dropped — Ophiuchus' familiar runs code, not
// a program catalog.)

const OPEN_TAG = /<\s*(think|chat|console)\s*>/gi;

// Split a reply into tag scopes. A scope ends at its own closer (</tag> or the
// sloppy <tag/>), at the next opening tag, or at end of text (a stream cut
// mid-scope keeps its content). Content is literal — a tag name inside a read
// file can't open a scope.
export function parseTagStream(raw) {
  const segments = [];
  const untagged = [];
  const pushUntagged = (text) => { const t = text.trim(); if (t) untagged.push(t); };
  let pos = 0;
  OPEN_TAG.lastIndex = 0;
  for (let open = OPEN_TAG.exec(raw); open; open = OPEN_TAG.exec(raw)) {
    pushUntagged(raw.slice(pos, open.index));
    const tag = open[1].toLowerCase();
    const bodyStart = open.index + open[0].length;
    const closer = new RegExp(`<\\s*/\\s*${tag}\\s*>|<\\s*${tag}\\s*/\\s*>`, "i");
    const closeAt = closer.exec(raw.slice(bodyStart));
    OPEN_TAG.lastIndex = bodyStart;
    const nextOpen = OPEN_TAG.exec(raw);
    let bodyEnd;
    let closed = false;
    if (closeAt && (!nextOpen || bodyStart + closeAt.index <= nextOpen.index)) {
      bodyEnd = bodyStart + closeAt.index;
      pos = bodyEnd + closeAt[0].length;
      closed = true;                       // ended at its own closer — unambiguous
    } else if (nextOpen) {
      bodyEnd = nextOpen.index;
      pos = nextOpen.index;                // implicitly cut by the next opener
    } else {
      bodyEnd = raw.length;
      pos = raw.length;                    // cut by end of stream
    }
    segments.push({ tag, text: raw.slice(bodyStart, bodyEnd).trim(), closed });
    OPEN_TAG.lastIndex = pos;
  }
  pushUntagged(raw.slice(pos));
  return { segments, untagged };
}

// Incremental sibling of parseTagStream: routes a LIVE stream by tag, so the
// familiar's <chat> types into the transcript and its <console> appears in the
// console — as it is written, not after the fact.
//
// The whole difficulty is that tags arrive split across chunks ("<con" + "sole>"),
// so text is only emitted once it is certainly not part of a delimiter: anything
// after a trailing "<" that could still grow into a tag is held back until the
// next chunk (or flush) resolves it. A "<" that cannot be a tag start — `if x < 5`
// — is released immediately.
const PARTIAL_TAG = /^<\/?\s*[a-z]*$/i;

export function createTagRouter({ onOpen, onText, onClose, onUntagged } = {}) {
  let buf = "";
  let current = null;

  function closerFor(tag) {
    return new RegExp(`<\\s*/\\s*${tag}\\s*>|<\\s*${tag}\\s*/\\s*>`, "i");
  }

  // Emit all of `text` except a trailing fragment that might still become a tag;
  // return the held-back remainder. Only the LAST "<" can be an unresolved
  // partial — anything earlier already had its chance to complete.
  function emitSafe(text, sink) {
    const lt = text.lastIndexOf("<");
    const hold = lt >= 0 && PARTIAL_TAG.test(text.slice(lt));
    const out = hold ? text.slice(0, lt) : text;
    if (out && sink) sink(out);
    return hold ? text.slice(lt) : "";
  }

  function step() {
    for (;;) {
      if (!current) {
        OPEN_TAG.lastIndex = 0;
        const m = OPEN_TAG.exec(buf);
        if (!m) { buf = emitSafe(buf, onUntagged); return; }
        if (m.index > 0) emitSafe(buf.slice(0, m.index), onUntagged);
        current = m[1].toLowerCase();
        buf = buf.slice(m.index + m[0].length);
        onOpen?.(current);
        continue;
      }
      const c = closerFor(current).exec(buf);
      if (c) {
        if (c.index > 0) onText?.(current, buf.slice(0, c.index));
        buf = buf.slice(c.index + c[0].length);
        onClose?.(current, "closer");
        current = null;
        continue;
      }
      // A new opening tag also ends the scope — same tolerance as parseTagStream.
      // Reported as "nextOpen" because such a scope is usually a phantom: prose
      // naming a tag ("we need <console> next") plants an opener mid-sentence.
      // A caller acting on content — executing it — must be able to refuse.
      OPEN_TAG.lastIndex = 0;
      const next = OPEN_TAG.exec(buf);
      if (next) {
        if (next.index > 0) onText?.(current, buf.slice(0, next.index));
        buf = buf.slice(next.index);
        onClose?.(current, "nextOpen");
        current = null;
        continue;
      }
      buf = emitSafe(buf, (t) => onText?.(current, t));
      return;
    }
  }

  return {
    feed(chunk) { if (!chunk) return; buf += chunk; step(); },
    /** Stream over: release whatever is still held back. */
    finish() {
      if (buf) {
        if (current) onText?.(current, buf);
        else onUntagged?.(buf);
        buf = "";
      }
      // "end" not "nextOpen": a scope cut by the stream ending holds real
      // content the model was mid-way through writing.
      if (current) { onClose?.(current, "end"); current = null; }
    },
  };
}

// The joined text of one scope across a reply.
//
// Properly-closed scopes win when any exist. A model that narrates its format
// ("We need to output <think> then <console>.") plants phantom openers in prose;
// those scopes get cut by the next opener and would otherwise splice garbage
// into the code that runs — a real turn lost `%whos` to a stray ".". Scopes cut
// by end-of-stream are still honoured when nothing closed, so a truncated reply
// keeps its content.
export function tagText(parsed, tag) {
  const all = parsed.segments.filter((s) => s.tag === tag);
  const closed = all.filter((s) => s.closed);
  return (closed.length ? closed : all).map((s) => s.text).filter(Boolean).join("\n\n");
}

// Self-check — `bun src/familiarTags.js`.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };

  // Feed one character at a time: the worst case for split delimiters.
  function drive(raw, chunkSize) {
    const got = { chat: "", console: "", untagged: "", opened: [], closed: [] };
    const r = createTagRouter({
      onOpen: (t) => got.opened.push(t),
      onClose: (t) => got.closed.push(t),
      onText: (t, s) => { got[t] = (got[t] || "") + s; },
      onUntagged: (s) => { got.untagged += s; },
    });
    for (let i = 0; i < raw.length; i += chunkSize) r.feed(raw.slice(i, i + chunkSize));
    r.finish();
    return got;
  }

  const reply = "<think>hm</think><console>print(6*7)</console><chat>It is 42.</chat>";
  for (const size of [1, 3, 7, 1000]) {
    const g = drive(reply, size);
    assert(g.console === "print(6*7)", `console text intact at chunk ${size} (got ${JSON.stringify(g.console)})`);
    assert(g.chat === "It is 42.", `chat text intact at chunk ${size}`);
    assert(!g.untagged.trim(), `no untagged leakage at chunk ${size}`);
    assert(g.opened.join(",") === "think,console,chat", `open order at chunk ${size}`);
    assert(g.closed.length === 3, `every scope closed at chunk ${size}`);
  }

  // A "<" that isn't a tag must not stall the stream (code compares things).
  const cmp = drive("<console>if x < 5 and y<3:\n  pass</console>", 1);
  assert(cmp.console === "if x < 5 and y<3:\n  pass", `bare < survives, got ${JSON.stringify(cmp.console)}`);

  // An unclosed scope still delivers its content on finish (stream cut short).
  assert(drive("<chat>half a sen", 1).chat === "half a sen", "unclosed scope flushes");
  // Untagged text is still surfaced for the correction path.
  assert(drive("bare words", 1).untagged.trim() === "bare words", "untagged reported");

  // Streaming and batch parsing must agree on the final text.
  const batch = parseTagStream(reply);
  assert(tagText(batch, "console") === drive(reply, 1).console, "router agrees with parseTagStream");

  // Regression: a model narrating the format plants phantom openers in prose.
  // The properly-closed scopes must win, or a stray "." splices into the code.
  const narrated = parseTagStream(
    'We need to output <think> then <console>.<think>Check namespace.</think>\n<console>\n%whos\n</console>');
  assert(tagText(narrated, "console") === "%whos",
    `phantom scopes ignored, got ${JSON.stringify(tagText(narrated, "console"))}`);
  assert(tagText(narrated, "think") === "Check namespace.", "phantom think scope ignored");
  // ...but an unclosed scope with no closed sibling is still honoured.
  assert(tagText(parseTagStream("<chat>cut off mid-sen"), "chat") === "cut off mid-sen",
    "stream-cut scope still delivers");

  console.log("familiarTags self-check passed");
}

// The environment's answer to a <console> block, rendered as the IPython
// session it actually is — In[n]/Out[n], continuation lines, tracebacks.
//
// The shape is the message: the familiar reads this to learn what kind of
// console it is driving. The old "› code / indented output" form said nothing,
// so the familiar wrote script-style code — printing values IPython already
// echoes, re-importing every block. Out[n] appearing on its own teaches the
// echo; the counter teaches that the session persists.
// A cell can print megabytes (the kernel's own budget is 2MB); the familiar's
// context gets head + tail with the middle elided — enough to read a table's
// shape or a traceback's ends without carrying the bulk.
const OUT_CAP = 3000;
function capText(s) {
  if (s.length <= OUT_CAP) return s;
  const head = Math.floor(OUT_CAP * 0.7), tail = OUT_CAP - head;
  return s.slice(0, head) + `\n... [${s.length - OUT_CAP} chars truncated] ...\n` + s.slice(-tail);
}

export function renderConsoleHistory(code, result, count = 1, who = "") {
  // `who` marks cells the familiar did not write ("$user" for the human's,
  // witnessed into its history) — the chat transcript's own speaker-prompt
  // shorthand. Inside the tag, so the chat-panel transcript filter — which
  // keys on the "<console_history>" prefix — still hides these records.
  const lines = ["<console_history>"];
  if (who) lines.push("$" + who);
  const src = code.replace(/\s+$/, "").split("\n");
  const lead = `In [${count}]: `;
  const cont = " ".repeat(Math.max(0, lead.length - 5)) + "...: ";
  src.forEach((c, i) => lines.push((i === 0 ? lead : cont) + c));

  const stream = capText([result.stdout, result.stderr].filter(Boolean).join("\n").replace(/\s+$/, ""));
  if (stream) lines.push(...stream.split("\n"));

  // execute_result is the echoed value of the final expression — Out[n].
  const results = (result.displays || [])
    .filter((d) => d && d.kind === "result")
    .map((d) => capText((d.data && d.data["text/plain"]) || ""))
    .filter(Boolean);
  const shown = (result.displays || [])
    .filter((d) => d && d.kind !== "result")
    .map((d) => capText((d.data && d.data["text/plain"]) || "[non-text display]"))
    .filter(Boolean);
  for (const s of shown) lines.push(...s.split("\n"));
  for (const r of results) {
    const [head, ...rest] = r.split("\n");
    lines.push(`Out[${count}]: ${head}`);
    for (const l of rest) lines.push(" ".repeat(`Out[${count}]: `.length) + l);
  }

  if (result.error) lines.push(...capText(String(result.error).replace(/\s+$/, "")).split("\n"));
  if (!stream && !results.length && !shown.length && !result.error) lines.push("(no output)");

  lines.push("</console_history>");
  return lines.join("\n");
}
