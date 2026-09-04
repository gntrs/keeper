import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/* A seat of its own, set before anything under src/ is imported, so a test
   run cannot read or write the seat belonging to the person on this machine. */
process.env.KEEPER_HOME = await mkdtemp(path.join(tmpdir(), "keeper-home-"));

const sharp = (await import("sharp")).default;
const { exportCrops } = await import("../src/crops.mjs");
const { buildIndex } = await import("../src/open.mjs");
const { readIndex, writePlacements } = await import("../src/store.mjs");

/* One frame is enough for every question here, and a scan of one is a test
   that finishes. The shape is 3/2 so a 3/2 slot sits exactly at cover. */
async function archive() {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-crops-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 60, g: 90, b: 130 } } })
    .jpeg()
    .toFile(path.join(root, "roll 01", "DSC_0001.jpg"));
  await buildIndex(root);
  const index = await readIndex(root);
  return { root, item: index.items[0] };
}

const SLOT = { id: "hero", label: "hero", aspect: 3 / 2, aspectText: "3/2", width: 0, note: "", group: "yours" };
const config = (out) => ({ slots: [SLOT], out, places: [] });

/* The placement the bench writes at cover on a 3/2 frame in a 3/2 slot. cw is
   a fraction of the source width, so 1 is the whole negative, and on a frame
   already at the slot's aspect that is exactly cover: object-position comes
   out at 50% 50% and can be asserted without going back through geometry.mjs
   to work out what it should be. */
const centred = (item) => ({ id: item.id, place: { cx: 0.5, cy: 0.5, cw: 1 } });

test("a second export does not overwrite the first when the sidecar is gone", async (t) => {
  const { root, item } = await archive();
  const out = await mkdtemp(path.join(tmpdir(), "keeper-out-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));

  await writePlacements(root, { hero: centred(item) });

  const first = await exportCrops({ root, config: config(out) });
  assert.equal(first.written, 1);
  const was = await readFile(path.join(out, "hero.jpg"));

  await rm(path.join(out, "hero.json"));

  const second = await exportCrops({ root, config: config(out) });
  assert.equal(second.written, 1);

  const now = await readFile(path.join(out, "hero.jpg"));
  assert.deepEqual(now, was, "the first crop was written over");
  const names = await readdir(out);
  assert.ok(names.includes("hero-2.jpg"), `expected hero-2.jpg, got ${names.join(", ")}`);
});

test("a stem taken by any extension is taken", async (t) => {
  const { root, item } = await archive();
  const out = await mkdtemp(path.join(tmpdir(), "keeper-out-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));

  await writePlacements(root, { hero: centred(item) });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "hero.png"), "not a crop, but it owns the name");

  const res = await exportCrops({ root, config: config(out) });
  assert.equal(path.basename(res.rows[0].file), "hero-2.jpg");
});

test("the css sidecar and the json agree", async (t) => {
  const { root, item } = await archive();
  const out = await mkdtemp(path.join(tmpdir(), "keeper-out-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));

  await writePlacements(root, { hero: centred(item) });
  await exportCrops({ root, config: config(out) });

  const json = JSON.parse(await readFile(path.join(out, "hero.json"), "utf8"));
  const css = await readFile(path.join(out, "hero.css"), "utf8");

  assert.equal(json.atCover, true);
  assert.ok(json.css.startsWith("object-fit: cover; object-position:"), json.css);
  assert.ok(css.includes('[data-slot="hero"]'), css);
  // the declaration in the file and the declaration in the json are the same
  // two properties, so a person who pastes either one gets the same picture
  for (const bit of json.css.split(";").map((s) => s.trim()).filter(Boolean)) {
    assert.ok(css.includes(bit), `${bit} is missing from the css file`);
  }
});

test("past cover the declaration drops the position and says where the crop went", async (t) => {
  const { root, item } = await archive();
  const out = await mkdtemp(path.join(tmpdir(), "keeper-out-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));

  // punched in to half the negative's width, which is well past cover
  await writePlacements(root, { hero: { id: item.id, place: { cx: 0.5, cy: 0.5, cw: 0.5 } } });
  await exportCrops({ root, config: config(out) });

  const json = JSON.parse(await readFile(path.join(out, "hero.json"), "utf8"));
  const css = await readFile(path.join(out, "hero.css"), "utf8");

  assert.equal(json.atCover, false);
  assert.equal(json.css, "object-fit: cover;");
  assert.ok(!css.includes("object-position"), css);
  assert.ok(css.includes("baked into hero.jpg"), css);
});
