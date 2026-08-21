import { S, post, tally, reveal } from "/app.js";
import { open, previewOpen, current, close as shut } from "/preview.js";
import { MIME, inTray, addMany as trayAddMany, toggle as trayToggle } from "/tray.js";

const $ = (s) => document.querySelector(s);
const F = { tag: new Set(), dir: new Set(), star: false, untagged: false, q: "" };
let visible = [];
let cursor = 0;

/**
 * The second flavour on every drag out of the shelf: a JSON array of every
 * selected id, beside the singular one the tray and the bench slots already
 * read. Two flavours rather than a wider first one, because the singular
 * mime is load bearing in three other files and none of them has ever heard
 * of a selection. Whoever reads this one falls back to the singular, and
 * until they do, dragging forty frames into the tray still adds the one
 * under the hand rather than nothing at all.
 */
export const MIMES = "application/x-keepers-frames";

/**
 * The set, as ids rather than as indices. A filter changing underneath is
 * the normal case here, and indices into a list that has just been rebuilt
 * point at whatever moved into those places.
 *
 * The cursor is not part of it and never becomes part of it. One is where
 * the keyboard is standing and the other is what a keystroke will land on,
 * and collapsing them would mean either a tagging run that drags a set
 * behind it or a selection that cannot be walked.
 */
const sel = new Set();

/** where a shift range measures from. an id, for the same reason. */
let anchor = null;

const at = (id) => visible.findIndex((i) => i.id === id);

/** everything from the anchor to here, replacing whatever was picked before */
function range(id) {
  const a = at(anchor ?? visible[cursor]?.id ?? id);
  const b = at(id);
  if (a < 0 || b < 0) return;
  sel.clear();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(visible[i].id);
}

/** true when anything is picked, which is the only thing most callers ask */
const picked = () => sel.size > 0;

function drop() {
  if (!sel.size) return false;
  sel.clear();
  anchor = null;
  return true;
}

/* Eight folders, and the rest behind one word. This row sits directly above
   the photographs, so anything that wraps in it pushes them down the window:
   forty chips wearing full relative paths measured ten rows and three
   hundred pixels of file names standing in front of the first frame. */
const DIRS = 8;

const countTag = (c) => S.items.filter((i) => S.tags[i.id]?.tag === c).length;
const countPlace = (p) => S.items.filter((i) => i.place === p).length;
const word = (c) => S.vocab[c];
/* A place is either the folder a frame sits in or a name out of the config,
   and only the first has segments. The tail identifies it either way, and
   the head of it is what `search the path` is for, three inches to the
   left. */
const leaf = (p) => p.split("/").pop();
/** whether any filter is actually on, which is the only reason clear exists */
const filtering = () => Boolean(F.tag.size || F.dir.size || F.star || F.untagged || F.q);

/**
 * One chip, wearing the value it stands for. The counts move while you tag,
 * so a chip already on screen has to be found again and updated rather than
 * rebuilt: a rebuilt chip is a chip that has forgotten it was switched on
 * under somebody's hand.
 */
function chip(v, label, count, key) {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.dataset.v = v;

  /* The letter that tags it, ahead of the word. This is the only place on
     the page the letters appear, which makes this row the legend for the
     keyboard as well as the filter for the mouse, and it is already where
     the eye goes to ask what a tag is. Without it the strip at the bottom
     says the letters above tag and points at nothing. */
  if (key === "tag") {
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = `${v.toLowerCase()} `;
    b.append(k);
  }
  b.append(label(v));

  const n = document.createElement("i");
  n.textContent = count(v);
  b.append(n);

  /* the full path only when the chip is not already showing it, so a
     tooltip never repeats the label it is standing on */
  const hint = key === "tag" ? S.hints[v] : label(v) === v ? "" : v;
  if (hint) b.title = hint;

  b.onclick = () => {
    F[key].has(v) ? F[key].delete(v) : F[key].add(v);
    b.classList.toggle("on");
    quiet(b);
    renderShelf();
  };
  quiet(b);
  return b;
}

/* The key is quieter than the word it names, so the row still reads as
   words first and the letters are there when asked for. On a chosen chip it
   goes back to inheriting, because --ink-3 on the accent is all but
   invisible and a chip already saying one thing loudly does not need a
   second voice. Set here rather than in a
   rule, because the row it belongs to is built in this file. */
