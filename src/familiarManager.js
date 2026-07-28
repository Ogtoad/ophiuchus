// The familiar's turn loop, console-first: stream a tagged reply, show <chat>,
// run <console> in the shared kernel router, feed the output back as
// <console_history>, and re-prompt while the reply keeps ending in <console>.
// One tool: the console. No separate program catalog.

import { parseTagStream, createTagRouter, tagText, renderConsoleHistory } from "./familiarTags.js";
import { buildSystem } from "./familiarPrompt.js";

// One declaration per cell means a walkthrough is many short cells, not a few
// big ones. At 8 the turn was capped before the familiar ever got to speak, so
// the human saw a pile of executed cells and no reply.
const MAX_ITERS = 24;       // console loops before a turn is force-ended

export function createFamiliar({ router, provider, lang = "python", name = "familiar", history: initial } = {}) {
  const history = Array.isArray(initial) ? initial : []; // {role, content} — user, assistant raw, console_history; restored across restarts by the roster
  // In[n]/Out[n] counter — a session that keeps counting is how the familiar
  // sees that the namespace persists rather than resetting each block.
  let cell = 0;

  async function send(userText, hooks = {}) {
    const {
      onDelta, onStatus, signal, onCell,
      onConsoleStart, onConsoleResult,
      observe,   // an observer turn: the human ran a cell; silence is the expected reply
    } = hooks;
    history.push({ role: "user", content: userText });

    let sayEmitted = false;

    for (let iter = 1; iter <= MAX_ITERS; iter += 1) {
      // Cancelled (ctrl+c): stop before spending another provider call or
      // another kernel cell — the loop holding the queue is the whole problem.
      if (signal?.aborted) { onStatus?.("cancelled"); return { reply: "", raw: "", cancelled: true }; }
      let raw = "";
      // Route the reply by tag AS IT ARRIVES: <chat> types into the transcript,
      // <console> lands in the console pane while the familiar is still writing
      // it. Nothing waits for the full reply, and nothing stands in for the code
      // — you watch it being written, then watch it run.
      // Declarations execute AS THEY COMPLETE in the stream — the interactive
      // contract. A top-level statement is provably finished the moment the
      // next one starts at column 0, so every part except the last is ready to
      // run while the model is still writing. The tail waits for the next
      // statement or for the scope to close, exactly as a REPL waits for Enter.
      //
      // Nothing is ever shown before it has run: the console renders a cell
      // when its result arrives, so live and truthful are not in tension.
      let buf = "";                  // the current scope's un-executed tail
      const ran = [];                // {part, result} in execution order
      let chain = Promise.resolve(); // serialises flushes against fast deltas

      async function flush(final) {
        if (signal?.aborted || !buf.trim()) return;
        const { parts, ok } = await router.split(lang, buf);
        // Not parsing yet has two very different causes, and IPython's
        // check_complete is what tells them apart:
        //   incomplete — the model is mid-declaration, wait for more text
        //   invalid    — it wrote something broken; run it NOW so the traceback
        //                reaches it immediately instead of at the closing tag
        // Only judged on a completed line, so a half-typed line is never
        // mistaken for a syntax error.
        let runAll = final;
        if (!ok && !final) {
          if (!/\n\s*$/.test(buf)) return;
          const check = await router.checkComplete(lang, buf);
          if (check.complete || check.status !== "invalid") return;
          runAll = true;
        }
        const ready = runAll ? parts : parts.slice(0, -1);
        if (!ready.length) return;
        // Keep the RAW remainder by line. Re-using the split segment would drop
        // the newline that separated it from whatever streams in next, welding
        // two statements together ("import mathdef area(r):").
        buf = runAll ? "" : buf.split("\n").slice(ready[ready.length - 1].end).join("\n");
        for (const { text } of ready) {
          if (signal?.aborted) return;
          cell += 1;
          const result = await (onCell ? onCell(text) : router.run(lang, text, { preemptible: true }));
          ran.push({ part: text, result });
          onConsoleResult?.(text, result);
          if (result.error) { buf = ""; return; }   // later lines assumed this worked
        }
      }
      const queue = (final) => { chain = chain.then(() => flush(final)); return chain; };

      const stream = createTagRouter({
        onOpen: (tag) => { if (tag === "console") { buf = ""; onConsoleStart?.(); } },
        onText: (tag, text) => {
          if (tag === "chat") { onDelta?.(text); sayEmitted = true; }
          else if (tag === "console") {
            buf += text;
            if (text.includes("\n")) queue(false);   // a boundary may have arrived
          }
        },
        onClose: (tag, reason) => {
          if (tag !== "console") return;
          // A scope cut by the next opening tag is prose that merely named a
          // tag — never execute it.
          if (reason === "nextOpen") { buf = ""; return; }
          queue(true);
        },
      });

      try {
        await provider([{ role: "system", content: buildSystem(lang, name) }, ...history], {
          signal,
          onText: (t) => { raw += t; stream.feed(t); },
        });
      } catch (e) {
        if (signal?.aborted) { onStatus?.("cancelled"); return { reply: "", raw, cancelled: true }; }
        throw e;
      }
      stream.finish();
      await chain;                    // let the last declarations finish running
      if (signal?.aborted) { onStatus?.("cancelled"); return { reply: "", raw, cancelled: true }; }

      // The full reply stays authoritative for what actually runs and for the
      // untagged check — the router drives the view, not the contract.
      const parsed = parseTagStream(raw);

      // Text outside tags, read by the only distinction that holds: did the
      // reply have any tags at all?
      //
      // Alongside real scopes it is narration — the model talking about what it
      // is about to do ("We need to output <think>…") before it opens one. That
      // is what <think> means here, so it is treated as <think>: carried in the
      // raw history below, never shown. It is not an error, and the contract is
      // never taught back — re-prompting those cost a full round trip a turn.
      //
      // With NO tags at all, narration is not a possible reading: it is the
      // answer with the wrapper forgotten. Show it. Anything else ends the turn
      // having said nothing, which is indistinguishable from a hang.
      if (parsed.untagged.length && !parsed.segments.length) {
        const said = parsed.untagged.join("\n\n");
        onDelta?.(said);
        sayEmitted = true;
        parsed.segments.push({ tag: "chat", text: said });
      } else if (parsed.untagged.length) {
        // Assumed narration, but say so — if the model put the real answer out
        // here and a <console> block alongside it, this note is the only thing
        // between that answer and vanishing silently.
        const stray = parsed.untagged.join(" ").replace(/\s+/g, " ");
        onStatus?.(`dropped text outside tags: "${stray.slice(0, 120)}${stray.length > 120 ? "…" : ""}"`);
      }

      // The cells already ran, during the stream. History is assembled now so
      // it still reads in the right order: what the familiar said, then what
      // the console answered.
      history.push({ role: "assistant", content: raw });

      if (!ran.length) {
        // A turn that ends having said nothing and run nothing looks identical
        // to a hang. Providers do return the occasional empty reply — say so.
        // Except on observer turns, where silence is the taught default.
        if (!sayEmitted && !observe) onStatus?.(raw.trim() ? "reply had no <chat> or <console>" : "provider returned an empty reply");
        return { reply: tagText(parsed, "chat"), raw, capped: false };
      }
      const first = cell - ran.length + 1;
      ran.forEach(({ part, result }, i) => {
        history.push({ role: "user", content: renderConsoleHistory(part, result, first + i) });
      });
    }

    // Say so in the conversation, not just the console: a turn that stops
    // silently after N cells reads as the familiar ignoring you.
    onStatus?.(`iteration cap hit after ${MAX_ITERS} cells — turn ended`);
    if (!sayEmitted) onDelta?.(`(stopped after ${MAX_ITERS} console steps without finishing — ask me to continue)`);
    return { reply: "", raw: "", capped: true };
  }

  // The human ran a cell in the shared console: witness it into history (the
  // same In/Out record the familiar's own cells leave, marked as the human's)
  // and give the familiar one turn to react — the prompt teaches that the
  // default reaction is none.
  function observeCell(code, result, hooks = {}) {
    return send(renderConsoleHistory(code, result, (cell += 1), "user"), { ...hooks, observe: true });
  }

  return {
    send, observeCell,
    setLang: (l) => { lang = l; },
    clear: () => { history.length = 0; cell = 0; },
    get history() { return history; },   // the roster persists this across restarts
  };
}

