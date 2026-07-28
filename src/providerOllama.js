// Ollama provider (native /api/chat) — covers the local daemon AND Ollama Cloud
// (ollama.com) through the same endpoint, the way logos's OllamaProvider does it.
// Cloud is detected by hostname and authenticated with an ollama.com API key
// (Bearer); local needs no key. The stream is newline-delimited JSON, NOT the
// OpenAI SSE shape — that's why this isn't just providerOpenai pointed elsewhere.
//
// A provider is (messages, {onText, signal}) => Promise<fullText>.

const LOCAL = "http://localhost:11434";

function resolveBase(baseUrl) {
  // Native API lives at the root — strip a trailing slash and any /v1 suffix.
  const raw = (baseUrl || LOCAL).trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
  return /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : "http://" + raw;
}

function isCloud(base) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === "ollama.com" || host.endsWith(".ollama.com");
  } catch {
    return false;
  }
}

// A direct cloud endpoint names models without the :cloud/-cloud suffix that the
// local daemon uses for signed-in cloud models.
function cloudModel(model, cloud) {
  const m = (model || "").trim();
  if (!cloud) return m;
  return m.endsWith(":cloud") || m.endsWith("-cloud") ? m.slice(0, -6) : m;
}

export function providerOllama({ apiKey, baseUrl, model } = {}) {
  const endpoint = resolveBase(baseUrl);
  const cloud = isCloud(endpoint);
  return async function provider(messages, { onText, signal } = {}) {
    if (cloud && !apiKey) throw new Error("Ollama cloud (ollama.com) needs an ollama.com API key");
    if (!model) throw new Error("Ollama provider needs a model (set OPHI_MODEL)");

    const headers = { "content-type": "application/json" };
    if (cloud && apiKey) headers.authorization = "Bearer " + apiKey;

    const res = await fetch(endpoint + "/api/chat", {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: cloudModel(model, cloud),
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content })), // system rides the array
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; } // partial / keepalive
        const t = ev.message && typeof ev.message.content === "string" ? ev.message.content : "";
        if (t) { full += t; onText && onText(t); }
      }
    }
    return full;
  };
}

// Self-check for the endpoint/model logic — `bun src/providerOllama.js`.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  assert(resolveBase() === LOCAL, "defaults to local daemon");
  assert(resolveBase("https://ollama.com/") === "https://ollama.com", "trims trailing slash");
  assert(resolveBase("http://localhost:11434/v1") === "http://localhost:11434", "strips /v1");
  assert(isCloud("https://ollama.com") === true, "ollama.com is cloud");
  assert(isCloud("https://api.ollama.com") === true, "*.ollama.com is cloud");
  assert(isCloud("http://localhost:11434") === false, "localhost is not cloud");
  assert(cloudModel("gpt-oss:120b-cloud", true) === "gpt-oss:120b", "strips -cloud on cloud endpoint");
  assert(cloudModel("qwen3:cloud", true) === "qwen3", "strips :cloud on cloud endpoint");
  assert(cloudModel("llama3", false) === "llama3", "leaves local model untouched");
  console.log("providerOllama self-check passed");
}
