/* ---------------------------------------------------------------------
   what leaves the archive, and what the folder looks like the second time.

   Export is the one part of keeper that writes files a person then hands to
   somebody else, so the failures it can have are the expensive kind. Three
   were measured before this file existed:

     exporting a tray into a folder it had already been exported to wrote a
     byte identical second copy of nearly every frame under a suffixed name,
     so forty frames became seventy nine files and the line at the end said
     "39 copied", which was true and useless;

     one photograph the drive would not read threw out of the whole export,
     leaving a folder holding the nine frames that had landed, looking
     finished, and the retry then doubled those nine;

     and a tray of eight thousand frames failed the alias export outright
     with a raw applescript stack overflow, before the finder was asked for
     a single alias.

   So these are as much about what export refuses to do as about what it
   does: it never writes a photograph the folder already holds, it never
   overwrites a photograph it did not write, it never touches the archive,
   and it never lets one frame decide the fate of the other hundred.

   Every archive here is generated under os.tmpdir() and removed afterwards.
   Nothing here touches an archive anybody owns.
   --------------------------------------------------------------------- */

import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/* A seat of its own, set before anything under src/ is imported, so a test
   run cannot read or write the seat belonging to the person on this machine. */
process.env.KEEPER_HOME = await mkdtemp(path.join(tmpdir(), "keeper-home-"));

const { exportTray, readTrays, writeTrays } = await import("../src/trays.mjs");
const { buildIndex } = await import("../src/open.mjs");
const { readIndex } = await import("../src/store.mjs");

const mac = process.platform === "darwin";
const rooted = typeof process.getuid === "function" && process.getuid() === 0;

/**
 * A stand in archive. The frames are made at different widths so that no two
 * of them are alike by accident, and big enough to be photographs, because
 * the scan walks past anything under a kilobyte and an archive of nothing
 * tests nothing. The case where two different photographs come out the same
 * length is built by hand further down, since it is the one the copy mode
 * used to get wrong and it cannot be reached by making frames that differ.
 */
async function archive(t, layout) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  let n = 0;
  for (const [folder, names] of Object.entries(layout)) {
    await mkdir(path.join(root, folder), { recursive: true });
    for (const name of names) {
      n++;
      await sharp({
        create: { width: 900 + n * 60, height: 600, channels: 3, background: { r: n * 11 % 255, g: 90, b: 140 } },
      }).jpeg().toFile(path.join(root, folder, name));
    }
  }

  await buildIndex(root);
  const index = await readIndex(root);
  return { root, index, items: index.items };
}

const out = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-dest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const tray = (ids) => ({ id: "web", name: "web", ids });

/** every file under a folder, with its size, so "unchanged" can be asserted */
async function census(dir) {
  const rows = {};
  for (const name of (await readdir(dir, { recursive: true, withFileTypes: true }))) {
    if (!name.isFile()) continue;
    const full = path.join(name.parentPath ?? name.path, name.name);
    rows[path.relative(dir, full)] = (await stat(full)).size;
  }
  return rows;
}

/* ---- the ordinary run ----------------------------------------------- */

test("a tray of frames lands whole, and the archive comes out untouched", async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"] });
  const dest = await out(t);
  const was = await census(root);

  const done = await exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index });

  assert.equal(done.written, 3);
  assert.deepEqual(done.already, []);
  assert.deepEqual(done.skipped, []);
  assert.deepEqual(done.problems, []);
  assert.deepEqual((await readdir(dest)).sort(), ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"]);
  assert.deepEqual(await census(root), was, "the archive is the negative and export only reads it");
});

test("the count is the files, not the frames it was asked about", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg"] });
  const dest = await out(t);
  const done = await exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index });
  assert.equal(done.written, (await readdir(dest)).length);
});

/* ---- and the same run again ----------------------------------------- */

test("exporting the same tray into the same folder twice gives the same folder", async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  await exportTray({ root, tray: tray(ids), folder: dest, index });
  const after = await census(dest);

  const again = await exportTray({ root, tray: tray(ids), folder: dest, index });

  assert.equal(again.written, 0, "there was nothing left to write");
  assert.deepEqual(again.already.sort(), [...ids].sort(), "and it says so, frame by frame");
  assert.deepEqual(again.skipped, [], "already there is not a failure");
  assert.deepEqual(await census(dest), after, "no second copy, under any name");

  const third = await exportTray({ root, tray: tray(ids), folder: dest, index });
  assert.equal(third.already.length, 3);
  assert.deepEqual(await census(dest), after);
});

