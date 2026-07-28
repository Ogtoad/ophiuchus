import { BrowserWindow, BrowserView } from "electrobun/bun";
import { cc, dlopen, FFIType, ptr } from "bun:ffi";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRouter } from "./kernelRouter.js";
import { createRoster } from "./familiarRoster.js";

// One kernel router, shared by the console and every familiar.
const router = createRouter();

// Familiars live in the roster: named configs in ~/.ophiuchus.json (seeded from
// OPHI_* env on first run), instances kept per name so §familiar toggling keeps
// each conversation. No vendor preferred — config picks the provider.
const roster = createRoster({ router, lang: "python" });

// The live familiar turn, so ctrl+c can abort it. A turn holds the kernel queue
// for as long as it loops, which is what made a later cell look like a hang.
let turn: AbortController | null = null;

// The live OBSERVER turn: after each human cell the familiar gets one look at
// what ran (witnessed into its history) and may react — the prompt teaches
// that silence is the default. Superseded by the next cell or a real chat
// send; provider failures are dropped silently (an unconfigured provider must
// not turn every cell into an error note).
let observerTurn: AbortController | null = null;
function observeCell(code: string, result: unknown, lang: string) {
  const send = toView();
  observerTurn?.abort();
  observerTurn = new AbortController();
  const signal = observerTurn.signal;
  const familiar = roster.active();
  familiar.setLang(lang);
  familiar.observeCell(code, result, {
    signal,
    onDelta: (t: string) => send.familiarDelta({ text: t }),
    onConsoleStart: () => send.familiarConsoleStart({}),
    onConsoleResult: (c: string, r: unknown) => send.familiarConsoleResult({ code: c, result: r }),
    onCell: (c: string) => trace("familiar", c, () => router.run(lang, c, { preemptible: true })),
  }).then(() => {
    if (!signal.aborted) { send.familiarDone({}); roster.saveActive(); }
  }).catch((e: Error) => console.log(`[observe] dropped: ${e.message}`));
}

// Session trace. Interactions used to leave no record at all, so "it went wrong
// mid-flight" was undiagnosable after the fact — every cell, who ran it, how
// long it took and how it ended now lands in the dev log.
let seq = 0;
async function trace<T>(who: string, code: string, work: () => Promise<T>): Promise<T> {
  const n = ++seq;
  const one = code.replace(/\s+/g, " ").slice(0, 70);
  const t0 = Date.now();
  console.log(`[cell ${n}] ${who} > ${one}`);
  try {
    const r = await work() as any;
    const bits = [
      r?.stdout ? `stdout ${JSON.stringify(String(r.stdout).slice(0, 60))}` : "",
      r?.displays?.length ? `displays ${r.displays.length}` : "",
      r?.stderr ? "stderr" : "",
      r?.error ? `ERROR ${JSON.stringify(String(r.error).split("\n").filter(Boolean).pop()?.slice(0, 80))}` : "",
    ].filter(Boolean).join(" · ") || "(no output)";
    console.log(`[cell ${n}] ${who} < ${Date.now() - t0}ms ${bits}`);
    return r;
  } catch (e) {
    console.log(`[cell ${n}] ${who} < ${Date.now() - t0}ms THREW ${(e as Error).message}`);
    throw e;
  }
}

// Smaller than this and the two panels are below their own minimums anyway.
const MIN_W = 480, MIN_H = 320;

// Windows: enter the OS's own modal move loop by posting the window a synthetic
// caption press, which the wndproc shim hands to DefWindowProc (see
// windowShim.c). Drag-to-edge snap and drag-to-top maximize live inside that
// loop, so routing the drag through it is what makes them work; the JS delta
// loop can only teleport the frame, which the OS never reads as a drag.
// Assigned after the window exists; null on other hosts (they keep the deltas).
let nativeDrag: (() => void) | null = null;

// bun→view push: stream the familiar's turn into the panel as it happens.
const toView = () => (mainWindow as any).webview.rpc.send;