function quiet(b) {
  const k = b.querySelector(".key");
  if (k) k.style.color = b.classList.contains("on") ? "" : "var(--ink-3)";
}

function chips(host, values, label, count, key) {
  host.replaceChildren(...values.map((v) => chip(v, label, count, key)));
}

/**
 * Everything past the eighth folder, behind one chip. It is not a filter
 * and never becomes one: clicking it lays the rest of the folders out in
 * the row and takes itself away, which is the whole of what it does.
 */
function more(host, rest) {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.textContent = "more";
  b.title = `${rest.length} more folders`;
  b.onclick = () => b.replaceWith(...rest.map((p) => chip(p, leaf, countPlace, "dir")));
  host.append(b);
}

export function mountShelf() {
  const present = Object.keys(S.vocab).filter((c) => countTag(c) > 0);
  /* Nothing is tagged on a fresh archive, so the row falls back to the whole
     vocabulary. That is the run where the letters matter most: all sixteen
     of them are on screen before the first keystroke. */
  chips($("#f-tag"), present.length ? present : Object.keys(S.vocab), word, countTag, "tag");

  const places = [...new Set(S.items.map((i) => i.place))]
    .sort((a, b) => countPlace(b) - countPlace(a));
  chips($("#f-dir"), places.slice(0, DIRS), leaf, countPlace, "dir");
  if (places.length > DIRS) more($("#f-dir"), places.slice(DIRS));

  $("#f-star").onclick = (e) => { F.star = !F.star; e.currentTarget.classList.toggle("on"); renderShelf(); };
  $("#f-untagged").onclick = (e) => { F.untagged = !F.untagged; e.currentTarget.classList.toggle("on"); renderShelf(); };
  $("#f-q").oninput = (e) => { F.q = e.target.value.trim().toLowerCase(); renderShelf(); };
  mountClear();

  mountSize();
  mountSweep();
  addEventListener("keydown", onKey);
}

/**
 * Clear was standing third in a line of filters wearing a filter's clothes,
 * which made it read as a third thing to switch on. It goes to the far end
 * of the row, quieter than the chips it undoes, and it is only there at all
 * when there is something to undo. Last in the row rather than first past
 * the .grow, so that arriving and leaving moves nothing else.
 */
function mountClear() {
  const b = $("#f-clear");
  b.style.color = "var(--ink-3)";
  b.closest(".row").append(b);
  b.onclick = () => {
    /* This was location.reload(), the one reset that also throws away where
       you were standing: four hundred frames into a filtered pile, clear
       put you back at the top of the unfiltered one. */
    F.tag.clear();
    F.dir.clear();
    F.star = false;
    F.untagged = false;
    F.q = "";
    $("#f-q").value = "";
    for (const c of document.querySelectorAll("#filters .chip.on")) {
      c.classList.remove("on");
      quiet(c);
    }
    renderShelf();
  };
}

/* ------------------------------------------------------------------ */
/* how many frames across                                              */
/* ------------------------------------------------------------------ */

/* The slider runs in real pixels rather than in five named steps, because a
   stepped one lurches and this is a thing you drag while looking at the
   pictures move. The 4px granularity is what keeps that smooth without
   relaying out a thousand tiles for a change nobody can see. */
const SIZE_KEY = "keepers.tile";
const NUDGE = 24;

function mountSize() {
  const slider = $("#f-size");
  if (!slider) return;

  const saved = Number(localStorage.getItem(SIZE_KEY));
  if (saved >= Number(slider.min) && saved <= Number(slider.max)) slider.value = String(saved);

  slider.oninput = () => applySize(true);
  applySize(false);
  /* the column count is a fact about the window, not about the slider, so
     it has to be recounted when the window changes even though nothing was
     touched in here. */
  addEventListener("resize", () => sayColumns());
}

