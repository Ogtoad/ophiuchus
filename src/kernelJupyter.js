// Jupyter backend (broker type): spawns kernelBroker.py, which uses
// jupyter_client to launch the named kernelspec and relays its messages as
// ___OPHI_ markers. The transport is identical to the driver's — the broker
// does the Jupyter↔marker translation, so the JS never learns the protocol.
//
// Requires: pip install jupyter_client ipykernel (+ the kernelspec installed).

import { createTransport } from "./kernelTransport.js";
import { pyLoaderCmd } from "./kernelPython.js";
import brokerSource from "./kernelBroker.py" with { type: "text" };

export function kernelJupyter(kernelName, python = "python") {
  return createTransport({
    label: "jupyter:" + kernelName,
    cmd: pyLoaderCmd(python, brokerSource, kernelName),
    config: {},
    // Most kernels implement these; capability-probing per kernel is a later
    // refinement. checkComplete/interrupt/inspect degrade gracefully in the broker.
    // No split: the broker speaks Jupyter, which has no statement-splitting
    // message. Blocks run whole on these kernels.
    capabilities: { complete: true, inspect: true, checkComplete: true, interrupt: true, richDisplay: true, split: false, state: "native" },
  });
}
