import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { needsProxy } from "./scan.mjs";
import { paths } from "./store.mjs";

/**
 * Camera raw, and the two other formats sharp cannot open, turned into one
 * file the rest of keepers already can.
 *
 * sharp is the decoder everywhere else in here and it cannot read an ARW, a
 * CR3 or an NEF at all: libvips ships no raw decoder, so the call throws
 * before a thumbnail, a sheet cell or a crop exists. A bmp and a jxl die the
 * same death for a duller reason. macOS decodes every one of them itself
 * through Image I/O, and `sips` is the front door to that, on a machine this
 * tool already refuses to run anywhere but.
 *
 * So each of those files gets exactly one jpeg proxy, written once into
 * .keepers/proxy and then used by the thumbnail, the contact sheet, the
 * browser and the export. The alternative is decoding a 36MB negative four
 * times, once per stage, every run.
 */

/**
 * WHY 3072 AND NOT THE 7008 THE SENSOR ACTUALLY HOLDS.
 *
 * The widest thing keepers ever writes out is the 2560px letterbox in
 * formats.mjs, and after it the 2400px hero. A proxy has to clear the widest
 * of those with room left over, because a crop that is not the full width of
 * the frame has fewer pixels than the frame does, and the moment the crop is
 * narrower than the slot the exporter is upscaling somebody's photograph and
 * calling it a 2560px file.
 *
 * 3072 clears 2560 by a fifth and costs about 0.9MB a frame, measured on the
 * owner's ILCE-7M4 files. Full size is 4.5MB a frame: across the 1,076 raws
 * on his drive that is the difference between roughly 1GB of cache and
 * roughly 5GB, for pixels no export would ever have used.
 */
export const PROXY_LONG_EDGE = 3072;

/** the same number the contact sheets are written at, so one cache, one look */
const PROXY_QUALITY = 82;

/** a raw that takes this long is a raw that is never coming back */
const SIPS_TIMEOUT_MS = 120_000;

const run = (args) =>
  new Promise((ok, no) => {
    // execFile and never exec: these paths hold spaces, hashes and brackets,
    // and one of the owner's folders is called `2026-06-21 (casino)`. An argv
    // list has no quoting to get wrong and no shell to get through.
    execFile("sips", args, { timeout: SIPS_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (!err) return ok(String(stdout));
      // sips puts its refusals on stderr and its progress on stdout, and the
      // first stderr line is the only one that says anything: the two after
      // it are a numbered code and an advert for --help.
      const said = String(stderr || err.message).split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "sips failed";
      no(new Error(said.replace(/^error:\s*/i, "").toLowerCase()));
    });
  });

/** the source's own pixels, as sips reports them, which is sensor order */
async function measure(srcAbs) {
  const out = await run(["-g", "pixelWidth", "-g", "pixelHeight", srcAbs]);
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  return w && h ? { w, h } : null;
}

export const proxyPath = (root, id) => path.join(paths(root).proxy, `${id}.jpg`);

/**
 * The proxy for one raw, built if it is not already on disk.
 *
 * Cached on the id rather than on the source path, so the file sits beside
 * the thumbnail of the same frame and is found again by the same key the rest
 * of keepers already addresses frames by.
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
   * TWO TRAPS IN `--out`, BOTH SILENT.
   *
   * 1. If the folder above the named file does not exist, sips does not fail
   *    and does not create it. It writes the image AT that path, as a file,
   *    named after the missing folder. So the mkdir above is not tidiness,
   *    it is the difference between .keepers/proxy/<id>.jpg and a file called
   *    .keepers/proxy holding one photograph.
   * 2. If the named path is an existing folder, sips writes into it under the
   *    source's own basename, which would put DSC02478.jpg where <id>.jpg was
   *    asked for.
   *
   * The write goes to a temp name and is then renamed, because eight
   * thumbnail workers run at once and a run killed mid-encode must not leave
   * a half jpeg behind that every later run then trusts.
   */
  const tmp = path.join(dir, `.${id}.${randomBytes(4).toString("hex")}.tmp.jpg`);

  /**
   * `--resampleHeightWidthMax` IS NOT A CAP, whatever the name says. It sets
   * the long edge to that number in both directions: a 1600px flatbed scan
   * comes back at 3072px, six times the pixels and twelve times the bytes,
   * every one of them invented, and the index then reports a resolution the
   * file has never had. Measured, not assumed: 500x333 in, 3072x2046 out.
   *
   * So the source is measured first and the flag is only passed when there
   * is something to lose by keeping it. That is a second sips call, about
   * 100ms, paid once per file for the life of the archive, and it cannot be
   * folded into the first: sips refuses to read properties and write a file
   * in one invocation, by name, with error 6.
   *
   * A source that cannot even be measured still gets the flag. It is about
   * to fail the convert anyway, and the failure is the useful answer.
   */
  const size = await measure(srcAbs).catch(() => null);
  const resample = !size || Math.max(size.w, size.h) > PROXY_LONG_EDGE
    ? ["--resampleHeightWidthMax", String(PROXY_LONG_EDGE)]
    : [];

  try {
    await run([
      "-s", "format", "jpeg",
      "-s", "formatOptions", String(PROXY_QUALITY),
      ...resample,
      "--out", tmp,
      srcAbs,
    ]);
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
 * `sips -g` reports the sensor, which is landscape even on a frame shot
 * upright: the turn lives in the exif orientation tag, which sips neither
 * applies to a raw nor reports for one. `oriented` is the proxy as the index
 * already recorded it, after sharp had applied that tag, so the original is
 * turned the same way whenever that is the way round the two aspects agree.
 * A bmp has no orientation to argue about and falls through untouched.
 */
export async function originalSize(srcAbs, oriented) {
  const size = await measure(srcAbs);
  if (!size) return null;
  const { w, h } = size;
  if (!oriented?.w || !oriented?.h) return size;
  const want = oriented.w / oriented.h;
  const turned = Math.abs(want - w / h) > Math.abs(want - h / w);
  return turned ? { w: h, h: w } : size;
}
