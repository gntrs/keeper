import { S, reveal } from "/app.js";
import { files } from "/host.js";
import { filtered, focus } from "/shelf.js";
import { toggle as trayToggle, inTray } from "/tray.js";
import { feel } from "/feel.js";

const $ = (s) => document.querySelector(s);

/**
 * The frame currently on screen, and the only thing this file remembers.
 * Null is the closed state, so nothing has to ask the DOM whether the
 * preview is up and nothing can disagree with it about that.
 */
let cur = null;

/** the picture's real dimensions, which decide how big the card is allowed to be */
let real = { w: 0, h: 0 };

export const previewOpen = () => cur !== null;

/**
 * The frame the card is showing, or null when it is shut. The shelf reads
 * this so that space and the tagging letters land on the picture in front of
 * you rather than on whatever the grid cursor was left standing on. Opening a
 * frame is how a decision gets made, and a keystroke that tags a different
 * frame than the one being looked at is worse than a keystroke that does
 * nothing at all.
 */
export const current = () => cur;

/**
 * The run the arrows walk, and it is whatever opened the card rather than
 * whatever the grid happens to be showing.
 *
 * A frame opened from the shelf steps through the shelf's filter, because
 * that filter is the question being asked. A frame opened from a tray steps
 * through the tray, because a tray is a pile you have already decided on and
 * arrowing out of it into the other two thousand frames answers a question
 * nobody asked. The caller passes the run it belongs to and the card holds
 * on to it until something else opens.
 */
let walk = filtered;

/**
 * Where the card was opened from, as a word: "shelf" or "tray".
 *
 * The run carries it on itself, because the run and its home are the same
 * fact and passing them separately is two arguments that can disagree. The
 * shelf never sets one, so its run is the default and the default is shelf.
 */
export const walkHome = () => walk?.home ?? "shelf";

/* ---------------------------------------------------------------------
   The quiet card.

   The card goes still when the hand does. Looking at a photograph is the
   one moment in this app where the chrome has nothing left to say, so
   after a second and a half without a pointer or a key the furniture
   steps behind the idle class and the photograph has the surround to
   itself. Any input lifts it back instantly. This file only says when
   deep and idle are true: what they look like, the pure black ground,
   the depth of the fade, and the plain cut under reduced motion, is
   style.css's side of the contract. The photograph itself is never in
   either class's reach, so its pixels cannot dim.
   --------------------------------------------------------------------- */
const IDLE_MS = 1500;
let idleTimer = 0;

function stir() {
  if (!cur) return;
  const host = $("#preview");
  host.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (cur) host.classList.add("idle"); }, IDLE_MS);
}

/* ---------------------------------------------------------------------
   Zoom, and it is sticky on purpose.

   A burst is thirty frames of the same second, and the question being
   asked of it is almost always about one small region: which frame has
   the eye sharp. So the zoom lives on the viewer, not on the picture.
   Stepping to the next frame reuses the held scale and pan, and the same
   eye stays under the cursor for the whole run instead of every arrow
   press dropping you back to fit to climb in again.

   The held scale is absolute, where 1 is one image pixel to one screen
   pixel, because that is the only number that means the same thing on a
   tall frame and a wide one. Falling back to fit clears the hold, and so
   does closing the card: stickiness is for a pass, not a session.

   Clips are left alone. Their controls own the pointer, and scrubbing
   footage through a crop is not a judgment anyone makes here.
   --------------------------------------------------------------------- */

/** the scale fit() last chose, so held zoom knows what fit means right now */
let fitScale = 1;

/** {scale, panX, panY} while zoomed past fit, null at fit. survives steps. */
let hold = null;

/**
 * Push the held state onto the picture. The transform is relative to the
 * fitted size the stage was measured at, so the same absolute hold renders
 * as a different multiple on every frame and the magnification is what
 * stays constant. The pan is clamped to the overflow so a frame can be
 * dragged to its edge and no further: a photograph floating loose in a
 * black stage with nothing under the cursor is a viewer that got lost.
 */