function applySize(save) {
  const slider = $("#f-size");
  const px = Number(slider.value);
  $("#grid")?.style.setProperty("--tile", `${px}px`);
  /* a track cannot know where its own thumb is, so the filled half is a
     gradient stop handed to it. the half thumb width keeps the paint under
     the middle of the knob rather than under its leading edge. */
  const min = Number(slider.min), max = Number(slider.max);
  slider.style.setProperty("--fill", `${((px - min) / (max - min)) * 100}%`);
  if (save) localStorage.setItem(SIZE_KEY, String(px));
  sayColumns();
}

function sayColumns() {
  const out = $("#f-size-n");
  if (!out) return;
  out.textContent = `${columns()} across`;
}

/* The truth about how many fit is in the grid the browser resolved, never in
   arithmetic done over here. This used to be `clientWidth / 164`, a number
   that was right for one tile size on one afternoon and quietly wrong the
   moment either changed: arrow up and down then jumped the wrong number of
   frames and felt like a dropped keypress. */
function columns() {
  const grid = $("#grid");
  if (!grid) return 1;
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
}

/* ------------------------------------------------------------------ */
/* dragging a rectangle across the grid                                 */
/* ------------------------------------------------------------------ */

/* How far the pointer has to travel before a press becomes a sweep. Below
   it a press on the grid background is a click, and a click on the
   background lets the selection go. Four pixels is about the wobble in a
   hand letting go of a mouse button. */
const SWEEP = 4;

/**
 * The marquee, and the one thing that decides everything else in here:
 * pointer handling and native drag and drop are two machines started by the
 * same gesture, and the only way they coexist is that each one owns a
 * different press. A press that starts on a photograph belongs to the drag,
 * because dragging frames to the bench and the tray is the whole reason the
 * tiles are draggable. A press that starts on the background belongs to the
 * sweep.
 *
 * Which would be the whole story, except that this grid has no background.
 * A wall of two hundred frames is edge to edge and the only empty pixels on
 * it are the 8px gutters, so "start on nothing" is an 8px target on a full
 * shelf and a fine rule that nobody can hit. So a modifier held at the press
 * takes a photograph out of the drag machine and hands it to this one:
 * cmd or shift and drag, from anywhere, sweeps. Neither is a gesture the
 * drag ever wanted, because cmd click is toggle select and nobody
 * shift drags a frame into a folder, and both already mean "add to what is
 * picked" in the sweep, which is what they do here.
 *
 * That hand off is the one preventDefault in this file and it is exact:
 * calling preventDefault on pointerdown over a draggable element is how you
 * stop dragstart from ever firing, so it happens only on the press that has
 * a modifier on it. Called on a bare press over a photograph it would break
 * every drop in the app, and the bug would look like the tray going deaf.
 */
