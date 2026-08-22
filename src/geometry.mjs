/**
 * The crop model. The only part of keeper that has to be exactly right,
 * because what the bench draws and what the exporter cuts are the same
 * rectangle, computed here once and used two ways.
 *
 * Runs unchanged in node and in the browser: no imports, no globals. The
 * server hands this file straight to the page.
 *
 * A PLACEMENT IS STORED IN THE NEGATIVE'S OWN COORDINATES, NOT THE SCREEN'S.
 * Three numbers, all fractions of the source file:
 *
 *   cx, cy  the centre of the crop, 0..1 across and down the source
 *   cw      the width of the crop as a fraction of the source width
 *
 * The height is not stored. It falls out of the slot's aspect ratio at the
 * moment of painting. That is the whole reason for storing it this way: a
 * layout can change a frame's aspect at a breakpoint, and a placement
 * written in screen pixels would quietly mean something different on a
 * phone. In source coordinates "the middle of the table, this wide" survives
 * every viewport, and what survives above and below is the layout's business
 * rather than the photograph's.
 */

/** @typedef {{cx:number, cy:number, cw:number}} Placement */
/** @typedef {{x:number, y:number, w:number, h:number}} CropRect */

export const CENTERED = { cx: 0.5, cy: 0.5, cw: 1 };

/** the smallest crop allowed, as a fraction of source width */
export const MIN_CW = 0.04;

/**
 * The widest crop of `aspect` that still fits inside the source. This is
 * cover: what a browser does with object-fit: cover and no object-position.
 * Zooming out past it would show ground through the frame, so it is the hard
 * upper bound on cw.
 */
export function coverWidth(nw, nh, aspect) {
  return Math.min(1, (nh * aspect) / nw);
}

/** the crop in source pixels, clamped so it can never leave the negative */
export function resolve(place, nw, nh, aspect) {
  const max = coverWidth(nw, nh, aspect);
  const cw = Math.min(Math.max(place.cw, MIN_CW), max);
  const w = cw * nw;
  const h = w / aspect;
  const hx = cw / 2;
  const hy = h / nh / 2;
  const cx = Math.min(Math.max(place.cx, hx), 1 - hx);
  const cy = Math.min(Math.max(place.cy, hy), 1 - hy);
  return { x: (cx - hx) * nw, y: (cy - hy) * nh, w, h };
}

/**
 * The placement with the crop pushed back inside the negative. Stored rather
 * than only applied at paint time, and the difference is felt in the hand:
 * `resolve` clamps too, but if the unclamped value is what gets kept then
 * dragging 400px past the left edge and back leaves 400px of travel that
 * moves nothing, and the picture feels stuck.
 */
export function clamp(place, nw, nh, aspect) {
  const max = coverWidth(nw, nh, aspect);
  const cw = Math.min(Math.max(place.cw, MIN_CW), max);
  const hx = cw / 2;
  const hy = (cw * nw) / aspect / nh / 2;
  return {
    cw,
    cx: Math.min(Math.max(place.cx, hx), 1 - hx),
    cy: Math.min(Math.max(place.cy, hy), 1 - hy),
  };
}

/**
 * The same rectangle said the way CSS can already say it. Only honest when
 * the crop is at cover, because object-position moves a picture and cannot
 * cut into one. Above cover the cut has to be baked into the file, which is
 * what `keeper export` does.
 */
export function toObjectPosition(rect, nw, nh) {
  const r = (n) => Math.round(n * 10) / 10;
  const px = nw - rect.w > 0.5 ? (rect.x / (nw - rect.w)) * 100 : 50;
  const py = nh - rect.h > 0.5 ? (rect.y / (nh - rect.h)) * 100 : 50;
  return `${r(px)}% ${r(py)}%`;
}

export function isAtCover(place, nw, nh, aspect) {
  return place.cw >= coverWidth(nw, nh, aspect) - 0.002;
}

/** "16/9", "16:9", "1.777" and 1.777 all mean the same thing */
export function parseAspect(v) {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d*\.?\d+)\s*[/:]\s*(\d*\.?\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(s);
  if (isFinite(n) && n > 0) return n;
  throw new Error(`cannot read aspect ratio: ${JSON.stringify(v)}`);
}
