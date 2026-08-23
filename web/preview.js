import { S, reveal } from "/app.js";
import { filtered, focus } from "/shelf.js";
import { toggle as trayToggle, inTray } from "/tray.js";

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

/**
 * This used to be a full screen lightbox and it is not one any more, on
 * purpose. Blacking out the whole window to look at one photograph is a
 * viewer's gesture, not a worker's: it throws away the row of frames you
 * were comparing against, it hides the filter you are working inside, and it
 * makes going back feel like leaving. A card floating over a dimmed page
 * keeps all of that in the corner of your eye while still being unambiguous
 * about what has your attention, which is the whole trick Quick Look pulls.
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
    media.onload = () => size(media.naturalWidth, media.naturalHeight);
  }
  $("#preview .preview-stage").replaceChildren(media);

  meta(item);
  $("#preview").hidden = false;
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
     this line. It is one row that truncates from the tail on a narrow card,
     so whatever sits last is what gets eaten, and the folder is the half that
     can afford it: it is spelled out again in the path underneath. The
     resolution is not written anywhere else on this card and it is the number
     the decision hangs on, whether this frame can be a 2400px banner. The
     running time rides ahead of the folder for the same reason. */
  const line = [
    code && S.vocab[code],
    item.w ? `${item.w}x${item.h}` : null,
    item.clock,
    item.place,
  ].filter(Boolean).join(" · ");

  const facts = document.createElement("p");
  facts.className = "dim";
  facts.textContent = line;

  const where = document.createElement("code");
  where.textContent = item.path;

  const finder = document.createElement("button");
  finder.className = "chip";
  finder.type = "button";
  finder.textContent = "reveal in finder";
  finder.onclick = () => reveal(item);

  const keep = document.createElement("button");
  keep.className = "chip";
  keep.type = "button";
  keep.textContent = inTray(item.id) ? "remove from tray" : "add to tray";
  keep.onclick = async () => {
    await trayToggle(item.id);
    keep.textContent = inTray(item.id) ? "remove from tray" : "add to tray";
  };

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

  host.replaceChildren(...pos, facts, where, finder, keep);
}

export function close() {
  if (!cur) return;
  cur = null;
  $("#preview").hidden = true;
  /* emptying the stage is what stops a clip that is still playing. hiding
     the card would leave the audio running behind the shelf. */
  $("#preview .preview-stage").replaceChildren();
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

  addEventListener("keydown", (e) => {
    if (!cur) return;
    if (e.key === "Escape") { close(); return e.preventDefault(); }
    if (e.target instanceof Element && e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowRight") { step(1); return e.preventDefault(); }
    if (e.key === "ArrowLeft") { step(-1); return e.preventDefault(); }
  });
}