function apply() {
  paintZoom();
  const stage = $("#preview .preview-stage");
  const media = stage.firstElementChild;
  if (!media || media.tagName !== "IMG") return;
  if (!hold) {
    media.style.transform = "";
    media.style.cursor = "zoom-in";
    return;
  }
  /* never below 1: a hold below this frame's fit would shrink the picture
     inside its own stage, so the frame shows at fit and the hold waits for
     the next frame it is actually past. */
  const rel = Math.max(1, hold.scale / fitScale);
  const ox = Math.max(0, stage.clientWidth * (rel - 1) / 2);
  const oy = Math.max(0, stage.clientHeight * (rel - 1) / 2);
  hold.panX = Math.min(ox, Math.max(-ox, hold.panX));
  hold.panY = Math.min(oy, Math.max(-oy, hold.panY));
  media.style.transform = `translate(${hold.panX}px, ${hold.panY}px) scale(${rel})`;
  media.style.cursor = "grab";
}

/**
 * Move to an absolute scale, keeping the point under the cursor under the
 * cursor. cx and cy are measured from the stage centre, which is also the
 * transform origin, so the pan that preserves a point falls out of one
 * line of algebra instead of a rectangle dance. Landing at or below fit
 * clears the hold, which is what makes fit the resting state rather than
 * a zoom that happens to be small.
 */
function zoomTo(scale, cx, cy) {
  const next = Math.min(8, Math.max(fitScale, scale));
  if (next <= fitScale * 1.001) {
    hold = null;
    apply();
    return;
  }
  const r0 = hold ? Math.max(1, hold.scale / fitScale) : 1;
  const r1 = next / fitScale;
  const p0x = hold ? hold.panX : 0;
  const p0y = hold ? hold.panY : 0;
  hold = {
    scale: next,
    panX: cx - (cx - p0x) * (r1 / r0),
    panY: cy - (cy - p0y) * (r1 / r0),
  };
  apply();
}

/**
 * The two state toggle: fit and one to one, nothing in between to
 * remember. A frame already at one to one inside its fit has nothing to
 * toggle to, so the key does nothing rather than pretending.
 */
function snap(cx = 0, cy = 0) {
  if (hold) hold = null;
  else if (fitScale < 1) return zoomTo(1, cx, cy), feel("tick");
  else return;
  apply();
  feel("tick");
}

/**
 * The held state, said out loud in the card chrome. It reads "held at"
 * rather than a bare percentage because the number alone would not say
 * the one thing that matters about it: that it will still be there on
 * the next frame.
 */
function paintZoom() {
  const el = $("#preview .preview-zoom");
  if (!el) return;
  el.hidden = !hold;
  if (hold) el.textContent = `held at ${Math.round(hold.scale * 100)}%`;
}

/**
 * This used to be a full screen lightbox and it is not one any more, on
 * purpose. Blacking out the whole window to look at one photograph is a
 * viewer's gesture, not a worker's: it throws away the row of frames you
 * were comparing against, it hides the filter you are working inside, and it
 * makes going back feel like leaving. A card floating over a dimmed page
 * keeps all of that in the corner of your eye while still being unambiguous
 * about what has your attention, which is the whole trick Quick Look pulls.
 *
 * The deep class is the one concession back toward the dark room: the
 * surround under the card drops to pure black while it is up, so coming
 * back to the shelf's near black reads as surfacing.
 */
export function open(item, run = filtered) {
  if (!item) return;
  walk = run;
  cur = item;
  real = { w: item.w ?? 0, h: item.h ?? 0 };

  /* A clip opens as a real player, not as its poster. Judging a piece of
     footage from one frame is how you end up cutting to a whip pan. It
     starts muted because a browser will refuse to autoplay otherwise, and a
     clip that silently does nothing when you open it reads as broken. */
  const media = document.createElement(item.kind === "film" ? "video" : "img");
  media.src = `/full/${item.id}`;
  if (item.kind === "film") {
    media.controls = true;
    media.autoplay = true;
    media.muted = true;
    media.playsInline = true;
    media.onloadedmetadata = () => size(media.videoWidth, media.videoHeight);
  } else {
    media.alt = "";
    /* the browser's own image drag would fight the pan, and there is
       nowhere in this app an image wants dragging to from here. */
    media.draggable = false;
    media.onload = () => size(media.naturalWidth, media.naturalHeight);
  }
  $("#preview .preview-stage").replaceChildren(media);

  meta(item);
  const host = $("#preview");
  host.hidden = false;
  host.classList.add("deep");
  stir();
  fit();
}