function mountSweep() {
  const grid = $("#grid");
  if (!grid) return;

  let box = null;      // the rectangle on screen, while there is one
  let from = null;     // where the press landed, in grid content coordinates
  let base = null;     // what was already picked when the sweep began
  let rects = null;    // every tile, measured once
  let live = false;    // past the threshold, so this is a sweep and not a click

  /* The grid scrolls, so a client coordinate means nothing five hundred
     pixels down the pile. Everything in here is in the grid's own content
     space, which is what an absolutely positioned child is placed in and
     what survives the scroll happening under a held button. */
  const org = () => {
    const r = grid.getBoundingClientRect();
    return { x: r.left - grid.scrollLeft, y: r.top - grid.scrollTop };
  };
  const spot = (e) => {
    const o = org();
    return { x: e.clientX - o.x, y: e.clientY - o.y };
  };

  /* Measured once, at the moment the sweep starts, and then never again.
     Two hundred getBoundingClientRect calls per pointermove is two hundred
     forced layouts per pointermove, and nothing in the grid moves while a
     button is down anyway. */
  function measure() {
    const o = org();
    const out = [];
    for (const el of grid.children) {
      if (!el.dataset.id) continue;
      const r = el.getBoundingClientRect();
      out.push({ el, id: el.dataset.id, l: r.left - o.x, t: r.top - o.y, r: r.right - o.x, b: r.bottom - o.y });
    }
    return out;
  }

  /* Everything the rectangle touches, not everything it swallows. A sweep
     across the top inch of a row is a sweep across that row: waiting for the
     rectangle to contain a whole tile would mean dragging down over the next
     row to pick this one. */
  function sweep(to) {
    const l = Math.min(from.x, to.x), r = Math.max(from.x, to.x);
    const t = Math.min(from.y, to.y), b = Math.max(from.y, to.y);
    sel.clear();
    for (const id of base) sel.add(id);
    for (const k of rects) {
      if (k.l < r && k.r > l && k.t < b && k.b > t) { sel.add(k.id); anchor = k.id; }
    }
    /* The classes are moved by hand rather than through renderShelf,
       because a repaint on every pointermove would rebuild a thousand tiles
       sixty times a second and would take the marquee, which is a child of
       the grid, out with them. */
    for (const k of rects) k.el.classList.toggle("picked", sel.has(k.id));
  }

  function place(to) {
    box.style.left = `${Math.min(from.x, to.x)}px`;
    box.style.top = `${Math.min(from.y, to.y)}px`;
    box.style.width = `${Math.abs(to.x - from.x)}px`;
    box.style.height = `${Math.abs(to.y - from.y)}px`;
  }

  function stop() {
    box?.remove();
    delete document.body.dataset.sweeping;
    box = null; from = null; base = null; rects = null; live = false;
  }

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const held = e.metaKey || e.shiftKey;
    const onFrame = Boolean(e.target.closest("figure"));
    if (onFrame && !held) return;
    /* only here, and only for the press that has already been taken off the
       drag machine by its modifier. */
    if (onFrame) e.preventDefault();
    stop();
    from = spot(e);
    base = held ? new Set(sel) : new Set();
    live = false;
  });

  grid.addEventListener("pointermove", (e) => {
    if (!from) return;
    /* The button came up somewhere this grid never heard about, which is
       what a press that never grew into a sweep and was let go outside the
       window looks like from in here: no capture was taken yet, so no
       pointerup arrives. Without this the next pointer to cross the grid
       with nothing held down would carry on the sweep it was left in. */
    if (!(e.buttons & 1)) { stop(); return; }
    const to = spot(e);
    if (!live) {
      if (Math.abs(to.x - from.x) < SWEEP && Math.abs(to.y - from.y) < SWEEP) return;
      live = true;
      /* Capture here and not on the press, so that a cmd click which never
         moves never takes one. A captured pointer retargets the mouse events
         chrome builds out of it, and a click retargeted off the photograph
         and onto the grid is a cmd click that quietly stops selecting. From
         this point on there is no click to lose and capture is what keeps
         the rectangle following a pointer that has left the grid, and what
         brings pointerup back here when it happens over the tray. */
      grid.setPointerCapture(e.pointerId);
      rects = measure();
      box = document.createElement("div");
      box.className = "marquee";
      grid.append(box);
      document.body.dataset.sweeping = "1";
    }
    place(to);
    sweep(to);
  });

  grid.addEventListener("pointerup", (e) => {
    if (!from) return;
    if (grid.hasPointerCapture(e.pointerId)) grid.releasePointerCapture(e.pointerId);
    /* A press on the background that never became a sweep is a click on
       nothing, and clicking on nothing lets go of the selection. Held with a
       modifier it does not, because that is the hand that was about to add
       to the set and slipped. */
    if (!live && !e.metaKey && !e.shiftKey) drop();
    /* A sweep that began on a photograph and ended on the same one is still
       a click as far as the document is concerned, and that click would run
       the tile's handler and collapse the set that was just swept up. One
       shot, and a timeout to take it away again when no click follows,
       because a listener left armed would eat the next real one. */
    if (live) {
      const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
      grid.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => grid.removeEventListener("click", eat, true), 0);
    }
    stop();
    renderShelf();
  });

  /* A cancelled pointer, which on this machine means a system gesture took
     the button, leaves the selection wherever the sweep had got to rather
     than throwing it away. */
  grid.addEventListener("pointercancel", () => { stop(); renderShelf(); });
}

