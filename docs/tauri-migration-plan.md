# Tauri migration — sidecar-first plan

Goal: replace electrobun as the shell (window, IPC bridge, packaging) while the
JS backend and the view survive bit-for-bit. Rust stays a dumb pipe; no logic
is rewritten. Full-Rust backend is explicitly out of scope — revisit only if
the ~30MB runtime weight ever matters.

Branch: `tauri-shell`. Master keeps building on electrobun until parity is
proven, then hard cutover and the electrobun path is deleted.

## Target architecture

```
view (unchanged JS)  ──electrobunShim──▶  tauri-plugin-shell (JS API, scoped
                                             │  to the sidecar binary only)
                                             ▼
                                       ophi-core.exe (bun-compiled sidecar)
                                             │  stdio, JSON lines
                                             ▼
                              appCore.js — everything src/index.ts does today
                              minus window/FFI/RPC plumbing (kernel router,
                              roster, turns, observer, snapshots, health)
                                             │
                                             ▼
                                python kernels (unchanged)
```

No custom Rust. The shim spawns the sidecar itself via plugin-shell's JS API
and does its own line framing (the exact pattern kernelTransport.js already
implements). One channel also kills an ordering race a Rust bridge would have
had: with responses resolving through `invoke` and pushes arriving as events,
a cell's final result could overtake its last streamed output line (the view
drops output once `liveEntry` clears). One ordered stdout stream carrying BOTH
responses and pushes makes that impossible by construction — resolve request
promises from the same stream the pushes ride.

Verified coupling surface (grep, 2026-08): exactly two electrobun imports —
index.ts (bun) and workspaceIndex.ts (view); the panels take the rpc object as
a parameter. Shim must cover 24 request methods, 5 window messages (become
Tauri window API calls), 6 push messages.

## Phases

### 0. Spike & measure (0.5–1d)
- `bunx tauri init` scaffold, Tauri v2, decorations:false, shadow:true.
- Load workspace.html statically; confirm WebView2 parity (fonts, phosphor CSS,
  caret behavior).
- Frameless gate, item by item (tao implements these via WM_NCHITTEST margins
  and the same WM_NCLBUTTONDOWN drag trick our shim uses — but verify, don't
  trust): drag via drag-region, drag-to-edge snap, drag-to-top maximize,
  Win+Arrow, Win11 Snap Layouts, resize from all 8 edges, behavior at >100%
  display scaling (which the current delta-drag code never handled).
- IPC payload gate: pump a 5MB single line (a max-budget base64 plot) through
  plugin-shell stdout events with `encoding: "raw"` + own line buffering, and a
  rapid small-chunk stream (typewriter deltas). Measure latency and loss.
- Measure the empty-shell installer; confirm NSIS's WebView2 bootstrapper
  option (an actual improvement — electrobun just fails without the runtime).
- Gate: any redline here → stop and reassess before writing more code.

### 1. Backend extraction (1d) — works on electrobun BEFORE the switch
- Split `src/index.ts`: `appCore.js` exports `createApp({ push })` returning the
  request-handler map (runCell, sendToFamiliar, cancelFamiliar, config,
  familiar*, snapshot*, kernelHealth, …). `push(name, payload)` replaces
  `toView().x()` for bun→view messages. Zero electrobun imports in appCore.
- `index.ts` shrinks to: electrobun window + FFI shim + RPC glue calling appCore.
  Ship this refactor on master first — it's pure movement, verified by the
  existing self-checks plus OPHI_SMOKE.
- Embed the .py drivers as compile-time text imports (bun `with { type: "text" }`)
  so the compiled sidecar needs no loose files; kernelPython already deflates
  source into argv.
- Logging discipline: appCore logs move to stderr — sidecar stdout is protocol.
- Add `router.shutdown()` (kill every live kernel backend) and call it on app
  exit — fixes the pre-existing kernel-orphan bug on master, needed by the
  sidecar's EOF handling later.

