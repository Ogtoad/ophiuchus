# logos IPython kernel driver — full feature map

**Source:** `logos/src/main/kernel/KernelManager.ts`, the embedded `BOOTSTRAP`
Python string (lines 24–727) + the `LOADER` one-liner (line 13).
**Purpose of this doc:** enumerate *every* feature of logos's kernel driver with
what it's for, so Ophiuchus can cherry-pick. Each item carries a lean
recommendation — **KEEP** (core console/servitor need), **OPTIONAL** (nice
console UX, costs code), **CUT** (logos-specific or heavy introspection we set
out to shed).

The driver is a persistent Python process running IPython's `InteractiveShell`,
talking to the app over a line-based **marker protocol** on stdin/stdout.

---

## 0. Bootstrap & transport

| Feature | What it's for | Lean |
|---|---|---|
| `LOADER` one-liner (`exec(zlib.decompress(b64decode(argv[1])))`) | Ships the whole driver as one deflated+base64 argv so it fits Windows' 32,767-char command-line limit. | **OPTIONAL** — our lean driver is small enough to pass via `python -c` directly; keep the trick only if the driver grows past ~30k chars. |
| IPython import guard → `___LOGOS_FATAL___` | If the interpreter lacks IPython, emit a clear fatal instead of a cryptic traceback. | **KEEP** (if IPython-based) — one line, saves confusion. |

## 1. Execution core

| Feature | What it's for | Lean |
|---|---|---|
| Cell buffer collect (`___LOGOS_EXEC_START___`/`END`, `_buf`) | Accumulate a multi-line cell, then run it as one unit. | **KEEP** |
| `shell.run_cell(buf, store_history=True, silent=False)` | The actual execution — IPython transforms (magics, `!shell`), compiles, runs, echoes last expression via the displayhook. | **KEEP** (this is *the* reason to use IPython over `exec`) |
| `___LOGOS_CELL_START___` / `CELL_END` / `CELL_ERROR` | Frame each cell's output so the app knows where a cell's stream begins/ends and whether it failed. | **KEEP** |
| `store_history=True` | IPython's `In[]`/`Out[]`, `_`, `__` history vars. | **OPTIONAL** — handy in a REPL; drop if unused. |

## 2. Output capture & budget

| Feature | What it's for | Lean |
|---|---|---|
| `_real_stdout` marker channel | Protocol markers bypass the per-cell byte cap so a truncated marker can't corrupt the stream. | **KEEP** (if a budget is used) |
| `_out_budget` (2 MB, config-overridable) | Stop a runaway `print`/generator from flooding the pipe and transcript. | **OPTIONAL** — good hygiene; a lean core can start without it. |
| `_LogosCapIO` (TextIOBase) | Enforces the budget on stdout+stderr, tracks dropped bytes + trailing-newline state. | **OPTIONAL** — only needed if `_out_budget` is kept. |
| stderr captured → re-emitted as `___LOGOS_STDERR___` lines | Preserve stdout/stderr *ordering* (stderr buffered, flushed after the cell as discrete lines). | **KEEP** — even plain capture wants stderr separated. |
| dropped-bytes note | One "… N bytes dropped" line when the budget clips. | **OPTIONAL** (with budget) |

## 3. Display seams (rich output — the IPython payoff)

| Feature | What it's for | Lean |
|---|---|---|
| `LogosDisplayHook` → `___LOGOS_DISPLAY___{kind:result}` | Last-expression result as a **mime bundle** (text/plain, text/html, image/png…) instead of `Out[N]:` text — enables rich `__repr__`, DataFrames, etc. | **KEEP if rich output wanted** — this is why you'd choose IPython. |
| `LogosDisplayPub` → `___LOGOS_DISPLAY___{kind:display}` | `IPython.display.display()` / matplotlib `plt.show()` → mime bundle. Plots, HTML, Markdown. | **KEEP if plots/rich** |
| `__logos_clean_bundle__` | Make a mime bundle JSON-safe (bytes→base64, else repr). | **KEEP** (needed by the two above) |
| `_showtraceback` → `___LOGOS_ERROR___` structured bundle | Errors as `{ename, evalue, frames:[{file,line,name}], traceback}` — real paths for click-to-source, not just rendered text. | **OPTIONAL** — nice; a lean core can just show the rendered traceback text. |

## 4. Shell configuration (the "ipy conf")

| Line | What it's for | Lean |
|---|---|---|
| `_c.HistoryManager.enabled = False` | Don't write every cell into the user's global `~/.ipython/profile_default/history.sqlite` (disk write per cell + pollution). | **KEEP** |
| `_c.InteractiveShell.xmode = 'Plain'` | Compact tracebacks (locations travel as frames instead). | **KEEP** |
| `_c.IPCompleter.evaluation = 'limited'` | Completion may evaluate attribute access on live objects; `limited` blocks arbitrary property side effects. | **KEEP if completion kept** (§7) |
| `shell.colors = 'NoColor'` | No ANSI color codes in output (the app themes it). | **KEEP** |

## 5. Namespace introspection (the heavy set — powers logos's inspector/draft UI)