const rpc = BrowserView.defineRPC({
  maxRequestTime: 300000,
  handlers: {
    requests: {
      // Typed by the human: runs now. Front of the queue, and it takes the
      // kernel back from a familiar cell mid-flight rather than waiting for it.
      // onOutput streams the running cell's lines into the console as they
      // happen — the result at the end is the same lines, made authoritative.
      runCell: async ({ code, lang }) => {
        const r = await trace("human", code, () =>
          router.run(lang, code, { front: true, preempt: true, onOutput: (o: unknown) => toView().cellOutput(o) }));
        observeCell(code, r, lang || "python");   // fire-and-forget — the cell's result never waits on the familiar
        return r;
      },
      complete: async ({ code, cursor, lang }) => router.complete(lang, code, cursor),
      inspect: async ({ name, lang }) => router.inspect(lang, name),
      languages: () => router.languages(),
      // First-boot dependency probe: is python real (not the Windows Store
      // alias), and which packages exist. find_spec, not import — fast, no side
      // effects. The console turns this into install guidance.
      kernelHealth: async () => {
        const MODS = ["IPython", "jedi", "jupyter_client", "dill", "winpty", "matplotlib", "matplotlib_inline"];
        const probe = `import json,sys,importlib.util as u;print(json.dumps({"python":sys.version.split()[0],"exe":sys.executable,"mods":{m:bool(u.find_spec(m)) for m in ${JSON.stringify(MODS)}}}))`;
        try {
          const p = Bun.spawn(["python", "-c", probe], { stdout: "pipe", stderr: "pipe" });
          const out = await Promise.race([
            new Response(p.stdout).text(),
            new Promise<string>((r) => setTimeout(() => { try { p.kill(); } catch {} r(""); }, 8000)),
          ]);
          const code = await p.exited;
          const line = (out.trim().split("\n").pop() || "");
          if (code !== 0 || !line.startsWith("{")) return { ok: false };
          return { ok: true, ...JSON.parse(line) };
        } catch {
          return { ok: false };
        }
      },
      restartKernel: ({ lang }) => { router.restart(lang); return { ok: true }; },
      interruptKernel: ({ lang }) => { router.interrupt(lang); return { ok: true }; },
      sendToFamiliar: async ({ text, lang }) => {
        const send = toView();
        const L = lang || "python";
        const familiar = roster.active();
        familiar.setLang(L);
        console.log(`[turn] start (${roster.activeName}): ${JSON.stringify(String(text).slice(0, 80))}`);
        const turnT0 = Date.now();
        // One turn at a time; ctrl+c aborts it through cancelFamiliar. A real
        // question also supersedes any observer turn still mulling.
        turn?.abort();
        observerTurn?.abort(); observerTurn = null;
        turn = new AbortController();
        const signal = turn.signal;
        await familiar.send(text, {
          signal,
          onDelta: (t: string) => send.familiarDelta({ text: t }),
          onStatus: (s: string) => { console.log(`[turn] status: ${s}`); send.familiarStatus({ text: s }); },
          // The chat panel pulses while the familiar works; the console shows
          // each cell as it runs.
          onConsoleStart: () => send.familiarConsoleStart({}),
          onConsoleResult: (code: string, result: unknown) => send.familiarConsoleResult({ code, result }),
          // Routed through trace so familiar cells appear in the same log as
          // the human's — the interleaving is the thing worth seeing.
          onCell: (code: string) => trace("familiar", code, () => router.run(L, code, { preemptible: true })),
        });
        send.familiarDone({});
        console.log(`[turn] end after ${Date.now() - turnT0}ms`);
        turn = null;
        roster.saveActive();   // the conversation survives a restart
        return { ok: true };
      },
      // ctrl+c: interrupt the kernel AND stop the familiar's loop. Interrupting
      // only the cell would leave the turn free to queue the next one.
      cancelFamiliar: () => {
        const had = !!turn || !!observerTurn;
        console.log(`[cancel] ctrl+c — familiar turn ${had ? "aborted" : "was idle"}`);
        turn?.abort(); turn = null;
        observerTurn?.abort(); observerTurn = null;
        return { aborted: had };
      },
      clearFamiliar: () => { roster.active().clear(); roster.saveActive(); return { ok: true }; },
      // The active familiar's conversation, for the chat panel to render on
      // boot and after a §familiar switch.
      transcript: () => ({ items: roster.transcript() }),
      // Who the two speakers are. The transcript prompts read `$name>`, so the
      // names are data, not markup.
      identity: () => ({ user: roster.user, familiar: roster.activeName }),
      // §set / §familiar — the roster is the config store (~/.ophiuchus.json).
      config: () => ({ user: roster.user, active: roster.activeName, familiars: roster.list(), firstRun: roster.firstRun }),
      setUser: ({ name }: { name: string }) => { roster.setUser(name); return { ok: true, user: roster.user }; },
      // Switching or creating mid-turn aborts the turn: it belongs to the
      // familiar that was speaking, not the one arriving.
      familiarUse: ({ name }: { name: string }) => { const r = roster.use(name); if (r.ok) { turn?.abort(); turn = null; observerTurn?.abort(); observerTurn = null; } return r; },
      familiarNew: ({ name }: { name: string }) => { const r = roster.create(name); if (r.ok) { turn?.abort(); turn = null; observerTurn?.abort(); observerTurn = null; } return r; },
      familiarEdit: ({ name, key, value }: { name: string; key: string; value: string }) => roster.edit(name, key, value),
      // §save / §load — conversation snapshot here; the console runs the
      // dill dump/load cell against the returned path. Loading mid-turn
      // aborts the turn: the conversation it belonged to is being replaced.
      snapshots: () => ({ names: roster.snapshots() }),
      snapshotSave: ({ name }: { name: string }) => roster.snapshotSave(name),
      snapshotLoad: ({ name }: { name: string }) => { const r = roster.snapshotLoad(name); if (r.ok) { turn?.abort(); turn = null; observerTurn?.abort(); observerTurn = null; } return r; },
      // §provider / §model — sugar over the active familiar's config.
      providers: () => ({ ids: roster.providers(), list: roster.providerList(), active: roster.activeConfig() }),
      models: () => roster.models(),
      // Renderer reports it mounted — the only in-app signal that the boxed view
      // wired up cleanly (WebView2 renderer console isn't on stdout).
      viewReady: (info: { boxes: number; console: boolean; familiar: boolean; inputs: number; layout?: string; drag?: string }) => {
        console.log(`view ready: ${info.boxes} boxes · console=${info.console} familiar=${info.familiar} · inputs=${info.inputs}${info.inputs === 1 ? " (single-input ok)" : " (EXPECTED 1)"} · layout=${info.layout} · drag=${info.drag}`);
        return { ok: true };
      },
    },
    // The window carries no OS chrome, so moving and sizing it are the view's
    // job: its drag strip and edge grips report here. Fire-and-forget, so a
    // drag never waits on a round trip. On Windows the drag is handed to the
    // OS move loop (nativeDrag); elsewhere the strip streams windowMove deltas
    // — relative rather than absolute, because the frame is the authority on
    // where the window is and it moves under us as the drag goes.
    messages: {
      // A poke, not a command: on Windows it enters the OS move loop, elsewhere
      // it is a no-op and the view's windowMove deltas do the dragging.
      windowDragStart: () => { nativeDrag?.(); },
      windowMove: ({ dx, dy }: { dx: number; dy: number }) => {
        const f = mainWindow.getFrame();
        mainWindow.setPosition(f.x + dx, f.y + dy);
      },
      windowClose: () => mainWindow.close(),
      // The maximize toggle every titlebar has, on the strip's double-click.
      windowToggleMaximize: () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      },
      // A west/north edge moves the origin as it sizes; clamping has to drop
      // BOTH halves of that or the window walks sideways at the minimum.
      windowResize: ({ edge, dx, dy }: { edge: string; dx: number; dy: number }) => {
        if (mainWindow.isMaximized()) return;   // grips overlap screen edges when maximized
        const f = mainWindow.getFrame();
        let { x, y, width, height } = f;
        if (edge.includes("w") && width - dx >= MIN_W) { x += dx; width -= dx; }
        if (edge.includes("e")) width = Math.max(MIN_W, width + dx);
        if (edge.includes("n") && height - dy >= MIN_H) { y += dy; height -= dy; }
        if (edge.includes("s")) height = Math.max(MIN_H, height + dy);
        mainWindow.setFrame(x, y, width, height);
      },
    },
  },
});

