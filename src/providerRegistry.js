// The provider registry: id -> factory, config-driven. No vendor preferred —
// the caller's config picks. A provider is (messages, {onText, signal}) => text;
// the familiar is agnostic to which one. Mirrors kernelRouter for the LLM side.

import { providerClaudeCode } from "./providerClaudeCode.js";
import { providerOpenai } from "./providerOpenai.js";
import { providerOllama } from "./providerOllama.js";
import { providerAnthropic } from "./providerAnthropic.js";

const FACTORIES = {
  "claude-code": providerClaudeCode,                                   // local CLI, no key
  openai: providerOpenai,                                             // OpenAI + any /v1 endpoint
  ollama: providerOllama,                                             // native /api/chat — local daemon or ollama.com cloud (Bearer key)
  anthropic: providerAnthropic,                                      // HTTP, needs key
  // Offline UI demo — canned tagged turns (console then chat), no provider needed.
  mock: () => { let n = 0; return async (_m, { onText } = {}) => {
    n += 1;
    const r = n % 2 ? "<think>demo</think><console>print('familiar online:', 6 * 7)</console>" : "<chat>It works — 42, straight from the shared kernel.</chat>";
    for (const c of r) onText && onText(c);
    return r;
  }; },
};

// One line per provider, for the setup guide — kept here so a new factory and
// its description live in the same file.
const DESCRIPTIONS = {
  "claude-code": "local claude CLI — no key needed",
  openai: "OpenAI or any /v1-compatible endpoint — needs apiKey",
  ollama: "local ollama daemon (or ollama.com with apiKey)",
  anthropic: "Anthropic API — needs apiKey",
  mock: "offline demo — canned replies",
};

export function createProvider(config = {}) {
  const id = config.id;
  // No default on purpose: an unset provider is a first-run state the setup
  // guide owns, not something to silently guess at.
  if (!id) throw new Error("no provider configured — run §setup");
  const factory = FACTORIES[id];
  if (!factory) throw new Error("unknown provider: " + id);
  return factory(config);
}

export const providerIds = () => Object.keys(FACTORIES);
export const providerList = () => Object.keys(FACTORIES).map((id) => ({ id, desc: DESCRIPTIONS[id] || "" }));