// Self-check — `bun src/familiarManager.js`. The untagged rule is the point:
// which side of it a reply falls on decides whether the human sees anything.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };

  // A reply is fed one character at a time, the worst case for the tag router.
  function run(replies) {
    let n = 0;
    const provider = async (_msgs, { onText }) => {
      const r = replies[Math.min(n++, replies.length - 1)];
      for (const ch of r) onText(ch);
      return r;
    };
    const ran = [];
    const router = {
      split: async (_l, code) => ({ parts: [{ text: code.trim(), end: code.split("\n").length }], ok: true }),
      run: async (_l, code) => { ran.push(code); return { stdout: "", displays: [], stderr: "", error: null }; },
      checkComplete: async () => ({ complete: true }),
    };
    let said = "";
    return createFamiliar({ router, provider })
      .send("go", { onDelta: (t) => { said += t; } })
      .then(() => ({ said, ran }));
  }

  // Untagged text ALONGSIDE tags is narration — treated as <think>, never shown.
  const a = await run(["Let me look first.\n<console>\nx = 1\n</console>", "<chat>done</chat>"]);
  assert(a.said === "done", `narration stays hidden, got ${JSON.stringify(a.said)}`);
  assert(a.ran.join() === "x = 1", `the console block still runs, got ${JSON.stringify(a.ran)}`);

  // A reply with NO tags at all is the answer with the wrapper forgotten. Show
  // it — on the FIRST pass. Teaching the contract cost a round trip a turn.
  const b = await run(["The answer is 42."]);
  assert(b.said === "The answer is 42.", `untagged-only reaches the human, got ${JSON.stringify(b.said)}`);
  assert(!b.ran.length, "nothing runs on a wrapper-less reply");

  console.log("familiarManager self-check passed");
}