const mainWindow = new BrowserWindow({
  title: "Ophiuchus",
  url: "views://workspace/index.html",
  rpc,
  // Borderless and undecorated: no OS titlebar, and almost no visible in-app
  // chrome — the window is content edge to edge, plus a close ×. The working
  // chrome is invisible and lives in the view: a drag strip along the top and
  // grips around the rim, reporting through the window* messages above. On
  // Windows the wndproc shim below makes the OS treat this frameless window as
  // a normal app window (snap, Win+Arrow, shadow) without painting any frame.
  // 16:9, up from 1200x780.
  titleBarStyle: "hidden",
  styleMask: { Titled: false, Borderless: true, FullSizeContentView: true, Closable: true, Miniaturizable: true, Resizable: true },
  frame: { width: 1560, height: 880, x: 100, y: 70 },
});

if (process.platform === "win32") {
  const GWL_STYLE = -16, WS_MAXIMIZEBOX = 0x10000;
  const u32 = dlopen("user32.dll", {
    FindWindowW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    SetWindowLongW: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    SetWindowPos: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.bool },
    GetCursorPos: { args: [FFIType.ptr], returns: FFIType.bool },
    PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.bool },
  }).symbols;
  const wide = (s: string) => Buffer.from(s + "\0", "utf16le");
  const cls = wide("BasicWindowClass"), title = wide("Ophiuchus");
  const hwnd = u32.FindWindowW(ptr(cls), ptr(title));
  if (hwnd) {
    // The wndproc shim (windowShim.c): WS_THICKFRAME without its painted frame,
    // which is what makes the window native to the OS — Win+Arrow, snap, DWM
    // shadow. TinyCC compiles it in-process; the subclass chains to
    // electrobun's own wndproc for everything but WM_NCCALCSIZE. On any
    // failure the window simply stays as it was: draggable and resizable
    // through the view, invisible to the snap system.
    try {
      const shim = cc({
        source: join(dirname(fileURLToPath(import.meta.url)), "windowShim.c"),
        symbols: {
          ophiSetup: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
          ophiSetOldProc: { args: [FFIType.ptr], returns: FFIType.void },
          ophiGetProc: { args: [], returns: FFIType.ptr },
        },
      });
      (globalThis as any).__ophiShim = shim;   // the wndproc must outlive this scope
      // TinyCC has no Windows import libraries, so the shim takes its user32
      // functions as pointers — resolved here the way a linker would.
      const k32 = dlopen("kernel32.dll", {
        GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr },
        GetProcAddress: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
      }).symbols;
      const cstr = (s: string) => Buffer.from(s + "\0", "ascii");
      const u32mod = k32.GetModuleHandleW(ptr(wide("user32.dll")));
      const fn = (name: string) => k32.GetProcAddress(u32mod, ptr(cstr(name)));

      const wproc = dlopen("user32.dll", {
        GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
        SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
      }).symbols;
      // WS_CAPTION as well: the shell's snap heuristics (drag previews,
      // Win+Arrow eligibility) treat caption-less windows as tool surfaces,
      // not app windows — Electron and Windows Terminal both keep the bit and
      // let WM_NCCALCSIZE erase the bar it would paint.
      const GWLP_WNDPROC = -4, WS_THICKFRAME = 0x40000, WS_CAPTION = 0xc00000;
      const SWP_FRAMECHANGED = 0x0027; // + NOMOVE|NOSIZE|NOZORDER

      // Arm the shim COMPLETELY before installing it. The window thread is
      // live and pumping; a message that lands between the swap and a late
      // ophiSetOldProc would chain into null (that segfault happened).
      shim.symbols.ophiSetup(fn("CallWindowProcW"), fn("DefWindowProcW"), fn("ReleaseCapture"), fn("IsZoomed"), fn("GetSystemMetrics"));
      const current = wproc.GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
      if (!current) throw new Error("GetWindowLongPtrW returned null");
      shim.symbols.ophiSetOldProc(current);
      wproc.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, shim.symbols.ophiGetProc());
      u32.SetWindowLongW(hwnd, GWL_STYLE, u32.GetWindowLongW(hwnd, GWL_STYLE) | WS_CAPTION | WS_THICKFRAME | WS_MAXIMIZEBOX);
      u32.SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_FRAMECHANGED);
      console.log("window: native frame shim installed (Win+Arrow/snap live)");
    } catch (e) {
      console.log("window: shim failed (" + (e as Error).message + ") — view-side drag/resize only");
      // Without the shim WS_THICKFRAME would paint its band; settle for
      // maximize legality alone, which paints nothing without a caption.
      u32.SetWindowLongW(hwnd, GWL_STYLE, u32.GetWindowLongW(hwnd, GWL_STYLE) | WS_MAXIMIZEBOX);
    }
    // A synthetic caption press; the shim routes it into the OS move loop.
    // PostMessage, not SendMessage — the loop is modal and runs on the window's
    // thread; Send would park this process inside it for the whole drag,
    // stalling the kernel stream and every RPC. lParam is the cursor anchor:
    // Def's move loop bails when the anchor isn't on the window.
    const WM_NCLBUTTONDOWN = 0x00a1, HTCAPTION = 2;
    const pt = new Int32Array(2);            // POINT { LONG x, y }
    nativeDrag = () => {
      u32.GetCursorPos(ptr(pt));
      const lp = BigInt(((pt[1] & 0xffff) << 16) | (pt[0] & 0xffff));
      u32.PostMessageW(hwnd, WM_NCLBUTTONDOWN, BigInt(HTCAPTION), lp);
    };
  } else {
    console.log("window: HWND not found — window management stays view-side only");
  }
}

console.log("Ophiuchus started");

// OPHI_SMOKE=1 drives the kernel + familiar once in this real process and logs
// the result — verifies both halves end-to-end without clicking the window.
if (process.env.OPHI_SMOKE === "1") {
  (async () => {
    try {
      // Same traced path the UI uses, so the trace itself is exercised too.
      const cell = await trace("human", "x = 6 * 7", () => router.run("python", "x = 6 * 7\nprint('kernel:', x)", { front: true, preempt: true }));
      console.log("SMOKE kernel:", JSON.stringify((cell.stdout || "").trim()));
      let chat = "";
      await roster.active().send("say hi", {
        onDelta: (t: string) => { chat += t; },
        onStatus: (s: string) => console.log(`[turn] status: ${s}`),
        onCell: (code: string) => trace("familiar", code, () => router.run("python", code, { preemptible: true })),
      });
      console.log("SMOKE familiar chat:", JSON.stringify(chat.trim()));
      console.log("SMOKE ok");
    } catch (e) {
      console.log("SMOKE fail:", (e as Error).message);
    }
  })();
}
