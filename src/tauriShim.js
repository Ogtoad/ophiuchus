// The view-side RPC bridge for the Tauri shell. Exposes the surface the panels
// already speak — rpc.request.<method>(args) and rpc.send.<windowOp>() —
// backed by the ophi-core sidecar over ONE ordered stdio stream (responses and
// pushes together, so streamed output can never be overtaken by its cell's
// final result). Window ops become native Tauri calls.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";

const RESIZE_DIR = { n: "North", s: "South", e: "East", w: "West", nw: "NorthWest", ne: "NorthEast", sw: "SouthWest", se: "SouthEast" };

export function createTauriShim({ messages = {} } = {}) {
  const win = getCurrentWindow();
  // Mirror shim diagnostics to the shell's stdout — readable without devtools.
  const dbg = (line) => { console.error("[shim]", line); invoke("gate_report", { line: "[shim] " + line }).catch(() => {}); };

  let child = null;
  let nextId = 1;
  let respawned = false;
  const pending = new Map();

  function feedLine(line) {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { dbg("bad frame: " + line.slice(0, 120)); return; }
    if (m.push) { messages[m.push] && messages[m.push](m.payload); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
  }

  async function start() {
    // Default encoding: plugin-shell emits one event PER LINE as a string.
    // (raw mode never delivered a single event on Windows — the original
    // "kernel frozen" bug.) Handle bytes defensively anyway.
    const dec = new TextDecoder();
    let buf = "";
    const asLines = (d, onLine) => {
      if (typeof d === "string") { onLine(d); return; }
      buf += dec.decode(d, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    };
    const cmd = Command.sidecar("binaries/ophi-core");
    cmd.stdout.on("data", (d) => asLines(d, feedLine));
    cmd.stderr.on("data", (d) => asLines(d, (text) => {
      console.error("[core]", text);
      invoke("gate_report", { line: "[core] " + String(text).slice(0, 300) }).catch(() => {});
    }));
    cmd.on("error", (e) => dbg("core spawn error: " + (e?.message ?? String(e))));
    cmd.on("close", (c) => {
      dbg("core exited: " + JSON.stringify(c));
      child = null;
      for (const p of pending.values()) p.reject(new Error("ophi-core exited"));
      pending.clear();
      // One respawn: a crashed core comes back; a crash LOOP stays visible.
      if (!respawned) { respawned = true; ready = start(); }
    });
    child = await cmd.spawn();
    dbg("core spawned, pid " + child.pid);
  }
  let ready = start();

  const request = new Proxy({}, {
    get: (_t, method) => async (args = {}) => {
      await ready;
      if (!child) throw new Error("ophi-core is not running");
      const id = nextId++;
      const line = JSON.stringify({ id, method, args }) + "\n";
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.write(line).catch((e) => { pending.delete(id); reject(e); });
      });
    },
  });

  // The window-op names the view already sends, mapped to native calls.
  // Drag/move are handled by the data-tauri-drag-region attribute; a resize
  // gesture is ONE native call, not a delta stream.
  const send = {
    windowDragStart: () => {},
    windowMove: () => {},
    windowClose: () => { win.close(); },
    windowToggleMaximize: () => { win.toggleMaximize(); },
    windowResize: ({ edge }) => { const d = RESIZE_DIR[edge]; if (d) win.startResizeDragging(d); },
  };

  return { rpc: { request, send } };
}
