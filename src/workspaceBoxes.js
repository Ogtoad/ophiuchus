// The tiling workspace — a vanilla port of logos's box tree. Panels live in a
// binary split tree; you resize them by dragging the seam between two, and
// rearrange them by dragging a panel's bar onto another panel's edge (re-split
// left/right/top/bottom) or its center (stack). Panels are live DOM (the console
// REPL, the familiar) — moved between wrappers, never re-created — so their
// state and stream targets survive every relayout.

// GAP 0: panels sit flush, no frame between them — the seam is a hit area, not
// a visible edge.
const MIN_W = 160, MIN_H = 110, DEFAULT_PX = 340, GAP = 0, HIT = 8, EDGE = 0.28;

const isSplit = (n) => n && n.type === "split";
const num = (v, d) => (typeof v === "number" && isFinite(v) && v > 0 ? v : d);

// ── Pure tree/layout functions ────────────────────────────────────────────

function minSize(node, dir) {
  if (!isSplit(node)) return dir === "horizontal" ? MIN_W : MIN_H;
  if (node.direction === dir) return node.children.reduce((s, c) => s + minSize(c, dir), 0);
  return node.children.reduce((m, c) => Math.max(m, minSize(c, dir)), 0);
}

// Each child's main-axis size in px. Fits: last child grows to fill spare space;
// on shrink, every child gives back its above-minimum extent proportionally so
// nothing clips until the window is smaller than the panels' combined minimums.
function childSizes(node, total) {
  const n = node.children.length;
  const mins = node.children.map((c) => minSize(c, node.direction));
  const sizes = node.children.map((c, i) => Math.max(mins[i], num(node.sizes && node.sizes[i], DEFAULT_PX)));
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= total) { sizes[n - 1] += total - sum; return sizes; }
  const extra = sum - mins.reduce((a, b) => a + b, 0);
  if (extra <= 0) return sizes; // at minimums already — clips, window too small
  const shrink = Math.min(1, (sum - total) / extra);
  return sizes.map((s, i) => Math.max(mins[i], Math.round(s - (s - mins[i]) * shrink)));
}

// Walk the tree → flat list of {boxId, rect} and the seams between siblings.
function layout(node, rect, path, boxes, seams) {
  if (!isSplit(node)) { boxes.push({ boxId: node.boxId, rect }); return; }
  const horiz = node.direction === "horizontal";
  const total = horiz ? rect.width : rect.height;
  const sizes = childSizes(node, total);
  let cursor = 0, prev = null;
  for (let i = 0; i < node.children.length; i++) {
    const main = sizes[i];
    const cr = horiz
      ? { left: rect.left + cursor, top: rect.top, width: main, height: rect.height }
      : { left: rect.left, top: rect.top + cursor, width: rect.width, height: main };
    if (prev) seams.push({
      direction: node.direction, splitPath: path.slice(), first: i - 1, second: i,
      firstSize: horiz ? prev.width : prev.height, secondSize: horiz ? cr.width : cr.height,
      firstMin: minSize(node.children[i - 1], node.direction), secondMin: minSize(node.children[i], node.direction),
      x: horiz ? cr.left - HIT / 2 : rect.left, y: horiz ? rect.top : cr.top - HIT / 2,
      w: horiz ? HIT : rect.width, h: horiz ? rect.height : HIT,
    });
    cursor += main;
    layout(node.children[i], cr, path.concat(i), boxes, seams);
    prev = cr;
  }
}