test("a frame added to the tray between two exports is the only one written", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg", "c.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  await exportTray({ root, tray: tray(ids.slice(0, 2)), folder: dest, index });
  const done = await exportTray({ root, tray: tray(ids), folder: dest, index });

  assert.equal(done.written, 1, "40 already there and 3 written is the sentence this makes possible");
  assert.equal(done.already.length, 2);
  assert.equal((await readdir(dest)).length, 3);
});

test("a symlink export is idempotent too, and reads the link rather than the name", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  const first = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "symlink" });
  assert.equal(first.written, 2);

  const again = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "symlink" });
  assert.equal(again.written, 0);
  assert.equal(again.already.length, 2);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "b.jpg"]);
});

test("a link of the right name pointing somewhere else is a collision, not a frame already there", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg"] });
  const dest = await out(t);
  const other = path.join(dest, "not the archive.jpg");
  await writeFile(other, "a stand in");
  await symlink(other, path.join(dest, "a.jpg"));

  const done = await exportTray({ root, tray: tray([items[0].id]), folder: dest, index, mode: "symlink" });

  assert.equal(done.written, 1);
  assert.deepEqual(done.already, []);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", `a-${items[0].id}.jpg`, "not the archive.jpg"].sort());
  assert.equal(await readlink(path.join(dest, "a.jpg")), other, "and what was already there is left as it was");
});

/* ---- two photographs that share a name ------------------------------ */

test("two different photographs of one name both land, and both stay landed", async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["TWIN.jpg"], "roll 02": ["TWIN.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);
  assert.equal(ids.length, 2);

  const first = await exportTray({ root, tray: tray(ids), folder: dest, index });
  assert.equal(first.written, 2, "losing one of them is not a trade anyone would accept");
  const files = (await readdir(dest)).sort();
  assert.equal(files.length, 2);
  assert.ok(files.includes("TWIN.jpg"));
  assert.ok(files.some((f) => /^TWIN-.+\.jpg$/.test(f)), "the second one wears its frame id");

  const again = await exportTray({ root, tray: tray(ids), folder: dest, index });
  assert.equal(again.written, 0);
  assert.equal(again.already.length, 2);
  assert.deepEqual((await readdir(dest)).sort(), files);
});

test("the second of a shared name still lands when the first is no longer in the tray", async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["TWIN.jpg"], "roll 02": ["TWIN.jpg"] });
  const dest = await out(t);
  const [one, two] = items.map((i) => i.id);

  await exportTray({ root, tray: tray([one]), folder: dest, index });
  const done = await exportTray({ root, tray: tray([two]), folder: dest, index });

  assert.equal(done.written, 1);
  assert.deepEqual((await readdir(dest)).sort(), ["TWIN.jpg", `TWIN-${two}.jpg`].sort());
});

/* ---- what is missing, and what will not read ------------------------ */

test("a frame gone from the index since it was trayed is skipped and the rest go", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg"] });
  const dest = await out(t);

  const done = await exportTray({
    root, index, folder: dest,
    tray: tray([items[0].id, "an id no scan ever handed out", items[1].id]),
  });

  assert.equal(done.written, 2);
  assert.deepEqual(done.skipped, ["an id no scan ever handed out"]);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "b.jpg"]);
});

test("a frame gone off the drive since it was trayed does not take the tray with it", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg", "c.jpg"] });
  const dest = await out(t);
  const gone = items[1];
  await rm(path.join(root, gone.path));

  const done = await exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index });

  assert.equal(done.written, 2, "the other two are the whole point");
  assert.deepEqual(done.skipped, [gone.id]);
  assert.equal(done.problems.length, 1);
  assert.match(done.problems[0].why, /drive/, "and the reason travels with the id");
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "c.jpg"]);
});

test("a frame keeper cannot read is one frame, and the retry does not double the rest", {
  skip: process.platform === "win32" ? "chmod does not gate a read on windows"
    : rooted ? "root reads everything" : false,
}, async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg", "c.jpg"] });
  const dest = await out(t);
  const shut = path.join(root, items[1].path);
  await chmod(shut, 0o000);
  t.after(() => chmod(shut, 0o644).catch(() => {}));

  const done = await exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index });
  assert.equal(done.written, 2);
  assert.deepEqual(done.skipped, [items[1].id]);
  assert.equal(done.problems[0].why, "keeper is not allowed to read that one");

  const again = await exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index });
  assert.equal(again.written, 0, "the two that landed are already there");
  assert.equal(again.already.length, 2);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "c.jpg"], "and nothing was written twice");
});

