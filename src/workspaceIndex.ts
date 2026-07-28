// Workspace view entry: RPC bridge + mounts both panels.
// The familiar's speech routes to the familiar panel; its CELLS route to the
// console, which is the one shared session view.
import Electrobun, { Electroview } from "electrobun/view";
import { initConsole } from "./consolePanel.js";
import { initFamiliar } from "./familiarPanel.js";
import { mountWorkspace } from "./workspaceBoxes.js";

let fam: any = null;
let con: any = null;

const rpc = Electroview.defineRPC({
  maxRequestTime: 300000,
  handlers: {
    requests: {},
    messages: {
      // The running human cell's output, line by line, while it runs.
      cellOutput: (o: any) => con && con.liveOutput(o),
      familiarDelta: ({ text }: { text: string }) => fam && fam.addChatDelta(text),
      familiarDone: () => { if (fam) fam.endReply(); },
      // Machinery talk belongs in the console, not the conversation.
      familiarStatus: ({ text }: { text: string }) => con && con.note(text),
      // The familiar's cells go to THE console — same session, same In[n]
      // numbering as the human's, because it is the same kernel. The console
      // shows only executed cells; the working pulse lives in the chat panel.
      familiarConsoleStart: () => {},
      familiarConsoleResult: ({ code, result }: { code: string; result: any }) => con && con.famResult(code, result),
    },
  },
});
const electrobun = new Electrobun.Electroview({ rpc });

// Hoist the two panels into a resizable/draggable box tree, then wire them.
// Default: console left, familiar right (drag a bar to any edge to re-split).
const ws = mountWorkspace(document.getElementById("workspace")!, {
  type: "split",
  direction: "horizontal",
  children: [
    { type: "leaf", boxId: "console" },
    { type: "leaf", boxId: "familiar" },
  ],
  // 3:2 — the console is the working surface, the familiar comments on it.
  sizes: [936, 624],
});

fam = initFamiliar(electrobun);
// The console owns the only input; the familiar's streaming state feeds its
// placeholder, so the one field always reports what both halves are doing.
con = initConsole(electrobun, fam);
fam.onStateChange(con.refreshPlaceholder);

// The window chrome, such as it is. There is no OS frame to move or size the
// window by — and the native one can't be used, because Windows paints its
// sizing border as a bright 7px band across the top of an app that is meant to
// be nothing but content. So both gestures live here, as invisible regions
// feeding electrobun's portable window API: the same code on every platform.
// ponytail: deltas are CSS px, 1:1 with window units at 100% display scaling.
// Multiply by devicePixelRatio if a HiDPI screen makes the window lag the cursor.
function onDrag(el: HTMLElement, send: (dx: number, dy: number) => void) {
  let move: ((m: PointerEvent) => void) | null = null;
  let up: (() => void) | null = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    up?.();                              // a native loop can steal the release — never stack handlers
    el.setPointerCapture(e.pointerId);   // keeps the gesture once it outruns the region
    let x = e.screenX, y = e.screenY;
    move = (m: PointerEvent) => {
      if (!(m.buttons & 1)) return up?.();   // release happened while captured elsewhere
      send(m.screenX - x, m.screenY - y);
      x = m.screenX; y = m.screenY;
    };
    up = () => {
      if (move) el.removeEventListener("pointermove", move);
      if (up) el.removeEventListener("pointerup", up);
      move = up = null;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

// The strip runs BOTH drag paths and lets the OS decide which one lives. The
// press pokes windowDragStart — on Windows that posts the window into the OS's
// own move loop (native drag, native edge snap, drag-to-top). If that loop
// engages it captures the mouse, so the delta loop below never hears another
// pointermove; on hosts with no native path (mac untested, linux equivalent
// unknown) or if the native loop declines, the deltas drag the window instead.
// No platform sniffing, no dead strip if either path breaks.
// Double-press within 350ms is the maximize toggle every titlebar has; manual
// detection because the native loop eats the events dblclick needs. The native
// drag is deferred until the pointer actually MOVES (a few px): a stationary
// press posted straight into the OS modal move loop captures the mouse, and
// the second click of a double-click was being eaten by it.
const bar = document.getElementById("titlebar")!;
onDrag(bar, (dx, dy) => electrobun.rpc.send.windowMove({ dx, dy }));
let lastDown = 0;
bar.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const t = performance.now();
  if (t - lastDown < 350) { lastDown = 0; electrobun.rpc.send.windowToggleMaximize({}); return; }
  lastDown = t;
  const x0 = e.screenX, y0 = e.screenY;
  const arm = (m: PointerEvent) => {
    if (!(m.buttons & 1)) return disarm();
    if (Math.abs(m.screenX - x0) + Math.abs(m.screenY - y0) < 4) return;
    disarm();
    electrobun.rpc.send.windowDragStart({});
  };
  const disarm = () => { bar.removeEventListener("pointermove", arm); bar.removeEventListener("pointerup", disarm); };
  bar.addEventListener("pointermove", arm);
  bar.addEventListener("pointerup", disarm);
});