// Collapse empty/single-child splits and flatten same-direction nesting, so the
// tree stays canonical after every move/remove.
function normalize(node) {
  if (!node) return null;
  if (!isSplit(node)) return node;
  const children = [], sizes = [];
  node.children.forEach((c, i) => {
    const nc = normalize(c);
    if (!nc) return;
    const sz = num(node.sizes && node.sizes[i], DEFAULT_PX);
    if (isSplit(nc) && nc.direction === node.direction) {
      nc.children.forEach((gc, j) => { children.push(gc); sizes.push(num(nc.sizes && nc.sizes[j], DEFAULT_PX)); });
    } else { children.push(nc); sizes.push(sz); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { type: "split", direction: node.direction, children, sizes };
}

function removeBox(node, boxId) {
  if (!isSplit(node)) return node.boxId === boxId ? null : node;
  const children = [], sizes = [];
  node.children.forEach((c, i) => {
    const nc = removeBox(c, boxId);
    if (nc) { children.push(nc); sizes.push(num(node.sizes && node.sizes[i], DEFAULT_PX)); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { type: "split", direction: node.direction, children, sizes };
}

const dirFor = (pos, fallback) =>
  pos === "left" || pos === "right" ? "horizontal" : pos === "top" || pos === "bottom" ? "vertical" : fallback;

function insertRel(node, targetId, pos, boxId) {
  const dir = dirFor(pos, isSplit(node) ? node.direction : "horizontal");
  const after = pos === "right" || pos === "bottom" || pos === "center";
  if (!isSplit(node)) {
    if (node.boxId !== targetId) return { node, ok: false };
    const leaf = { type: "leaf", boxId }, self = { type: "leaf", boxId: node.boxId };
    return { ok: true, node: { type: "split", direction: dir, children: after ? [self, leaf] : [leaf, self], sizes: [DEFAULT_PX, DEFAULT_PX] } };
  }
  const di = node.children.findIndex((c) => !isSplit(c) && c.boxId === targetId);
  if (di >= 0 && node.direction === dir) {
    const at = after ? di + 1 : di;
    const children = node.children.slice(); children.splice(at, 0, { type: "leaf", boxId });
    const sizes = (node.sizes || node.children.map(() => DEFAULT_PX)).slice(); sizes.splice(at, 0, DEFAULT_PX);
    return { ok: true, node: { ...node, children, sizes } };
  }
  for (let i = 0; i < node.children.length; i++) {
    const r = insertRel(node.children[i], targetId, pos, boxId);
    if (!r.ok) continue;
    const children = node.children.slice(); children[i] = r.node;
    return { ok: true, node: { ...node, children } };
  }
  return { node, ok: false };
}

function moveBox(root, boxId, targetId, pos) {
  if (boxId === targetId) return root;
  const without = removeBox(root, boxId);
  if (!without) return root;
  const r = insertRel(without, targetId, pos, boxId);
  return normalize(r.ok ? r.node : root);
}

function updateAtPath(node, path, depth, fn) {
  if (!isSplit(node)) return node;
  if (depth >= path.length) return fn(node);
  const head = path[depth];
  const child = updateAtPath(node.children[head], path, depth + 1, fn);
  if (child === node.children[head]) return node;
  const children = node.children.slice(); children[head] = child;
  return { ...node, children };
}

function applyResize(root, seam, first, second) {
  return normalize(updateAtPath(root, seam.splitPath, 0, (split) => {
    const sizes = split.children.map((c, i) => num(split.sizes && split.sizes[i], DEFAULT_PX));
    sizes[seam.first] = Math.max(1, first);
    sizes[seam.second] = Math.max(1, second);
    return { ...split, sizes };
  }));
}

// Which edge of a box the pointer is over → the drop zone.
function dropPosition(px, py, w, h) {
  const xr = px / Math.max(1, w), yr = py / Math.max(1, h);
  const inL = xr <= EDGE, inR = xr >= 1 - EDGE, inT = yr <= EDGE, inB = yr >= 1 - EDGE;
  if ((inT || inB) && !(inL || inR)) return inT ? "top" : "bottom";
  if ((inL || inR) && !(inT || inB)) return inL ? "left" : "right";
  if (inL || inR || inT || inB) {
    const d = { top: yr, bottom: 1 - yr, left: xr, right: 1 - xr };
    return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
  }
  return "center";
}

// ── Mount: DOM rendering + interaction ─────────────────────────────────────

// STABLE. Do not version this key. Bumping it discards every saved arrangement
// on the next start — which is exactly how a deliberately stacked layout came
// back side by side: the key was bumped to push a new default ratio, and the
// user's layout went with it. A changed default is for people who have no
// stored layout; it is never worth overwriting one that exists.
const STORE_KEY = "ophi.workspace.v2";
const leaves = (n) => (isSplit(n) ? n.children.flatMap(leaves) : [n.boxId]);

export function mountWorkspace(container, tree) {
  let dragged = null;                 // boxId being dragged
  const wrappers = new Map();         // boxId → wrapper el
  const panels = {};                  // boxId → live content el (moved out of the pool)
  for (const el of document.querySelectorAll("[data-box]")) panels[el.dataset.box] = el;

  // Restore the saved layout if every panel it names still exists; else default.
  let stored = null;
  try { const s = localStorage.getItem(STORE_KEY); if (s) stored = normalize(JSON.parse(s)); } catch {}
  let root = stored && leaves(stored).every((id) => panels[id]) ? stored : normalize(tree);
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(root)); } catch {} };

  const seamLayer = document.createElement("div");
  seamLayer.className = "wseams";
  container.appendChild(seamLayer);

  const indicator = document.createElement("div");
  indicator.className = "wdrop";
  indicator.hidden = true;
  container.appendChild(indicator);

  function boxRect(boxId) {
    const w = wrappers.get(boxId);
    return w ? { width: w.clientWidth, height: w.clientHeight } : { width: 1, height: 1 };
  }

  function showIndicator(boxId, pos) {
    const w = wrappers.get(boxId);
    if (!w) return;
    const r = { left: w.offsetLeft, top: w.offsetTop, width: w.clientWidth, height: w.clientHeight };
    const s = indicator.style;
    indicator.hidden = false;
    if (pos === "left" || pos === "right") {
      s.left = (pos === "left" ? r.left : r.left + r.width - 3) + "px";
      s.top = r.top + 8 + "px"; s.width = "3px"; s.height = Math.max(16, r.height - 16) + "px";
    } else if (pos === "top" || pos === "bottom") {
      s.top = (pos === "top" ? r.top : r.top + r.height - 3) + "px";
      s.left = r.left + 8 + "px"; s.height = "3px"; s.width = Math.max(16, r.width - 16) + "px";
    } else { // center
      s.left = r.left + r.width / 2 - 1.5 + "px"; s.top = r.top + 8 + "px";
      s.width = "3px"; s.height = Math.max(16, r.height - 16) + "px";
    }
  }
  const hideIndicator = () => { indicator.hidden = true; };

  function makeWrapper(boxId) {
    const w = document.createElement("div");
    w.className = "wbox";
    const panel = panels[boxId];

    // The panels have no topbars to grab, so the whole box is the handle — but
    // only with Alt held, otherwise a draggable box would swallow text
    // selection everywhere. Chromium decides draggability at mousedown, so we
    // set it per press (the trick logos uses on its topbar).
    w.addEventListener("mousedown", (e) => {
      w.draggable = e.altKey && !e.target.closest("button, select, input, textarea, a, [data-no-box-drag]");
    }, true);

    w.addEventListener("dragstart", (e) => {
      if (!w.draggable) { e.preventDefault(); return; }
      dragged = boxId;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", boxId);
      w.classList.add("dragging");
    });
    w.addEventListener("dragend", () => {
      dragged = null; hideIndicator();
      w.classList.remove("dragging");
      w.draggable = false;
    });

    const localPos = (e) => {
      const b = w.getBoundingClientRect();
      return dropPosition(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    };
    w.addEventListener("dragover", (e) => {
      if (!dragged || dragged === boxId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      showIndicator(boxId, localPos(e));
    });
    w.addEventListener("drop", (e) => {
      if (!dragged || dragged === boxId) return;
      e.preventDefault();
      const pos = localPos(e);
      root = moveBox(root, dragged, boxId, pos);
      dragged = null; hideIndicator();
      render();
    });

    w.appendChild(panel);
    container.appendChild(w);
    return w;
  }

  function beginResize(seam, e) {
    e.preventDefault();
    const horiz = seam.direction === "horizontal";
    const start = horiz ? e.clientX : e.clientY;
    const combined = seam.firstSize + seam.secondSize;
    document.body.classList.add(horiz ? "wresize-col" : "wresize-row");

    const move = (ev) => {
      const delta = (horiz ? ev.clientX : ev.clientY) - start;
      const first = Math.max(seam.firstMin, Math.min(seam.firstSize + delta, combined - seam.secondMin));
      root = applyResize(root, seam, first, combined - first);
      render();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("wresize-col", "wresize-row");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function render() {
    const rect = { left: 0, top: 0, width: container.clientWidth, height: container.clientHeight };
    const boxes = [], seams = [];
    layout(root, rect, [], boxes, seams);

    const live = new Set();
    for (const b of boxes) {
      live.add(b.boxId);
      const w = wrappers.get(b.boxId) || makeWrapper(b.boxId);
      wrappers.set(b.boxId, w);
      const s = w.style;
      s.left = b.rect.left + GAP / 2 + "px";
      s.top = b.rect.top + GAP / 2 + "px";
      s.width = Math.max(0, b.rect.width - GAP) + "px";
      s.height = Math.max(0, b.rect.height - GAP) + "px";
    }
    for (const [boxId, w] of wrappers) {
      if (live.has(boxId)) continue;
      w.remove(); wrappers.delete(boxId); // panel stays in the removed wrapper; not reachable, but never destroyed
    }

    seamLayer.replaceChildren();
    for (const seam of seams) {
      const el = document.createElement("div");
      el.className = "wseam " + (seam.direction === "horizontal" ? "col" : "row");
      const s = el.style;
      s.left = seam.x + "px"; s.top = seam.y + "px"; s.width = seam.w + "px"; s.height = seam.h + "px";
      el.addEventListener("pointerdown", (e) => beginResize(seam, e));
      seamLayer.appendChild(el);
    }
    // Keep the seam layer + indicator on top of the boxes.
    container.appendChild(seamLayer);
    container.appendChild(indicator);
    save();
  }

  render();
  new ResizeObserver(render).observe(container);
  // `restored` says the layout came from storage rather than the default —
  // the only way to tell a persistence failure from a user who never moved anything.
  return { render, restored: !!stored && root === stored };
}

// Self-check for the tree ops — `bun src/workspaceBoxes.js`. Skipped on import.
if (import.meta.main) {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const tree = { type: "split", direction: "horizontal", children: [
    { type: "leaf", boxId: "console" }, { type: "leaf", boxId: "familiar" }], sizes: [300, 300] };

  // Drop familiar onto console's top → vertical split, familiar above console.
  const stacked = moveBox(tree, "familiar", "console", "top");
  assert(stacked.direction === "vertical", "top drop makes a vertical split");
  assert(stacked.children[0].boxId === "familiar", "top drop puts source first");

  // Removing a leaf collapses the split to the survivor.
  assert(removeBox(tree, "familiar").boxId === "console", "remove collapses to survivor");

  // Layout: last child grows to fill spare width.
  const boxes = [], seams = [];
  layout(tree, { left: 0, top: 0, width: 1000, height: 500 }, [], boxes, seams);
  assert(boxes[0].rect.width === 300 && boxes[1].rect.width === 700, "last box absorbs remainder");
  assert(seams.length === 1 && seams[0].direction === "horizontal", "one seam between two boxes");

  // Resize the seam: sizes become absolute px, combined extent preserved.
  const resized = applyResize(tree, seams[0], 420, 580);
  assert(resized.sizes[0] === 420 && resized.sizes[1] === 580, "resize stores px");

  // Nested same-direction split flattens on normalize.
  const nested = { type: "split", direction: "horizontal", children: [
    { type: "leaf", boxId: "a" },
    { type: "split", direction: "horizontal", children: [
      { type: "leaf", boxId: "b" }, { type: "leaf", boxId: "c" }], sizes: [100, 100] }],
    sizes: [100, 200] };
  assert(normalize(nested).children.length === 3, "same-direction nesting flattens");

  console.log("workspaceBoxes self-check passed");
}