/**
 * The index knows the dimensions of a still and usually not of a clip, so
 * whichever of the two arrives second wins. Nothing is resized unless the
 * number actually changed, because a video fires this on every source
 * change and a needless relayout under a playing clip is visible.
 */
function size(w, h) {
  if (!w || !h || (real.w === w && real.h === h)) return;
  real = { w, h };
  fit();
}

/**
 * THE CARD IS MEASURED, NOT GUESSED. The picture gets whatever height is
 * left after the meta block below it has been laid out, which is a number
 * only the browser knows: the path wraps to two lines on some frames and one
 * on others, and a hard coded allowance for it would either crop the tall
 * frames or leave a band of empty card under the wide ones.
 *
 * The three way minimum is the rule the brief asked for, in order: never
 * wider than 88% of the window, never taller than the room left inside 80%
 * of it, and never, ever scaled past 1. Blowing a 400px frame up to fill a
 * 5K display would be inventing detail that is not in the file.
 */
function fit() {
  if (!cur || !real.w || !real.h) return;
  const card = $("#preview .preview-card");
  const stage = $("#preview .preview-stage");

  stage.style.width = "";
  stage.style.height = "";
  const chrome = Math.max(0, card.offsetHeight - stage.offsetHeight);

  const capW = innerWidth * 0.88;
  const capH = innerHeight * 0.8;
  const room = Math.max(160, capH - chrome);
  const scale = Math.min(1, capW / real.w, room / real.h);

  stage.style.width = `${Math.round(real.w * scale)}px`;
  stage.style.height = `${Math.round(real.h * scale)}px`;

  /* what fit means changed, so a held zoom has to be re-laid on top of the
     new measurement. the hold itself does not move: that is the point. */
  fitScale = scale;
  apply();
  /* the strip is as wide as the stage this just sized, so what fits in it is
     only knowable now. on the first open of a frame this runs after the
     picture has loaded and the card has stopped being its minimum width. */
  trim($("#preview .preview-facts"));
}
addEventListener("resize", fit);

/**
 * Everything under the picture is something you cannot see by looking at it:
 * what it was tagged, where it came from, how big it really is, how long it
 * runs, and where it lives. The path is selectable in one go because half
 * the reason anyone opens this is to paste that path somewhere else.
 */
