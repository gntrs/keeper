import { createRequire } from "node:module";
import { mkdir, open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { haveFfmpeg, poster, probe } from "./film.mjs";
import { alive } from "./lock.mjs";
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
  await atomically(dstAbs, (tmp) => sharp(srcAbs)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(tmp));
}

/**
 * A THUMBNAIL IS EITHER WHOLE OR IT IS NOT THERE, WITH NOTHING IN BETWEEN.
 *
 * Written straight to its final name, a thumbnail is a half file for as long
 * as the encoder is running, and the way out of that state is quitting the
 * app, pulling the drive or filling the disk. What is left is a webp with no
 * end to it, sitting under the name the whole run afterwards checks for. The
 * scan then skips it because a file is there, the browser gets it with a 200
 * and cannot decode it, and the tile is blank for the life of that archive.
 * No rescan repairs it, because every rescan makes the same check and reaches
 * the same wrong answer. Measured, not assumed: one truncated file, a full
 * rescan afterwards, and the tile still black.
 *
 * The temp name sits in the same folder so the rename is a rename and not a
 * copy across a filesystem, and it carries the pid so two keepers thumbnailing
 * the same archive cannot land on each other's half written file.
 */
async function atomically(dstAbs, write) {
  const tmp = `${dstAbs}.${process.pid}.part`;
  try {
    await write(tmp);
    await rename(tmp, dstAbs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * Whether what is on disk under that name is a whole thumbnail.
 *
 * Existence is not the question. The question is whether a browser will get a
 * picture out of it, and a webp answers that itself: the four bytes after
 * RIFF are the length of everything that follows them, so a file shorter than
 * that is a file that was cut off, wherever the cut landed. Twelve bytes and
 * a stat, which the open was going to cost anyway.
 *
 * A header check alone was not enough, and the reason is the sentence the
 * tile now prints. It tells the person to rescan, and a rescan that skipped
 * every truncation past the twelfth byte would have been advice that does
 * nothing. Measured: a thumbnail cut to twenty bytes survived a full rescan
 * under the header check and is rebuilt under this one.
 *
 * Longer than the header says is not a truncation and is left alone. RIFF
 * pads its chunks to an even length, so an encoder is allowed to leave a
 * trailing byte, and refusing those would rebuild the whole archive.
 */
async function readable(file) {
  let fh;
  try {
    fh = await open(file, "r");
    const head = Buffer.alloc(12);
    const [{ bytesRead }, { size }] = await Promise.all([fh.read(head, 0, 12, 0), fh.stat()]);
    if (bytesRead < 12) return false;
    if (head.toString("latin1", 0, 4) !== "RIFF") return false;
    if (head.toString("latin1", 8, 12) !== "WEBP") return false;
    return size >= head.readUInt32LE(4) + 8;
  } catch {
    return false;
  } finally {
    await fh?.close().catch(() => {});
  }
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
  /* Anything a killed run left behind, and only that.
   *
   * They are named for the pid that wrote them, and the pid is asked whether
   * it is still there. Skipping our own pid alone was not enough: two keepers
   * can reach one archive when the claim file has been deleted by hand or the
   * same folder is mounted twice, and the sweep then pulled the temp files out
   * from under the other one mid encode, which came back as three frames
   * failing with ENOENT on the rename. Measured, and the comment that used to
   * sit here said it could not happen. */
  for (const f of await readdir(thumbDir).catch(() => [])) {
    if (!f.endsWith(".part")) continue;
    const pid = Number(f.split(".").at(-2));
    if (pid === process.pid || alive(pid)) continue;
    await unlink(path.join(thumbDir, f)).catch(() => {});
  }
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
          if (!await readable(dst)) {
            // ffmpeg writes the still, sharp re-encodes it to the same webp
            // every thumbnail in the archive is, so the shelf has one format
            const still = `${dst}.${process.pid}.png.part`;
            await poster(abs, still, { seconds: info.seconds });
            try {
              await atomically(dst, (tmp) => sharp(still).webp({ quality: 72 }).toFile(tmp));
            } finally {
              await unlink(still).catch(() => {});
            }
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
        /* Not "is there a file", but "is there a thumbnail". The difference
           is one archive somebody quit out of mid scan, whose blank tiles no
           amount of rescanning ever brought back. */
        if (!await readable(dst)) await thumbnail(src, dst);
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

/** re-encode one source through a crop rectangle, for `keeper export` */
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
