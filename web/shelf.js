import { S, post, tally, reveal, typed } from "/app.js";
import { open, previewOpen, current, close as shut, walkHome } from "/preview.js";
import { bin as wastebasket, files, pick as chord, restore } from "/host.js";
import { did, didFinal } from "/undo.js";
import { MIME, inTray, addMany as trayAddMany, toggle as trayToggle } from "/tray.js";

import { fresh, hit as thump, leave, nope } from "/motion.js";
import { feel } from "/feel.js";

const $ = (s) => document.querySelector(s);
const F = { tag: new Set(), dir: new Set(), star: false, untagged: false, q: "", binned: false };
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
export const MIMES = "application/x-keeper-frames";

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

/**
 * What the wall was showing at the end of the last render, and which frames
 * a key just struck.
 *
 * Both exist for motion and for nothing else. The shelf repaints in full on
 * every keystroke, so "which of these tiles is new" cannot be read off the
 * dom: every tile is new to the dom and almost none of them are new to the
 * person looking at it. `drawn` is the difference between those two facts.
 */
let drawn = new Set();
let struck = [];

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

/**
 * The one frame and nothing else, which is what every way of opening a frame
 * means by it. A click said this in three lines of its own once, and then
 * space and return opened a card without saying it at all, so the comfiest
 * path through the shelf, hover to the frame and hit space, was the one path
 * that left the selection standing somewhere else.
 */
function pickOne(id) {
  sel.clear();
  sel.add(id);
  anchor = id;
}

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
const filtering = () => Boolean(F.tag.size || F.dir.size || F.star || F.untagged || F.q || F.binned);

/**
 * One chip, wearing the value it stands for. The counts move while you tag,
 * so a chip already on screen has to be found again and updated rather than
 * rebuilt: a rebuilt chip is a chip that has forgotten it was switched on
 * under somebody's hand.
 */
/**
 * Which digit tags which code, and the order is the row on screen.
 *
 * It is rebuilt on every render rather than fixed once, because the row is
 * ordered by what is actually in this archive: a shoot full of portraits
 * puts portrait on 1 for the person culling it. That does mean the mapping
 * can move under a hand mid pass, so it only ever moves when a code crosses
 * zero for the first time, which happens early and then stops.
 */
let digits = new Map();
const digitFor = (code) => digits.get(code) ?? 0;
export function setDigits(codes) {
  digits = new Map(codes.slice(0, 9).map((c, i) => [c, i + 1]));
}

