import { randomBytes } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { host } from "./os/index.mjs";
import { needsProxy } from "./scan.mjs";
import { paths } from "./store.mjs";

/**
 * Camera raw, and the two other formats sharp cannot open, turned into one
 * file the rest of keeper already can.
 *
 * sharp is the decoder everywhere else in here and it cannot read an ARW, a
 * CR3 or an NEF at all: libvips ships no raw decoder, so the call throws
 * before a thumbnail, a sheet cell or a crop exists. A bmp and a jxl die the
 * same death for a duller reason.
 *
 * Which decoder answers instead is the platform's business and lives in
 * os/, because the two machines are not equally equipped here: one of them
 * ships a decoder for all of this and the other ships none.
 *
 * So each of those files gets exactly one jpeg proxy, written once into
 * .keeper/proxy and then used by the thumbnail, the contact sheet, the
 * browser and the export. The alternative is decoding a 36MB negative four
 * times, once per stage, every run.
 */

/**
 * WHY 3072 AND NOT THE 7008 THE SENSOR ACTUALLY HOLDS.
 *
 * The widest thing keeper ever writes out is the 2560px letterbox in
 * formats.mjs, and after it the 2400px hero. A proxy has to clear the widest
 * of those with room left over, because a crop that is not the full width of
 * the frame has fewer pixels than the frame does, and the moment the crop is
 * narrower than the slot the exporter is upscaling somebody's photograph and
 * calling it a 2560px file.
 *
 * 3072 clears 2560 by a fifth and costs about 0.9MB a frame, measured on
 * full frame 33MP files. Full size is 4.5MB a frame, so across a thousand
 * raws that is the difference between roughly 1GB of cache and roughly 5GB,
 * for pixels no export would ever have used.
 */
export const PROXY_LONG_EDGE = 3072;

/** the same number the contact sheets are written at, so one cache, one look */
const PROXY_QUALITY = 82;

/** a raw that takes this long is a raw that is never coming back */
const DECODE_TIMEOUT_MS = 120_000;

export const proxyPath = (root, id) => path.join(paths(root).proxy, `${id}.jpg`);

/**
 * The proxy for one raw, built if it is not already on disk.
 *
 * Cached on the id rather than on the source path, so the file sits beside
 * the thumbnail of the same frame and is found again by the same key the rest
 * of keeper already addresses frames by.
 */
export async function proxyFor(root, id, srcAbs) {
  const dst = proxyPath(root, id);

  // a proxy that is already there is the whole point. size is checked as well
  // as existence because an interrupted write is worse than no write: it
  // would be reused for the life of the archive.
  const found = await stat(dst).catch(() => null);
  if (found?.size > 0) return dst;

  const dir = path.dirname(dst);
  await mkdir(dir, { recursive: true });

  /**
   * The write goes to a temp name and is then renamed, because eight
   * thumbnail workers run at once and a run killed mid-encode must not leave
   * a half jpeg behind that every later run then trusts.
   *
   * The mkdir above is not tidiness either. A decoder handed an out path
   * whose parent does not exist either fails outright or, on the mac, quietly
   * writes the image AT that path: the difference is .keeper/proxy/<id>.jpg
   * against a file called .keeper/proxy holding one photograph.
   */
  const tmp = path.join(dir, `.${id}.${randomBytes(4).toString("hex")}.tmp.jpg`);

  try {
    if (!(await host.canDecode())) throw new Error(host.decodeHint);
    await host.decode(srcAbs, tmp, PROXY_LONG_EDGE, PROXY_QUALITY, DECODE_TIMEOUT_MS);
    await rename(tmp, dst);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw new Error(`raw: ${e.message}`);
  }
  return dst;
}

/**
 * The file a decoder should actually be pointed at for one indexed frame:
 * the proxy if it is raw, the original if it is not.
 *
 * Every caller goes through this rather than testing the extension itself,
 * so there is one answer to "which pixels" and the thumbnail, the sheet, the
 * browser and the export cannot come to different ones.
 */
export async function readableSource(root, item) {
  const abs = path.join(root, item.path);
  if (!needsProxy(path.extname(item.path).toLowerCase())) return abs;
  return proxyFor(root, item.id, abs);
}

/**
 * How big the original really is, for the record written next to an export.
 *
 * A raw decoder reports the sensor, which is landscape even on a frame shot
 * upright: the turn lives in the exif orientation tag, which neither of these
 * two applies to a raw nor reports for one. `oriented` is the proxy as the index
 * already recorded it, after sharp had applied that tag, so the original is
 * turned the same way whenever that is the way round the two aspects agree.
 * A bmp has no orientation to argue about and falls through untouched.
 */
export async function originalSize(srcAbs, oriented) {
  /* Bounded for the same reason the one inside decode is: this runs while an
     export is being written and a wedged sips would hold it open with nothing
     on screen. */
  const size = await host.measure(srcAbs, DECODE_TIMEOUT_MS);
  if (!size) return null;
  const { w, h } = size;
  if (!oriented?.w || !oriented?.h) return size;
  const want = oriented.w / oriented.h;
  const turned = Math.abs(want - w / h) > Math.abs(want - h / w);
  return turned ? { w: h, h: w } : size;
}