export function renderShelf() {
  /* An empty archive replaces this whole section with an explanation, taking
     the filter row and the grid with it. Anything that repaints the shelf
     from elsewhere, the tray does it on every add, has to survive that. */
  if (!$("#grid")) return;

  visible = S.items.filter((i) => {
    const t = S.tags[i.id] ?? {};
    return (!F.tag.size || F.tag.has(t.tag)) &&
      (!F.dir.size || F.dir.has(i.place)) &&
      (!F.star || t.star) &&
      (!F.untagged || !t.tag) &&
      (!F.q || i.path.toLowerCase().includes(F.q));
  });
  cursor = Math.min(cursor, Math.max(0, visible.length - 1));

  /* A selection is a set of frames on this screen, so a filter that takes a
     frame off the screen takes it out of the set. The alternative is a
     letter tagging forty frames you can see and eleven you cannot, which is
     the one thing a fast keystroke must never do. */
  if (sel.size) {
    const live = new Set(visible.map((i) => i.id));
    for (const id of sel) if (!live.has(id)) sel.delete(id);
    if (anchor && !live.has(anchor)) anchor = null;
  }

  $("#f-star").querySelector("i").textContent = S.items.filter((i) => S.tags[i.id]?.star).length;
  $("#f-untagged").querySelector("i").textContent = S.items.filter((i) => !S.tags[i.id]?.tag).length;
  syncTags();
  $("#f-clear").hidden = !filtering();
  /**
   * When the untagged filter is on, every frame on screen is untagged, so
   * the scrim stops telling you anything and becomes a grey film over the
   * whole working set. The grid says so and the stylesheet lifts it, which
   * is the only place that knows both facts at once.
   */
  $("#grid").classList.toggle("all-untagged", F.untagged);

  $("#none").hidden = visible.length > 0;
  if (!visible.length) {
    $("#none").textContent = filtering()
      ? "nothing matches that combination."
      : "no frames.";
  }

  $("#grid").replaceChildren(...visible.map((item, n) => tile(item, n)));
}

/**
 * The tag counts, repainted. They are the only thing on the page that says a
 * keystroke landed at all, so they have to move on every one: tagging forty
 * frames food and watching nothing change is indistinguishable from tagging
 * nothing. A code that has just crossed zero gets a chip of its own, and the
 * chips already standing are updated in place so a filter switched on under
 * somebody's hand survives it.
 */
function syncTags() {
  const host = $("#f-tag");
  const at = new Map([...host.children].map((b) => [b.dataset.v, b]));
  for (const c of Object.keys(S.vocab)) {
    const n = countTag(c);
    let b = at.get(c);
    if (!b) {
      if (!n) continue;
      b = chip(c, word, countTag, "tag");
      host.append(b);
    }
    b.querySelector("i").textContent = n;
  }
}

/** the set the shelf is currently showing, which is what the preview walks */
export function filtered() {
  return visible;
}

/**
 * Put the cursor on a particular frame rather than on a particular index.
 * The preview arrows through the same list the shelf is showing, and if it
 * moved the cursor by number instead the two would fall out of step the
 * moment a filter changed underneath them.
 */
export function focus(id) {
  const at = visible.findIndex((i) => i.id === id);
  if (at < 0) return;
  cursor = at;
  renderShelf();
  $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
}