function chip(v, label, count, key) {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.dataset.v = v;

  /**
   * What you press, ahead of the word. This row is the legend for the
   * keyboard as well as the filter for the mouse, and it is already where
   * the eye goes to ask what a tag is.
   *
   * The first nine show a number, because a number is the faster key: the
   * digits are one row under the fingers in a fixed order, and a hand
   * running a pile does not want to remember that celebrating is v. The
   * ones past nine show their letter, since there is no tenth digit worth
   * having. Both keys always work for every tag either way, so the letters
   * the tagging agent writes never stop being typeable.
   */
  if (key === "tag") {
    const k = document.createElement("span");
    k.className = "key";
    const n = digitFor(v);
    k.textContent = `${n || v.toLowerCase()} `;
    b.append(k);
  }
  b.append(label(v));

  const n = document.createElement("i");
  n.textContent = count(v);
  b.append(n);

  /* the full path only when the chip is not already showing it, so a
     tooltip never repeats the label it is standing on */
  const d = key === "tag" ? digitFor(v) : 0;
  const hint = key === "tag"
    ? `${S.hints[v] ?? ""}${d ? `  ·  press ${d} or ${v.toLowerCase()}` : ""}`.trim()
    : label(v) === v ? "" : v;
  if (hint) b.title = hint;

  b.onclick = () => {
    F[key].has(v) ? F[key].delete(v) : F[key].add(v);
    b.classList.toggle("on");
    quiet(b);
    feel("tick");
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
 * Everything past the eighth folder, behind one chip. It is not a filter and
 * never becomes one.
 *
 * It used to open once and take itself away, which meant a drive with fifty
 * shoots on it put a permanent three line thicket above the photographs and
 * the only way back was a reload. So it closes again, and it says how many
 * it is hiding rather than saying "more", because the count is the fact you
 * are deciding on.
 *
 * A folder you actually chose stays out when the row closes. Collapsing a
 * live filter out of sight is the row lying about what it is showing you.
 */
function more(host, rest) {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.style.color = "var(--ink-3)";
  b.title = "the rest of the folders";
  let open = false;
  let shown = [];

  const say = () => { b.textContent = open ? "less" : `${rest.length} more`; };

  b.onclick = () => {
    open = !open;
    if (open) {
      const have = new Set(shown.map((c) => c.dataset.place));
      for (const p of rest) {
        if (have.has(p)) continue;
        const c = chip(p, leaf, countPlace, "dir");
        c.dataset.place = p;
        host.insertBefore(c, b);
        shown.push(c);
      }
    } else {
      shown = shown.filter((c) => {
        if (c.classList.contains("on")) return true;
        c.remove();
        return false;
      });
    }
    say();
  };

  say();
  host.append(b);
}

export function mountShelf() {
  const present = Object.keys(S.vocab).filter((c) => countTag(c) > 0);
  setDigits(present.length ? present : Object.keys(S.vocab));
  /* Nothing is tagged on a fresh archive, so the row falls back to the whole
     vocabulary. That is the run where the letters matter most: all sixteen
     of them are on screen before the first keystroke. */
  chips($("#f-tag"), present.length ? present : Object.keys(S.vocab), word, countTag, "tag");

  const places = [...new Set(S.items.map((i) => i.place))]
    .sort((a, b) => countPlace(b) - countPlace(a));
  chips($("#f-dir"), places.slice(0, DIRS), leaf, countPlace, "dir");
  if (places.length > DIRS) more($("#f-dir"), places.slice(DIRS));

  $("#f-star").onclick = (e) => { F.star = !F.star; e.currentTarget.classList.toggle("on"); feel("tick"); renderShelf(); };
  $("#f-untagged").onclick = (e) => { F.untagged = !F.untagged; e.currentTarget.classList.toggle("on"); feel("tick"); renderShelf(); };
  $("#f-q").oninput = (e) => { F.q = e.target.value.trim().toLowerCase(); renderShelf(); };
  mountClear();

  mountSize();
  mountSweep();
  /* Clicking the empty part of the grid lets the selection go, the way it
     does in finder. It is on the grid rather than on the document so that a
     click in the filter row or the tray does not throw away a pile somebody
     spent a minute building, and it tests the target so a click that landed
     on a photograph is left to the tile's own handler. */
  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest("figure")) return;
    if (!drop()) return;
    renderShelf();
  });
  /* the same gesture the keyboard does, so the button and the key are never
     two different promises about the same frame */
  $("#f-bin").onclick = () => binPress();
  $("#f-nuke").onclick = () => nukePress();
  $("#f-binned").onclick = (e) => {
    F.binned = !F.binned;
    e.currentTarget.classList.toggle("on", F.binned);
    /* leaving the bin with a pile still selected would carry a selection of
       set aside frames onto a wall that is not showing any of them */
    sel.clear();
    binCancel();
    renderShelf();
  };
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
    F.binned = false;
    F.q = "";
    $("#f-q").value = "";
    for (const c of document.querySelectorAll("#filters .chip.on")) {
      c.classList.remove("on");
      quiet(c);
    }
    binCancel();
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
const SIZE_KEY = "keeper.tile";
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

/**
 * How much smaller a frame is in the tray than on the wall.
 *
 * 96 over the slider's 208 default, so a tray nobody has touched the slider
 * for looks exactly as it always did, and the two move together from there.
 * The floor keeps the remove button on a thumbnail rather than over it, and
 * the ceiling keeps a panel at its narrowest from falling to one column.
 */
const TRAY_RATIO = 0.46, TRAY_MIN = 72, TRAY_MAX = 176;

