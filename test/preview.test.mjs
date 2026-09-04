/* ---------------------------------------------------------------------
   why a frame has no picture, and what keeper does about it.

   Every case here was seen on screen before it was written down: two black
   squares in a wall of two thousand, and a quick look card that opened onto
   nothing with the file's own path printed underneath it. Both came from the
   same habit of treating a file that exists as a file that is readable.

   Nothing here touches an archive anybody owns. Each test makes its own
   folder in the system temp directory, fills it with frames sharp draws from
   nothing, and takes it away again afterwards.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";

const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const { serve } = await import("../src/server.mjs");
const { loadConfig } = await import("../src/config.mjs");
const { buildIndex } = await import("../src/open.mjs");
const { readIndex } = await import("../src/store.mjs");
const { paths } = await import("../src/store.mjs");
const { buildThumbs, thumbnail } = await import("../src/thumbs.mjs");

async function archive(n = 3) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-preview-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  for (let i = 0; i < n; i++) {
    /* Comfortably over the 1KB floor in scan.mjs, which is there to keep an
       icon out of a contact sheet and would quietly drop a flat 90x60 test
       frame along with it. */
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 30 + i * 20, g: 80, b: 120 } },
    }).jpeg().toFile(path.join(root, "roll 01", `DSC_${String(i).padStart(4, "0")}.jpg`));
  }
  await buildIndex(root);
  const index = await readIndex(root);
  return { root, items: index.items, thumbs: paths(root).thumbs };
}

async function up(root) {
  const config = await loadConfig(root);
  const { server, url } = await serve({ root, config, port: 0 });
  return {
    url,
    close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
  };
}

/* THE ONE THAT COST AN ARCHIVE ITS TILES.
   A thumbnail written straight to its final name is a half file for as long
   as the encoder is running, and quitting keeper during a first scan leaves
   one behind under exactly the name every later run checks for. The check was
   existence, so the answer was yes, so the frame was skipped, so the tile was
   black for the life of that folder and no rescan ever touched it. */
test("a thumbnail that was cut off is built again on the next scan", async (t) => {
  const { root, items, thumbs } = await archive(3);
  t.after(() => rm(root, { recursive: true, force: true }));

  const victim = path.join(thumbs, `${items[1].id}.webp`);
  const whole = (await stat(victim)).size;
  await truncate(victim, 0);

  await buildThumbs(root, items, thumbs);

  const after = await stat(victim);
  assert.equal(after.size, whole, "the empty file should have been replaced by the thumbnail");
  assert.equal((await readFile(victim)).subarray(8, 12).toString(), "WEBP");
});

/* The same fix must not undo resumability. Rebuilding two thousand good
   thumbnails on every launch would be the more expensive bug. */
test("a thumbnail that is already whole is left where it is", async (t) => {
  const { root, items, thumbs } = await archive(3);
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = await Promise.all(items.map(async (i) => (await stat(path.join(thumbs, `${i.id}.webp`))).mtimeMs));
  await new Promise((r) => setTimeout(r, 20));
  await buildThumbs(root, items, thumbs);
  const after = await Promise.all(items.map(async (i) => (await stat(path.join(thumbs, `${i.id}.webp`))).mtimeMs));

  assert.deepEqual(after, before, "no thumbnail should have been written a second time");
});

/* THE SHAPE OF THE FIX, NOT ONLY ITS RESULT.
   The final name must never be the name the encoder writes into, because a
   write into the final name is a half thumbnail sitting under the name every
   later run trusts. Watching the folder while it happens is a race and makes
   a flaky test, so the shape is asserted through a permission instead: the
   destination is left in place and made read only. A write into it fails with
   EACCES. A write into a temp name and a rename over it does not care, because
   a rename answers to the folder rather than to the file.
   Deliberately not a test of read only thumbnails as a feature. It is the
   cheapest deterministic way to see which of the two writes is happening. */
test("the encoder never writes into the final name", async (t) => {
  const { root, items, thumbs } = await archive(1);
  t.after(() => rm(root, { recursive: true, force: true }));

  const dst = path.join(thumbs, `${items[0].id}.webp`);
  const was = await readFile(dst);
  await chmod(dst, 0o444);
  t.after(() => chmod(dst, 0o644).catch(() => {}));

  await thumbnail(path.join(root, items[0].path), dst);

  const now = await readFile(dst);
  assert.equal(now.subarray(8, 12).toString(), "WEBP");
  assert.ok(now.length > 0);
  assert.ok(was.length > 0);
  const left = (await readdir(thumbs)).filter((f) => f.endsWith(".part"));
  assert.deepEqual(left, [], "the temp name should not have survived the rename");
});

/* A source the encoder refuses is the ordinary way a write dies part way
   through. What must not survive it is a file under the real name, or a temp
   file left in the folder for the next run to trip over. */
test("a thumbnail that fails to encode leaves nothing behind at all", async (t) => {
  const { root, thumbs } = await archive(1);
  t.after(() => rm(root, { recursive: true, force: true }));

  const notAPicture = path.join(root, "roll 01", "broken.jpg");
  await writeFile(notAPicture, "this is not a jpeg");
  const dst = path.join(thumbs, "deadbeefdead.webp");

  await assert.rejects(() => thumbnail(notAPicture, dst));
  await assert.rejects(() => stat(dst), { code: "ENOENT" });
  const left = (await readdir(thumbs)).filter((f) => f.endsWith(".part"));
  assert.deepEqual(left, [], "no temp file should be left in the thumbnail folder");
});

/* A keeper that was killed mid encode leaves its temp file behind. The next
   run clears it, and cannot clear one belonging to a keeper that is running. */
