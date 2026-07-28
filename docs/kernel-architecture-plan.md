# Language-agnostic kernel architecture

**Status:** in implementation
**Goal:** the console (and the familiar's `<console>` channel) route and execute
through *any* language — Python today, and Go / C++ / Haskell / C next — with the
core untouched when a language is added.

## The one seam

The `___OPHI_` marker protocol is a language-agnostic wire. The JS side spawns a
process, writes `EXEC_START/code/EXEC_END`, and parses framed markers — it knows
nothing about the language. So a backend is just **a command that speaks the
marker protocol**. Two ways to produce that:

1. **marker-driver backend** — a shim in the target language embeds its
   interpreter and emits markers directly. `kernelDriver.py` (IPython) is one.
   Zero external deps. Full control.
2. **jupyter-broker backend** — a thin Python broker uses `jupyter_client` to
   launch *any installed Jupyter kernelspec* and **relays** its iopub/shell
   messages as our markers. One broker → every language with a Jupyter kernel.

Both satisfy one contract; the transport and router don't care which.

## Contract

```
Kernel = {
  run(code)            -> { stdout, stderr, error, errorBundle, displays, success }
  complete(code, cur)  -> { matches, start, end }
  inspect(name)        -> { found, type, signature, doc }
  checkComplete(code)  -> { complete, message? }
  interrupt()          -> void
  restart()            -> void
  whenReady()          -> Promise
  capabilities         -> { complete, inspect, checkComplete, interrupt, richDisplay, state }
}
```

`capabilities` is negotiated per backend — the UI greys out what a kernel can't
do. `state`: `native` (a live process holds it) | `replay` | `none`.

## Files (scope-named)

| File | Role |
|---|---|
| `kernelTransport.js` | generic marker-protocol transport: spawn `spec.cmd`, job queue, line-parse, `run/complete/inspect/checkComplete/interrupt/restart`. **Language-agnostic.** |
| `pythonKernel.js` | marker-driver backend: deflate+load `kernelDriver.py`, capabilities → `createTransport(spec)` |
| `kernelDriver.py` | the IPython marker driver (unchanged) |
| `jupyterKernel.js` | jupyter-broker backend: `spec.cmd = [python, kernelBroker.py, <kernelspec>]` → `createTransport(spec)` |
| `kernelBroker.py` | `jupyter_client` → launches a kernelspec, relays its messages as `___OPHI_` markers |
| `kernelRouter.js` | registry `langId → backend factory`; lazy spawn; per-language lifecycle; kernelspec discovery |

The transport is reused by **both** backend types — the broker emits the same
markers the driver does, so the JS never learns the Jupyter protocol.

## Protocol mapping (broker's translation table)

| Jupyter message | `___OPHI_` marker |
|---|---|
| iopub `status` busy → | `CELL_START` |
| iopub `stream` stdout | raw line |
| iopub `stream` stderr | `STDERR<line>` |
| iopub `execute_result` {data} | `DISPLAY{kind:result,data}` |
| iopub `display_data` {data} | `DISPLAY{kind:display,data}` |
| iopub `error` {ename,evalue,traceback} | `ERROR{...}` |
| shell `execute_reply` status ok/error + iopub idle | `CELL_END` / `CELL_ERROR` |
| `complete_reply` {matches,cursor_start,cursor_end} | `COMPLETE_RESULT` |
| `inspect_reply` {found,data} | `INSPECT_RESULT` |
| `is_complete_reply` {status} | `CHECK_OK` / `CHECK_FAIL` |
| `interrupt_kernel()` | (from `INTERRUPT`) |

## Phases

- **Phase 1 (dep-free refactor):** split `kernelManager.js` → `kernelTransport.js`
  + `pythonKernel.js` + `kernelRouter.js`. App behaves identically; Python via the
  driver, routed. No new deps.
- **Phase 2 (broker):** `pip install jupyter_client ipykernel`; register the
  `python3` kernelspec; write `kernelBroker.py` + `jupyterKernel.js`; register in
  the router. Validate the broker driving **real ipykernel** (same language — diff
  against the driver). 
- **Phase 3 (polyglot proof):** install one genuinely different kernel
  (gophernotes / Go — single binary, fast) and route to it. Confirms the seam.
- **Phase 4 (UI):** language selector in the console; the familiar's
  `<console lang="go">` routes through the router; capability-aware affordances.

## Costs / boundaries

- Deps appear at Phase 2: `jupyter_client` + `ipykernel` + `pyzmq` (native wheel).
  Python stays dep-free on the driver backend; the broker is the on-ramp.
- Per language = **install its kernelspec** (not write a driver): `xeus-cling`
  (C++), `IHaskell`, `gophernotes` (Go), `jupyter-c-kernel` (C).
- Per-language state is isolated (each kernel its own process/namespace — no
  cross-language sharing).
- Heavy kernels (Cling) cold-start slowly → lazy spawn is mandatory (router owns it).
- Broker `inspect` is less structured than the driver's (Jupyter returns a
  text/plain blob, not type/signature/doc) — acceptable, capability-flagged.