| Feature | What it's for | Lean |
|---|---|---|
| `__logos_should_skip_name__` | Big skip-list filtering internal/dunder/builtin names out of the namespace snapshot. | **CUT** (unless an inspector panel is built) |
| `_flat_src_cache` + `__logos_flat_source__` | Cached `inspect.getsource` keyed by code identity — avoids re-reading files every cell for every function. | **CUT** (only needed by the snapshot) |
| `__logos_entry__` | Serialize each namespace name → `{origin, scope, type, preview, definition, opaque}` — the data behind logos's variable/function/class inspector and "draft code" surface. | **CUT** |
| `_ns_ids`/`_ns_reprs` + `__logos_delta__` | Per-cell namespace **delta** (only bindings whose identity changed, plus in-place mutation of literal containers) → `___LOGOS_INSPECT___` JSON after every cell. | **CUT** |
| `_declared_names` + `__logos_collect_declared__` | AST walk marking assignment-statement bindings as "declarations" (vs loop targets / function-body locals) — decides what becomes editable draft code. | **CUT** |
| `__logos_modules__` | List loaded project `.py` modules (name+path) for a one-click import/reload UI. | **CUT** |

> This whole group is logos's "workbench" introspection. Ophiuchus's console
> shows cell output, not a live-namespace inspector — so this is the biggest,
> safest cut. Revisit only if you want a variable-explorer panel.

## 6. logos ecosystem accessors (logos-specific)

| Feature | What it's for | Lean |
|---|---|---|
| `_Logos` / `logos` object (`.ns`, `._map`, `.use()`) | In-kernel cross-namespace artifact loader — `logos.use('ns:util.py.TrainJob')` imports across logos project namespaces via importlib, with path confinement. | **CUT** — logos project model; not in Ophiuchus. |
| `_md_section` | Extract a markdown section by heading for `logos.use('file#Heading')`. | **CUT** |
| `___LOGOS_NS_SYNC___` handler | App pushes the namespace→dir map for `logos.use`. | **CUT** |

## 7. Console UX helpers (optional niceties)

| Feature | Marker | What it's for | Lean |
|---|---|---|---|
| Tab completion | `___LOGOS_COMPLETE___` → `_RESULT` | jedi completions via `shell.Completer.completions` + `rectify_completions`, ≤50 matches on a shared replacement span. | **OPTIONAL** — good REPL UX; needs the `IPCompleter` conf line. |
| Hover / object inspect | `___LOGOS_OBJ_INSPECT___` → `_RESULT` | `shell.object_inspect` → type, signature, docstring for a hovered name. | **OPTIONAL** |
| Input completeness check | `___LOGOS_CHECK_START/END___` → `CHECK_OK`/`CHECK_FAIL` | `shell.check_complete` — tells the editor whether a multi-line cell is complete, incomplete (keep typing), or invalid. Enter-vs-newline logic. | **OPTIONAL** — nice for the console input; otherwise Shift+Enter convention. |

## 8. Control & lifecycle

| Feature | What it's for | Lean |
|---|---|---|
| `_logos_stdin_reader` thread + `_q` | A reader thread owns stdin so out-of-band signals (interrupt, tool results) don't wait behind a running cell in the protocol loop. | **KEEP** (adapted) — needed for interrupt to work. |
| `___LOGOS_INTERRUPT___` → `_thread.interrupt_main()` | Ctrl-C a runaway cell (raises `KeyboardInterrupt` in the main thread; works on Windows where SIGINT-to-child doesn't). Gated on `_in_cell`. | **KEEP** — a REPL needs a stop button. |
| `___LOGOS_READY___` | Handshake: driver is up and listening. | **KEEP** |
| config line (`outputByteLimit`) | First stdin line carries runtime config. | **OPTIONAL** (with budget) |

## 9. Servitor tool proxy (logos's servitor-from-Python)

| Feature | What it's for | Lean |
|---|---|---|
| `_LogosTools` / `logos.tools.name(**kwargs)` | Lets code *inside the kernel* call app tools: prints `___LOGOS_TOOL_CALL___`, blocks on a response queue the reader thread feeds, 50-calls/cell cap, 120 s timeout. | **CUT for v1** — Ophiuchus's servitor drives the kernel from *outside* (its `<console>` runs code); it doesn't need tools callable from *inside* Python. Revisit if the servitor should call app functions mid-cell. |
| `___LOGOS_TOOLS_SYNC___` / `___LOGOS_TOOL_RESULT___` | App pushes the tool name→doc map; feeds tool-call responses back. | **CUT for v1** |

---

## Suggested lean baseline (starting cherry-pick)

A defensible "IPython-stripped" `kernelDriver.py` = **§1 + §2(stderr ordering) +
§3(display+clean_bundle) + §4(all four conf lines) + §8(reader thread, interrupt,
ready)**, dropping §5, §6, §9 entirely and treating §7 (completion/inspect/check)
and the §2 budget / §3 error-bundle as OPTIONAL add-ons.

That keeps the IPython payoff (rich `display()`, plots, proper `run_cell` with
magics, interrupt) while shedding the introspection/workbench/tool machinery —
roughly a 700-line driver down to ~120–150.

## Wire protocol reference (for whatever we keep)

**In:** config line · `EXEC_START`/`EXEC_END` · `CHECK_START`/`CHECK_END` ·
`COMPLETE` · `OBJ_INSPECT` · `NS_SYNC` · `TOOLS_SYNC` · `INTERRUPT` · `TOOL_RESULT`
**Out:** `READY` · `CELL_START` · `CELL_END`/`CELL_ERROR` · `STDERR` · `DISPLAY` ·
`ERROR` · `INSPECT_START`/`END` · `CHECK_OK`/`CHECK_FAIL` · `COMPLETE_RESULT` ·
`OBJ_INSPECT_RESULT` · `TOOL_CALL` · `FATAL`