/* ---- where it may not write ----------------------------------------- */

test("a destination inside the archive is refused, in every mode", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg"] });
  const ids = items.map((i) => i.id);

  for (const [mode, folder, made] of [
    ["copy", path.join(root, "for the client"), false],
    ["symlink", path.join(root, "roll", "links"), false],
    ["copy", root, true],
    ["copy", path.join(root, "roll"), true],
  ]) {
    await assert.rejects(
      exportTray({ root, tray: tray(ids), folder, index, mode }),
      /inside the archive/,
      `${mode} into ${folder} has to be refused`,
    );
    /* refused before the folder is made, too. mkdir runs after that check
       and a refusal that still left a folder behind would put an empty one
       in somebody's archive for the next scan to walk. */
    if (!made) await assert.rejects(lstat(folder), "and the folder was not made on the way to refusing");
  }
  assert.deepEqual((await readdir(path.join(root, "roll"))).sort(), ["a.jpg"], "and the archive is as it was");
});

test("a mode this machine has never heard of is refused before anything is written", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg"] });
  const dest = await out(t);
  await assert.rejects(
    exportTray({ root, tray: tray(items.map((i) => i.id)), folder: dest, index, mode: "hardlink" }),
    /no export mode called hardlink/,
  );
  assert.deepEqual(await readdir(dest), []);
});

/* ---- one frame is one frame ----------------------------------------- */

test("a frame listed twice in a tray is exported once", async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg"] });
  const dest = await out(t);
  const id = items[0].id;

  const done = await exportTray({ root, tray: tray([id, id]), folder: dest, index });

  assert.equal(done.written, 1);
  assert.deepEqual(await readdir(dest), ["a.jpg"]);
});

test("and a trays.json carrying a repeated id hands back one of it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-trays-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeTrays(root, { trays: [{ id: "web", name: "web", ids: ["a1", "a1", "b2"] }], active: "web" });
  assert.deepEqual((await readTrays(root)).trays[0].ids, ["a1", "b2"]);
});

/* ---- the platform's own shortcut ------------------------------------ */

test("an alias export is idempotent, and its count is read off the disk", {
  skip: mac ? false : "macos only: this drives the real finder through apple events",
}, async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg", "b.jpg", "c.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  const first = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "alias" });
  assert.equal(first.written, 3);
  assert.equal(first.already.length, 0);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "b.jpg", "c.jpg"]);

  const again = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "alias" });
  assert.equal(again.written, 0, "the finder was asked to make nothing at all");
  assert.deepEqual(again.already.sort(), [...ids].sort());
  assert.deepEqual(again.skipped, []);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("two aliases of one name both land, and neither is written twice", {
  skip: mac ? false : "macos only: this drives the real finder through apple events",
}, async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["TWIN.jpg"], "roll 02": ["TWIN.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  const first = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "alias" });
  assert.equal(first.written, 2);
  const files = (await readdir(dest)).sort();

  const again = await exportTray({ root, tray: tray(ids), folder: dest, index, mode: "alias" });
  assert.equal(again.written, 0);
  assert.equal(again.already.length, 2);
  assert.deepEqual((await readdir(dest)).sort(), files);
});

test("an ordinary photograph already under that name is a collision the alias mode works around", {
  skip: mac ? false : "macos only: this drives the real finder through apple events",
}, async (t) => {
  const { root, index, items } = await archive(t, { roll: ["a.jpg"] });
  const dest = await out(t);
  await writeFile(path.join(dest, "a.jpg"), "somebody else's photograph, and not ours to touch");

  const done = await exportTray({ root, tray: tray([items[0].id]), folder: dest, index, mode: "alias" });

  assert.equal(done.written, 1);
  assert.deepEqual((await readdir(dest)).sort(), ["a.jpg", `a-${items[0].id}.jpg`].sort());
  assert.equal((await stat(path.join(dest, "a.jpg"))).size, 49, "what was already there is untouched");
});

