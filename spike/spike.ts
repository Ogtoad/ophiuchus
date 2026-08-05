// Phase-0 spike: exercises every gate from docs/tauri-migration-plan.md.
// Window gates are manual (drag, snap, Win+Arrow, dblclick, DPI); the IPC
// payload gates run automatically on load and print results on the page.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Command } from "@tauri-apps/plugin-shell";

const win = getCurrentWindow();
const $ = (id: string) => document.getElementById(id)!;
const report = (line: string) => { $("results").textContent += line + "\n"; console.log("[spike]", line); };

// ── Window chrome: grips + close (drag + dblclick-maximize come from the
// data-tauri-drag-region attribute — core injects both behaviors). ─────────
const DIRS: Record<string, string> = { n: "North", s: "South", e: "East", w: "West", nw: "NorthWest", ne: "NorthEast", sw: "SouthWest", se: "SouthEast" };
for (const [cls, dir] of Object.entries(DIRS)) {
  const el = document.body.appendChild(document.createElement("div"));
  el.className = "wedge " + cls;
  el.addEventListener("pointerdown", (e) => { if (e.button === 0) win.startResizeDragging(dir as any); });
}
$("closeBtn").addEventListener("click", () => win.close());

// ── Caret-alignment sample: the overlay/textarea pair from the real console.
const input = $("input") as HTMLTextAreaElement;
const overlay = $("overlay");
input.addEventListener("input", () => {
  overlay.textContent = input.value + (input.value.endsWith("\n") ? "​" : "");
});
input.focus();

// ── IPC gates: spawn `bun -e` through plugin-shell, raw encoding, own line
// framing — the exact transport shape the sidecar will use. ────────────────
function lineReader(onLine: (l: string) => void) {
  const dec = new TextDecoder();
  let buf = "";
  return (data: Uint8Array) => {
    buf += dec.decode(data, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  };
}

async function gateBigLine() {
  const N = 5 * 1024 * 1024;
  const t0 = performance.now();
  const cmd = Command.create("bun", ["-e", `process.stdout.write("x".repeat(${N}) + "\\n"); console.log("BIGDONE");`], { encoding: "raw" as any });
  let chunks = 0, firstLine = "", done = false;
  const feed = lineReader((l) => { if (!firstLine) firstLine = l; else if (l === "BIGDONE") done = true; });
  cmd.stdout.on("data", (d: any) => { chunks += 1; feed(d as Uint8Array); });
  const closed = new Promise<void>((res) => cmd.on("close", () => res()));
  await cmd.spawn();
  await closed;
  const ms = Math.round(performance.now() - t0);
  const intact = firstLine.length === N && /^x+$/.test(firstLine.slice(0, 1000)) && firstLine.endsWith("x");
  report(`GATE big-line: ${intact && done ? "PASS" : "FAIL"} — 5MB line in ${chunks} chunks, ${ms}ms, intact=${intact}, tail-seen=${done}`);
}

async function gateRapid() {
  const t0 = performance.now();
  const cmd = Command.create("bun", ["-e", `let i = 0; const t = setInterval(() => { console.log("tick" + i); i += 1; if (i >= 200) { clearInterval(t); } }, 1);`], { encoding: "raw" as any });
  const seen = new Set<number>();
  const feed = lineReader((l) => { const m = /^tick(\d+)$/.exec(l); if (m) seen.add(+m[1]); });
  cmd.stdout.on("data", (d: any) => feed(d as Uint8Array));
  const closed = new Promise<void>((res) => cmd.on("close", () => res()));
  await cmd.spawn();
  await closed;
  const ms = Math.round(performance.now() - t0);
  report(`GATE rapid-stream: ${seen.size === 200 ? "PASS" : "FAIL"} — ${seen.size}/200 ticks, ${ms}ms`);
}

async function gateStdinRoundtrip() {
  const t0 = performance.now();
  const cmd = Command.create("bun", ["-e",
    `process.stdin.on("data", (d) => { const s = d.toString(); process.stdout.write("echo:" + s); if (s.includes("quit")) process.exit(0); });`,
  ], { encoding: "raw" as any });
  let got = "";
  const feed = lineReader((l) => { got += l + ";"; });
  cmd.stdout.on("data", (d: any) => feed(d as Uint8Array));
  const closed = new Promise<void>((res) => cmd.on("close", () => res()));
  const child = await cmd.spawn();
  await child.write("hello\n");
  await child.write("quit\n");
  await closed;
  const ms = Math.round(performance.now() - t0);
  report(`GATE stdin-roundtrip: ${got.includes("echo:hello") ? "PASS" : "FAIL"} — ${JSON.stringify(got.slice(0, 40))}, ${ms}ms`);
}

(async () => {
  report(`devicePixelRatio: ${devicePixelRatio} (manual gates matter most at >1)`);
  try { await gateStdinRoundtrip(); } catch (e: any) { report("GATE stdin-roundtrip: FAIL — " + e.message); }
  try { await gateRapid(); } catch (e: any) { report("GATE rapid-stream: FAIL — " + e.message); }
  try { await gateBigLine(); } catch (e: any) { report("GATE big-line: FAIL — " + e.message); }
  report("— automated gates done. Manual: drag strip, drag-to-edge snap, drag-to-top, Win+Arrow, Snap Layouts, dblclick titlebar, all 8 grips, caret alignment in the sample below. —");
})();
