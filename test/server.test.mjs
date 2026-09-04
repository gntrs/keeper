/* ---------------------------------------------------------------------
   what the server promises, tested against a real server on a real port.

   Every one of these is a thing that was measured going wrong on this
   machine, not a thing that might: a page on another origin writing into
   somebody's archive, a delete that reported success and removed nothing,
   a clip dropped into a bench slot, a rename erased by an export that was
   holding a copy of trays.json from before the rename existed.

   Nothing here touches an archive anybody owns. Each test makes its own
   folder in the system temp directory, fills it with frames sharp draws
   from nothing, and takes it away again afterwards.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

/* The seat is pointed somewhere disposable before a single line of src/ runs,
   because runtime.mjs reads it at import and a test that read the real one
   would answer questions about the person running the tests. That is also why
   everything below is a dynamic import: a static one is evaluated before any
   statement in this file, environment variable included. */
const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const { serve } = await import("../src/server.mjs");
const { loadConfig } = await import("../src/config.mjs");
const { idFor, readBinned, readIndex, readTags, writeIndex } = await import("../src/store.mjs");
const { readTrays } = await import("../src/trays.mjs");
const { host: platform } = await import("../src/os/index.mjs");
const { CENTERED } = await import("../src/geometry.mjs");

/**
 * An archive with frames in it and an index over them, written by hand.
 *
 * The scan and the thumbnailer are somebody else's tests. What these need is
 * files that really exist at the paths the index names, because the trash
 * sweep and the tray export both go to the disk and would pass against
 * anything if they did not.
 */
async function archive(n = 3) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-arc-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  const items = [];
  for (let i = 1; i <= n; i++) {
    const rel = `roll 01/DSC_${String(i).padStart(4, "0")}.jpg`;
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 20 + (i % 200), g: 70, b: 110 } },
    }).jpeg().toFile(path.join(root, rel));
    items.push({ path: rel, bytes: 1, kind: "still", id: idFor(rel), w: 64, h: 48 });
  }
  await writeIndex(root, { items, builtAt: new Date().toISOString(), root });
  return { root, items };
}

async function up(root, extra = {}) {
  const config = await loadConfig(root);
  const { server, url, token } = await serve({ root, config, port: 0, ...extra });
  return {
    url,
    token,
    tok: { "x-keeper-token": token },
    close: () => new Promise((done) => {
      // fetch keeps its sockets alive, so close on its own waits for a client
      // that has no intention of going away
      server.closeAllConnections?.();
      server.close(done);
    }),
  };
}

const send = (url, route, method, body, headers = {}) =>
  fetch(url + route, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const post = (url, route, body, headers) => send(url, route, "POST", body, headers);

test("a foreign origin is refused", async (t) => {
  const { root, items } = await archive(2);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  const said = await post(s.url, "/api/tag", { id: items[0].id, star: 1 }, {
    ...s.tok, origin: "http://evil.example",
  });
  assert.equal(said.status, 403);
  assert.match((await said.json()).error, /came from another page/);

  /* The same request with no Origin at all, which is what a form post from
     another page looks like, refused on the header the browser sends instead. */
  const formish = await post(s.url, "/api/tag", { id: items[0].id, star: 1 }, {
    ...s.tok, "sec-fetch-site": "cross-site",
  });
  assert.equal(formish.status, 403);

  // and nothing was written on the way past
  assert.deepEqual(await readTags(root), {});
});

test("a write without the token is refused, and with it lands", async (t) => {
  const { root, items } = await archive(3);
  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });

  const bare = await post(s.url, "/api/tag", { id: items[0].id, star: 1 });
  assert.equal(bare.status, 403);
  assert.match((await bare.json()).error, /did not carry this keeper's token/);
  assert.deepEqual(await readTags(root), {});

  // the page carries the token this server is asking for, so a page that can
  // be read can write and a page that cannot cannot
  const page = await fetch(`${s.url}/`).then((r) => r.text());
  assert.ok(page.includes(`window.KEEPER_TOKEN="${s.token}"`));

  const good = await post(s.url, "/api/tag", { id: items[0].id, star: 1 }, s.tok);
  assert.equal(good.status, 200);
  assert.deepEqual(await readTags(root), { [items[0].id]: { star: 1 } });

  // and the batch the contact sheet sends, in one turn of the queue
  const many = await post(s.url, "/api/tag", {
    rows: [{ id: items[1].id, tag: "P" }, { id: items[2].id, star: 1 }],
  }, s.tok);
  assert.equal(many.status, 200);
  assert.deepEqual(await many.json(), { ok: true, applied: 2 });
  const tags = await readTags(root);
  assert.equal(tags[items[1].id].tag, "P");
  assert.equal(tags[items[2].id].star, 1);

  // one word the vocabulary does not hold and the whole batch writes nothing
  const junk = await post(s.url, "/api/tag", {
    rows: [{ id: items[0].id, tag: "P" }, { id: items[1].id, tag: "NOPE" }],
  }, s.tok);
  assert.equal(junk.status, 400);
  assert.deepEqual(await readTags(root), tags);
});