function meta(item) {
  const host = $("#preview .preview-meta");
  const code = S.tags[item.id]?.tag;
  /* The pixels come before the folder, and that order is the whole point of
     this line. The folder is the half that can afford to be eaten on a narrow
     card, because it is spelled out again in the path underneath. The
     resolution is not written anywhere else on this card and it is the number
     the decision hangs on, whether this frame can be a 2400px banner. The
     running time rides ahead of the folder for the same reason.
     
     ONE ELEMENT PER FACT, AND IT USED TO BE ONE STRING. Ellipsis truncates
     the tail of whatever box it is on, and on one joined string that box
     holds all four facts. So a portrait frame, whose card is as narrow as
     cards get, ate its way back past the folder and into the number: 800x1200
     was drawn as 800x120, which is not a shortened number, it is a different
     one, and it looks entirely plausible. A truncation that produces a
     believable lie is worse than no room at all.
     
     Split, only the folder can shrink and the number is never touched. The
     stylesheet holds that side of it, next to .preview-facts. */
  const facts = document.createElement("p");
  facts.className = "dim preview-facts";

  /**
   * WHAT GETS GIVEN UP FIRST WHEN THE ROW IS TOO NARROW, SAID HERE.
   *
   * The order these are added is the reading order, left to right. The number
   * on `give` is the order they are surrendered in, highest first, and the two
   * orders are deliberately not the same. Reading order is what makes a
   * sentence. Surrender order is about what is written down anywhere else:
   *
   *   the folder   goes first, it is spelled out in full in the path below
   *   the runtime  next, a rough figure the clip itself carries anyway
   *   the tag      next, the wall shows it and the chips above count it
   *   kept         next to last, because k is a toggle: somebody who gets no
   *                answer presses it again and turns off the thing they just
   *                turned on. a confirmation is worth more than a label.
   *   the pixels   never. this card is the only place they appear, and they
   *                are the number the decision hangs on: whether this frame
   *                can be a 2400px banner. It is the last thing standing.
   */
  const bit = (text, give, cls) => {
    if (!text) return;
    const el = document.createElement("span");
    if (cls) el.className = cls;
    el.dataset.give = give;
    el.textContent = text;
    facts.append(el);
  };

  /* kept, first, because it is the one fact on this card that the person
     just caused. pressing k wrote it and this card said nothing back, so the
     only confirmation was going back to the wall to look. a state you can set
     from a screen has to be readable on that screen. */
  if (S.tags[item.id]?.star) {
    const kept = document.createElement("strong");
    kept.dataset.give = "1";
    kept.textContent = "kept";
    facts.append(kept);
  }
  bit(code && S.vocab[code], 2);
  bit(item.w ? `${item.w}x${item.h}` : null, 0);
  bit(item.clock, 4);
  bit(item.place, 5, "where");

  const where = document.createElement("code");
  where.textContent = item.path;

  const finder = document.createElement("button");
  finder.className = "chip";
  finder.type = "button";
  finder.textContent = `reveal in ${files()}`;
  finder.onclick = () => reveal(item);

  const keep = document.createElement("button");
  keep.className = "chip";
  keep.type = "button";
  keep.textContent = inTray(item.id) ? "remove from tray" : "add to tray";
  keep.onclick = async () => {
    await trayToggle(item.id);
    keep.textContent = inTray(item.id) ? "remove from tray" : "add to tray";
  };

  /* the held zoom, spoken in the chrome rather than drawn on the picture,
     because the one rule of the stage is that nothing sits on the pixels. */
  const zoom = document.createElement("span");
  zoom.className = "label num preview-zoom";
  zoom.hidden = true;

  /* Nothing on this card says the arrows walk a set, so the position does.
     The set is the one the shelf is filtered down to, because that is what
     left and right actually move through, and saying "of 203" while a filter
     is on would be counting a pile that is not under the cursor.

     A frame opened out of the tray can sit outside that set entirely, and
     then there is no honest number to print, so nothing is printed. An
     invented "1 of 203" would be worse than a gap. */
  const list = filtered();
  const at = list.findIndex((i) => i.id === item.id);
  const pos = [];
  if (at >= 0) {
    const count = document.createElement("span");
    count.className = "label num";
    count.textContent = `${at + 1} of ${list.length}`;
    pos.push(count);
  }

  host.replaceChildren(zoom, ...pos, facts, where, finder, keep);
  trim(facts);
  paintZoom();
}

/**
 * DROP THE FACTS THAT DO NOT FIT, RATHER THAN DRAW HALF OF ONE.
 *
 * This strip is as wide as the photograph above it, by the card's design, and
 * a portrait frame leaves it about 170 pixels once the two buttons have taken
 * their half. Four facts want more than that. Before this, the row was one
 * string with an ellipsis, so the overflow ate backwards from the tail and
 * stopped wherever it ran out of room: on a portrait frame that was inside
 * the resolution, and 800x1200 was drawn as 800x120. A shortened word is
 * still the word. A shortened number is a different number, it is a plausible
 * one, and it sits exactly where somebody is deciding whether this frame can
 * be a 2400px banner.
 *
 * So one whole fact is removed at a time until the row fits, and which one
 * goes is the data-give order set where the facts are built, not the order
 * they are drawn in. Dropping the rightmost would drop the resolution before
 * the tag, and the tag is on the wall behind this card while the resolution
 * is on nothing.
 *
 * It cannot wrap instead. The card contract in the stylesheet requires this
 * strip to be the same height on every frame, or the card resizes as you
 * arrow along a row and the stage measurement above reads a number that has
 * stopped being true.
 */
