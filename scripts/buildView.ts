// Build the workspace view into dist-view/ for the Tauri shell.
//   bun run build:view
// Bundles src/workspaceIndex.ts → dist-view/workspaceIndex.js and copies
// the static HTML + CSS. Tauri serves dist-view/ as frontendDist.
import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-view");
const src = (...p: string[]) => join(root, "src", ...p);

// Clean — stale output is the #1 source of "why is my old code running".
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Bundle the TS entry. The view modules are ESM; bun produces one file with
// the .js/.ts graph inlined. No minify in dev (readable stack traces); the
// Tauri release build can add --minify later if bundle size matters.
const entry = src("workspaceIndex.ts");
const result = await Bun.build({
  entrypoints: [entry],
  outdir: out,
  target: "browser",
  format: "esm",
  naming: "workspaceIndex.js",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Static assets — the HTML/CSS are hand-written, not bundled.
cpSync(src("workspace.html"), join(out, "index.html"));
cpSync(src("workspace.css"), join(out, "index.css"));

console.log(`view built → ${out} (${result.outputs.length} module(s))`);