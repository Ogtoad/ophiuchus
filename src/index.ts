// The electrobun SHELL: window, native frame shim, and the RPC bridge. All
// application behavior lives in appCore.js — this file only hosts it. (The
// Tauri migration replaces this file and nothing else on the bun side.)

import { BrowserWindow, BrowserView } from "electrobun/bun";
import { cc, dlopen, FFIType, ptr } from "bun:ffi";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "./appCore.js";

// bun→view push: stream the familiar's turn into the panel as it happens.
const toView = () => (mainWindow as any).webview.rpc.send;

const app = createApp({ push: (name: string, payload: unknown) => (toView() as any)[name](payload) });

// Kernels are children of this process; reap them however we exit.
process.on("exit", app.shutdown);

// Smaller than this and the two panels are below their own minimums anyway.
const MIN_W = 480, MIN_H = 320;

// Windows: enter the OS's own modal move loop by posting the window a synthetic
// caption press, which the wndproc shim hands to DefWindowProc (see
// windowShim.c). Drag-to-edge snap and drag-to-top maximize live inside that
// loop, so routing the drag through it is what makes them work; the JS delta
// loop can only teleport the frame, which the OS never reads as a drag.
// Assigned after the window exists; null on other hosts (they keep the deltas).
let nativeDrag: (() => void) | null = null;

const rpc = BrowserView.defineRPC({
  maxRequestTime: 300000,
  handlers: {
    requests: app.handlers as any,
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
      windowClose: () => { app.shutdown(); mainWindow.close(); },
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
      const cell = await app.trace("human", "x = 6 * 7", () => app.router.run("python", "x = 6 * 7\nprint('kernel:', x)", { front: true, preempt: true }));
      console.log("SMOKE kernel:", JSON.stringify((cell.stdout || "").trim()));
      let chat = "";
      await app.roster.active().send("say hi", {
        onDelta: (t: string) => { chat += t; },
        onStatus: (s: string) => console.log(`[turn] status: ${s}`),
        onCell: (code: string) => app.trace("familiar", code, () => app.router.run("python", code, { preemptible: true })),
      });
      console.log("SMOKE familiar chat:", JSON.stringify(chat.trim()));
      console.log("SMOKE ok");
    } catch (e) {
      console.log("SMOKE fail:", (e as Error).message);
    }
  })();
}