### 2. Sidecar (1d)
- `sidecarMain.ts`: JSON-lines loop over stdin/stdout around createApp —
  `{id, method, args}` in; `{id, result|error}` and `{push, payload}` out, one
  ordered stream. `console.log` rebound to stderr at the top.
- Lifecycle — a subsystem, not a footnote: stdin EOF (parent died or closed) →
  `router.shutdown()` kills every kernel process, then exit. Requires adding
  `shutdown()` to kernelRouter/transport (proc.kill per live backend). NOTE:
  today NOTHING kills kernels on app exit — python processes are orphaned by
  the electrobun app too. Pre-existing bug; fixing it in the transport benefits
  master immediately, land it in phase 1.
- `bun build --compile` → `ophi-core-x86_64-pc-windows-msvc.exe` (bundled via
  externalBin). Dev loop runs the uncompiled `bun sidecarMain.ts` instead.
- Drive it by hand: runCell, a familiar turn against mock, ctrl-c path, EOF
  kills kernels (check no python left in tasklist).

### 3. Shell wiring (0.5–1d, config not code)
- Tauri config: window, capability scoping plugin-shell to the sidecar binary
  ONLY (no general shell access from the webview).
- Watchdog in the shim: sidecar exit → console note + auto-respawn once.

### 4. View adapter (1d)
- `electrobunShim.js`: object with `rpc.request.<name>(args)` (proxy → invoke)
  and `rpc.send.<name>` (window control calls), incoming events → the existing
  message handler map. workspaceIndex constructs this instead of Electroview —
  consolePanel/familiarPanel untouched.
- Window controls: titlebar gets `data-tauri-drag-region` (delete the delta-drag
  and native-poke paths), dblclick → `toggleMaximize()`, grips →
  `startResizeDragging(edge)`, × → `close()`. windowShim.c, TinyCC, bun:ffi
  block: deleted at cutover.

### 5. Packaging (1d)
- View built by `bun build` into `dist/`; Tauri serves it (no views:// scheme).
- `tauri icon icon.png` generates the icon set — embedIcon.ts retired.
- NSIS bundle; verify: install, Start Menu + icon, uninstall, per-user install
  dir. Keep the release routine: `gh release create` with the NSIS exe.

### 6. Parity pass & cutover (1–2d)
- Checklist, each against a real kernel: ctrl+↵/alt+↵, §-commands incl. setup +
  save/load, ?inspect, bare % , tab-complete, smart indent + trailing-newline
  caret, ^C both halves, ! commands, %cd, inline plots, observer turns,
  familiar switching, session restore, kernel-health guidance on broken python,
  multi-lang via jupyter discovery, drag/snap/dblclick-maximize/resize.
- Port OPHI_SMOKE to the sidecar protocol.
- Cutover: delete electrobun deps, index.ts shell, windowShim.c, embedIcon.ts;
  update README + memory; release as 0.2.0-beta.1.

## Risks
- Frameless behavior differs under wry (focus, autofocus quirks): phase 0 gates.
- Sidecar stdout corruption by stray console.log: stderr rebind in sidecarMain +
  a protocol fuzz line in the sidecar self-check. (Verified: backend modules'
  only console.logs outside index.ts are in `import.meta.main` self-check
  blocks, which never run in the sidecar.)
- Large IPC payloads (multi-MB base64 plots as single protocol lines) through
  plugin-shell events: phase 0 gates with a real 5MB pump.
- Known migration loss: localStorage origin changes (views:// → tauri
  localhost), so the persisted console transcript, pad, and layout reset once.
  Config and familiar sessions are files (~/.ophiuchus.*) and survive.
- Electrobun's updater artifacts (update.json / bsdiff) die with it; Tauri's
  updater plugin is a separate later project (today's updater was never
  configured anyway — baseUrl is empty).
- WebView2 runtime: NSIS bootstrapper option closes the gap electrobun left
  open.

Total: ~6–8 working days to a parity NSIS installer, with phases 1–2 landing on
master as harmless refactors (plus one real bug fix) before any Tauri code
exists.
