// The familiar's voice: a CRT typewriter.
//
// The model streams in bursts; this drains those bursts one character at a time
// at a steady rate, so the reply *types* rather than arriving in chunks. Each
// character is born glowing and decays to the baseline colour over ~1s, which
// leaves a bright comet-head at the cursor and cooling text behind it.
//
// DOM cost is the thing to get right: one span per character would leave
// thousands behind on a long reply. Characters settle in the order they were
// born, so a settled span is folded into a single leading text node and
// dropped — live spans only ever cover the last ~1s of typing.

const SETTLE_MS = 1000;      // must match --char-settle in the CSS animation
// Tuned against the self-check below: slow enough to read as typing on a short
// reply (~200 chars ≈ 1.3s), fast enough that a long one doesn't leave you
// waiting on the animation after the model already finished (4k ≈ 3.5s).
const BASE_CPS = 120;        // resting speed, characters per second
const CATCHUP_AT = 80;       // queue length where we start accelerating
const MAX_CPS = 2400;        // ceiling, so a long burst can't crawl for minutes

export function createTypewriter(host, { charsPerSecond = BASE_CPS } = {}) {
  const settled = document.createTextNode("");
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "█";                 // █ — the Commodore block
  host.append(settled, cursor);

  let queue = "";
  let live = [];               // spans still glowing, oldest first
  let raf = 0;
  let carry = 0;               // fractional characters between frames
  let last = 0;
  let done = false;
  let onIdle = null;

  // Faster when behind: the pacing should read as typing, not as a backlog.
  function rate() {
    if (queue.length <= CATCHUP_AT) return charsPerSecond;
    return Math.min(MAX_CPS, charsPerSecond * (queue.length / CATCHUP_AT));
  }

  function emit(ch) {
    if (ch === "\n") {
      // Newlines never glow — they'd be invisible spans that only cost DOM.
      settled.appendData(flushLive() + "\n");
      return;
    }
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = ch;
    span.dataset.born = String(performance.now());
    host.insertBefore(span, cursor);
    live.push(span);
  }

  // Fold every still-live span into text (used at newlines and on finish).
  function flushLive() {
    let text = "";
    for (const span of live) { text += span.textContent; span.remove(); }
    live = [];
    return text;
  }

  // Drop spans whose glow has finished — they become plain settled text.
  function reap(now) {
    let n = 0;
    while (n < live.length && now - Number(live[n].dataset.born) >= SETTLE_MS) n += 1;
    if (!n) return;
    let text = "";
    for (let i = 0; i < n; i++) { text += live[i].textContent; live[i].remove(); }
    settled.appendData(text);
    live = live.slice(n);
  }

  function frame(now) {
    raf = 0;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;

    if (queue.length) {
      carry += rate() * dt;
      let n = Math.floor(carry);
      if (n > 0) {
        carry -= n;
        n = Math.min(n, queue.length);
        // Emit whole code points — slicing UTF-16 units splits surrogate
        // pairs and types emoji as two broken halves. A high surrogate at the
        // very end of the queue waits for its pair to stream in.
        let k = 0;
        while (k < n) {
          const u = queue.charCodeAt(k);
          if (u >= 0xd800 && u <= 0xdbff && k + 1 === queue.length) break;
          const ch = String.fromCodePoint(queue.codePointAt(k));
          emit(ch); k += ch.length;
        }
        queue = queue.slice(k);
        host.dispatchEvent(new CustomEvent("typed", { bubbles: true }));
      }
    }
    reap(now);

    if (queue.length || live.length) { schedule(); return; }
    if (done) { cursor.remove(); if (onIdle) onIdle(); }
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  return {
    /** Feed model output; it types out at the configured rate. */
    push(text) {
      if (!text) return;
      queue += text;
      done = false;
      if (!raf) { last = 0; }        // don't count the idle gap as elapsed time
      schedule();
    },
    /** No more input coming — type out the rest, then retire the cursor. */
    finish(cb) {
      done = true; onIdle = cb || null;
      if (!queue.length && !live.length) { cursor.remove(); if (onIdle) onIdle(); return; }
      schedule();
    },
    /** Dump everything instantly (used when the panel is cleared). */
    flush() {
      settled.appendData(flushLive() + queue);
      queue = ""; done = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      cursor.remove();
    },
    get pending() { return queue.length; },
  };
}

// Self-check — `bun src/familiarType.js`. Pure pacing maths, no DOM needed.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const rate = (qlen, base = BASE_CPS) =>
    qlen <= CATCHUP_AT ? base : Math.min(MAX_CPS, base * (qlen / CATCHUP_AT));

  assert(rate(10) === BASE_CPS, "short queue types at resting speed");
  assert(rate(CATCHUP_AT) === BASE_CPS, "at the threshold, still resting speed");
  assert(rate(CATCHUP_AT * 2) === BASE_CPS * 2, "double backlog types twice as fast");
  assert(rate(1e6) === MAX_CPS, "acceleration is capped");
  const drain = (chars) => {
    let q = chars, t = 0;
    for (let i = 0; i < 100000 && q > 0; i++) { q -= rate(q) / 60; t += 1 / 60; }
    return t;
  };
  // Both ends matter: it must read as typing, and it must not outlast the model.
  const short = drain(200), long = drain(4000);
  assert(short > 0.8, `200 chars takes ${short.toFixed(2)}s — reads as typing (>0.8s)`);
  assert(long < 5, `4k-char reply drains in ${long.toFixed(1)}s (<5s)`);
  console.log(`familiarType self-check passed (200ch ${short.toFixed(1)}s · 4000ch ${long.toFixed(1)}s)`);
}