/**
 * The size that used to be the end of it. 8,079 items in one applescript
 * list literal is where this machine overflows its stack, and the whole
 * export died on it with `execution error: Stack overflow. (-2706)` and no
 * mention of trays or frames. The sources here are all fictitious, so the
 * finder refuses every one of them and every index comes back as a skip:
 * what is being asserted is that nine thousand of them come back at all.
 */
test("a tray past the applescript ceiling answers instead of overflowing", {
  skip: mac ? false : "macos only: this is an applescript limit",
}, async (t) => {
  const { links } = await import("../src/os/macos.mjs");
  const dest = await out(t);
  const jobs = Array.from({ length: 9000 }, (_, i) => ({
    src: path.join(dest, "nothing here", `DSC_${i}.jpg`),
    name: `DSC_${i}.jpg`,
  }));

  const bad = await links(jobs, dest);

  assert.equal(bad.size, 9000, "every one refused, and none of them lost");
  assert.ok(bad.has(0) && bad.has(8079) && bad.has(8999), "the batch offsets are put back");
  assert.deepEqual(await readdir(dest), [], "and nothing was made for a source that is not there");
});


/* ---- two photographs the folder cannot tell apart by size ------------ */

/**
 * THE ONE THAT WAS A SILENT LOSS.
 *
 * "Is the file already under that name this same frame" used to be answered
 * by the byte count alone, and a comment beside it said the damage was
 * bounded because the second photograph would keep its own suffixed copy.
 * That was not true. A frame read as already there is never written at all,
 * so a folder holding one roll's DSC_0003.jpg silently swallowed the other
 * roll's, and the run reported it as work already done.
 *
 * Same name and same length is not a contrived pairing. Two scans of one
 * negative come off a scanner at the same uncompressed size, and a camera
 * that names by counter gives the same name to every card's third frame.
 * These are built by padding one file up to the other's length, because
 * frames made the ordinary way here never collide.
 */
test("two different photographs of one name and one size both land", async (t) => {
  const { root, index, items } = await archive(t, {
    "roll 01": ["DSC_0003.jpg"],
    "roll 02": ["DSC_0003.jpg"],
  });
  const dest = await out(t);

  const [a, b] = ["roll 01/DSC_0003.jpg", "roll 02/DSC_0003.jpg"].map((r) => path.join(root, r));
  const [sa, sb] = await Promise.all([stat(a), stat(b)]);
  const [short, long] = sa.size < sb.size ? [a, b] : [b, a];
  const gap = Math.abs(sa.size - sb.size);
  await writeFile(short, Buffer.alloc(gap), { flag: "a" });
  assert.equal((await stat(short)).size, (await stat(long)).size, "the two are now the same length");

  await buildIndex(root, { rescan: true });
  const fresh = (await readIndex(root)).items;
  const first = fresh.find((i) => i.path.startsWith("roll 01/"));
  const second = fresh.find((i) => i.path.startsWith("roll 02/"));

  /* Exported one tray at a time, which is what makes it a loss rather than a
     collision: the second export has no idea the first one happened. */
  const one = await exportTray({ root, tray: tray([first.id]), folder: dest, index: { items: fresh } });
  assert.equal(one.written, 1);

  const two = await exportTray({ root, tray: tray([second.id]), folder: dest, index: { items: fresh } });
  assert.equal(two.written, 1, "the second photograph is a different one and has to land");
  assert.deepEqual(two.already, [], "and it is not reported as work already done");

  const there = await readdir(dest);
  assert.equal(there.length, 2, "both are in the folder");
  assert.ok(there.includes("DSC_0003.jpg"));
  assert.ok(there.includes(`DSC_0003-${second.id}.jpg`), "the second one under the name the id suffix exists for");
});

/**
 * And the other half of the same question, because a check that answers "not
 * the same" to everything would pass the test above and bring back the
 * doubling that the whole feature exists to stop.
 */
test("the same photograph twice over is still only there once", async (t) => {
  const { root, index, items } = await archive(t, { "roll 01": ["DSC_0001.jpg", "DSC_0002.jpg"] });
  const dest = await out(t);
  const ids = items.map((i) => i.id);

  assert.equal((await exportTray({ root, tray: tray(ids), folder: dest, index })).written, 2);
  const again = await exportTray({ root, tray: tray(ids), folder: dest, index });
  assert.equal(again.written, 0);
  assert.deepEqual(again.already.sort(), [...ids].sort());
  assert.equal((await readdir(dest)).length, 2, "a second run adds nothing");
});
