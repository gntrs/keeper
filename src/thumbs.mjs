import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { haveFfmpeg, poster, probe } from "./film.mjs";
import { readableSource } from "./raw.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

export const THUMB_WIDTH = 400;

/**
 * One thumbnail per still, named by its stable id, so the browser can show
 * ten thousand pictures without the drive spinning up once.
 *
 * TWO TRAPS, BOTH PAID FOR IN LOST HOURS:
 *
 * 1. `.rotate()` with no argument applies the EXIF orientation, and it must
 *    come BEFORE the resize or a portrait frame is resized as a landscape one
 *    and then turned. That part is easy to get right by accident.
 *
 * 2. `.rotate()` does NOT change what `.metadata()` reports on the same
 *    pipeline. A phone portrait still reads back as landscape with
 *    `orientation: 6` or `8`, so the width and height have to be swapped by
 *    hand. Get this wrong and every portrait in the archive is filed with its
 *    dimensions inverted, which then puts the crop model on the wrong axis.
 *
 * BOTH TRAPS SURVIVE THE RAW PROXY, which is the answer to the obvious
 * question about it. sips writes the sensor out in sensor order and copies
 * the exif orientation tag across untouched: an upright ARW comes back as a
 * landscape jpeg still tagged `orientation: 8`, exactly like a jpeg straight
 * off the camera. So the proxy goes through this function unchanged and the
 * rotate is as necessary here as it ever was. Skipping it because "sips
 * already handled it" lays every portrait raw on its side.
 */
export async function thumbnail(srcAbs, dstAbs) {
  await sharp(srcAbs)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(dstAbs);
}

export async function dimensions(srcAbs) {
  const m = await sharp(srcAbs).metadata();
  const turned = m.orientation && m.orientation >= 5;
  return {
    w: turned ? m.height : m.width,
    h: turned ? m.width : m.height,
  };
}

/**
 * Thumbnails a whole scan. Resumable by design: an id whose thumbnail is
 * already on disk is skipped, so a run interrupted at frame 1,400 of 1,768
 * costs 368 frames the second time, not 1,768.
 */
export async function buildThumbs(root, items, thumbDir, { onProgress, concurrency = 8 } = {}) {
  await mkdir(thumbDir, { recursive: true });
  const meta = [];
  let done = 0;
  let failed = 0;

  const ff = await haveFfmpeg();
  let filmSkipped = 0;

  const worker = async (queue) => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const abs = path.join(root, item.path);
      const dst = path.join(thumbDir, `${item.id}.webp`);
      try {
        if (item.kind === "film") {
          if (!ff) { filmSkipped++; meta.push({ id: item.id, path: item.path, kind: "film", w: 0, h: 0 }); onProgress?.(++done + failed, item); continue; }
          const info = await probe(abs);
          if (!existsSync(dst)) {
            // ffmpeg writes the still, sharp re-encodes it to the same webp
            // every thumbnail in the archive is, so the shelf has one format
            const tmp = `${dst}.png`;
            await poster(abs, tmp, { seconds: info.seconds });
            await sharp(tmp).webp({ quality: 72 }).toFile(dst);
            await (await import("node:fs/promises")).unlink(tmp).catch(() => {});
          }
          meta.push({ id: item.id, path: item.path, kind: "film", w: info.w, h: info.h, seconds: info.seconds });
          onProgress?.(++done + failed, item);
          continue;
        }
        /* A raw is decoded here and nowhere else in the run: readableSource
           hands back the proxy, building it if this is the first pass, and
           every later stage finds it already on disk. The dimensions come off
           the proxy too, deliberately. They are the ones the browser is
           served, the ones the bench draws its rectangle in and the ones the
           export cuts out of, and an index quoting the 7008px negative while
           every one of those holds 3072px would be a number that reads
           better and lies about what a crop can deliver. */
        const src = await readableSource(root, item);
        if (!existsSync(dst)) await thumbnail(src, dst);
        const d = await dimensions(src);
        meta.push({ id: item.id, path: item.path, kind: "still", w: d.w, h: d.h });
      } catch (e) {
        failed++;
        // kept in the index rather than dropped: a frame that cannot be read
        // is a fact about the archive, and silently losing it would make the
        // counts lie.
        meta.push({ id: item.id, path: item.path, kind: item.kind ?? "still", w: 0, h: 0, error: String(e.message).slice(0, 120) });
      }
      onProgress?.(++done + failed, item);
    }
  };

  const queue = items.slice();
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  meta.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { meta, failed, filmSkipped, ffmpeg: ff };
}

/** re-encode one source through a crop rectangle, for `keepers export` */
export async function exportCrop(srcAbs, dstAbs, rect, targetWidth) {
  const pipeline = sharp(srcAbs).rotate().extract({
    left: Math.round(rect.x),
    top: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.w)),
    height: Math.max(1, Math.round(rect.h)),
  });
  if (targetWidth > 0 && targetWidth < rect.w) {
    pipeline.resize({ width: Math.round(targetWidth) });
  }
  await writeFile(dstAbs, await pipeline.toBuffer());
}
