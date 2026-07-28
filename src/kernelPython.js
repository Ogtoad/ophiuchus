// Python backend (marker-driver type): the IPython driver shipped as a
// deflated+base64 argv (the §0 loader), zero external deps beyond IPython.

import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTransport } from "./kernelTransport.js";

const LOADER = "import base64,zlib,sys;exec(zlib.decompress(base64.b64decode(sys.argv[1])).decode())";
const DRIVER_PATH = join(dirname(fileURLToPath(import.meta.url)), "kernelDriver.py");

export function kernelPython(python = "python", outputByteLimit = 2_000_000) {
  const driverB64 = deflateSync(Buffer.from(readFileSync(DRIVER_PATH, "utf8"), "utf8")).toString("base64");
  return createTransport({
    label: "python",
    cmd: [python, "-u", "-c", LOADER, driverB64],
    config: { outputByteLimit },
    interruptSignal: true,   // posix: ctrl+c is a real SIGINT to the child
    // split: this driver can report a block's top-level statements (ast).
    capabilities: { complete: true, inspect: true, checkComplete: true, interrupt: true, richDisplay: true, split: true, state: "native" },
  });
}

// Self-check — `bun src/kernelPython.js` (needs python + IPython). The two
// behaviors that regressed silently before they were built: output must arrive
// WHILE a cell runs, and interrupt must break a blocking C call (raise_signal
// path — interrupt_main let a sleep(60) run its full 60s).
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const k = kernelPython();

  const seen = [];
  const t0 = Date.now();
  const r = await k.run(
    "import time\nfor i in range(3):\n    print('tick', i)\n    time.sleep(0.4)\n",
    { onOutput: (o) => { if (o.kind === "stdout") seen.push(Date.now() - t0); } },
  );
  const doneAt = Date.now() - t0;
  assert(seen.length === 3, "three stdout lines streamed");
  assert(seen[0] < doneAt - 600, "first line arrived while the cell ran, not with the result");
  assert(r.stdout.includes("tick 2"), "final result still authoritative");

  const t1 = Date.now();
  const long = k.run("import time\ntime.sleep(60)\n", {});
  setTimeout(() => k.interrupt(), 400);
  const r2 = await long;
  assert(Date.now() - t1 < 5000, "interrupt broke the sleep instead of waiting it out");
  assert(String(r2.error || "").includes("KeyboardInterrupt"), "cell ended with KeyboardInterrupt");

  // A heavy C-extension import must not deadlock against the stdin reader
  // thread (numpy + a thread blocked in ReadFile on the async pipe did).
  const t2 = Date.now();
  const r4 = await Promise.race([
    k.run("import numpy as np\nprint('np', np.__version__)\n", {}),
    new Promise((res) => setTimeout(() => res(null), 20000)),
  ]);
  assert(r4 && r4.stdout.includes("np "), `numpy imports under the driver (${Date.now() - t2}ms)`);

  // stderr streams while the cell runs; \r progress collapses to its last frame.
  const ev = [];
  const t3 = Date.now();
  const r5 = await k.run(
    "import sys, time\nsys.stderr.write('working...\\n')\nsys.stderr.flush()\ntime.sleep(0.5)\nfor i in range(5):\n    sys.stdout.write(f'\\rprog {i}')\nprint()\n",
    { onOutput: (o) => ev.push({ kind: o.kind, at: Date.now() - t3 }) },
  );
  const firstErr = ev.find((o) => o.kind === "stderr");
  assert(firstErr && firstErr.at < 450, "stderr streamed while the cell ran, not at its end");
  assert(r5.stdout.includes("prog 4") && !r5.stdout.includes("prog 3"), "\\r progress collapsed to its final frame");

  // ! output must survive the pty: conhost's \r\r\n line ends read as
  // progress-overwrites and every shell line erased itself (the "cut from the
  // host system" bug — !dir returned only blank lines).
  const r6 = await k.run("!echo shell_ok && dir /b", {});
  assert(r6.stdout.includes("shell_ok"), `!echo output survives, got ${JSON.stringify(r6.stdout.slice(0, 80))}`);
  assert(r6.stdout.includes("package.json"), "!dir lists real files");

  console.log(`kernelPython self-check passed (stream ${seen.map((m) => m + "ms").join("/")} · interrupt ${Date.now() - t1}ms · numpy ok · stderr@${firstErr.at}ms · !shell ok)`);
  process.exit(0);
}