test("a trash that reports success without deleting keeps the frame in the index", async (t) => {
  const { root, items } = await archive(2);
  const id = items[0].id;
  const file = path.join(root, items[0].path);
  t.after(() => rm(root, { recursive: true, force: true }));

  /* A platform that says yes and does nothing, which is exactly what windows
     did with a file another program held open. */
  const liar = await up(root, { machine: { ...platform, trash: async () => {} } });
  // registered as well as closed below, so that a failing assertion in the
  // middle of this test cannot leave a listening socket holding the run open
  t.after(() => liar.close());
  assert.equal((await post(liar.url, "/api/bin", { ids: [id] }, liar.tok)).status, 200);

  const said = await post(liar.url, "/api/trash", { ids: [id] }, liar.tok);
  assert.equal(said.status, 500);
  const body = await said.json();
  assert.equal(body.ok, false);
  assert.equal(body.trashed, 0);
  assert.deepEqual(body.gone, []);
  assert.deepEqual(body.left, [id]);
  assert.ok(body.error);
  assert.ok((await readIndex(root)).items.some((i) => i.id === id));
  assert.deepEqual(await readBinned(root), [id]);
  await access(file);
  await liar.close();

  // and a platform that tells the truth
  const honest = await up(root, {
    machine: { ...platform, trash: async (paths) => { for (const p of paths) await unlink(p); } },
  });
  t.after(() => honest.close());

  const done = await post(honest.url, "/api/trash", { ids: [id] }, honest.tok);
  assert.equal(done.status, 200);
  const out = await done.json();
  assert.equal(out.ok, true);
  assert.equal(out.trashed, 1);
  assert.deepEqual(out.gone, [id]);
  assert.deepEqual(out.left, []);
  assert.ok(!(await readIndex(root)).items.some((i) => i.id === id));
  assert.deepEqual(await readBinned(root), []);
  await assert.rejects(access(file));
});

test("a clip cannot be placed", async (t) => {
  const { root, items } = await archive(2);
  const index = await readIndex(root);
  index.items[1].kind = "film";
  await writeIndex(root, index);

  const s = await up(root);
  t.after(async () => { await s.close(); await rm(root, { recursive: true, force: true }); });
  const slot = (await loadConfig(root)).slots[0].id;

  const refused = await post(s.url, "/api/place", { slot, id: items[1].id, place: CENTERED }, s.tok);
  assert.equal(refused.status, 400);
  assert.equal(
    (await refused.json()).error,
    "a clip cannot be placed. the bench cuts stills, and a clip is film.",
  );

  // an id nothing in the archive answers to is its own sentence
  const nobody = await post(s.url, "/api/place", { slot, id: "0123456789ab", place: CENTERED }, s.tok);
  assert.equal(nobody.status, 404);

  // and a still still goes in
  const taken = await post(s.url, "/api/place", { slot, id: items[0].id, place: CENTERED }, s.tok);
  assert.equal(taken.status, 200);
});

test("the tray export writes inside the queue", async (t) => {
  /* Enough frames that the copy takes long enough for a rename typed during
     it to land in the middle, which is the whole shape of the bug: the export
     used to write back a trays.json it had read before it started. */
  const { root, items } = await archive(300);
  const dest = await mkdtemp(path.join(tmpdir(), "keeper-dest-"));
  const s = await up(root);
  t.after(async () => {
    await s.close();
    await rm(root, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  const made = await post(s.url, "/api/trays", { name: "job" }, s.tok).then((r) => r.json());
  const id = made.tray.id;
  assert.equal((await send(s.url, "/api/trays", "PATCH", { id, add: items.map((i) => i.id) }, s.tok)).status, 200);

  const exporting = post(s.url, "/api/trays/export", { id, folder: dest, mode: "copy" }, s.tok);
  await new Promise((r) => setTimeout(r, 15));
  const renamed = await send(s.url, "/api/trays", "PATCH", { id, name: "the new name" }, s.tok);
  assert.equal(renamed.status, 200);

  const out = await (await exporting).json();
  assert.equal(out.ok, true);
  assert.equal(out.written, items.length);

  const tray = (await readTrays(root)).trays.find((x) => x.id === id);
  assert.equal(tray.name, "the new name");
  assert.equal(tray.dest, out.dest);
  assert.equal(tray.mode, "copy");
});

test("a busy archive is refused at open", async (t) => {
  const { root } = await archive(1);
  const other = await mkdtemp(path.join(tmpdir(), "keeper-held-"));
  const flag = path.join(other, "held");
  const s = await up(root);

  const held = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    `import { claim } from ${JSON.stringify(pathToFileURL(path.join(REPO, "src/lock.mjs")).href)};
     import { writeFile } from "node:fs/promises";
     await claim(process.argv[1]);
     await writeFile(process.argv[2], "held");
     setInterval(() => {}, 1e9);`,
    other,
    flag,
  ], { stdio: "ignore" });

  t.after(async () => {
    held.kill("SIGKILL");
    await s.close();
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });

  for (let n = 0; n < 200; n++) {
    try { await access(flag); break; } catch { await new Promise((r) => setTimeout(r, 25)); }
  }
  await access(flag);

  const refused = await post(s.url, "/api/open", { path: other }, s.tok);
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /another keeper \(pid \d+\)/);

  // and this server is still holding the folder it was serving
  const run = JSON.parse(await readFile(path.join(root, ".keeper", "run.json"), "utf8"));
  assert.equal(run.pid, process.pid);
  assert.equal(run.token, s.token);
});

test("an unreadable archive is refused at boot", async (t) => {
  const { root } = await archive(1);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, ".keeper", "tags.json"), "nope");

  const config = await loadConfig(root);
  /* Held so that a serve which answered instead of refusing gets closed
     anyway. A listening socket nobody closes keeps the whole run alive, and a
     test that hangs says far less than a test that fails. */
  const slipped = {};
  t.after(() => slipped.up && new Promise((done) => {
    slipped.up.server.closeAllConnections?.();
    slipped.up.server.close(done);
  }));
  await assert.rejects(
    async () => { slipped.up = await serve({ root, config, port: 0 }); },
    (e) => e.code === "EUNREADABLE" && /tags\.json\.bak/.test(e.message),
  );
});
