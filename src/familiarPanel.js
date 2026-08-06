// The familiar panel: the conversation, and nothing else.
//
// It has NO input — text enters at the console and arrives here via alt/altgr+↵.
// It has no console of its own either: the familiar's code and output go to the
// real console, in the same session as the human's, because there is one kernel.
// What is left is speech — the human's line as a record, the familiar's typed
// out in phosphor.

import { createTypewriter } from "./familiarType.js";

const STICK = 48;

// Inline markdown for the familiar's prose — models emit **bold**, *em* and
// `code` no matter what the prompt says, so render it instead of fighting it.
// DOM built from textContent only: model text can never inject markup. Applied
// once a reply has SETTLED (and to restored transcripts) — while streaming,
// the phosphor types the raw text, then it snaps into form.
const MD_INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
function mdRender(text) {
  const frag = document.createDocumentFragment();
  for (const rawLine of String(text).split("\n")) {
    if (frag.childNodes.length) frag.appendChild(document.createTextNode("\n"));
    // A heading is just an emphasized line in a conversation.
    const h = /^#{1,4}\s+(.*)$/.exec(rawLine);
    const line = h ? h[1] : rawLine;
    const target = h ? document.createElement("strong") : frag;
    let last = 0;
    for (const m of line.matchAll(MD_INLINE)) {
      if (m.index > last) target.appendChild(document.createTextNode(line.slice(last, m.index)));
      const t = m[0];
      const el = document.createElement(t[0] === "`" ? "code" : t.startsWith("**") ? "strong" : "em");
      el.textContent = t.replace(/^\*\*|\*\*$|^\*|\*$|^`|`$/g, "");
      target.appendChild(el);
      last = m.index + t.length;
    }
    if (last < line.length) target.appendChild(document.createTextNode(line.slice(last)));
    if (h) frag.appendChild(target);
  }
  return frag;
}

export function initFamiliar(rpcBridge) {
  const req = rpcBridge.rpc.request;
  const chat = document.getElementById("fchat");

  let streaming = false;
  let current = null;                 // the familiar bubble being streamed into
  let typer = null;
  let onStateChange = null;           // console re-reads its placeholder
  let names = { user: "user", familiar: "familiar" };

  const stick = () => { chat.scrollTop = chat.scrollHeight; };
  let pinned = true;
  chat.addEventListener("scroll", () => {
    pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight <= STICK;
  });

  function setStreaming(on) {
    if (streaming === on) return;
    streaming = on;
    if (onStateChange) onStateChange();
  }

  // Each line opens with the speaker's own prompt: `$philip> hi`.
  function bubble(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    const prompt = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = "$" + (role === "you" ? names.user : names.familiar) + ">";
    const body = document.createElement("span");
    body.className = "body";
    body.textContent = text || "";
    el.append(prompt, document.createTextNode(" "), body);
    el._body = body;
    return el;
  }

  function addUserMsg(text) {
    current = null;
    const turn = document.createElement("div");
    turn.className = "turn";
    turn.appendChild(bubble("you", text));
    chat.appendChild(turn);
    chat._turn = turn;                 // the reply joins this turn
    pinned = true; stick();
  }

  // The familiar's working state lives HERE, not in the console: a pulsing
  // placeholder bubble under its own prompt, shown from send until the first
  // spoken word (or the turn's end, for turns that are all console work).
  let working = null;
  function showWorking() {
    if (working || current) return;
    working = bubble("familiar", "");
    working._body.className = "body thinking";
    working._body.textContent = "…";
    (chat._turn || chat).appendChild(working);
    if (pinned) stick();
  }
  function hideWorking() {
    if (working) { working.remove(); working = null; }
  }

  // Model deltas are queued, not written: the typewriter drains them at a steady
  // rate so the reply types out with a live cursor. Streaming stays genuinely
  // streamed — this paces the paint, it never waits for the whole reply.
  // The working placeholder, if present, BECOMES the reply bubble — the pulse
  // resolves into speech in place instead of jumping.
  function addChatDelta(text) {
    if (!current) {
      if (working) {
        current = working; working = null;
        current._body.className = "body";
        current._body.textContent = "";
      } else {
        current = bubble("familiar", "");
        (chat._turn || chat).appendChild(current);
      }
      typer = createTypewriter(current._body);
      current._body.addEventListener("typed", () => { if (pinned) stick(); });
      setStreaming(true);
    }
    typer.push(text);
  }

  function endReply() {
    hideWorking();   // a turn that never spoke still stops pulsing
    const t = typer, body = current && current._body;
    current = null; typer = null;
    // Idle only once the text has finished typing, so the console placeholder
    // doesn't say "done" while glyphs are still landing. Then the settled raw
    // text snaps into its markdown form.
    const done = () => {
      if (body) body.replaceChildren(mdRender(body.textContent));
      setStreaming(false);
    };
    if (t) t.finish(done);
    else done();
  }

  function addError(text) {
    const el = document.createElement("div");
    el.className = "ferror";
    el.textContent = text;
    chat.appendChild(el);
    stick();
  }

  // Replace the panel with a stored conversation (boot restore, §familiar
  // switch). Static render — no typewriter; this is a record, not speech.
  function renderTranscript(items) {
    if (typer) typer.flush();
    chat.replaceChildren();
    current = null; typer = null; working = null;
    let turn = null;
    for (const it of items || []) {
      if (it.who === "you") {
        turn = document.createElement("div");
        turn.className = "turn";
        turn.appendChild(bubble("you", it.text));
        chat.appendChild(turn);
      } else {
        const b = bubble("familiar", "");
        b._body.appendChild(mdRender(it.text));
        (turn || chat).appendChild(b);
      }
    }
    chat._turn = turn;
    stick();
  }

  function clearTranscript() {
    if (typer) typer.flush();
    chat.replaceChildren();
    current = null; typer = null; working = null;
    setStreaming(false);
    try { req.clearFamiliar && req.clearFamiliar({}); } catch {}
  }

  async function send(text) {
    const t = (text || "").trim();
    if (!t) return;
    addUserMsg(t);
    setStreaming(true);
    showWorking();
    try {
      await req.sendToFamiliar({ text: t });
    } catch (e) {
      addError("familiar error — " + ((e && e.message) || e));
      endReply();
    }
  }

  return {
    addChatDelta, endReply, clearTranscript, renderTranscript,
    sendFromConsole: send,
    setNames: (n) => { names = { ...names, ...n }; },
    isStreaming: () => streaming,
    onStateChange: (fn) => { onStateChange = fn; },
  };
}
