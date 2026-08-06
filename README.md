# Ophiuchus

One kernel console, driven by human and familiar.

Ophiuchus is a desktop workspace built around a single live interpreter
session. Two panels: **the console** — a real IPython kernel with `In[n]`
numbering, completion, inspection and rich output — and **the familiar**, an
LLM companion that works by writing code into that same session. One kernel,
one namespace, shared both ways: your variables are its variables, its
declarations are callable by you, and every cell from either side lands in the
same transcript in execution order.

Built on [Tauri](https://tauri.app) (Rust shell + system webview) with a bun
sidecar for the kernel and familiar, ported lean from logos, its larger
predecessor.

## The console

- **One input for everything.** `ctrl+↵` runs the cell, `alt/altgr+↵` sends
  the same text to the familiar, `↵` is a newline. `tab` completes against the
  live kernel, `?name` inspects, `ctrl+c` interrupts.
- **`§` is the interface.** A bare `§` lists the commands: `§set`,
  `§provider`, `§model`, `§familiar`, `§restart`, `§interrupt`, `§clear`.
  Listing forms are bare (`§provider`), actions take arguments (`§provider openai`).
- **Output is live.** stdout streams while a cell runs, stderr streams as it
  is written, and `\r` progress updates overwrite in place instead of
  stacking. Shell escapes (`!pip install …`, `!curl …`) run in a real pty, so
  programs behave as they do in a terminal — animated progress bars included.
- **`ctrl+c` is a system interrupt** — it breaks blocking C calls, kills
  running shell children, and stops the familiar's turn, not just a Python
  flag check.
- **The transcript survives restarts.** Cells, outputs and images are
  restored on boot with their original numbering. Kernel *state* does not
  persist, and the restored transcript says so.

## The console language

**Python** — the built-in marker driver (IPython, no jupyter needed). Fast
path, statement-level streaming for the familiar, magics, `!` escapes. One
kernel, one namespace, shared between human and familiar.

## Familiars

The familiar speaks in tagged text — private `<think>`, prose `<chat>`, and
`<console>` code that executes one declaration at a time, live, in the shared
session. Its cells appear in the console as they run, because they ran.

- **Named familiars** with per-familiar provider, model, endpoint and key:
  `§familiar` lists, `§familiar <name>` switches, `§familiar new <name>`
  creates, `§familiar <name> <key> <value>` edits.
- **Providers**: `claude-code` (local CLI, no key), `openai` (any
  `/v1/chat/completions` endpoint), `ollama` (local daemon or ollama.com),
  `anthropic` (HTTP API), `mock` (offline demo). `§provider` and `§model`
  operate on the active familiar; with ollama, `§model` lists what the daemon
  actually has pulled.
- **Conversations persist** per familiar across restarts and survive provider
  or model changes — config is a parameter of the next call, not of the
  conversation.

Configuration lives in `~/.ophiuchus.json` (hand-editable; `OPHI_CONFIG`
relocates it). `OPHI_PROVIDER`, `OPHI_MODEL`, `OPHI_API_KEY`, `OPHI_BASE_URL`,
`OPHI_USER`, `OPHI_FAMILIAR` seed it on first run. Note that API keys stored
there are plain text — prefer provider-side auth where it matters.

## The window

Frameless — no titlebar, no chrome except a close `×` — but native: snap,
Win+Arrow and the system shadow all work. Tauri's `data-tauri-drag-region`
attribute on the invisible top strip hands drag-to-move and double-click-
maximize to the OS move loop; edge grips fire one-shot `startResizeDragging`
calls. No FFI, no compiled C shim — the webview's own window API does it.

- Drag the invisible top strip to move; double-press it to maximize.
- Edges and corners resize.
- `alt+drag` a panel to re-tile the workspace; `alt+wheel` adjusts the
  (deliberately invisible) padding; layouts persist.

## Running

```
bun install
pip install -r requirements.txt
bun run dev
```

`requirements.txt` documents what is optional: the console needs only
`ipython`/`jedi`; `pywinpty` upgrades shell escapes to a real pty on Windows;
`matplotlib-inline` for inline plots; `dill` for §save/§load snapshots.

`OPHI_SMOKE=1 bun run smoke` runs a kernel + familiar round trip end-to-end
and logs the result. Most modules carry a runnable self-check:
`bun src/<module>.js`.

## Status

Early, and Windows-first: the pty path is a Windows implementation today
(with graceful fallback), while the kernel, console, familiar and language
layers are platform-neutral. Tauri provides native frameless window
management across Windows, macOS, and Linux.