function tile(item, n) {
  const t = S.tags[item.id] ?? {};
  const fig = document.createElement("figure");

  /* Five states can be true of the same frame at once: it has no tag, it is
     kept, it is in the active tray, it is picked, and the keyboard is
     standing on it. They are collected in a list and joined rather than
     concatenated onto a string, because the version of this that builds the
     class name by hand is the version where adding a sixth state quietly
     drops a fifth. Picked was the fifth, and it arrived here rather than in
     a rewrite, which is what the list was for. */
  fig.className = [
    !t.tag && "untagged",
    t.star && "star",
    inTray(item.id) && "intray",
    sel.has(item.id) && "picked",
    n === cursor && S.view === "shelf" && "cursor",
    item.kind === "film" && !item.w && "noposter",
  ].filter(Boolean).join(" ");

  /* The id in the markup, which the sweep needs. It hit tests rectangles
     against tiles and has to name what it hit without counting children,
     because the marquee itself is a child of the grid while it is running. */
  fig.dataset.id = item.id;

  const img = new Image();
  img.loading = "lazy"; img.decoding = "async"; img.src = `/thumb/${item.id}`; img.alt = "";
  fig.append(img);

  /* The tag used to print across the corner of every thumbnail and it does
     not any more. A wall of two thousand frames should read as photographs,
     and a word stamped on each one turns it into a wall of labels you have
     to look past. The tag still drives the filter chips above and still
     shows in the preview, which are the two places you go to ask about it. */

  // film is tagged and kept exactly like a photograph, so it wears the same
  // frame. the only difference is a play mark and a running time, which are
  // the two things you cannot tell from a poster.
  if (item.kind === "film") {
    const play = document.createElement("span");
    play.className = "film";
    fig.append(play);
    if (item.clock) {
      const c = document.createElement("span");
      c.className = "clock";
      c.textContent = item.clock;
      fig.append(c);
    }
  }

  /**
   * A visible way into the tray, and since cmd click became toggle select it
   * is now the only one for a single frame that is not a drag. It says what
   * it will do rather than what it is, because the same button takes a frame
   * back out again and a permanent plus sign on something already in the
   * tray would be a lie.
   */
  const add = document.createElement("button");
  add.className = "add";
  add.type = "button";
  /* No text at all, in either state. The mark is a glyph the stylesheet
     masks in, chosen by the intray class alone, so this file never has to
     know which of the two it is drawing. A word does not fit here either
     way: at 208px a tile, "remove" spilled off the corner and was cut in
     half by the photograph beside it. The title and the label carry the
     meaning instead, because a glyph on its own says nothing to a screen
     reader and nothing to a person who has not met it before. */
  const held = inTray(item.id);
  add.title = held ? "remove from tray" : "add to tray";
  add.setAttribute("aria-label", add.title);
  add.onclick = (e) => { e.stopPropagation(); trayToggle(item.id); };
  fig.append(add);

  const cap = document.createElement("figcaption");
  cap.textContent = item.path.split("/").pop();
  fig.append(cap);

  /* Drag is the second way in, and it exists because dropping a frame into a
     folder is the gesture this panel is pretending to be. It carries the
     private mime type and the path, never the path alone: a drag with only
     text in it would be accepted by every text field on the page, and the
     tray would accept a drag that began somewhere else entirely. */
  fig.draggable = true;
  fig.addEventListener("dragstart", (e) => {
    /* Dragging a frame that is in the selection drags the whole selection,
       the way dropping one file of eight into a folder in finder moves all
       eight. Dragging one that is not leaves the selection alone rather than
       replacing it: the repaint that would take costs the drag its own
       element mid dragstart, and a drag whose source has been removed from
       the document is a drag that never reaches anything.

       The singular flavour stays exactly what it was and always carries the
       frame under the hand. The bench slots, tray.js and dragout.js all read
       it and none of them knows a selection exists, so a set dragged onto a
       slot still lands the picture you grabbed and a drag out to finder is
       still that one file. */
    const many = sel.has(item.id) ? [...sel] : [item.id];
    e.dataTransfer.setData(MIME, item.id);
    e.dataTransfer.setData(MIMES, JSON.stringify(many));
    e.dataTransfer.setData("text/plain", item.path);
    e.dataTransfer.effectAllowed = "copy";
    if (img.complete && img.naturalWidth) {
      e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    }
    document.body.dataset.dragging = "1";
  });
  fig.addEventListener("dragend", () => {
    delete document.body.dataset.dragging;
    document.querySelector("#tray[data-over]")?.removeAttribute("data-over");
  });

  /**
   * Click selects and does not open, which is the change a mac user will
   * feel first. It is what makes a set possible at all: a click that opened
   * a card could never be the click that starts a range, and picking twelve
   * frames would mean dismissing twelve cards. Opening moved to the double
   * click, to space and to return, and the two keys were free.
   *
   * The cursor comes along on every one of them, so a run started with the
   * mouse carries straight on under the keyboard.
   */
  fig.onclick = (e) => {
    e.preventDefault();
    if (e.metaKey) {
      sel.has(item.id) ? sel.delete(item.id) : sel.add(item.id);
      anchor = item.id;
    } else if (e.shiftKey) {
      range(item.id);
    } else {
      sel.clear();
      sel.add(item.id);
      anchor = item.id;
    }
    cursor = n;
    renderShelf();
  };

  /* The repaint above has already replaced this element by the time the
     second click lands, but the handler travels with the item it closed
     over, so the frame that opens is the frame that was hit. */
  fig.ondblclick = (e) => { e.preventDefault(); open(item); };
  return fig;
}

