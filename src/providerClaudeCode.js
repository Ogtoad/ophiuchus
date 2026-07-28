// Claude Code provider (adapter-as-transport): spawns the local `claude` CLI in
// print mode, tool-free, streaming stream-json, and relays text deltas. No API
// key — uses the CLI's own auth. The familiar owns the loop, so the CLI runs as
// a pure completion transport (--allowed-tools "" disables its built-in tools).
//
// A provider is (messages, {onText, signal}) => Promise<fullText>.

import { spawn } from "node:child_process";

function deltaText(v) {
  if (!v || typeof v !== "object") return "";
  if (v.type === "text_delta" && typeof v.text === "string") return v.text;
  if (typeof v.text === "string" && typeof v.type === "string" && v.type.includes("delta")) return v.text;
  if (v.delta && typeof v.delta === "object") return deltaText(v.delta);
  if (v.event && typeof v.event === "object") return deltaText(v.event);
  return "";
}

function assistantText(ev) {
  const msg = ev && ev.message;
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}

function flattenPrompt(messages) {
  const parts = messages
    .filter((m) => m.role !== "system")
    .map((m) => (m.role === "user" ? "User" : "Assistant") + ":\n" + m.content);
  parts.push("Respond as the assistant to the latest user message.");
  return parts.join("\n\n");
}

export function providerClaudeCode({ cliPath = "claude", model } = {}) {
  return function provider(messages, { onText, signal } = {}) {
    return new Promise((resolve, reject) => {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--allowed-tools", ""];
      if (system) args.push("--append-system-prompt", system);
      if (model) args.push("--model", model);

      const proc = spawn(cliPath, args, { stdio: ["pipe", "pipe", "pipe"] });
      let buf = "", full = "", lastAssistant = "", stderr = "", errText = "";
      const onAbort = () => { try { proc.kill(); } catch {} };
      signal && signal.addEventListener && signal.addEventListener("abort", onAbort, { once: true });

      proc.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let ev; try { ev = JSON.parse(t); } catch { continue; }
          const type = ev.type;
          if (type === "system" || type === "status") continue; // hooks, init, status noise
          if (type === "rate_limit_event") {
            const info = ev.rate_limit_info || {};
            if (info.status === "rejected") errText = "Claude Code rate-limited (" + (info.overageDisabledReason || "rate limit") + ")";
            continue;
          }
          const d = deltaText(ev);
          if (d) { full += d; onText && onText(d); continue; }
          if (type === "assistant") {
            // Synthetic error messages (out of credits, etc.) carry model "<synthetic>".
            if (ev.error || (ev.message && ev.message.model === "<synthetic>")) {
              errText = errText || assistantText(ev) || "Claude Code error";
              continue;
            }
            const s = assistantText(ev);
            if (s) lastAssistant = s;
            continue;
          }
          if (type === "result" && ev.is_error) {
            errText = errText || (typeof ev.result === "string" ? ev.result : "Claude Code failed");
          }
        }
      });
      proc.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
      proc.on("error", (e) => { cleanup(); reject(new Error("claude CLI error: " + e.message)); });
      proc.on("close", (code) => {
        cleanup();
        if (signal && signal.aborted) return reject(new Error("aborted"));
        if (full.trim()) return resolve(full);
        // Streaming produced nothing — fall back to the last full message, then error.
        if (lastAssistant.trim() && !errText) { onText && onText(lastAssistant); return resolve(lastAssistant); }
        return reject(new Error(errText || stderr.slice(-300).trim() || ("claude exited " + code)));
      });
      function cleanup() { signal && signal.removeEventListener && signal.removeEventListener("abort", onAbort); }

      proc.stdin.write(flattenPrompt(messages));
      proc.stdin.end();
    });
  };
}
