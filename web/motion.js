/* ---------------------------------------------------------------------
   motion.js

   The half of the motion layer that needs to know something css cannot:
   which frames are new since the last paint, where a thumbnail was standing
   when you pressed the key, and how long to hold a tile on screen after it
   has already been taken out of the model.

   Everything in here is decoration in the strict sense: if any of it throws
   or is skipped the app is still correct, only flatter. That is why nothing
   in here is awaited by anything that writes, and why every entry point
   tolerates a missing element rather than guarding at the call site.
   --------------------------------------------------------------------- */

const soft = matchMedia("(prefers-reduced-motion: reduce)");
export const reduced = () => soft.matches;

/** put a class on, take it off when its animation ends, never stack two */
function once(el, cls, ms) {
  if (!el || reduced()) return;
  el.classList.remove(cls);
  /* reading a layout value is what restarts a css animation that is already
     running. without it a second tag on the same frame inside a third of a
     second does nothing at all, which is precisely the run this is for. */
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** a tag or a keep landing on a frame */
export const hit = (el) => once(el, "hit", 360);

/** the app declining to do something */
export const nope = (el) => once(el, "nope", 320);

/**
 * Past this many tiles nothing on the wall animates at all.
 *
 * Not a taste call. Every animating tile is a composited layer, and this app
 * routinely draws two and a half thousand of them at once. The honest
 * version of "we cannot animate that many" is no animation, not a slow one.
 */
const WALL = 900;

/**
 * How much of the wall has to change before it counts as a different wall.
 *
 * This is the number that separates the two things that both look like a
 * repaint from in here. Tagging a frame rebuilds every tile in the grid and
 * changes the set of frames on it by nothing, and the wall must not flinch:
 * a run is a keystroke every half second and forty tiles breathing on each
 * one is unusable. Turning a filter on replaces the wall wholesale, and
 * there the whole point is that it deals itself out again.
 *
 * In between sits binning a frame, which takes one tile out of a hundred and
 * forty. That is a change to the wall, not a new one, so only what actually
 * arrived is animated and everything else stays exactly where it was.
 */
const NEW_WALL = 0.4;

/**
 * How many tiles get a staggered entrance.
 *
 * The stagger is what makes a wall arriving read as a deck being dealt
 * rather than a page loading, and it is the one thing here that scales with
 * the size of the archive. At 14ms a step, nine hundred frames would finish
 * arriving thirteen seconds after the filter changed. So the step index is
 * capped and everything past the cap lands on the last beat, which nobody
 * sees: those tiles are below the fold.
 */
const STAGGER = 26;

/**
 * Deal the tiles in, or do not, depending on what just happened to the wall.
 *
 * Called with the ids the shelf is about to draw and the ids it drew last
 * time. It cannot read any of this off the dom: the shelf rebuilds every
 * tile on every render, so to the dom every tile is new and to the person
 * looking at the screen almost none of them are.
 */
export function fresh(grid, ids, before) {
  if (!grid || reduced() || ids.length > WALL) return;

  const now = new Set(ids.map((i) => i.id ?? i));
  let added = 0;
  for (const id of now) if (!before.has(id)) added++;
  let gone = 0;
  for (const id of before) if (!now.has(id)) gone++;
  if (!added && !gone) return;

  const churn = (added + gone) / Math.max(before.size, now.size, 1);
  const all = churn > NEW_WALL;

  let n = 0;
  for (const el of grid.children) {
    if (!all && before.has(el.dataset.id)) continue;
    el.dataset.fresh = "";
    el.style.setProperty("--i", String(Math.min(n++, STAGGER)));
  }
}

/**
 * Hold a set of tiles on screen while they shrink away, then do the thing
 * that removes them for real.
 *
 * This is the one place the app deliberately lies for a fifth of a second:
 * the frames are already binned in the model when this runs. Without it a
 * frame you set aside vanishes between two rendered frames and the only
 * evidence anything happened is a number changing in the corner.
 */
export function leave(els, then) {
  const live = [...els].filter(Boolean);
  if (!live.length || reduced()) return then();
  for (const el of live) el.classList.add("going");
  setTimeout(then, 200);
}

/** the section that just became the visible one */
export function viewIn(el) {
  if (!el || reduced()) return;
  el.dataset.in = "";
  setTimeout(() => delete el.dataset.in, 300);
}

/**
 * The frame flies to the tray.
 *
 * A frame added by a keystroke or a corner button has no travel: the marker
 * appears on the tile and a number changes on the far side of the window,
 * and nothing connects the two. This draws the line. It is a clone, fixed
 * over the original, animated with the web animations api rather than a
 * class, because both ends of the path are measured at the moment the key
 * is pressed and no stylesheet can know them.
 *
 * It never blocks and never reports. If the source tile is offscreen or the
 * tray is shut there is nothing to draw a line between, so it does nothing.
 */
export function flyToTray(id) {
  if (reduced()) return;
  const from = document.querySelector(`#grid figure[data-id="${CSS.escape(id)}"] img`)
    ?? document.querySelector(".preview-stage img");
  if (!from) return;

  const tray = document.querySelector("#tray");
  if (!tray || tray.hidden) return;
  const dest = document.querySelector("#tray-grid");
  if (!dest) return;

  const a = from.getBoundingClientRect();
  const b = dest.getBoundingClientRect();
  if (!a.width || !a.height) return;
  /* a tile scrolled out of the visible part of the wall has a rectangle and
     no business throwing a copy of itself across a window nobody is looking
     at that part of. */
  if (a.bottom < 0 || a.top > innerHeight) return;

  const fly = new Image();
  fly.src = from.currentSrc || from.src;
  fly.className = "flier";
  fly.style.left = `${a.left}px`;
  fly.style.top = `${a.top}px`;
  fly.style.width = `${a.width}px`;
  fly.style.height = `${a.height}px`;
  document.body.append(fly);

  /* the landing is the top of the tray grid rather than the slot the tile
     will actually occupy, because that slot does not exist yet: the panel
     repaints after the write, and waiting for it would put the throw after
     the arrival. */
  const size = Math.min(b.width * .42, 96);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + 28 - (a.top + a.height / 2);
  const end = size / Math.max(a.width, 1);

  const anim = fly.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    /* the lift. a straight line between two points on a screen reads as a
       cut, and an arc reads as a throw. it is the same distance either way
       and only one of them looks like a hand did it. */
    { transform: `translate(${dx * .55}px, ${dy * .5 - 46}px) scale(${(1 + end) / 2})`,
      opacity: .98, offset: .55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0 },
  ], { duration: 460, easing: "cubic-bezier(.42,0,.16,1)", fill: "forwards" });

  anim.finished.catch(() => {}).finally(() => fly.remove());
}