/**
 * Tagging is keyboard first because it is the only way it gets done. A
 * thousand frames through a mouse is an afternoon; through the home row it
 * is twenty minutes. The letters are the same ones the agent writes, so a
 * person correcting a machine's pass never has to learn a second alphabet.
 */
async function onKey(e) {
  if (e.ctrlKey || e.altKey) return;
  /* One rule, and it is the mac one: a bare letter tags, cmd plus a key
     commands. It is not a tidiness. r was bound bare to reveal in finder and
     sat in front of the tag table, so resting, one of the sixteen, could not
     be typed at all, and putting find on f would have taken food the same
     way. The rule frees both letters and every letter after them. */
  if (e.metaKey) return command(e);
  if (S.view !== "shelf" || e.target.matches("input")) return;

  /**
   * The preview keeps the arrows, and it moves this cursor itself as it
   * goes: without that both would step and the shelf would run through the
   * set at twice the speed of the card. The two decisions travel into it,
   * because opening a frame is how you decide about it and a card you have
   * to shut before you can act on what you have just seen makes you decide
   * the same thing twice. Nothing advances afterwards: the card is one
   * photograph being looked at, not a run.
   */
  const shown = previewOpen() ? current() : null;
  if (shown) {
    const landed = () => { renderShelf(); tally(); return e.preventDefault(); };
    /* Space opened this card and space shuts it, because that is what space
       does to a quick look on this machine and it is the strongest reflex
       there is. Keep moved off it and onto k, which is free, mnemonic and
       still one handed halfway down a pile. */
    if (e.key === " ") { shut(); return e.preventDefault(); }
    if (e.key === "k" || e.key === "K") { await flip(shown); return landed(); }
    const code = e.key.toUpperCase();
    if (S.vocab[code]) { await mark(shown, code); return landed(); }
    return;
  }
  if (previewOpen()) return;
  /* Escape with no card up lets the selection go, which is the second half
     of what escape means everywhere else on this machine: back out of the
     thing you are inside. The preview owns it while it is open, above. */
  if (e.key === "Escape") {
    if (!drop()) return;
    renderShelf();
    return e.preventDefault();
  }
  if (!visible.length) return;
  /* the same two keys every viewer on this machine uses for this, and they
     are free here because a tag is a letter and these are not. */
  if (e.key === "-" || e.key === "=" || e.key === "+") {
    const slider = $("#f-size");
    const to = Number(slider.value) + (e.key === "-" ? -NUDGE : NUDGE);
    slider.value = String(Math.min(Math.max(to, Number(slider.min)), Number(slider.max)));
    applySize(true);
    $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
    return e.preventDefault();
  }

  const cols = columns();
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];

  if (move !== undefined) {
    cursor = Math.min(Math.max(cursor + move, 0), visible.length - 1);
    /* Shift walks the range out from the anchor and a bare arrow lets it
       go, both the way finder does it. Letting go is the important half: a
       cursor that dragged a set behind it could never be used to look at one
       frame again, and with nothing picked this line does nothing at all,
       which is the whole of what a tagging run needs from it. */
    if (e.shiftKey) {
      if (!anchor) anchor = visible[cursor - move]?.id ?? null;
      range(visible[cursor].id);
    } else {
      drop();
    }
    renderShelf();
    $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
    return e.preventDefault();
  }

  const item = visible[cursor];
  /* Both open the card. Space because that is quick look, return because
     that is what return does to a selected file in finder. */
  if (e.key === "Enter" || e.key === " ") { open(item); return e.preventDefault(); }

  if (e.key === "k" || e.key === "K") {
    if (picked()) { await keepAll([...sel]); return e.preventDefault(); }
    await flip(item);
    step();
    return e.preventDefault();
  }

  const code = e.key.toUpperCase();
  if (S.vocab[code]) {
    /* A selection takes the keystroke whole and stays where it is. Nothing
       advances, because there is nothing to advance through: the run is the
       frame under the cursor, and a set is a decision already made about
       every frame in it at once. */
    if (picked()) { await markAll([...sel], code); return e.preventDefault(); }
    await mark(item, code);
    step();
    return e.preventDefault();
  }
}

