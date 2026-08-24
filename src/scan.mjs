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
 * keeper can show and sharp cannot open, so it gets the same jpeg proxy a
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
 * Everything keeper is willing to look at. The raw formats are in the same
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
 * a row of dead cells that look like a bug in keeper rather than a missing
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

/**
 * Ignored without comment. These are the droppings of the tools that made the
 * archive, and a scan that announces four hundred .DS_Store files has told
 * you nothing while hiding the one line that mattered.
 */
const QUIET_EXT = new Set([".ini", ".lnk", ".tmp", ".part", ".download"]);

/**
 * The same thing by name rather than by extension, because a dotfile has no
 * extension as far as `path.extname` is concerned: `.DS_Store` comes back as
 * the empty string, and without this the commonest file on a mac drive lands
 * in a bucket called "(no extension)".
 */
/**
 * WHERE A FRAME SITS IN THE ARCHIVE, WRITTEN WITH FORWARD SLASHES ON EVERY
 * MACHINE.
 *
 * This is not cosmetic and it is not about how the path looks in the shelf.
 * A frame's id is a hash of this string, so the separator is part of the id:
 * the same photograph on the same external drive would hash one way plugged
 * into a mac and another way plugged into a windows machine, and every tag,
 * star, tray and placement written on one would point at nothing on the
 * other. One drive carried between two desks is the ordinary way a
 * photographer works, so the two have to agree.
 *
 * Forward slashes are the right side of that argument to land on, because
 * path.join and the whole node fs api accept them on windows, while nothing
 * on a mac accepts a backslash. It also means the path a person reads in the
 * shelf and types into the search box is the same string on both.
 */
const inside = (root, full) => path.relative(root, full).split(path.sep).join("/");

const QUIET_NAMES = new Set([".ds_store", ".localized", "thumbs.db", "desktop.ini", "icon\r"]);

/**
 * Skipped wherever they appear, at any depth, and matched without case.
 *
 * THE TWO WINDOWS ENTRIES ARE NOT TIDINESS. `$RECYCLE.BIN` sits at the root
 * of every windows volume and holds the files somebody has already deleted,
 * so scanning a drive root without skipping it puts every discarded frame
 * back on the shelf as a new photograph, with a new id, after the person
 * went to the trouble of throwing it away. `System Volume Information` is
 * unreadable to a normal account and would only produce a wall of permission
 * errors on the way past.
 *
 * Without case, because these are compared against names off a filesystem
 * that does not care about it: the recycler is usually shouted and is not
 * always, and a folder called `Node_Modules` is the same folder.
 */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".keeper", ".keepers", ".Trashes", ".Spotlight-V100",
  ".fseventsd", "__MACOSX", ".DS_Store",
  "$recycle.bin", "system volume information", "$windows.~ws", "$windows.~bt",
].map((n) => n.toLowerCase()));

/**
 * Walks a folder and returns every still under it, sorted by path so the
 * order is the same on every machine and every run. That stability is not
 * cosmetic: cell ids are derived from position, and an id that moves between
 * runs would silently repoint every tag written against it.
 *
 * It also returns what it walked past, and that half exists because of a real
 * afternoon: a 903GB drive scanned to 2,836 frames and said nothing else, so
 * the eight hundred gigabytes of audio, project files and empty render
 * folders stayed invisible and the question "are my videos on this drive"
 * took an hour of searching to answer no. A scan that only reports what it
 * liked is a scan you cannot trust a negative from.
 */
export async function scan(root, { onProgress } = {}) {
  const out = [];
  const ignored = new Map(); // extension -> { count, bytes }
  const barren = []; // folders holding nothing readable, at any depth
  let seen = 0;

  const note = (ext, bytes) => {
    const at = ignored.get(ext) ?? { count: 0, bytes: 0 };
    at.count += 1;
    at.bytes += bytes;
    ignored.set(ext, at);
  };

  /** returns how many readable frames sit at or under this folder */
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0; // unreadable directory, e.g. a permissions-locked system folder
    }
    let found = 0;
    for (const e of entries) {
      if (e.name.startsWith("._")) continue; // apple resource fork sidecars
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        found += await walk(full);
      } else if (e.isFile()) {
        const base = e.name.toLowerCase();
        const ext = path.extname(base);
        const kind = kindOf(ext);
        const s = await stat(full).catch(() => null);
        if (!kind) {
          // the sidecars a camera and an editor leave everywhere are not a
          // finding, they are furniture. everything else is worth a line.
          if (!QUIET_EXT.has(ext) && !QUIET_NAMES.has(base)) {
            note(ext || "(no extension)", s?.size ?? 0);
          }
          continue;
        }
        if (!s || s.size < 1024) continue; // a sub-1KB "image" is not one
        out.push({ path: inside(root, full), bytes: s.size, kind });
        found += 1;
        if (++seen % 250 === 0) onProgress?.(seen);
      }
    }
    if (!found && dir !== root) barren.push(inside(root, dir));
    return found;
  }

  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // A barren folder inside a barren folder is one fact, not two. Reporting
  // every leaf of an empty tree buries the one line that matters, which is
  // the name of the tree.
  const set = new Set(barren);
  const topmost = barren
    .filter((p) => !set.has(path.dirname(p)))
    .sort((a, b) => (a < b ? -1 : 1));

  return {
    items: out,
    ignored: [...ignored]
      .map(([ext, at]) => ({ ext, ...at }))
      .sort((a, b) => b.count - a.count),
    barren: topmost,
  };
}