function trim(facts) {
  if (!facts) return;
  /* Every fact is put back before any is taken away, because this runs again
     on every relayout and a window being widened has to give back what being
     narrowed took. Trimming a list that had already been trimmed would only
     ever shrink, so a card that got bigger would stay as terse as the
     smallest it had ever been. */
  const all = facts._all ?? (facts._all = [...facts.children]);
  if (facts.children.length !== all.length) facts.replaceChildren(...all);
  /* Re-measured after each removal rather than subtracted from one reading,
     because taking the last fact away also takes its separator with it: the
     dot is drawn on every child but the last, so each removal frees a little
     more than the fact itself was worth. Predicting that arithmetic costs one
     fact too many. It is at most four measurements, once, on opening a
     picture that is about to decode several megabytes. */
  for (let i = 0; i < 6; i++) {
    if (facts.scrollWidth <= facts.clientWidth) return;
    /* the most expendable one still standing, which is rarely the last */
    let go = null;
    for (const el of facts.children) {
      if (go === null || Number(el.dataset.give ?? 0) > Number(go.dataset.give ?? 0)) go = el;
    }
    /* never leave the strip empty: one fact drawn whole beats none */
    if (!go || facts.children.length === 1) return;
    go.remove();
  }
}

export function close() {
  if (!cur) return;
  cur = null;
  /* the idle timer dies with the card, or a card opened within the next
     second and a half would inherit a fade it did not earn. */
  clearTimeout(idleTimer);
  /* the hold dies too: stickiness is for the pass being made, and a card
     reopened tomorrow zoomed into last week's corner would be a haunting. */
  hold = null;
  const host = $("#preview");
  host.classList.remove("deep", "idle");
  host.hidden = true;
  /* emptying the stage is what stops a clip that is still playing. hiding
     the card would leave the audio running behind the shelf. */
  $("#preview .preview-stage").replaceChildren();
}

/**
 * Re-run the meta line for the frame on screen. The shelf calls this after a
 * keystroke tags or keeps the previewed frame, because the card is the thing
 * being looked at and a tag that only shows up in the chips behind it is a
 * keystroke with no visible answer on the one surface that has your eyes.
 */
export function sync() {
  if (cur) meta(cur);
}

/**
 * The frame on screen has just left the run: set aside, put back, or off the
 * drive entirely. The card walks to the nearest survivor rather than going
 * dark, because the hand on the keyboard is in the middle of a pass and a
 * card that closes itself ends the pass to make you reopen it. Forward
 * first, the direction a cull moves, then backward, and only when nothing in
 * the run survives does the card close. The shelf repaints itself after the
 * same mutation, so this touches nothing but the card: a repaint from in
 * here would paint a grid the shelf is about to paint again.
 */
export function evict(ids) {
  if (!cur) return;
  const gone = new Set(ids);
  if (!gone.has(cur.id)) return;
  const list = walk();
  const at = list.findIndex((i) => i.id === cur.id);
  let next = null;
  for (let i = at + 1; i < list.length; i++) {
    if (!gone.has(list[i].id)) { next = list[i]; break; }
  }
  if (!next) {
    for (let i = at - 1; i >= 0; i--) {
      if (!gone.has(list[i].id)) { next = list[i]; break; }
    }
  }
  if (next) open(next, walk);
  else close();
}

/**
 * Left and right walk whatever the card was opened from, not the whole
 * archive, because that run is the question you are asking and arrowing out
 * of it would answer a different one.
 *
 * The shelf cursor only comes along when the shelf is what is being walked,
 * so closing the preview leaves you standing on the frame you were last
 * looking at rather than back where you started. Walking a tray leaves the
 * shelf exactly where you left it: you are checking a pile you already made,
 * and coming back to a grid that has moved underneath you, carrying a
 * selection you did not make, is not what checking it should cost.
 */
