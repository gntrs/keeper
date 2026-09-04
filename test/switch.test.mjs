/* ---------------------------------------------------------------------
   the seam where the archive changes under a running server.

   Every one of these was measured going wrong on this machine before it was
   written down. The folder keeper is serving is a variable that /api/open
   reassigns, and the page sends one request per frame for a bulk keep, so
   there is a window of a second or two after every bulk action in which the
   writes still queued belong to a folder that is no longer open. What that
   used to do, with every request answering 200, is put one archive's
   decisions into another one, and on two copies of one shoot it emptied the
   index of the archive nobody had touched.

   Nothing here touches an archive anybody owns. Each test makes its own
   folders in the system temp directory and takes them away afterwards.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const { serve } = await import("../src/server.mjs");
const { loadConfig } = await import("../src/config.mjs");
const { idFor, readBinned, readIndex, readTags, writeIndex } = await import("../src/store.mjs");
const { host: platform } = await import("../src/os/index.mjs");

/* Two archives holding the same relative paths, which is not a contrivance:
   it is a card copied twice, or a shoot and its backup. An id is a hash of
   the path inside the archive, so the same photograph in both has the same
   id in both, and that is what turns a write aimed at one into a write that
   lands cleanly and wrongly on the other. */
async function archive(n = 4) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-switch-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  const items = [];
  for (let i = 0; i < n; i++) {
    const rel = `roll 01/DSC_${String(i).padStart(4, "0")}.jpg`;
    await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 40 + i * 30, g: 80, b: 120 } } })
      .jpeg().toFile(path.join(root, rel));
    items.push({ path: rel, bytes: 1, kind: "still", id: idFor(rel), w: 900, h: 600 });
  }
  await writeIndex(root, { items, builtAt: new Date().toISOString(), root });
  return { root, items };
}

async function up(root, extra = {}) {
  const config = await loadConfig(root);
  const { server, url, token } = await serve({ root, config, port: 0, ...extra });
  return {
    url,
    tok: { "x-keeper-token": token, "content-type": "application/json" },
    close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
  };
}

const post = (s, route, body) =>
  fetch(s.url + route, { method: "POST", headers: s.tok, body: JSON.stringify(body) });

/* THE ONE THAT PUT ONE SHOOT'S DECISIONS INTO ANOTHER.
   The writes are fired without awaiting, then the folder is swapped out from
   under them, which is a person pressing keep on a block and dropping a new
   folder on the window a second later. */
test("writes queued before a folder switch land in the folder they were about", async (t) => {
  const a = await archive(4);
  const b = await archive(4);
  const s = await up(a.root);
  t.after(async () => {
    await s.close();
    await rm(a.root, { recursive: true, force: true });
    await rm(b.root, { recursive: true, force: true });
  });

  const writes = a.items.map((i) => post(s, "/api/tag", { id: i.id, tag: "P", star: 1 }));
  const opened = await post(s, "/api/open", { path: b.root });
  assert.equal(opened.status, 200);
  const said = await Promise.all(writes);
  assert.deepEqual(said.map((r) => r.status), [200, 200, 200, 200]);

  const mine = await readTags(a.root);
  const theirs = await readTags(b.root);
  assert.equal(Object.keys(mine).length, 4, "every tag belongs to the folder that was open");
  assert.equal(Object.keys(theirs).length, 0, "and none of them reached the folder that was opened next");
  assert.equal(mine[a.items[0].id].tag, "P");
  assert.equal(mine[a.items[0].id].star, 1);
});

/* The same seam, on the list that says what is set aside. */
test("a bin write queued before a switch does not reach the other archive", async (t) => {
  const a = await archive(4);
  const b = await archive(4);
  const s = await up(a.root);
  t.after(async () => {
    await s.close();
    await rm(a.root, { recursive: true, force: true });
    await rm(b.root, { recursive: true, force: true });
  });

  const writes = a.items.map((i) => post(s, "/api/bin", { ids: [i.id] }));
  await post(s, "/api/open", { path: b.root });
  await Promise.all(writes);

  assert.equal((await readBinned(a.root)).length, 4);
  assert.equal((await readBinned(b.root)).length, 0, "the archive that was opened next keeps its own empty bin");
});

/* The worst of the three. A delete rewrites the index and the bin, so aimed
   at the wrong archive it removes frames from a folder nobody touched. */
test("a delete queued before a switch does not empty the other archive's index", async (t) => {
  const a = await archive(4);
  const b = await archive(4);
  const s = await up(a.root, { machine: platform });
  t.after(async () => {
    await s.close();
    await rm(a.root, { recursive: true, force: true });
    await rm(b.root, { recursive: true, force: true });
  });

  const ids = a.items.map((i) => i.id);
  await post(s, "/api/bin", { ids });
  const trashing = post(s, "/api/trash", { ids });
  await post(s, "/api/open", { path: b.root });
  assert.equal((await trashing).status, 200);

  const theirs = await readIndex(b.root);
  assert.equal(theirs.items.length, 4, "the archive nobody touched keeps every frame in its index");
  const mine = await readIndex(a.root);
  assert.equal(mine.items.length, 0, "and the one that was deleted from loses them");
});

/* THE CHECK THAT EXISTS TO STOP THE PLATFORM LYING, FAILING OPEN.
   A file keeper cannot ask about is not a file that has gone. Reading every
   errno as proof of a delete took the frame out of the index and out of the
   bin while the photograph stayed on the drive. */
test("a file keeper cannot read is not reported as deleted", async (t) => {
  const { root, items } = await archive(2);
  const s = await up(root, {
    /* A platform that says it deleted and did not, which is the whole reason
       the check is there. The real one on this machine would refuse the
       unreadable folder anyway; this makes the test about the check. */
    machine: { ...platform, trash: async () => {} },
  });
  const locked = path.join(root, "locked");
  await mkdir(locked, { recursive: true });
  await writeFile(path.join(locked, "held.jpg"), "not really a jpeg, and not readable in a moment");
  t.after(async () => {
    await chmod(locked, 0o755).catch(() => {});
    await s.close();
    await rm(root, { recursive: true, force: true });
  });

  const rel = "locked/held.jpg";
  const hidden = { path: rel, bytes: 1, kind: "still", id: idFor(rel), w: 900, h: 600 };
  await writeIndex(root, { items: [...items, hidden], builtAt: new Date().toISOString(), root });
  await post(s, "/api/bin", { ids: [hidden.id] });
  await chmod(locked, 0o000);

  const said = await post(s, "/api/trash", { ids: [hidden.id] });
  const out = await said.json();
  /* Not a 200, and that is the point. The platform said it deleted, the disk
     would not say either way, and keeper reports the delete it cannot vouch
     for as the failure it is rather than as work done. */
  assert.equal(said.status, 500, JSON.stringify(out));
  assert.equal(out.ok, false);
  assert.equal(out.trashed, 0);
  assert.deepEqual(out.gone, [], "nothing should be claimed as gone");
  assert.deepEqual(out.left, [hidden.id], "the frame keeper could not ask about stays");
  assert.match(out.error, /still on the drive/);

  const index = await readIndex(root);
  assert.ok(index.items.some((i) => i.id === hidden.id), "and it is still in the index");
  assert.deepEqual(await readBinned(root), [hidden.id], "and it is still set aside");
});
