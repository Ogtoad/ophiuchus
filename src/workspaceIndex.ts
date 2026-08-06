// Workspace view entry (Tauri shell): RPC bridge + mounts both panels.
// The familiar's speech routes to the familiar panel; its CELLS route to the
// console, which is the one shared session view.
//
// The shim exposes the same rpc surface the panels have always spoken; the
// window chrome is native now — the drag strip is a data-tauri-drag-region
// (drag + dblclick-maximize handled by the OS path), and a resize grip fires
// ONE native startResizeDragging instead of streaming deltas.
import { createTauriShim } from "./tauriShim.js";
import { initConsole } from "./consolePanel.js";
import { initFamiliar } from "./familiarPanel.js";
import { mountWorkspace } from "./workspaceBoxes.js";

let fam: any = null;
let con: any = null;

const rpcBridge = createTauriShim({
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
});

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

fam = initFamiliar(rpcBridge);
// The console owns the only input; the familiar's streaming state feeds its
// placeholder, so the one field always reports what both halves are doing.
con = initConsole(rpcBridge, fam);
fam.onStateChange(con.refreshPlaceholder);

// Native window chrome: the strip drags (and dblclick-maximizes) through the
// OS path Tauri injects for drag regions; the grips are one-shot native
// resize gestures; × closes.
const bar = document.getElementById("titlebar")!;
bar.setAttribute("data-tauri-drag-region", "");

for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
  const el = document.body.appendChild(document.createElement("div"));
  el.className = "wedge " + edge;
  el.addEventListener("pointerdown", (e) => {
    if (e.button === 0) rpcBridge.rpc.send.windowResize({ edge, dx: 0, dy: 0 });
  });
}

document.getElementById("closeBtn")!.addEventListener("click", () => rpcBridge.rpc.send.windowClose({}));

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
// Per-panel zoom: ctrl+wheel scales the panel under the cursor — hover IS the
// selection. CSS zoom scales the px-sized fonts and the overlay/textarea pair
// together, so the console's caret metrics survive. Persisted per panel.
// (Webview-level zoom hotkeys are disabled in the shell so this handler is
// the only ctrl+wheel behavior.)
const ZOOM_KEY = "ophi.zoom.";
for (const panel of Array.from(document.querySelectorAll<HTMLElement>(".panel"))) {
  const saved = parseFloat(localStorage.getItem(ZOOM_KEY + panel.id) || "");
  if (saved) (panel.style as any).zoom = String(saved);
  panel.addEventListener("wheel", (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const cur = parseFloat((panel.style as any).zoom || "1") || 1;
    const next = Math.min(3, Math.max(0.5, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    (panel.style as any).zoom = next.toFixed(3);
    localStorage.setItem(ZOOM_KEY + panel.id, next.toFixed(3));
  }, { passive: false });
}

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
rpcBridge.rpc.request.identity({})
  .then((id: { user: string; familiar: string }) => fam.setNames(id))
  .then(() => rpcBridge.rpc.request.transcript({}))
  .then((t: { items: any[] }) => { if (t.items && t.items.length) fam.renderTranscript(t.items); })
  .catch(() => {});

// Tell the core we mounted. `inputs` is the load-bearing assertion: the
// whole app must expose exactly ONE text field (the console's).
rpcBridge.rpc.request.viewReady({
  boxes: document.querySelectorAll(".wbox").length,
  console: !!document.getElementById("output"),
  familiar: !!document.getElementById("fchat"),
  inputs: document.querySelectorAll("textarea, input[type=text]").length,
  layout: ws.restored ? "restored" : "default",
  drag: document.elementFromPoint(innerWidth / 2, 5)?.id || "NOT ON TOP",
}).catch(() => {});