function applySize(save) {
  const slider = $("#f-size");
  const px = Number(slider.value);
  $("#grid")?.style.setProperty("--tile", `${px}px`);
  /* On the root, not on the panel, because that is the channel the tray
     already uses in the other direction with --tray-w: one number moves and
     everything reading it follows, and neither module has to import the
     other to say so. It is set even when the panel is shut, so opening it
     is not a repaint at the wrong size. */
  const t = Math.max(TRAY_MIN, Math.min(Math.round(px * TRAY_RATIO), TRAY_MAX));
  document.documentElement.style.setProperty("--tray-tile", `${t}px`);
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
  let held4drag = false; // the press was modified and began on a photograph

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
    held4drag = false;
  }

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    /* Option joins cmd and shift as a select modifier. All three mean the
       same thing to this grid, which is "the press you are about to make is
       about the set, not about the photograph", and a hand that reaches for
       the wrong one of the three should not get a different app. Option is
       also the only one of them that is not already spoken for by the
       system while the button is down. */
    const held = chord(e) || e.shiftKey || e.altKey;
    const onFrame = Boolean(e.target.closest("figure"));
    /**
     * In the bin a bare press on a photograph sweeps, and this is the only
     * place in the app where that is true.
     *
     * The modifier rule exists because a press on a frame is worth more to
     * the drag than to the sweep: dragging frames to the tray and the bench
     * is how they get there. In the bin nothing is going anywhere. It is a
     * pile you are deciding about as a pile, the two things you can do to it
     * both take a set, and there is nothing on the far end of a drag out of
     * it. So the press goes to the sweep, and the gesture people already
     * tried first is the one that works.
     */
    if (onFrame && !held && !F.binned) return;
    stop();
    from = spot(e);
    base = held ? new Set(sel) : new Set();
    /* a bare sweep in the bin still has to call off the native drag, or the
       first pixel of the gesture hands the frame to the drag machine and the
       rectangle never appears. */
    held4drag = onFrame && (held || F.binned);
    live = false;
  });

  /**
   * The one place the native drag is turned off, and it is here rather than
   * on the press.
   *
   * preventDefault on a pointerdown suppresses the whole compatibility
   * chain chrome builds out of it, mousedown, mouseup and **click** with it.
   * That is what a cmd click on a photograph was hitting: the press was
   * cancelled to keep the drag machine off it, the click never happened, and
   * the tile's own handler, which is what does the toggling, was never
   * called. It looked exactly like cmd click not being implemented.
   *
   * Cancelling the dragstart instead stops the drag just as dead and leaves
   * the click alone, because a click is not built out of a dragstart.
   */
  grid.addEventListener("dragstart", (e) => {
    if (held4drag) e.preventDefault();
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
    /* Whether anything on screen actually changed. A press that never became
       a sweep and was held with a modifier changes nothing here, and that
       case has to leave the grid alone: see the repaint at the bottom. */
    const swept = live;
    let changed = false;
    if (!live && !chord(e) && !e.shiftKey && !e.altKey) changed = drop();
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
    /* THE REPAINT IS CONDITIONAL, AND CMD CLICK IS WHY.

       A click is only born when mousedown and mouseup land on the same
       element. Pointer events run ahead of the mouse events chrome builds
       out of them, so this handler fires between the two, and it used to
       repaint unconditionally. renderShelf replaces every tile in the grid,
       which means the img that took the mousedown no longer existed by the
       time mouseup was dispatched: chrome retargeted mouseup to the grid
       div, the targets no longer matched, and no click was ever generated.
       The tile's handler, which is the only thing that toggles a pick, was
       never called.

       It looked exactly like cmd click not being implemented, and it was the
       second time this app has produced that symptom from a different cause.
       The first was a preventDefault on the press, fixed above.

       So the repaint now happens only when something changed: a sweep that
       really swept, or a click on the background that really let a pile go.
       A cmd or shift click that never moved falls through untouched, the
       tile survives to receive its own mouseup, and the click arrives. */
    if (swept || changed) renderShelf();
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
    /* The bin is a place you go to, not a thing mixed into everything else.
       Off, a binned frame is simply not on the wall; on, it is the only kind
       of frame on the wall, and every other filter still applies inside it. */
    if (S.binned.has(i.id) !== F.binned) return false;
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

  const binChip = $("#f-binned");
  if (binChip) {
    binChip.querySelector("i").textContent = S.binned.size;
    binChip.hidden = !S.binned.size && !F.binned;
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

  const grid = $("#grid");
  const before = drawn;
  drawn = new Set(visible.map((i) => i.id));
  grid.replaceChildren(...visible.map((item, n) => tile(item, n)));
  fresh(grid, visible, before);
  /* the frames a key just changed, thumped after the repaint rather than
     before it, because the tile that was under the hand a moment ago is not
     the same element any more: this whole grid was rebuilt in the line
     above. the ids survive the rebuild and the elements do not. */
  for (const id of struck) thump(grid.querySelector(`figure[data-id="${CSS.escape(id)}"]`));
  struck = [];
  /* after the grid, because what the trash would take depends on what the
     filters just left standing */
  sayBin();
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
  /* A code that has just appeared has taken a digit, so the row of numbers
     has to be told before the next keystroke lands on the old mapping. The
     order on screen is the order of the keys and the two cannot be allowed
     to disagree even for one frame. */
  setDigits([...host.children].map((b) => b.dataset.v));
  for (const b of host.children) {
    const k = b.querySelector(".key");
    if (!k) continue;
    const d = digitFor(b.dataset.v);
    k.textContent = `${d || b.dataset.v.toLowerCase()} `;
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
  /* The preview is the only caller, and it calls on every arrow. The pick
     comes with it or arrowing once off the frame space just picked would
     leave the selection on a photograph that is no longer on screen. */
  pickOne(id);
  renderShelf();
  $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
}

/**
 * The drag image for a set: three tiles fanned out, and the number.
 *
 * A canvas rather than markup, because a drag image is snapshotted once at
 * dragstart and never updated, so there is nothing a live element buys here
 * and a canvas cannot be caught mid transition. It is drawn at the device
 * pixel ratio and sized down in css, or it is a soft rectangle on a retina
 * screen.
 *
 * The element has to be in the document to be snapshotted, and it has to be
 * gone before the next paint or it is a stray canvas sitting over the wall.
 * Off screen and removed on the next frame does both: the browser takes its
 * picture during dragstart, synchronously, so by the time the timeout runs
 * the image has already been captured.
 */
function stack(ids) {
  const dpr = Math.min(devicePixelRatio || 1, 3);
  const W = 108, H = 92;
  const c = document.createElement("canvas");
  c.width = W * dpr; c.height = H * dpr;
  c.style.cssText = `position:fixed;left:-9999px;top:0;width:${W}px;height:${H}px`;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);

  /* back to front, so the one under the cursor ends up on top */
  const shown = ids.slice(0, 3).reverse();
  shown.forEach((id, i) => {
    const src = $(`#grid figure[data-id="${CSS.escape(id)}"] img`);
    const back = shown.length - 1 - i;
    const x = 8 + back * 7, y = 8 + back * 6;
    const s = 62;
    g.save();
    g.shadowColor = "#000000a6"; g.shadowBlur = 10; g.shadowOffsetY = 3;
    g.fillStyle = "#141416";
    g.beginPath(); g.roundRect(x, y, s, s, 3); g.fill();
    g.restore();
    if (src?.complete && src.naturalWidth) {
      g.save();
      g.beginPath(); g.roundRect(x, y, s, s, 3); g.clip();
      /* cover, so a portrait and a landscape both fill the square the way
         they do on the wall */
      const k = Math.max(s / src.naturalWidth, s / src.naturalHeight);
      const w = src.naturalWidth * k, h = src.naturalHeight * k;
      g.drawImage(src, x + (s - w) / 2, y + (s - h) / 2, w, h);
      g.restore();
    }
  });

  const label = String(ids.length);
  g.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  const w = Math.max(22, g.measureText(label).width + 14);
  const bx = W - w - 6, by = H - 24;
  g.fillStyle = "#e1062c";
  g.beginPath(); g.roundRect(bx, by, w, 20, 3); g.fill();
  g.fillStyle = "#fff";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(label, bx + w / 2, by + 10.5);

  document.body.append(c);
  setTimeout(() => c.remove(), 0);
  return c;
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
  add.onclick = (e) => {
    /* A modifier means the hand is building a selection, and the corner of a
       tile is not an exception to that.

       This button is invisible until the tile is hovered, but it was never
       inactive: opacity zero still takes the pointer, so the top right 26
       pixels of every frame on the wall were a live add to tray control the
       whole time. A cmd click that landed there called this handler, and
       stopPropagation then swallowed the click the figure needed to toggle
       the pick, so the frame went quietly into the tray and was never
       selected. Both halves were wrong and neither said anything.

       Letting it bubble is the whole fix: the figure's own handler is the
       one place the modifiers are read, and it is now the only one. */
    if (chord(e) || e.shiftKey || e.altKey) return;
    e.stopPropagation();
    trayToggle(item.id);
  };
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
    /* One frame drags its own thumbnail. A set drags a stack with the count
       on it, because the single thumbnail was a lie about how many were
       coming: forty frames and one photograph under the cursor look exactly
       like one frame under the cursor. */
    const ghost = many.length > 1 ? stack(many) : null;
    if (ghost) e.dataTransfer.setDragImage(ghost, 34, 34);
    else if (img.complete && img.naturalWidth) {
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
    if (chord(e) || e.altKey) {
      sel.has(item.id) ? sel.delete(item.id) : sel.add(item.id);
      anchor = item.id;
    } else if (e.shiftKey) {
      range(item.id);
    } else {
      /* A plain click opens it. Selecting is what the modifiers and the
         swept box are for, and hover already moves the cursor, so a bare
         click had nothing left to do but the thing you meant by it. It also
         picks the frame, so that whatever you do next is about the one you
         are looking at. */
      pickOne(item.id);
      cursor = n;
      renderShelf();
      return open(item);
    }
    cursor = n;
    renderShelf();
  };

  /**
   * The frame under the pointer is the frame the keyboard acts on.
   *
   * Photo mechanic and lightroom both work this way and it is the faster
   * hand: the mouse is already pointing at the picture you are thinking
   * about, so space looks at that one, a letter tags that one and the trash
   * takes that one, with no click first to tell the app what you were
   * obviously already looking at.
   *
   * It only moves the cursor, never the selection. A pointer crossing forty
   * frames on its way somewhere must not pick forty frames up.
   */
  fig.onpointerenter = () => {
    if (!byPointer) return;
    /* a sweep in progress owns the pointer, and a drag to the tray or the
       bench is a press that has already left the tile it started on. */
    if (document.body.dataset.sweeping || cursor === n) return;
    cursor = n;
    paintCursor();
  };
  return fig;
}

/**
 * Which of the two hands is steering.
 *
 * Hover follows the mouse, and the arrows follow the keyboard, and they
 * fight the moment a hand rests on the trackpad while the other hand runs
 * the alphabet: every keystroke would jump back to whatever the cursor
 * happens to be sitting over. So the arrows switch hover off, and the next
 * real pointer movement switches it back on. Movement, not the enter event
 * a repaint fires by itself when a new tile appears under a still pointer.
 */
let byPointer = true;
/**
 * Where the pointer actually is, kept because a hover flag written onto a
 * tile cannot be trusted to survive that tile.
 *
 * The tray repaints itself whole on every add, every remove and every arrow,
 * so a frame marked as hovered is replaced by a brand new element under a
 * hand that has not moved, and no enter event fires for it. Asking the
 * document what is under this point, at the moment the key is pressed, has
 * no state to go stale.
 */
let point = { x: -1, y: -1 };
addEventListener("pointermove", (e) => {
  byPointer = true;
  point = { x: e.clientX, y: e.clientY };
}, { passive: true });

/**
 * Moving the ring without rebuilding the grid.
 *
 * renderShelf() replaces every tile, which on a pointer crossing a wall at
 * speed is a few hundred elements thrown away per second, and it also takes
 * the element out from under the pointer mid-gesture. The ring is one class
 * on two tiles, so it is moved as one class on two tiles.
 */
function paintCursor() {
  const grid = $("#grid");
  if (!grid) return;
  grid.querySelector("figure.cursor")?.classList.remove("cursor");
  grid.children[cursor]?.classList.add("cursor");
  sayBin();
}

/**
 * Tagging is keyboard first because it is the only way it gets done. A
 * thousand frames through a mouse is an afternoon; through the home row it
 * is twenty minutes. The letters are the same ones the agent writes, so a
 * person correcting a machine's pass never has to learn a second alphabet.
 */
async function onKey(e) {
  if (e.ctrlKey) return;
  /* One rule, and it is the mac one: a bare letter tags, cmd plus a key
     commands. It is not a tidiness. r was bound bare to reveal in finder and
     sat in front of the tag table, so resting, one of the sixteen, could not
     be typed at all, and putting find on f would have taken food the same
     way. The rule frees both letters and every letter after them. */
  if (chord(e) || e.altKey) return command(e);
  if (S.view !== "shelf" || typed(e)) return;

  /**
   * The preview keeps the arrows, and it moves this cursor itself as it
   * goes: without that both would step and the shelf would run through the
   * set at twice the speed of the card. The two decisions travel into it,
   * because opening a frame is how you decide about it and a card you have
   * to shut before you can act on what you have just seen makes you decide
   * the same thing twice. Nothing advances afterwards: the card is one
   * photograph being looked at, not a run.
   */
  /**
   * The trash, on the key finder puts it on, and it means what finder means:
   * the file is moved, not removed. It goes to the macOS Trash with its Put
   * Back record, so this is undone from finder in one keystroke.
   *
   * Two presses. The first arms and says what will happen and to how many,
   * the second does it. A cull runs at a keystroke every half second and the
   * one irreversible key in the app is not allowed to be reachable at that
   * speed. It sits above the preview branch on purpose: a frame you have
   * opened to look at properly is exactly the frame you decide to bin.
   */
  if (e.key === "Backspace" || e.key === "Delete") {
    binPress();
    return e.preventDefault();
  }

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
    /* the ask first: escape backs out of the innermost thing you are inside,
       and while it is up that is the ask and not the pile it is about. */
    if (armed) { binCancel(); return e.preventDefault(); }
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
    byPointer = false;
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
     that is what return does to a selected file in finder.

     Both pick it too, the same way a click does. Hover puts the cursor on a
     frame and space looks at it, and that pair is the most comfortable thing
     in the app, comfortable enough that it gets used instead of clicking and
     the selection is then quietly a frame behind. Opening a frame is how a
     decision about it gets made, so the frame you are looking at is the
     frame the next keystroke is about. */
  if (e.key === "Enter" || e.key === " ") {
    pickOne(item.id);
    renderShelf();
    open(item);
    return e.preventDefault();
  }

  if (e.key === "k" || e.key === "K") {
    if (picked()) { await keepAll([...sel]); return e.preventDefault(); }
    await flip(item);
    step();
    return e.preventDefault();
  }

  /* a digit is the same act as its letter, and it is the one a hand running
     a pile actually reaches for. the mapping is whatever the legend row is
     showing, so what you press is what you can read. */
  if (/^[1-9]$/.test(e.key)) {
    const hit = [...digits].find(([, d]) => d === Number(e.key));
    if (hit) {
      if (picked()) { await markAll([...sel], hit[0]); return e.preventDefault(); }
      await mark(item, hit[0]);
      step();
      return e.preventDefault();
    }
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
  if (e.target?.matches?.("input, select, textarea")) return;
  if (S.view !== "shelf") return;

  /* Option rewrites the character on a mac keyboard, so option+r arrives as
     "®" and option+delete as a word-delete. The physical key is the only
     thing in the event worth reading once a modifier is down. */
  const k = e.code;

  /**
   * Reveal in finder, on option rather than on cmd.
   *
   * It was cmd+r, which lightroom and bridge use and which reads right. In
   * a browser it is not available: cmd+r is a chrome accelerator resolved
   * above the page, preventDefault runs, and the tab reloads anyway. Tested
   * by the person using it, which is the only test that counted.
   *
   * It is also off the bare r it used to sit on, where it was quietly
   * eating the `resting` tag.
   */
  if (k === "KeyR") {
    reveal(previewOpen() ? current() : visible[cursor]);
    return e.preventDefault();
  }

  /**
   * The trash, on the chord finder uses for it, and it means what finder
   * means: the file is moved, not removed. It goes to the macOS Trash with
   * its Put Back record, so this is undone from finder in one keystroke.
   *
   * Two presses, like emptying a tray. The first arms and says what will
   * happen and to how many, the second does it. A cull runs at a keystroke
   * every half second and the one irreversible key in the app is not allowed
   * to be reachable at that speed.
   */
  if (!visible.length) return;

  /* Everything the filters left, and not one frame more. Select all on a
     filtered pile means all of this, because the filter is the question
     being asked and answering a different one would be the fastest way in
     this app to tag two thousand frames wrong. */
  if (k === "KeyA") {
    /* Pressing it again lets the lot go. Select all with no way back out of
       it is a trap, and the second press is where a hand already is. */
    if (visible.every((i) => sel.has(i.id)) && sel.size) {
      drop();
      renderShelf();
      return e.preventDefault();
    }
    for (const i of visible) sel.add(i.id);
    anchor = visible[0].id;
    renderShelf();
    return e.preventDefault();
  }

  /* The keyboard's way into the tray, now that cmd click is toggle select.
     cmd+return rather than a letter: every letter is either a tag or one
     keystroke away from being mistaken for one, and return already means
     commit the thing in front of you. */
  if (k === "Enter") { collect(); return e.preventDefault(); }
}

/* ------------------------------------------------------------------ */
/* the trash                                                           */
/* ------------------------------------------------------------------ */

let armed = null;      // the ids the armed press would take
let armedAt = 0;

/* Above this many, a repeat of the same key is not consent. One frame is a
   decision you have already made by pointing at it. Four hundred is not, and
   the second press arrives half a second after the first in an app where
   every other keystroke is harmless and repeats fast. */
const MANY = 6;

/** the frame the pointer is resting on in the tray, if it is resting on one */
function overTray() {
  if (point.x < 0) return null;
  const el = document.elementFromPoint(point.x, point.y);
  return el?.closest("#tray .tray-item")?.dataset.id ?? null;
}

/**
 * The frame the tray owns the keyboard for, or null when it owns nothing.
 *
 * A card that is up wins, because it was opened on purpose, and it counts as
 * the tray's only when the tray is what opened it. With no card up it is
 * whatever the pointer is resting on in the panel.
 */
function trayContext() {
  if (previewOpen()) return walkHome() === "tray" ? current()?.id ?? null : null;
  return overTray();
}

/** what the bin would take right now: the selection, the frame the preview
    is showing, or the one under the cursor, in that order. the tray is not
    in this list, because a frame the tray owns never reaches it. */
function binTargets() {
  if (picked()) return [...sel];
  const shown = previewOpen() ? current() : null;
  return [shown?.id ?? visible[cursor]?.id].filter(Boolean);
}

/**
 * Backspace, and it does not delete anything.
 *
 * IT USED TO GO STRAIGHT TO THE MACOS TRASH AND THAT WAS A REAL MISTAKE ON A
 * REAL DRIVE. A shot can be bad and still be the only copy of itself, and the
 * fastest key in a culling tool must not be wired to the one irreversible
 * thing on the machine. The frame you are done looking at and the file you
 * want off the disk are two different decisions and this key only ever makes
 * the first one.
 *
 * So it sets frames aside. The file does not move, the index keeps it, the
 * tags keep it, and the shelf stops drawing it. Inside the bin the same key
 * is the way back out, because the one gesture that put a frame here should
 * be the one that takes it away again.
 *
 * There is no arming any more, on either side. Two presses are the price of
 * something you cannot undo, and this is not that.
 */
function binPress() {
  /* In the tray the key means take it out of the pile. It is checked before
     anything else because a frame in the tray is a frame you already decided
     to keep, and setting that same frame aside is the opposite answer. */
  const held = trayContext();
  if (held) {
    dispatchEvent(new CustomEvent("keeper:untray", { detail: { id: held } }));
    return;
  }
  const ids = binTargets();
  if (!ids.length) return;
  return F.binned ? unbin(ids) : bin(ids);
}

export function binCancel() {
  if (!armed) return;
  armed = null;
  sayBin();
}

const many = (n) => `${n} ${n === 1 ? "frame" : "frames"}`;

/* the tiles currently standing for a set of ids. only motion uses this: the
   model has already been changed by the time it is called. */
const tilesFor = (ids) =>
  ids.map((id) => $(`#grid figure[data-id="${CSS.escape(id)}"]`)).filter(Boolean);

async function bin(ids) {
  const going = tilesFor(ids);
  const ok = await post("/api/bin", { ids });
  if (!ok) { feel("no"); nope($("#f-bin")); sayBin("that did not go in the bin."); return; }
  for (const id of ids) { S.binned.add(id); sel.delete(id); }
  /* the frames are already out of the model here. this holds them on the
     wall for a fifth of a second while they shrink away, because a frame
     that disappears between two rendered frames leaves no evidence that
     anything happened except a number changing in the far corner. */
  feel("thud");
  leave(going, () => { renderShelf(); tally(); });
  did(`setting aside ${many(ids.length)}`, () => unbin(ids), () => bin(ids));
  sayBin(`${many(ids.length)} set aside. nothing was deleted.`);
  setTimeout(() => sayBin(), 6000);
}

async function unbin(ids) {
  const going = tilesFor(ids);
  const ok = await post("/api/bin", { ids, put: true });
  if (!ok) { feel("no"); nope($("#f-bin")); sayBin("that did not come back out."); return; }
  for (const id of ids) { S.binned.delete(id); sel.delete(id); }
  feel("tap");
  leave(going, () => { renderShelf(); tally(); });
  did(`putting back ${many(ids.length)}`, () => bin(ids), () => unbin(ids));
  sayBin(`${many(ids.length)} back on the shelf.`);
  setTimeout(() => sayBin(), 6000);
}

/**
 * The real one, and it lives at the bottom of the bin where you have to go
 * on purpose. Finder's own delete, so the Put Back record survives and the
 * whole thing is still undone from the Trash in one keystroke.
 *
 * A small pile is committed by pressing the same button again. A large one
 * is not: it gets the full stop in the middle of the screen, because the
 * second press arrives half a second after the first and four hundred
 * photographs is not a thing anybody agrees to by accident.
 */
function nukePress() {
  const ids = binTargets();
  if (!ids.length) return;
  const same = armed && armed.length === ids.length && armed.every((id) => ids.includes(id));
  if (same && ids.length <= MANY && Date.now() - armedAt < 4000) return nuke(ids);
  armed = ids;
  armedAt = Date.now();
  sayBin();
  if (ids.length <= MANY) {
    setTimeout(() => { if (Date.now() - armedAt >= 4000) { armed = null; sayBin(); } }, 4100);
  }
}

async function nuke(ids) {
  armed = null;
  const going = tilesFor(ids);
  const ok = await post("/api/trash", { ids });
  if (!ok) {
    feel("no");
    nope($("#f-nuke"));
    sayBin("that did not go to the trash. the file may be on a drive that is gone.");
    return;
  }

  /* The server has already dropped them from the index, so the page drops
     them from its own copy rather than asking for the whole state again:
     re-fetching would throw away the cursor, the selection and the scroll
     position of someone in the middle of a cull. */
  const gone = new Set(ids);
  S.items = S.items.filter((i) => !gone.has(i.id));
  S.byId = new Map(S.items.map((i) => [i.id, i]));
  for (const id of gone) { sel.delete(id); S.binned.delete(id); }
  feel("thud");
  leave(going, () => { renderShelf(); tally(); });
  /**
   * The one wall in the stack.
   *
   * The file has left the archive and keeper cannot fetch it back: the whole
   * point of going through finder is that finder holds the Put Back record,
   * and finder is where it is undone. So cmd z stops here and says that,
   * rather than stepping over it and quietly taking back the tag you made
   * before it, which would look exactly like the delete having been undone.
   */
  didFinal(`deleting ${many(ids.length)}`,
    `that one is in ${wastebasket()}. ${restore()} it from ${files()}, not from here.`);
  sayBin(`${many(ids.length)} in ${wastebasket()}. ${files()} can ${restore()} them.`);
  setTimeout(() => sayBin(), 6000);
}

/**
 * What the two buttons say.
 *
 * The first one is the reversible one and it never asks, because asking
 * about something you can undo teaches people to press through questions.
 * The second one asks, and over a real pile it stops the screen.
 */
function sayBin(text) {
  const el = $("#f-bin");
  if (!el) return;
  const targets = binTargets().length;

  el.hidden = !targets && !text;
  el.textContent = text || (F.binned
    ? `put back ${targets > 1 ? many(targets) : "this one"}`
    : `set aside ${targets > 1 ? many(targets) : "this one"}`);

  const kill = $("#f-nuke");
  if (kill) {
    const n = armed?.length ?? 0;
    const big = n > MANY;
    kill.hidden = !F.binned || (!targets && !armed);
    kill.classList.toggle("armed", !!armed && !big);
    kill.textContent = armed && !big
      ? `press again to delete ${many(n)}`
      : "delete off the drive";
    bigAsk(big ? n : 0);
  }
  /* last, because it moves the two elements the lines above just wrote to */
  binBar();
}

/**
 * Where the bin's two controls are standing right now.
 *
 * They are one pair of buttons, not two, and they move. On the shelf they
 * are a chip in the filter row, because out there `set aside` is one more
 * thing you can do to a frame among a row of things. In the bin they are the
 * only two things there are to do, so they come down to a bar across the
 * bottom, next to the photographs and under the hand, and they take an icon
 * each on the way.
 *
 * Moving the element rather than drawing a second one is the whole point:
 * every handler, every id lookup, the label that already knows to read `put
 * back` in here, and the two press arming on delete all carry across
 * untouched, because it is the same button in a different parent.
 */
let binHome = null;

function binBar() {
  const bar = $("#bin-bar"), back = $("#f-bin"), kill = $("#f-nuke");
  if (!bar || !back || !kill) return;
  /* where they live on the shelf, read once, before anything has moved */
  binHome ??= { parent: back.parentNode, before: kill.nextSibling };

  if (F.binned) {
    if (back.parentNode !== bar) bar.append(back, kill);
    /* the icon rule in icons.css is the attribute and a --ph, nothing else */
    back.dataset.icon = "";
    kill.dataset.icon = "";
  } else if (back.parentNode === bar) {
    binHome.parent.insertBefore(back, binHome.before);
    binHome.parent.insertBefore(kill, binHome.before);
    delete back.dataset.icon;
    delete kill.dataset.icon;
  }

  /* The bar is for a set. One frame under the cursor is still backspace, the
     way it is everywhere else in this app. */
  const n = sel.size;
  $("#bin-n").textContent = n ? `${many(n)} selected` : "";
  bar.hidden = !F.binned || !n;
}

/** the full stop in the middle of the screen, and only for a real pile */
function bigAsk(n) {
  let box = $("#bin-ask");
  if (!n) { box?.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "bin-ask";
    box.innerHTML = `
      <div class="bin-card">
        <p class="bin-n"></p>
        <p class="bin-what">off the drive and into the macos trash. finder can put
          them back, and keeper cannot.</p>
        <div class="bin-acts">
          <button type="button" class="chip bin-no">keep them</button>
          <button type="button" class="bin-yes"></button>
        </div>
      </div>`;
    document.body.append(box);
    box.querySelector(".bin-no").onclick = () => binCancel();
    box.addEventListener("click", (e) => { if (e.target === box) binCancel(); });
    box.querySelector(".bin-yes").onclick = () => { const ids = armed; armed = null; bigAsk(0); nuke(ids); };
  }
  box.querySelector(".bin-n").textContent = `${n} frames`;
  box.querySelector(".bin-yes").textContent = `delete ${n}`;
  box.querySelector(".bin-yes").focus();
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
/**
 * Put a set of tag rows back exactly as they were, for the undo of anything
 * that wrote one. `[id, tag, star]` each, and an empty string is what the
 * server reads as untagged, so a frame that had no tag before gets none back
 * rather than keeping whatever it was given.
 */
async function restoreTags(rows) {
  for (const [id, tag, star] of rows) {
    S.tags[id] = { ...S.tags[id], tag: tag || undefined, star };
  }
  renderShelf();
  tally();
  await Promise.all(rows.map(([id, tag, star]) =>
    post("/api/tag", { id, tag: tag ?? "", star })));
}

/** what a set of frames is wearing right now, in the shape restoreTags reads */
const tagRows = (ids) =>
  ids.map((id) => [id, S.tags[id]?.tag, S.tags[id]?.star ? 1 : 0]);

const someFrames = (n) => `${n} ${n === 1 ? "frame" : "frames"}`;

async function flip(item) {
  const was = tagRows([item.id]);
  const star = S.tags[item.id]?.star ? 0 : 1;
  S.tags[item.id] = { ...S.tags[item.id], star };
  const now = tagRows([item.id]);
  struck = [item.id];
  feel("tap");
  did(star ? "keeping a frame" : "letting a frame go",
      () => restoreTags(was), () => restoreTags(now));
  await post("/api/tag", { id: item.id, star });
}

async function mark(item, code) {
  const was = tagRows([item.id]);
  S.tags[item.id] = { ...S.tags[item.id], tag: code };
  const now = tagRows([item.id]);
  struck = [item.id];
  feel("tick");
  did(`tagging a frame ${S.vocab[code]?.[0] ?? code}`,
      () => restoreTags(was), () => restoreTags(now));
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
  const was = tagRows(ids);
  for (const id of ids) S.tags[id] = { ...S.tags[id], tag: code };
  struck = ids;
  feel("tick");
  renderShelf();
  tally();
  did(`tagging ${someFrames(ids.length)} ${S.vocab[code]?.[0] ?? code}`,
      () => restoreTags(was), () => restoreTags(tagRows(ids)));
  await Promise.all(ids.map((id) => post("/api/tag", { id, tag: code })));
}

/**
 * A mixed set becomes a kept set rather than each frame flipping where it
 * stands. "keep these" is what the key means, and a set that half inverts is
 * a set nobody can predict from looking at it. Only an already all kept set
 * is let go, so the key still undoes itself.
 */
async function keepAll(ids) {
  const was = tagRows(ids);
  const star = ids.some((id) => !S.tags[id]?.star) ? 1 : 0;
  for (const id of ids) S.tags[id] = { ...S.tags[id], star };
  struck = ids;
  feel("tap");
  renderShelf();
  tally();
  did(`${star ? "keeping" : "letting go"} ${someFrames(ids.length)}`,
      () => restoreTags(was), () => restoreTags(tagRows(ids)));
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