// Eight grips around the rim. Corners come last so they stack over the edges.
for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
  const el = document.body.appendChild(document.createElement("div"));
  el.className = "wedge " + edge;
  onDrag(el, (dx, dy) => electrobun.rpc.send.windowResize({ edge, dx, dy }));
}

document.getElementById("closeBtn")!.addEventListener("click", () => electrobun.rpc.send.windowClose({}));

// The padding is invisible by design (black on black). Alt — already the
// panel-drag key — reveals it, and alt+wheel resizes it, persisted per user.
const PAD_KEY = "ophi.pad.vmin";
let pad = parseFloat(localStorage.getItem(PAD_KEY) || "") || 0.6;
const applyPad = () => document.documentElement.style.setProperty("--pad", pad + "vmin");
applyPad();
// The console's §set speaks to the same knob — one narrow seam, not an import
// cycle: the panel modules never import workspace modules.
(window as any).__pad = {
  get: () => pad,
  set: (v: number) => { pad = Math.min(5, Math.max(0, v)); localStorage.setItem(PAD_KEY, String(pad)); applyPad(); },
};
addEventListener("keydown", (e) => { if (e.key === "Alt") document.body.classList.add("alt-held"); });
addEventListener("keyup", (e) => { if (e.key === "Alt") document.body.classList.remove("alt-held"); });
addEventListener("blur", () => document.body.classList.remove("alt-held"));
addEventListener("wheel", (e) => {
  if (!e.altKey) return;
  e.preventDefault();
  (window as any).__pad.set(pad + (e.deltaY < 0 ? 0.15 : -0.15));
}, { passive: false });

// Speaker names for the transcript prompts ($philip> / $familiar>), then the
// stored conversation — the session picks up where it left off.
electrobun.rpc.request.identity({})
  .then((id: { user: string; familiar: string }) => fam.setNames(id))
  .then(() => electrobun.rpc.request.transcript({}))
  .then((t: { items: any[] }) => { if (t.items && t.items.length) fam.renderTranscript(t.items); })
  .catch(() => {});

// Tell the bun side we mounted. `inputs` is the load-bearing assertion: the
// whole app must expose exactly ONE text field (the console's) — a familiar
// composer creeping back in would show up here as 2.
electrobun.rpc.request.viewReady({
  boxes: document.querySelectorAll(".wbox").length,
  console: !!document.getElementById("output"),
  familiar: !!document.getElementById("fchat"),
  inputs: document.querySelectorAll("textarea, input[type=text]").length,
  layout: ws.restored ? "restored" : "default",
  // The strip must be the topmost thing at the very top edge, or it drags nothing.
  drag: document.elementFromPoint(innerWidth / 2, 5)?.id || "NOT ON TOP",
});
