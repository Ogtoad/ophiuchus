// Streaming provider for the familiar — Anthropic Messages API over SSE, native
// fetch (no SDK). A provider is `(messages, {onText, signal}) => Promise<fullText>`;
// the manager is provider-agnostic, so other vendors slot in the same shape.
// The API key comes from the caller or ANTHROPIC_API_KEY — never hardcoded.

export function providerAnthropic({ apiKey, model = "claude-sonnet-5", maxTokens = 4096 } = {}) {
  return async function provider(messages, { onText, signal } = {}) {
    const key = apiKey || (typeof process !== "undefined" && process.env && process.env.ANTHROPIC_API_KEY);
    if (!key) throw new Error("no Anthropic API key (set ANTHROPIC_API_KEY or configure it)");

    // Anthropic takes system top-level; the rest are user/assistant turns.
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const msgs = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages: msgs }),
      signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

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
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            full += ev.delta.text;
            onText?.(ev.delta.text);
          }
        } catch { /* keepalive / partial line */ }
      }
    }
    return full;
  };
}