test("temp files from a dead run are swept and a live run's are not", async (t) => {
  const { root, items, thumbs } = await archive(1);
  t.after(() => rm(root, { recursive: true, force: true }));

  const dead = path.join(thumbs, "aaaaaaaaaaaa.webp.999999.part");
  const mine = path.join(thumbs, `bbbbbbbbbbbb.webp.${process.pid}.part`);
  await writeFile(dead, "half");
  await writeFile(mine, "half");

  await buildThumbs(root, items, thumbs);

  await assert.rejects(() => stat(dead), { code: "ENOENT" });
  await stat(mine); // still there, and this throws if it is not
});

/* An empty file under the right name used to go out with a 200, which is the
   worst of the three possible answers: the browser has no picture, the tile
   is blank, and nothing anywhere said so. */
test("an empty thumbnail is a missing thumbnail, not a two hundred", async (t) => {
  const { root, items, thumbs } = await archive(2);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  await truncate(path.join(thumbs, `${items[0].id}.webp`), 0);

  const empty = await fetch(`${s.url}/thumb/${items[0].id}`);
  assert.equal(empty.status, 404);
  assert.match((await empty.json()).error, /no thumbnail/);

  const good = await fetch(`${s.url}/thumb/${items[1].id}`);
  assert.equal(good.status, 200);
  assert.ok(Number(good.headers.get("content-length")) > 0);
});

/* The quick look card's black rectangle. The frame is in the index and the
   photograph is not on the drive, which is a folder somebody moved in the
   finder while keeper was open on it. */
test("a frame whose file has moved says so rather than four hundred and fouring", async (t) => {
  const { root, items } = await archive(2);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  await rename(path.join(root, items[0].path), path.join(root, "somewhere else.jpg"));

  const gone = await fetch(`${s.url}/full/${items[0].id}`);
  assert.equal(gone.status, 410);
  assert.match((await gone.json()).error, /not where keeper left it/);

  const here = await fetch(`${s.url}/full/${items[1].id}`);
  assert.equal(here.status, 200);
});

/* An id that was never in this archive is a different sentence, because it is
   a different problem: the page is pointed at a folder keeper has moved off. */
test("an id this archive never held is still an unknown frame", async (t) => {
  const { root } = await archive(1);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  const said = await fetch(`${s.url}/full/ffffffffffff`);
  assert.equal(said.status, 404);
  assert.match((await said.json()).error, /unknown frame/);
});

/* A HEADER CHECK WAS NOT ENOUGH, AND THE TILE IS WHY.
   The tile tells the person to rescan, so a rescan that skipped a truncation
   past the twelfth byte would have been advice that does nothing. The webp
   says its own length four bytes in, so any cut is visible. */
test("a thumbnail cut off in the middle is built again too", async (t) => {
  const { root, items, thumbs } = await archive(2);
  t.after(() => rm(root, { recursive: true, force: true }));

  const victim = path.join(thumbs, `${items[0].id}.webp`);
  const whole = (await stat(victim)).size;
  assert.ok(whole > 80, "the test needs a thumbnail with a middle to cut");
  await truncate(victim, 60);

  await buildThumbs(root, items, thumbs);

  assert.equal((await stat(victim)).size, whole);
});

/* The sweep must clear a dead run's leavings and nothing else. Skipping only
   our own pid was not enough: two keepers reach one archive whenever the
   claim file has been deleted by hand, and the sweep then pulled the temp
   files out from under the other one mid encode. */
test("the sweep leaves a living keeper's temp file alone", async (t) => {
  const { root, items, thumbs } = await archive(1);
  t.after(() => rm(root, { recursive: true, force: true }));

  const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
  t.after(() => kid.kill("SIGKILL"));
  await new Promise((r) => setTimeout(r, 150));

  const live = path.join(thumbs, `aaaaaaaaaaaa.webp.${kid.pid}.part`);
  const dead = path.join(thumbs, "bbbbbbbbbbbb.webp.999999.part");
  await writeFile(live, "half");
  await writeFile(dead, "half");

  await buildThumbs(root, items, thumbs);

  await stat(live); // throws if the sweep took it
  await assert.rejects(() => stat(dead), { code: "ENOENT" });
});

/* THE FORMATS SHARP SAYS IT READS AND DOES NOT.
   sharp.format.heif.input.fileSuffix on this build is exactly [".avif"], so
   every photograph off an iphone was a black tile. And sharp does read a
   tiff, so the thumbnail was always fine, while the card and the bench were
   handed image/tiff, which chromium will not draw. */
test("heic and tiff are decoded through the proxy, not handed to the browser raw", async () => {
  const { needsProxy } = await import("../src/scan.mjs");
  for (const ext of [".heic", ".heif", ".tif", ".tiff"]) {
    assert.equal(needsProxy(ext), true, `${ext} should go through the proxy`);
  }
});

test("a tiff reaches the browser as a jpeg it can draw", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-tiff-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  await sharp({ create: { width: 1400, height: 900, channels: 3, background: { r: 70, g: 90, b: 60 } } })
    .tiff().toFile(path.join(root, "roll 01", "scan.tiff"));
  await buildIndex(root);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  const index = await readIndex(root);
  const [frame] = index.items;
  assert.equal(frame.w, 1400, "a tiff should be measured, not filed as nothing");
  assert.equal(frame.error, undefined);

  const full = await fetch(`${s.url}/full/${frame.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "image/jpeg");

  const thumb = await fetch(`${s.url}/thumb/${frame.id}`);
  assert.equal(thumb.status, 200);
});
