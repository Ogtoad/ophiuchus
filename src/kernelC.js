// C backend factory: the marker-protocol C driver (kernelC.py) running
// `tcc -run` per cell. Registered only when a tcc binary is actually findable,
// so §lang never offers a language that can't run.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTransport } from "./kernelTransport.js";
import { pyLoaderCmd } from "./kernelPython.js";
import cDriverSource from "./kernelC.py" with { type: "text" };

export function tccAvailable(env = process.env) {
  if (env.OPHI_TCC && existsSync(env.OPHI_TCC)) return true;
  if (env.LOCALAPPDATA && existsSync(join(env.LOCALAPPDATA, "Programs", "tcc", "tcc", "tcc.exe"))) return true;
  return ["/usr/bin/tcc", "/usr/local/bin/tcc"].some((p) => existsSync(p)) || !!Bun.which("tcc");
}

export function kernelC(python = "python") {
  return createTransport({
    label: "c",
    cmd: pyLoaderCmd(python, cDriverSource),
    config: {},
    // No split (a C cell is one program), no completion/inspection.
    capabilities: { complete: false, inspect: false, checkComplete: true, interrupt: true, richDisplay: false, split: false, state: "none" },
  });
}
