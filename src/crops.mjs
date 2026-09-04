import { mkdir, open, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { resolve as resolveCrop, isAtCover, toObjectPosition } from "./geometry.mjs";
import { exportCrop } from "./thumbs.mjs";
import { readIndex, readPlacements } from "./store.mjs";
import { needsProxy } from "./scan.mjs";
/* The same two path helpers the tray export already uses, because "is this
   destination inside the archive" has to answer the same way in both places.
   Two copies of that rule is how one of them drifts. */
import { inside, settled } from "./trays.mjs";
import { PROXY_LONG_EDGE, originalSize, readableSource } from "./raw.mjs";

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
/**
 * Where a crop goes when nobody said.
 *
 * It was `keeper-out` in the working directory, which is correct and is not
 * findable. keeper is normally started against a drive from whatever folder
 * the terminal happened to be in, so the crops landed next to the source of
 * keeper itself, and the honest answer to "where did my export go" was a
 * path nobody would have guessed. Downloads is the folder every mac already
 * uses for "a file I just made and am about to do something with", it is one
 * click from the dock, and it is the same place whichever folder keeper was
 * launched from.
 *
 * `"out"` in a keeper.config.json still wins, and is still resolved against
 * the working directory, so a project that wants its crops inside itself
 * says so in one line.
 */
export const DEFAULT_OUT = path.join(homedir(), "Downloads", "keeper");

/**
 * A name nothing is using yet.
 *
 * An export used to write `<slot>/<slot>.jpg` and write over it every time,
 * which meant the second export silently destroyed the first. That is the
 * wrong default for a file somebody spent a minute framing: crops are cheap,
 * a crop you cannot get back is not. So every export is a new file, numbered
 * from the second one on, and the sidecar takes the same stem so a crop and
 * its numbers can never drift apart.
 *
 * It used to ask the disk about `<stem>.json` alone, which is the one file of
 * the three a person is most likely to throw away once they have read it.
 * Measured: with the sidecar deleted the jpeg beside it was written straight
 * over and the export reported "wrote 1 crop". A stem taken by any extension
 * is taken, so the folder is read once per export and the answer is the set
 * of stems already in it.
 */
function freeStem(stems, id) {
  for (let n = 1; n < 1000; n++) {
    const stem = n === 1 ? id : `${id}-${n}`;
    if (!stems.has(stem)) { stems.add(stem); return stem; }
  }
  const last = `${id}-${Date.now()}`;
  stems.add(last);
  return last;
}

export async function exportCrops({ root, config, only = null }) {
  const [index, placements] = await Promise.all([readIndex(root), readPlacements(root)]);
  // resolved against the working directory, which is also where loadConfig
  // looked, so `out` in a config means what a person typing it would expect
  const dir = config.out ? path.resolve(config.out) : DEFAULT_OUT;

  /* Crops may not be written inside the archive they came out of.
   *
   * The next scan would pick every one of them up as a new frame, so an
   * export would quietly grow the wall it was made from, and a rescan after
   * a few exports would bury the negatives in crops of themselves. The tray
   * export has refused this since it was written (trays.mjs) and this one
   * did not, which mattered most for the person whose archive is their
   * downloads folder, because that is where crops go by default. */
  if (inside(await settled(root), await settled(dir))) {
    throw new Error(
      "those crops would land inside the archive, and the next scan would " +
      "pick them up as new frames. point `out` in keeper.config.json " +
      "somewhere outside it.",
    );
  }

  const byId = new Map((index?.items ?? []).map((i) => [i.id, i]));
  const rows = [];

  /* One slot, when the bench asks for one. The button under a picture means
     that picture and nothing else, and an export of nineteen crops fired off
     by a person who wanted one is nineteen files to sort through. */
  const wanted = only ? config.slots.filter((s) => s.id === only) : config.slots;

  /* One listing for the whole export rather than one question per stem. The
     folder cannot change under us mid run, and freeStem adds each name it
     hands out, so two slots in the same export cannot pick the same one. A
     folder that is not there yet has no stems in it. */
  const stems = new Set(
    (await readdir(dir).catch(() => [])).map((n) => n.replace(/\.[^.]+$/, "")),
  );

  for (const slot of wanted) {
    const p = placements[slot.id];
    if (!p) continue;
    const item = byId.get(p.id);
    if (!item) { rows.push({ slot: slot.id, lost: true }); continue; }

    const rect = resolveCrop(p.place, item.w, item.h, slot.aspect);
    const box = pixels(rect, item.w, item.h);
    const proxied = needsProxy(path.extname(item.path).toLowerCase());
    /* One flat folder, not a folder per slot holding one picture each. The
       old shape was tidy and it meant six clicks to get at six crops, on a
       screen whose whole point was choosing them quickly. */
    await mkdir(dir, { recursive: true });
    /* The crop of a raw is a jpeg and has to be called one. `wide.arw` full
       of jpeg bytes is a file no viewer opens, no uploader accepts and every
       tool that reads the extension gets wrong. */
    const ext = proxied ? ".jpg" : path.extname(item.path).toLowerCase();

    /* The name is claimed on the disk, not just in this process's set.
     *
     * The stems are read once at the top of the export, so two exports in
     * flight at the same time both looked at the same folder, both picked
     * `hero`, and the second wrote straight over the first while both
     * reported "wrote 1 crop". That happens for real when the bench's own
     * per slot button lands on a slow negative and the whole-board export
     * arrives behind it. Creating the file with `wx` makes the disk the
     * arbiter: whoever gets it keeps it, and the loser steps to the next
     * stem instead of destroying a crop somebody framed by hand. */
    let stem = null;
    let dst = null;
    for (let tries = 0; tries < 1000 && !dst; tries++) {
      const candidate = freeStem(stems, slot.id);
      const at = path.join(dir, `${candidate}${ext}`);
      try {
        const fh = await open(at, "wx");
        await fh.close();
        stem = candidate;
        dst = at;
      } catch (e) {
        if (e?.code !== "EEXIST") throw e;
      }
    }
    if (!dst) {
      rows.push({ slot: slot.id, source: item.path, failed: "there are already a thousand crops of this slot in that folder" });
      continue;
    }

    /* One slot at a time, because a decoder that gives up on one negative
       must not cost the other eighteen their crops. The message goes back
       whole: it is the only thing anyone has to go on, and the frame it
       names is the one to look at. */
    try {
      /* A raw is cut from its proxy, because sharp cannot decode the
         negative and because the proxy is the picture the person was looking
         at when they dragged the rectangle. Same pixels on the bench and in
         the folder, which is the reason this is right and not only the
         reason it works. A negative macOS cannot read throws here and is
         reported as this slot failing, same as any other bad decode. */
      await exportCrop(await readableSource(root, item), dst, box, slot.width);
    } catch (e) {
      /* The name was claimed on the disk before the decode was attempted, so
         a negative that cannot be read has to hand it back. Leaving it there
         puts a zero byte file no viewer opens in somebody's folder and pushes
         the next good export to `hero-2` for no reason a person could see. */
      await unlink(dst).catch(() => {});
      rows.push({ slot: slot.id, source: item.path, failed: String(e.message).toLowerCase() });
      continue;
    }

    /* Which pixels these actually are, in the one file that exists to say
       so. A crop out of a 3072px proxy is not a crop out of a 7008px
       negative, and whoever opens this to reprint the shot next spring is
       entitled to know the negative is still on the drive holding more than
       twice the detail of the file next to this one. */
    const original = proxied
      ? await originalSize(path.join(root, item.path), { w: item.w, h: item.h }).catch(() => null)
      : null;

    /* The one line somebody can actually paste.
     *
     * A crop is framed here so it can be shown on a page, and the numbers
     * that say where to show it were only ever a field inside a json blob:
     * true, complete, and useless without retyping it by hand. So the same
     * two properties are written as a declaration, in the json as `css` and
     * in a `.css` file beside the crop. Eight exported crops are eight rules
     * to paste into a stylesheet.
     *
     * Past cover there is no position to give. The cut is inside the file
     * already and css has no way to say it, so the declaration stops at
     * object-fit and the comment says where the framing went.
     */
    const cover = isAtCover(p.place, item.w, item.h, slot.aspect);
    const pos = toObjectPosition(rect, item.w, item.h);
    const decl = cover
      ? `object-fit: cover; object-position: ${pos};`
      : "object-fit: cover;";

    await writeFile(path.join(dir, `${stem}.css`), [
      `/* keeper: ${slot.label}, ${slot.aspectText}, cut from ${item.path}${
        cover ? "" : `. the crop is baked into ${path.basename(dst)}, so there is nothing to position`
      } */`,
      `[data-slot="${slot.id}"] {`,
      "  object-fit: cover;",
      ...(cover ? [`  object-position: ${pos};`] : []),
      "}",
      "",
    ].join("\n"));

    // the numbers that made the file, next to the file. a crop nobody can
    // reproduce six months later is a crop that has to be eyeballed again.
    await writeFile(path.join(dir, `${stem}.json`), JSON.stringify({
      slot: slot.id,
      source: item.path,
      from: proxied ? "proxy" : "original",
      sourceSize: { w: item.w, h: item.h },
      proxy: proxied ? {
        longEdge: PROXY_LONG_EDGE,
        originalSize: original ?? undefined,
        note: "cut from the jpeg proxy macos decoded out of this file, not from the original itself",
      } : undefined,
      aspect: slot.aspectText,
      crop: box,
      atCover: cover,
      objectPosition: pos,
      css: decl,
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