function step(dir) {
  const list = walk();
  const at = list.findIndex((i) => i.id === cur.id);
  const next = list[at + dir];
  if (!next) return;
  if (walk === filtered) focus(next.id);
  open(next, walk);
}

export function mountPreview() {
  /* Clicking the backdrop closes and clicking the card does not, which is
     the whole reason the card is a separate element. Without the closest()
     test, selecting the path would dismiss the thing you were reading. */
  $("#preview").onclick = (e) => { if (!e.target.closest(".preview-card")) close(); };

  /* There is no close button to wire up, and that is deliberate. It was the
     only piece of chrome in this app sitting on top of a photograph, and it
     was buying a third way out of a card that already had two: escape, and
     the blurred page around it, which wears a zoom-out cursor to say so.
     Nothing looks it up here, so its absence from the markup cannot throw on
     mount and take the arrow keys down with it. */

  /* the stage is a permanent element that pictures pass through, so the
     zoom gestures wire to it once instead of to every picture. */
  const stage = $("#preview .preview-stage");

  stage.addEventListener("wheel", (e) => {
    if (!cur) return;
    const media = stage.firstElementChild;
    if (!media || media.tagName !== "IMG") return;
    /* the wheel belongs to the zoom while the pointer is on the picture,
       and letting it also scroll the page would be two answers to one
       gesture. */
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    const at = hold ? hold.scale : fitScale;
    /* exponential, because zoom is a ratio: the same flick should feel the
       same size at 120% as at 400%, and a linear step does not. */
    zoomTo(at * Math.exp(-e.deltaY * 0.0022), cx, cy);
  }, { passive: false });

  stage.addEventListener("dblclick", (e) => {
    if (!cur) return;
    const media = stage.firstElementChild;
    if (!media || media.tagName !== "IMG") return;
    const r = stage.getBoundingClientRect();
    snap(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });

  /* drag pans while a zoom is held. pointer capture keeps the pan alive
     when a fast hand outruns the stage, which on a small crop of a big
     frame is every drag. */
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!cur || !hold) return;
    const media = stage.firstElementChild;
    if (!media || media.tagName !== "IMG") return;
    drag = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    media.style.cursor = "grabbing";
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || !hold) return;
    hold.panX += e.clientX - drag.x;
    hold.panY += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    apply();
  });
  const lift = () => {
    if (!drag) return;
    drag = null;
    /* apply puts the open hand back on the cursor */
    apply();
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);

  /* anything the hand does wakes the chrome back up. keydown listens on
     capture so the furniture returns even when the key itself is spent by
     a layer above the card. */
  addEventListener("pointermove", stir, { passive: true });
  addEventListener("pointerdown", stir, { passive: true });
  addEventListener("wheel", stir, { passive: true });
  addEventListener("keydown", stir, true);

  addEventListener("keydown", (e) => {
    if (!cur) return;
    /* a layer above this card can spend the keystroke first, the folder
       panel's escape does, and it marks the event when it has. answering
       it again here would close the card the person could not even see
       under the panel they were dismissing. */
    if (e.defaultPrevented) return;
    if (e.key === "Escape") { close(); return e.preventDefault(); }
    if (e.target instanceof Element && e.target.matches("input, select, textarea")) return;
    /* z toggles fit and one to one, unless the vocab has claimed the
       letter: a tagging key beats a viewing key, because tagging is what
       the card is for. the shelf will have spent it as a tag by the time
       this runs, and answering it twice would zoom under a tag. */
    if ((e.key === "z" || e.key === "Z") && !S.vocab.Z
        && !e.metaKey && !e.ctrlKey && !e.altKey) {
      snap();
      return e.preventDefault();
    }
    if (e.key === "ArrowRight") { step(1); return e.preventDefault(); }
    if (e.key === "ArrowLeft") { step(-1); return e.preventDefault(); }
  });
}
