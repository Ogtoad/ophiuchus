// OpenAI-compatible provider — one impl covers OpenAI, LM Studio, llama.cpp, and
// any server speaking /v1/chat/completions. Point baseUrl at the endpoint; apiKey
// is optional for local gateways. Native fetch + SSE. (Ollama has its own native
// provider, providerOllama — logos keeps it off the /v1 shim for cloud auth.)

export function providerOpenai({ apiKey, baseUrl = "https://api.openai.com/v1", model = "gpt-4o", maxTokens } = {}) {
  return async function provider(messages, { onText, signal } = {}) {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = "Bearer " + apiKey;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content })), // system role rides the array
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI-compatible ${res.status}: ${(await res.text()).slice(0, 300)}`);

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
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          const t = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
          if (t) { full += t; onText && onText(t); }
        } catch { /* keepalive / partial */ }
      }
    }
    return full;
  };
}
