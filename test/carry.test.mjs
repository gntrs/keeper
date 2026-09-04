/* ---------------------------------------------------------------------
   what a decision does when the photograph under it moves.

   A frame's id is a hash of its path inside the archive, so renaming a folder
   after an evening of culling used to orphan every star, tag, bin entry,
   placement and tray membership underneath it, silently, with the wall coming
   back empty and keeper saying nothing. Measured before this existed: four of
   five rows orphaned by one rename.

   These are deliberately as much about what it refuses to do as about what it
   does, because the failure being prevented is losing an evening of decisions
   and the failure that could be introduced is putting them on the wrong
   photographs.

   Nothing here touches an archive anybody owns.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const { moved, carryTags, carryBinned, carryPlacements, carryTrays } = await import("../src/carry.mjs");
const { buildIndex } = await import("../src/open.mjs");
const {
  readIndex, readTags, writeTags, readBinned, writeBinned, readPlacements, writePlacements,
} = await import("../src/store.mjs");
const { readTrays, writeTrays } = await import("../src/trays.mjs");

const frame = (id, p, bytes) => ({ id, path: p, bytes });

/* ---- the matcher, on its own ---------------------------------------- */

test("a renamed folder carries every frame under it", () => {
  const before = [frame("a1", "roll 01/DSC_0001.jpg", 100), frame("a2", "roll 01/DSC_0002.jpg", 200)];
  const after = [frame("b1", "wedding/DSC_0001.jpg", 100), frame("b2", "wedding/DSC_0002.jpg", 200)];
  assert.deepEqual([...moved(before, after)], [["a1", "b1"], ["a2", "b2"]]);
});

test("a frame that did not move is not treated as one that did", () => {
  const both = [frame("a1", "roll 01/one.jpg", 100)];
  assert.equal(moved(both, both).size, 0);
});

test("two files of one name and one size carry nothing, either way", () => {
  const before = [frame("a1", "roll 01/twin.jpg", 300), frame("a2", "roll 02/twin.jpg", 300)];
  const after = [frame("b1", "left/twin.jpg", 300), frame("b2", "right/twin.jpg", 300)];
  assert.equal(moved(before, after).size, 0, "there is no honest way to say which was which");
});

test("the same name at a different size is a different photograph", () => {
  const before = [frame("a1", "roll 01/one.jpg", 100)];
  const after = [frame("b1", "roll 01/one.jpg", 999)];
  assert.equal(moved(before, after).size, 0);
});

test("a frame that simply left carries nothing", () => {
  assert.equal(moved([frame("a1", "roll 01/gone.jpg", 100)], []).size, 0);
  assert.equal(moved([], [frame("b1", "roll 01/new.jpg", 100)]).size, 0);
});

/* ---- the four shapes a decision comes in ---------------------------- */

test("a star and a tag ride across, and a row already there is not overwritten", () => {
  const map = new Map([["a1", "b1"], ["a2", "b2"]]);
  const { out, touched } = carryTags({ a1: { tag: "P", star: 1 }, a2: { tag: "L" }, b2: { tag: "X" } }, map);
  assert.equal(touched, true);
  assert.deepEqual(out.b1, { tag: "P", star: 1 });
  assert.equal("a1" in out, false, "and the orphan row does not linger");
  assert.deepEqual(out.b2, { tag: "X" }, "a decision already about this frame wins");
  assert.deepEqual(out.a2, { tag: "L" }, "so the one that could not land stays where it was");
});

test("the bin comes across without growing a duplicate", () => {
  const { out, touched } = carryBinned(["a1", "b1", "keep"], new Map([["a1", "b1"]]));
  assert.equal(touched, true);
  assert.deepEqual(out, ["b1", "keep"]);
});

test("a placement follows its frame and the slot stays where it is", () => {
  const map = new Map([["a1", "b1"]]);
  const { out, touched } = carryPlacements({ hero: { id: "a1", place: { cx: 0.5 } }, side: { id: "z", place: {} } }, map);
  assert.equal(touched, true);
  assert.deepEqual(out.hero, { id: "b1", place: { cx: 0.5 } });
  assert.deepEqual(out.side, { id: "z", place: {} });
});

