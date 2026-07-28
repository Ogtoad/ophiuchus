// Token highlighting, ported from logos's consoleText. Used twice: live under
// the console's input overlay, and on recorded entries in both consoles. Emits
// DOM (not HTML strings) so kernel/model text can never inject markup.

const KEYWORDS = {
  python: new Set(["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "with", "as", "lambda", "async", "await", "True", "False", "None"]),
  deno: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "try", "catch", "class", "import", "from", "export", "new", "await", "async", "true", "false", "null", "undefined"]),
  c: new Set(["int", "char", "long", "short", "float", "double", "void", "unsigned", "signed", "struct", "union", "enum", "typedef", "const", "static", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "sizeof", "include", "define"]),
};
KEYWORDS.ipython = KEYWORDS.python3 = KEYWORDS.python;

// One shared regex — matchAll clones internally, so a global instance is safe.
const TOKEN_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function tokenizeLine(line, lang) {
  const marker = lang === "deno" || lang === "c" ? "//" : "#";
  const at = line.indexOf(marker);
  const body = at >= 0 ? line.slice(0, at) : line;
  const comment = at >= 0 ? line.slice(at) : "";
  const keywords = KEYWORDS[lang] || KEYWORDS.python;

  const parts = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index), kind: "plain" });
    const t = m[0];
    const kind = /^["'`]/.test(t) ? "string"
      : /^\d/.test(t) ? "number"
      : keywords.has(t) ? "keyword"
      : "plain";
    parts.push({ text: t, kind });
    last = m.index + t.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), kind: "plain" });
  if (comment) parts.push({ text: comment, kind: "comment" });
  return parts.length ? parts : [{ text: line, kind: "plain" }];
}

/** Highlighted text as a DocumentFragment. */
export function highlight(text, lang) {
  const frag = document.createDocumentFragment();
  const lines = String(text == null ? "" : text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i) frag.appendChild(document.createTextNode("\n"));
    for (const { text: t, kind } of tokenizeLine(lines[i], lang)) {
      if (kind === "plain") { frag.appendChild(document.createTextNode(t)); continue; }
      const span = document.createElement("span");
      span.className = "t-" + kind;
      span.textContent = t;
      frag.appendChild(span);
    }
  }
  return frag;
}

// Self-check — `bun src/consoleText.js` (tokenizer only; highlight needs a DOM).
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const kinds = (s, l) => tokenizeLine(s, l).map((p) => p.kind + ":" + p.text);

  assert(kinds("def f():", "python").includes("keyword:def"), "python keyword");
  assert(kinds("x = 42", "python").includes("number:42"), "number");
  assert(kinds("s = 'hi'", "python").includes("string:'hi'"), "string");
  assert(kinds("x = 1 # note", "python").includes("comment:# note"), "python comment");
  assert(kinds("const x = 1 // n", "deno").includes("comment:// n"), "deno comment");
  assert(kinds("const x", "deno").includes("keyword:const"), "deno keyword");
  // A '#' inside a string must not start a comment... known limit, kept simple:
  // logos has the same behaviour, so the port stays faithful.
  console.log("consoleText self-check passed");
}
