import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Camera raw, by the mount a person actually owns. Every one of these is a
 * still and gets treated as one everywhere it is counted, sorted, tagged or
 * placed, but none of them can be handed to sharp: libvips carries no raw
 * decoder, so `sharp(file)` throws on an ARW before a thumbnail exists. They
 * are named apart here so the pipeline can send them through raw.mjs, which
 * has macOS decode them once into a jpeg proxy.
 *
 * `.dng` sits in this set although sharp will sometimes get a preview out of
 * one: sometimes is not a rule, a linear dng has no preview to find, and one
 * decoder for every mount is one thing to reason about.
 */
export const RAW_EXT = new Set([
  ".arw", ".srf", ".sr2",    // sony, all three of them, the older two included
  ".cr2", ".cr3",            // canon
  ".nef",                    // nikon
  ".raf",                    // fuji
  ".orf",                    // olympus
  ".rw2",                    // panasonic
  ".srw",                    // samsung
  ".pef",                    // pentax
  ".dng",                    // adobe, and what a drone or an iphone writes
]);

/**
 * The stills that have to go through the proxy, which is not the same set as
 * the raw ones and is the set that actually matters to the pipeline.
 *
 * `sharp.format` on the build shipped in node_modules reads exactly eight
 * things: gif, heif, jpeg, png, svg, tiff, webp and vips. Anything outside
 * that and inside what `sips --formats` says Image I/O reads is a still
 * keepers can show and sharp cannot open, so it gets the same jpeg proxy a
 * raw does. bmp and jxl are here for that reason alone. heif covers heic and
 * avif both, which is why neither of those needs one.
 *
 * Checked with sips and with sharp rather than remembered: sharp swallows a
 * bmp with "input file contains unsupported image format", which is one
 * unreadable frame per file and no clue in it about why.
 */
export const PROXY_EXT = new Set([
  ...RAW_EXT,
  ".bmp",
  ".jxl",
]);

export const needsProxy = (ext) => PROXY_EXT.has(ext);

/**
 * Everything keepers is willing to look at. The raw formats are in the same
 * set as the jpegs on purpose: a frame is a frame to the shelf, to the sheets
 * and to the bench, and the only place the difference shows is which file the
 * decoder is pointed at.
 *
 * Every extension here was put to `sips --formats` before it was written
 * down, which is a shorter list than the one memory offers. What macOS also
 * reads and this deliberately leaves out: psd, exr, tga, ico, pdf, svg, jp2
 * and the raws off cameras nobody in this house owns. An archive of
 * photographs is not a folder of graphics, and a scan that thumbnails every
 * icon in a design folder has made the shelf worse, not fuller. They are one
 * line each on the day somebody needs them.
 */
export const STILL_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff",
  ".heic", ".heif", ".gif",
  ...PROXY_EXT,
]);

/**
 * Film sits in the same archive as the stills and gets judged in the same
 * pass, so it is scanned the same way. `.mov` first because this is a mac
 * and that is what the camera and the phone both write.
 *
 * The second row is what the rest of a real drive turns out to hold: a phone
 * that predates hevc, a dvd rip, a screen recording off a windows machine, a
 * clip somebody downloaded in 2011, an ogg from a linux box, a broadcast
 * master, and the two halves of a 360 camera's output.
 *
 * NOT `.braw` AND NOT `.r3d`, ON PURPOSE. ffmpeg decodes neither without a
 * proprietary sdk that is not on this machine and cannot be brew installed,
 * so listing them would put clips in the index that can never get a poster:
 * a row of dead cells that look like a bug in keepers rather than a missing
 * decoder.
 */
export const FILM_EXT = new Set([
  ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mts", ".m2ts", ".webm",
  ".3gp", ".mpg", ".mpeg", ".wmv", ".flv", ".ogv", ".mxf", ".insv",
]);

/**
 * The extension decides, and it is allowed to be wrong.
 *
 * A .mov holding one frame exists and so does an animated .gif, and there is
 * no cheap way to tell from the name. Opening every file to find out would
 * turn a scan of ten thousand into a decode of ten thousand, and the cost of
 * guessing wrong is one odd looking cell on a contact sheet. The cost of
 * being clever here is a scan that takes twenty minutes.
 */
export const kindOf = (ext) =>
  STILL_EXT.has(ext) ? "still" : FILM_EXT.has(ext) ? "film" : null;

/** skipped wherever they appear, at any depth */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".keepers", ".Trashes", ".Spotlight-V100",
  ".fseventsd", "__MACOSX", ".DS_Store",
]);

/**
 * Walks a folder and returns every still under it, sorted by path so the
 * order is the same on every machine and every run. That stability is not
 * cosmetic: cell ids are derived from position, and an id that moves between
 * runs would silently repoint every tag written against it.
 */
export async function scan(root, { onProgress } = {}) {
  const out = [];
  let seen = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory, e.g. a permissions-locked system folder
    }
    for (const e of entries) {
      if (e.name.startsWith("._")) continue; // apple resource fork sidecars
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const kind = kindOf(path.extname(e.name).toLowerCase());
        if (!kind) continue;
        const s = await stat(full).catch(() => null);
        if (!s || s.size < 1024) continue; // a sub-1KB "image" is not one
        out.push({ path: path.relative(root, full), bytes: s.size, kind });
        if (++seen % 250 === 0) onProgress?.(seen);
      }
    }
  }

  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