test("a tray keeps its order and loses nothing", () => {
  const doc = { trays: [{ id: "web", name: "web", ids: ["a1", "keep", "a2"] }] };
  const { out, touched } = carryTrays(doc, new Map([["a1", "b1"], ["a2", "b2"]]));
  assert.equal(touched, true);
  assert.deepEqual(out.trays[0].ids, ["b1", "keep", "b2"]);
  assert.equal(out.trays[0].name, "web");
});

test("nothing to carry means nothing is rewritten", () => {
  const none = new Map();
  assert.equal(carryTags({ a: { star: 1 } }, none).touched, false);
  assert.equal(carryBinned(["a"], none).touched, false);
  assert.equal(carryPlacements({ hero: { id: "a" } }, none).touched, false);
  assert.equal(carryTrays({ trays: [{ ids: ["a"] }] }, none).touched, false);
});

/* ---- and the whole of it, through a real rescan --------------------- */

async function archive() {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-carry-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  for (let i = 0; i < 3; i++) {
    await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30 + i * 40, g: 80, b: 120 } } })
      .jpeg().toFile(path.join(root, "roll 01", `DSC_${String(i).padStart(4, "0")}.jpg`));
  }
  await buildIndex(root);
  return { root, items: (await readIndex(root)).items };
}

test("renaming a folder after a night of culling keeps the night", async (t) => {
  const { root, items } = await archive();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeTags(root, {
    [items[0].id]: { tag: "P", star: 1 },
    [items[1].id]: { tag: "L" },
  });
  await writeBinned(root, [items[2].id]);
  await writePlacements(root, { hero: { id: items[0].id, place: { cx: 0.5, cy: 0.5, cw: 1 } } });
  await writeTrays(root, { trays: [{ id: "web", name: "web", ids: [items[0].id, items[1].id] }] });

  await rename(path.join(root, "roll 01"), path.join(root, "the wedding"));
  await buildIndex(root, { rescan: true });

  const after = await readIndex(root);
  assert.equal(after.items.length, 3);
  assert.ok(after.items.every((i) => i.path.startsWith("the wedding/")));
  const now = new Map(after.items.map((i) => [path.basename(i.path), i.id]));

  const tags = await readTags(root);
  assert.deepEqual(tags[now.get("DSC_0000.jpg")], { tag: "P", star: 1 }, "the star survives the rename");
  assert.deepEqual(tags[now.get("DSC_0001.jpg")], { tag: "L" });
  assert.equal(Object.keys(tags).length, 2, "and no orphan row is left behind");

  assert.deepEqual(await readBinned(root), [now.get("DSC_0002.jpg")]);
  assert.equal((await readPlacements(root)).hero.id, now.get("DSC_0000.jpg"));
  assert.deepEqual((await readTrays(root)).trays[0].ids,
    [now.get("DSC_0000.jpg"), now.get("DSC_0001.jpg")]);
});

test("a case only rename is the same folder to the drive and was not to keeper", async (t) => {
  const { root, items } = await archive();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeTags(root, { [items[0].id]: { star: 1 } });
  await rename(path.join(root, "roll 01"), path.join(root, "ROLL 01"));
  await buildIndex(root, { rescan: true });

  const after = await readIndex(root);
  const first = after.items.find((i) => i.path.endsWith("DSC_0000.jpg"));
  assert.deepEqual((await readTags(root))[first.id], { star: 1 });
});

test("a rescan that finds nothing moved leaves the decisions exactly as they were", async (t) => {
  const { root, items } = await archive();
  t.after(() => rm(root, { recursive: true, force: true }));

  const was = { [items[0].id]: { tag: "P", star: 1 } };
  await writeTags(root, was);
  await buildIndex(root, { rescan: true });
  assert.deepEqual(await readTags(root), was);
});
