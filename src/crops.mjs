import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolve as resolveCrop, isAtCover, toObjectPosition } from "./geometry.mjs";
import { exportCrop } from "./thumbs.mjs";
import { readIndex, readPlacements } from "./store.mjs";

/**
 * The float rectangle geometry hands back, as a box of whole pixels that is
 * inside the negative.
 *
 * Rounding x, y, w and h one at a time is what the export used to do and it
 * is off by one whenever two halves round the same way: a hero at 16/9 on a
 * 6240x4160 frame resolves to y 2229.5 plus h 1930.5, which is exactly 4160,
 * and rounds to 2230 plus 1931, which is 4161. sharp refuses that with
 * "extract_area: bad extract area" and the whole export dies for the sake of
 * one pixel that was never in the crop.
 *
 * The origin rounds first and the size takes what is left, so the box can
 * only ever lose that pixel, never invent one.
 */
function pixels(rect, w, h) {
  const left = Math.min(Math.max(0, Math.round(rect.x)), w - 1);
  const top = Math.min(Math.max(0, Math.round(rect.y)), h - 1);
  return {
    x: left,
    y: top,
    w: Math.min(Math.max(1, Math.round(rect.w)), w - left),
    h: Math.min(Math.max(1, Math.round(rect.h)), h - top),
  };
}

/**
 * Cut every placed slot out of its negative and write it, with the numbers
 * that produced it beside each one.
 *
 * This used to live inside the `export` command. The bench has a button now,
 * and two copies of it would be two chances for the crop the browser drew and
 * the crop the terminal wrote to stop being the same file, which is the kind
 * of drift a client finds before anyone here does.
 *
 * Nothing throws for a slot whose frame has left the index. One dead
 * placement out of nineteen must not cost the other eighteen their export, so
 * it comes back in the rows marked `lost` and the caller says so in its own
 * words.
 *
 * The rows keep config order rather than being split into good and bad,
 * because a terminal reading them top to bottom should see the same sequence
 * as the bench.
 */
export async function exportCrops({ root, config }) {
  const [index, placements] = await Promise.all([readIndex(root), readPlacements(root)]);
  // resolved against the working directory, which is also where loadConfig
  // looked, so `out` in a config means what a person typing it would expect
  const dir = path.resolve(config.out ?? "keepers-out");
  const byId = new Map((index?.items ?? []).map((i) => [i.id, i]));
  const rows = [];

  for (const slot of config.slots) {
    const p = placements[slot.id];
    if (!p) continue;
    const item = byId.get(p.id);
    if (!item) { rows.push({ slot: slot.id, lost: true }); continue; }

    const rect = resolveCrop(p.place, item.w, item.h, slot.aspect);
    const box = pixels(rect, item.w, item.h);
    const into = path.join(dir, slot.id);
    await mkdir(into, { recursive: true });
    const dst = path.join(into, `${slot.id}${path.extname(item.path).toLowerCase()}`);

    /* One slot at a time, because a decoder that gives up on one negative
       must not cost the other eighteen their crops. The message goes back
       whole: it is the only thing anyone has to go on, and the frame it
       names is the one to look at. */
    try {
      await exportCrop(path.join(root, item.path), dst, box, slot.width);
    } catch (e) {
      rows.push({ slot: slot.id, source: item.path, failed: String(e.message).toLowerCase() });
      continue;
    }

    // the numbers that made the file, next to the file. a crop nobody can
    // reproduce six months later is a crop that has to be eyeballed again.
    await writeFile(path.join(into, "placement.json"), JSON.stringify({
      slot: slot.id,
      source: item.path,
      sourceSize: { w: item.w, h: item.h },
      aspect: slot.aspectText,
      crop: box,
      atCover: isAtCover(p.place, item.w, item.h, slot.aspect),
      objectPosition: toObjectPosition(rect, item.w, item.h),
      place: p.place,
    }, null, 2));

    rows.push({
      slot: slot.id,
      source: item.path,
      file: dst,
      soft: !!(slot.width && box.w < slot.width),
    });
  }

  // The denominator used to be every slot, which stopped meaning anything the
  // moment fourteen standard shapes joined the list: nobody fills a pinterest
  // crop and a skyscraper on the same afternoon, and "3 of 19" reads as
  // failure. What is worth counting is your own holes.
  const mine = config.slots.filter((s) => s.group === "yours");
  return {
    dir,
    rows,
    written: rows.filter((r) => r.file).length,
    soft: rows.filter((r) => r.soft).length,
    lost: rows.filter((r) => r.lost).length,
    failed: rows.filter((r) => r.failed).length,
    mine: mine.length,
    empty: mine.filter((s) => !placements[s.id]).length,
  };
}