/**
 * Everything cmd that is about the frames. It is a separate function rather
 * than three more branches in onKey because the guards are not the same
 * ones: reveal has to work with a card up, where the tagging keys have
 * already been handed to the previewed frame and gone.
 *
 * cmd+a is let go inside a text field rather than fought over, because with
 * a caret in the search box select all means the eight characters under it.
 *
 * cmd+1, cmd+2, cmd+f and cmd+o are in app.js instead. Three of them work on
 * the bench as well, and cmd+o has to work on an archive with nothing in it,
 * where this file never mounts and none of this exists.
 */
function command(e) {
  if (e.target.matches("input, select, textarea")) return;
  if (S.view !== "shelf") return;
  const k = e.key.toLowerCase();

  /**
   * Reveal, on the chord lightroom and bridge already use, and off the bare
   * r it had been eating a tag with. The reveal request goes out before
   * preventDefault has to hold, so the worst chrome can do with its own
   * reload shortcut is reload a page that has already opened finder, and
   * everything on screen is on the server anyway.
   */
  if (k === "r") {
    reveal(previewOpen() ? current() : visible[cursor]);
    return e.preventDefault();
  }

  if (!visible.length) return;

  /* Everything the filters left, and not one frame more. Select all on a
     filtered pile means all of this, because the filter is the question
     being asked and answering a different one would be the fastest way in
     this app to tag two thousand frames wrong. */
  if (k === "a") {
    for (const i of visible) sel.add(i.id);
    anchor = visible[0].id;
    renderShelf();
    return e.preventDefault();
  }

  /* The keyboard's way into the tray, now that cmd click is toggle select.
     cmd+return rather than a letter: every letter is either a tag or one
     keystroke away from being mistaken for one, and return already means
     commit the thing in front of you. */
  if (e.key === "Enter") { collect(); return e.preventDefault(); }
}

/**
 * The selection into the tray, or the frame under the cursor when there is
 * no selection. The plural add lives on tray.js now, so this is one call and
 * one repaint rather than one of each per frame.
 */
async function collect() {
  const ids = (picked() ? [...sel] : [visible[cursor]?.id]).filter(Boolean);
  if (ids.length) await trayAddMany(ids);
}

/* Both writes go to the copy on this page first and to the server after,
   and neither of them repaints: on the shelf the repaint is step()'s, one
   frame later, and doing it here as well would paint the whole grid twice
   for every keystroke of a run that is a keystroke every half second. */
async function flip(item) {
  const star = S.tags[item.id]?.star ? 0 : 1;
  S.tags[item.id] = { ...S.tags[item.id], star };
  await post("/api/tag", { id: item.id, star });
}

async function mark(item, code) {
  S.tags[item.id] = { ...S.tags[item.id], tag: code };
  await post("/api/tag", { id: item.id, tag: code });
}

/**
 * The same two writes over a whole set. One request per frame, because that
 * is the route the server has, but one repaint, at the end and before the
 * requests are waited on. Painting inside the loop would rebuild two hundred
 * tiles two hundred times for a single keystroke, and the run this app is
 * built around is a keystroke every half second.
 */
async function markAll(ids, code) {
  for (const id of ids) S.tags[id] = { ...S.tags[id], tag: code };
  renderShelf();
  tally();
  await Promise.all(ids.map((id) => post("/api/tag", { id, tag: code })));
}

/**
 * A mixed set becomes a kept set rather than each frame flipping where it
 * stands. "keep these" is what the key means, and a set that half inverts is
 * a set nobody can predict from looking at it. Only an already all kept set
 * is let go, so the key still undoes itself.
 */
async function keepAll(ids) {
  const star = ids.some((id) => !S.tags[id]?.star) ? 1 : 0;
  for (const id of ids) S.tags[id] = { ...S.tags[id], star };
  renderShelf();
  tally();
  await Promise.all(ids.map((id) => post("/api/tag", { id, star })));
}

function step() {
  // advancing after a tag is what makes it a run rather than a series of
  // decisions. it stops at the end rather than wrapping, so you can feel
  // the bottom of the pile.
  cursor = Math.min(cursor + 1, visible.length - 1);
  renderShelf();
  tally();
  $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
}
