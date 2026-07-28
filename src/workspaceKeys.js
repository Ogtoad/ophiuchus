// Keybindings, ported from logos's useKeybindings. One input serves two
// destinations, so the binding IS the routing — this matcher decides whether a
// keystroke runs code or talks to the familiar.
//
// The subtlety worth the code: on Windows AltGr reports ctrlKey AND altKey. A
// naive `e.ctrlKey && key === 'Enter'` therefore fires on AltGr+Enter too, and
// the chat gesture would silently also run the cell. So:
//   - an alt-only binding is satisfied by Alt *or* AltGr (hence "alt/altgr"),
//   - a ctrl binding is rejected when AltGr is down,
//   - an explicit altGr binding outranks the alt fallback.

export const DEFAULT_KEYBINDINGS = {
  sendToConsole: { key: "Enter", ctrl: true },
  sendToChat: { key: "Enter", alt: true },   // Alt or AltGr / right-alt
};

function matchBinding(e, b) {
  if (e.key !== b.key) return false;

  const isAltGr = (e.getModifierState && e.getModifierState("AltGraph")) || (e.ctrlKey && e.altKey);
  const altGrAsAlt = isAltGr && !b.altGr && !!b.alt && !b.ctrl;
  const ctrl = altGrAsAlt ? false : e.ctrlKey;
  const alt = altGrAsAlt ? true : e.altKey;

  if (b.altGr) {
    if (!isAltGr) return false;
  } else {
    if (isAltGr && !altGrAsAlt) return false;   // keeps ctrl+enter off AltGr
    if (!!b.ctrl !== ctrl) return false;
    if (!!b.alt !== alt) return false;
  }
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.meta !== e.metaKey) return false;
  return true;
}

export function createKeybindings(map = DEFAULT_KEYBINDINGS) {
  return {
    // Explicit altGr bindings win over the altGr-satisfies-alt fallback,
    // whatever the map order.
    matchAction(e) {
      let fallback = null;
      for (const [action, binding] of Object.entries(map)) {
        if (!matchBinding(e, binding)) continue;
        if (binding.altGr) return action;
        if (fallback === null) fallback = action;
      }
      return fallback;
    },
    // The label the placeholder teaches with — "ctrl+↵", "alt/altgr+↵".
    format(action) {
      const b = map[action];
      if (!b) return "";
      const parts = [];
      if (b.ctrl) parts.push("ctrl");
      if (b.alt) parts.push(b.ctrl ? "alt" : "alt/altgr");
      if (b.altGr) parts.push("altgr");
      if (b.shift) parts.push("shift");
      parts.push(b.key === "Enter" ? "↵" : b.key);
      return parts.join("+");
    },
  };
}

// Self-check — `bun src/workspaceKeys.js`. AltGr disambiguation is the point.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const kb = createKeybindings();
  const ev = (o) => ({ key: "Enter", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

  assert(kb.matchAction(ev({ ctrlKey: true })) === "sendToConsole", "ctrl+enter runs");
  assert(kb.matchAction(ev({ altKey: true })) === "sendToChat", "alt+enter chats");
  // AltGr = ctrl+alt: must chat, must NOT run the cell.
  assert(kb.matchAction(ev({ ctrlKey: true, altKey: true })) === "sendToChat", "altgr+enter chats, not runs");
  assert(kb.matchAction(ev({ getModifierState: (m) => m === "AltGraph" })) === "sendToChat", "AltGraph state chats");
  assert(kb.matchAction(ev({})) === null, "bare enter is a newline");
  assert(kb.matchAction(ev({ ctrlKey: true, shiftKey: true })) === null, "shift disqualifies");
  assert(kb.matchAction({ ...ev({ ctrlKey: true }), key: "a" }) === null, "other keys ignored");
  assert(kb.format("sendToConsole") === "ctrl+↵", "console hint");
  assert(kb.format("sendToChat") === "alt/altgr+↵", "chat hint");

  console.log("workspaceKeys self-check passed");
}
