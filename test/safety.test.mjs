/* ---------------------------------------------------------------------
   the six ways keeper was measured losing somebody's work, made to happen
   again here against the real code, on archives of their own.

   None of these is a guess about what might go wrong. Each one is a
   failure that was measured on a real machine before the fix it now
   guards: a tags.json left six megabytes long and unparseable by a kill in
   the middle of one write, eighty stars split across two keepers on one
   folder with seventy eight of them gone, a contact sheet applied from a
   second process that took eighty rows to three, a delete that said yes
   and removed nothing, a page on another origin writing into the archive,
   and an export that wrote over the crop before it because somebody had
   thrown its sidecar away. In every case both sides reported success.

   Each test was also run against a copy of the code with its fix taken
   back out, and went red there. A test that passes against the broken
   code proves nothing, so that is not assumed of any of these.

   Nothing here touches a folder anybody owns. Every archive is made in
   the system temp directory, the seat is pointed at a temp folder before a
   single line of src/ is imported, and every server started here listens
   on a port the operating system picked.
   --------------------------------------------------------------------- */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, statSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";

/* The seat first, because runtime.mjs reads it the moment it is imported and
   a test that read the real one would be answering questions about whoever
   is running the tests. Everything from src/ is imported dynamically below
   for the same reason: a static import runs before any line of this file. */
const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const SRC = (name) => new URL(`../src/${name}`, import.meta.url).href;
const BIN = new URL("../bin/keeper.mjs", import.meta.url).pathname;

const { serve } = await import(SRC("server.mjs"));
const { loadConfig } = await import(SRC("config.mjs"));
const { idFor, paths, readBinned, readIndex, readTags, writeIndex, writeTags, writePlacements } =
  await import(SRC("store.mjs"));
const { host: platform } = await import(SRC("os/index.mjs"));
const { exportCrops } = await import(SRC("crops.mjs"));

/* Every serve() in this process adds an exit handler that lets go of its
   claim, and this file starts more than the ten node warns at. */
process.setMaxListeners(64);

const made = [SEAT];
after(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/**
 * An archive with real files at the paths the index names.
 *
 * The index is written by hand rather than scanned, because the scan is
 * another file's business and what matters here is that the frames exist:
 * the trash sweep and the export both go to the disk, and a test against an
 * index over nothing would pass whatever they did.
 */
async function archive(n, { width = 64, height = 48 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-safe-"));
  made.push(root);
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  const items = [];
  for (let i = 1; i <= n; i++) {
    const rel = `roll 01/DSC_${String(i).padStart(4, "0")}.jpg`;
    await sharp({ create: { width, height, channels: 3, background: { r: (i * 7) % 255, g: 70, b: 110 } } })
      .jpeg()
      .toFile(path.join(root, rel));
    items.push({ path: rel, bytes: 1, kind: "still", id: idFor(rel), w: width, h: height });
  }
  await writeIndex(root, { items, builtAt: new Date().toISOString(), root });
  return { root, items };
}

/** a keeper in this process, on a port the system picks */
async function up(root, extra = {}) {
  const { server, url, token } = await serve({ root, config: await loadConfig(root), port: 0, ...extra });
  return {
    url,
    token,
    tok: { "x-keeper-token": token },
    close: () => new Promise((done) => {
      // fetch keeps its sockets open, and close on its own would wait for
      // a client that has no intention of leaving
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

/**
 * A second keeper in a process of its own.
 *
 * The claim is per process, so a second serve() in this process on the same
 * folder would be read as this keeper refreshing its own claim and would
 * prove nothing. The child prints one line, the url and token when it came
 * up or the error when it was refused, and then waits to be killed.
 */
function spawnServer(root) {
  const kid = spawn(process.execPath, ["--input-type=module", "-e", `
    const { serve } = await import(${JSON.stringify(SRC("server.mjs"))});
    const { loadConfig } = await import(${JSON.stringify(SRC("config.mjs"))});
    const root = process.argv[1];
    try {
      const { url, token } = await serve({ root, config: await loadConfig(root), port: 0 });
      console.log(JSON.stringify({ url, token }));
    } catch (e) {
      console.log(JSON.stringify({ error: e.message, code: e.code }));
      process.exit(0);
    }
    setInterval(() => {}, 1e9);
  `, root], { stdio: ["ignore", "pipe", "pipe"] });

  let err = "";
  kid.stderr.on("data", (d) => { err += d; });
  const ready = new Promise((resolve, reject) => {
    let out = "";
    kid.stdout.on("data", (d) => {
      out += d;
      const nl = out.indexOf("\n");
      if (nl >= 0) resolve(JSON.parse(out.slice(0, nl)));
    });
    kid.on("exit", (code) => reject(new Error(`the second keeper exited ${code} before saying anything: ${err}`)));
  });
  return { kid, ready, stderr: () => err };
}

/** the cli as somebody would type it, with the test's own seat and no colour */
function keeper(args) {
  const kid = spawn(process.execPath, [BIN, ...args], {
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  kid.stdout.on("data", (d) => { said += d; });
  kid.stderr.on("data", (d) => { said += d; });
  return once(kid, "exit").then(([code]) => ({ code, said }));
}

/* a fingerprint of the sidecar folder: names and sizes. it changes the
   instant a write puts a byte down, under whatever name it puts it */
const fingerprint = (dir) =>
  readdirSync(dir).sort().map((n) => `${n}:${statSync(path.join(dir, n)).size}`).join(" ");

/**
 * Tags by the tens of thousands, so that one write is tens of milliseconds
 * long. That is what a real archive's tags.json looks like once the notes an
 * agent leaves are in it, and it is the size at which the measured failures
 * became reachable: a small file is written between two ticks and no kill,
 * and no second reader, can land inside it.
 */
function heavy(rows, note = "n".repeat(200)) {
  const out = {};
  for (let i = 0; i < rows; i++) out[idFor(`roll 99/DSC_${i}.jpg`)] = { tag: "P", star: 0, note };
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. a kill in the middle of a write                                  */
/* ------------------------------------------------------------------ */

/**
 * Measured: SIGKILL 240ms into one /api/tag left tags.json at 6,291,456
 * bytes and unparseable, and the next keeper on that archive answered
 * /api/state with no tags and no error. The write truncated the file first
 * and filled it afterwards, and the reader answered a file it could not
 * parse with an empty object.
 *
 * The keeper here is a child so that it can really be killed, and the kill
 * is aimed from the first byte the write puts down rather than from the
 * request, because a kill that lands before the write proves nothing. Two
 * distances in: one that is certainly inside the write and one further on.
 */
test("a keeper killed in the middle of a tag write leaves tags.json whole", async (t) => {
  const old = heavy(60000);
  const ROWS = Object.keys(old).length;

  for (const delay of [3, 25]) {
    const { root, items } = await archive(1);
    await writeTags(root, old);
    const dir = paths(root).dir;

    const second = spawnServer(root);
    const { url, token } = await second.ready;
    t.after(() => { try { second.kid.kill("SIGKILL"); } catch { /* already gone */ } });

    const before = fingerprint(dir);
    const exited = once(second.kid, "exit");
    // not awaited: the process it is talking to is about to die under it
    const inflight = post(url, "/api/tag", { id: items[0].id, star: 1 }, { "x-keeper-token": token }).catch(() => null);

    /* polled rather than spun, because a loop that never yields would also
       stop this process from ever sending the request it is waiting on */
    const giveUp = Date.now() + 20000;
    while (fingerprint(dir) === before && Date.now() < giveUp) await sleep(1);
    assert.notEqual(fingerprint(dir), before, "the write never started");
    await sleep(delay);
    second.kid.kill("SIGKILL");
    await exited;
    await inflight;

    /* whole, and every old row still in it. the new star is allowed to be
       there or not, because either the write landed entirely or it never
       landed, and both of those are the truth about what happened */
    const got = await readTags(root);
    assert.equal(Object.keys(got).length >= ROWS, true, `rows went missing when killed ${delay}ms into the write`);
    for (const id of Object.keys(old)) {
      assert.deepEqual(got[id], old[id], `row ${id} was damaged when killed ${delay}ms into the write`);
    }
    const star = got[items[0].id];
    assert.ok(star === undefined || star.star === 1);

    /* and the next keeper on this archive sees them. the measured failure
       ended with a page that said zero tags and nothing else. */
    const next = await up(root);
    t.after(() => next.close());
    const state = await fetch(`${next.url}/api/state`).then((r) => r.json());
    assert.equal(Object.keys(state.tags).length >= ROWS, true, "a fresh keeper answered with the tags gone");
    await next.close();
  }
});

/* ------------------------------------------------------------------ */
/* 2. two keepers on one archive                                       */
/* ------------------------------------------------------------------ */

/**
 * Measured: eighty star writes split across two servers on one folder left
 * a two row tags.json with the tag letters stripped, seventy eight rows
 * gone, and every one of the eighty answered 200. Each server's queue
 * ordered its own writes and could not see the other's.
 *
 * The second keeper has to be refused. If it is not, the eighty writes are
 * split across the two exactly as two windows would split them, and every
 * row and every letter has to come out the other side, which is the
 * assertion that goes red against a keeper that lets the second one in.
 */
test("a second keeper on the same archive is refused, so a burst cannot be split across two", async (t) => {
  const { root, items } = await archive(80);
  // a letter on every row before the stars arrive, because the measured
  // failure stripped the letters from the rows it did not lose outright
  await writeTags(root, Object.fromEntries(items.map((i) => [i.id, { tag: "P" }])));

  const first = await up(root);
  t.after(() => first.close());
  const second = spawnServer(root);
  const said = await second.ready;
  t.after(() => { try { second.kid.kill("SIGKILL"); } catch { /* already gone */ } });

  if (said.error) {
    assert.equal(said.code, "EBUSY", said.error);
    assert.match(said.error, /another keeper \(pid \d+\) has this archive open at http:\/\/127\.0\.0\.1:\d+/);
    // and the claim the first one holds is untouched by the refusal
    const run = JSON.parse(await readFile(paths(root).run, "utf8"));
    assert.equal(run.pid, process.pid);
    assert.equal(run.token, first.token);
  }

  const doors = said.error
    ? [first]
    : [first, { url: said.url, tok: { "x-keeper-token": said.token } }];
  const answers = await Promise.all(items.map((it, i) => {
    const door = doors[i % doors.length];
    return post(door.url, "/api/tag", { id: it.id, star: 1 }, door.tok);
  }));
  for (const r of answers) assert.equal(r.status, 200);

  const tags = await readTags(root);
  assert.equal(Object.keys(tags).length, items.length, "rows went missing");
  for (const it of items) {
    assert.equal(tags[it.id]?.star, 1, `${it.path} lost its star`);
    assert.equal(tags[it.id]?.tag, "P", `${it.path} lost its letter`);
  }
  assert.ok(said.error, "a second keeper was allowed onto an archive that already had one");
});

/* ------------------------------------------------------------------ */
/* 3. keeper tag against a live keeper                                 */
/* ------------------------------------------------------------------ */

/**
 * Measured: `keeper tag` run while a keeper was serving the archive and a
 * person was starring frames in it took eighty rows to three with no tag
 * letters left, and both the terminal and the page said they had succeeded.
 * The command read the file, merged its rows into the copy it had read and
 * wrote the whole thing back from a second process.
 *
 * Here eighty stars are in flight from the page while the command runs on
 * a contact sheet of four other frames. Every star and every letter has to
 * be on the disk afterwards, and the command has to have gone through the
 * keeper rather than round it.
 */
test("keeper tag against a live keeper loses none of the stars landing beside it", async (t) => {
  const { root, items } = await archive(84);
  const starred = items.slice(0, 80);
  const sheet = items.slice(80);
  // the file the real one is: thousands of rows already, so every write is
  // long enough for a second process to land in the middle of it
  await writeTags(root, heavy(8000));

  await mkdir(paths(root).sheets, { recursive: true });
  await writeFile(
    path.join(paths(root).sheets, "index.json"),
    JSON.stringify(sheet.map((it, n) => ({ sheet: 1, cell: `r1c${n + 1}`, id: it.id })), null, 1),
  );
  const file = path.join(root, "tags.txt");
  await writeFile(file, "1  PLTW * r1c2\n");

  const s = await up(root);
  t.after(() => s.close());

  /* sheet[0] is starred in the page AND sits on the sheet the agent is about
     to write, which is the case that actually lost data: the agent starred
     r1c2 and nothing else, and the row it sent for r1c1 carried star: 0,
     which the server merged straight over the person's star: 1. Measured
     before the fix: 0 of 2 page stars on sheet frames survived, and the
     terminal said `tagged 4 frames` while it happened. */
  const alsoOnSheet = [...starred, sheet[0]];
  const burst = Promise.all(alsoOnSheet.map((it) => post(s.url, "/api/tag", { id: it.id, star: 1 }, s.tok)));
  await sleep(20);
  const [{ code, said }, answers] = await Promise.all([keeper(["tag", root, file]), burst]);

  assert.equal(code, 0, said);
  for (const r of answers) assert.equal(r.status, 200);

  /* the disk first, the message second. against the old command the disk is
     what went wrong, and a test that fails on the missing sentence before it
     looks at the rows would go red for the wrong reason. */
  const tags = await readTags(root);
  for (const it of starred) assert.equal(tags[it.id]?.star, 1, `${it.path} lost its star`);
  assert.deepEqual(sheet.map((it) => tags[it.id]?.tag), ["P", "L", "T", "W"]);
  assert.equal(tags[sheet[1].id].star, 1, "the star marked on the sheet did not land");
  assert.equal(tags[sheet[0].id].star, 1, "the page's own star was wiped by a sheet that did not mention it");
  /* A reader of a contact sheet can say "this one is a keeper" and cannot say
     "this one is not", so a cell nobody starred carries no star at all rather
     than a zero that overwrites somebody else's answer. */
  assert.equal(tags[sheet[2].id].star, undefined, "an unstarred cell should carry no star");
  assert.equal(Object.keys(tags).length, 8000 + items.length, "rows went missing");
  assert.match(said, /through the keeper already open/);
});

/* ------------------------------------------------------------------ */
/* 4. a delete that says yes and does nothing                          */
/* ------------------------------------------------------------------ */

/**
 * Measured on windows: the shell delete came back clean with the file still
 * on the drive, the ids left the index anyway, and the wall and the disk
 * disagreed from then on. The platform is faked here because there is no
 * other way to make it lie on demand, and that is the point: what the
 * platform says happened is a claim, and the server has to check it.
 *
 * Four platforms in turn on one archive: one that says yes and does
 * nothing, one that does half, one that does the job and then complains,
 * and one that must never be reached at all.
 */
test("a delete the platform says it did and did not do keeps the frame in the index", async (t) => {
  const { root, items } = await archive(3);
  const [a, b, c] = items;
  const file = (it) => path.join(root, it.path);
  const inIndex = async (it) => (await readIndex(root)).items.some((i) => i.id === it.id);

  /* the liar: resolves, removes nothing */
  const liar = await up(root, { machine: { ...platform, trash: async () => {} } });
  t.after(() => liar.close());
  assert.equal((await post(liar.url, "/api/bin", { ids: [a.id, b.id] }, liar.tok)).status, 200);

  const said = await post(liar.url, "/api/trash", { ids: [a.id] }, liar.tok);
  assert.equal(said.status, 500);
  const body = await said.json();
  assert.equal(body.ok, false);
  assert.equal(body.trashed, 0);
  assert.deepEqual(body.gone, []);
  assert.deepEqual(body.left, [a.id]);
  assert.match(body.error, /still on the drive/);
  assert.equal(await inIndex(a), true, "a frame the drive still holds left the index");
  assert.deepEqual(await readBinned(root), [a.id, b.id]);
  await access(file(a));
  await liar.close();

  /* half: the first file goes, the second stays */
  const half = await up(root, { machine: { ...platform, trash: async (ps) => { await unlink(ps[0]); } } });
  t.after(() => half.close());
  const two = await post(half.url, "/api/trash", { ids: [a.id, b.id] }, half.tok);
  assert.equal(two.status, 500);
  const split = await two.json();
  assert.equal(split.ok, false);
  assert.equal(split.trashed, 1);
  assert.deepEqual(split.gone, [a.id]);
  assert.deepEqual(split.left, [b.id]);
  assert.equal(await inIndex(a), false, "a frame that left the drive stayed in the index");
  assert.equal(await inIndex(b), true, "a frame the drive still holds left the index");
  assert.deepEqual(await readBinned(root), [b.id]);
  await assert.rejects(access(file(a)));
  await access(file(b));
  await half.close();

  /* loud: does the job, then throws. the disk is what counts, so this is a
     delete that worked, and the index says so */
  const loud = await up(root, {
    machine: { ...platform, trash: async (ps) => { for (const p of ps) await unlink(p); throw new Error("no"); } },
  });
  t.after(() => loud.close());
  const done = await post(loud.url, "/api/trash", { ids: [b.id] }, loud.tok);
  assert.equal(done.status, 200);
  const out = await done.json();
  assert.equal(out.ok, true);
  assert.deepEqual(out.gone, [b.id]);
  assert.deepEqual(out.left, []);
  assert.equal(await inIndex(b), false);
  assert.deepEqual(await readBinned(root), []);
  await assert.rejects(access(file(b)));
  await loud.close();

  /* never reached: a frame that is not in the bin, and an id the index has
     never heard of, are refused before the platform is asked anything */
  let asked = 0;
  const strict = await up(root, { machine: { ...platform, trash: async () => { asked++; } } });
  t.after(() => strict.close());
  assert.equal((await post(strict.url, "/api/trash", { ids: [c.id] }, strict.tok)).status, 409);
  assert.equal((await post(strict.url, "/api/trash", { ids: ["0123456789ab"] }, strict.tok)).status, 404);
  assert.equal((await post(strict.url, "/api/trash", { ids: [] }, strict.tok)).status, 400);
  assert.equal(asked, 0, "the platform was asked to delete a frame it should never have been asked about");
  assert.equal(await inIndex(c), true);
  await access(file(c));
});

/* ------------------------------------------------------------------ */
/* 5. a write from another page, or without the token                  */
/* ------------------------------------------------------------------ */

/**
 * Measured: a page served from another origin posted to this port and was
 * answered. The check was a list of eight routes and it missed /api/tag,
 * /api/bin, /api/place and every tray route, and the json content type it
 * relied on was no defence at all.
 *
 * So every request that is not a read is asked two questions before any
 * route is looked at: where it came from, and whether it carries the token
 * this process wrote into its own page. The page's own request passes both,
 * the command line's passes with no origin at all, and a read is never
 * asked, because a read cannot lose anybody anything.
 */
test("a write from another page, or without the token, is refused, and the page's own goes through", async (t) => {
  const { root, items } = await archive(2);
  const s = await up(root);
  t.after(() => s.close());
  const origin = new URL(s.url).origin;
  const row = { id: items[0].id, star: 1 };

  const refused = async (headers, why) => {
    const r = await post(s.url, "/api/tag", row, headers);
    assert.equal(r.status, 403, why);
    return (await r.json()).error;
  };

  assert.match(await refused({ ...s.tok, origin: "http://evil.example" }, "a foreign origin"), /came from another page/);
  assert.match(await refused({ ...s.tok, origin: "http://127.0.0.1:1" }, "the same host on another port"), /came from another page/);
  assert.match(await refused({ ...s.tok, origin: "null" }, "an opaque origin"), /came from another page/);
  // a form post carries no Origin, and the browser says where it came from
  // in the header it sends instead
  assert.match(await refused({ ...s.tok, "sec-fetch-site": "cross-site" }, "a cross site form"), /came from another page/);
  assert.match(await refused({ ...s.tok, "sec-fetch-site": "same-site" }, "a same site, other origin form"), /came from another page/);
  assert.match(await refused({ origin }, "no token"), /did not carry this keeper's token/);
  assert.match(await refused({ origin, "x-keeper-token": "0".repeat(32) }, "a wrong token"), /did not carry this keeper's token/);
  assert.match(await refused({}, "nothing at all"), /did not carry this keeper's token/);
  assert.deepEqual(await readTags(root), {}, "a refused write reached the disk");

  /* every route that writes, behind the same door, with no list to forget
     to add to. the body is nonsense on purpose: none of these may get far
     enough to read it. */
  const writes = [
    ["POST", "/api/tag"], ["POST", "/api/bin"], ["POST", "/api/place"], ["DELETE", "/api/place?slot=hero"],
    ["POST", "/api/trays"], ["PATCH", "/api/trays"], ["DELETE", "/api/trays?id=tray-1"],
    ["POST", "/api/trays/export"], ["POST", "/api/export"], ["POST", "/api/open"],
    ["POST", "/api/trash"], ["POST", "/api/reveal"], ["POST", "/api/reveal-export"],
    ["POST", "/api/choose"], ["POST", "/api/locate"], ["POST", "/api/doctor"], ["POST", "/api/quit"],
    ["POST", "/api/tour"], ["POST", "/api/update/allow"], ["POST", "/api/update/apply"],
    ["POST", "/no/such/route"],
  ];
  for (const [method, route] of writes) {
    const bare = await send(s.url, route, method, { ids: [items[0].id], path: root, id: "x" });
    assert.equal(bare.status, 403, `${method} ${route} answered ${bare.status} without a token`);
    const foreign = await send(s.url, route, method, {}, { ...s.tok, origin: "http://evil.example" });
    assert.equal(foreign.status, 403, `${method} ${route} answered ${foreign.status} from another page`);
  }
  assert.deepEqual(await readBinned(root), []);
  assert.ok((await readIndex(root)).items.length === 2);

  /* the page's own request, dressed exactly as a browser dresses it */
  const own = await post(s.url, "/api/tag", row, { ...s.tok, origin, "sec-fetch-site": "same-origin" });
  assert.equal(own.status, 200);
  assert.deepEqual(await readTags(root), { [items[0].id]: { star: 1 } });

  /* the command line's, which sends no origin and no sec-fetch-site */
  const cli = await post(s.url, "/api/tag", { id: items[1].id, tag: "L" }, s.tok);
  assert.equal(cli.status, 200);
  assert.equal((await readTags(root))[items[1].id].tag, "L");

  /* reads are not asked, and none of them hands the token out */
  const state = await fetch(`${s.url}/api/state`, { headers: { origin: "http://evil.example" } });
  assert.equal(state.status, 200);
  const shown = await state.text();
  assert.ok(!shown.includes(s.token), "the token is in /api/state, which any page can read");
  for (const route of ["/api/ping", "/api/progress", "/api/trays"]) {
    const r = await fetch(`${s.url}${route}`, { headers: { origin: "http://evil.example" } });
    assert.equal(r.status, 200, route);
    assert.ok(!(await r.text()).includes(s.token), `the token is in ${route}`);
  }
  // the one place it is: the page this process serves, which another
  // origin cannot read
  const page = await fetch(`${s.url}/`);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.ok((await page.text()).includes(`window.KEEPER_TOKEN="${s.token}"`));
});

/* ------------------------------------------------------------------ */
/* 6. an export with the sidecar thrown away                           */
/* ------------------------------------------------------------------ */

/**
 * Measured: with hero.json deleted by hand, the next export wrote hero.jpg
 * straight over the crop already there and said "wrote 1 crop". The free
 * name was decided by asking the disk about the sidecar alone, which is the
 * one file of the three a person is most likely to throw away once read.
 *
 * Twice through the function the terminal uses and twice through the route
 * the bench presses, with a different sidecar gone each time. The bytes of
 * every crop written earlier have to be the bytes still there afterwards.
 */
test("an export never writes over a crop whose sidecar was thrown away", async (t) => {
  const { root, items } = await archive(1, { width: 900, height: 600 });
  const out = await mkdtemp(path.join(tmpdir(), "keeper-out-"));
  made.push(out);
  const slots = [
    { id: "hero", label: "hero", aspect: "3/2" },
    { id: "square", label: "square", aspect: "1/1" },
  ];
  await writeFile(path.join(root, "keeper.config.json"), JSON.stringify({ slots, out, formats: false }));
  const config = await loadConfig(root);
  const at = { id: items[0].id, place: { cx: 0.5, cy: 0.5, cw: 1 } };
  await writePlacements(root, { hero: at, square: at });
  const bytes = async (name) => readFile(path.join(out, name));

  const first = await exportCrops({ root, config });
  assert.equal(first.written, 2);
  assert.deepEqual((await readdir(out)).sort(), ["hero.css", "hero.jpg", "hero.json", "square.css", "square.jpg", "square.json"]);
  const hero = await bytes("hero.jpg");
  const square = await bytes("square.jpg");

  /* The framing moves before the second export. Cutting the same rectangle
     twice gives the same jpeg byte for byte, so an export that wrote over
     the first crop would leave a file that still compares equal, and the
     assertion below would pass against the very bug it is here for. The
     real afternoon is this one anyway: export, throw the sidecar away, punch
     the crop in, export again, and expect both framings to be on the disk. */
  const moved = { id: items[0].id, place: { cx: 0.6, cy: 0.5, cw: 0.7 } };
  await writePlacements(root, { hero: moved, square: moved });

  // the json from one, the css from the other
  await rm(path.join(out, "hero.json"));
  await rm(path.join(out, "square.css"));
  const second = await exportCrops({ root, config });
  assert.equal(second.written, 2);
  assert.deepEqual(await bytes("hero.jpg"), hero, "hero.jpg was written over");
  assert.deepEqual(await bytes("square.jpg"), square, "square.jpg was written over");
  assert.deepEqual(second.rows.map((r) => path.basename(r.file)).sort(), ["hero-2.jpg", "square-2.jpg"]);
  assert.notDeepEqual(await bytes("hero-2.jpg"), hero, "the second framing came out identical to the first, so an overwrite could not be seen");

  /* the route the bench presses, on the same folder, with the second
     export's own sidecar gone this time */
  const s = await up(root);
  t.after(() => s.close());
  await rm(path.join(out, "hero-2.json"));
  const hero2 = await bytes("hero-2.jpg");
  const third = await post(s.url, "/api/export", { slot: "hero" }, s.tok);
  assert.equal(third.status, 200);
  const shipped = await third.json();
  assert.equal(shipped.written, 1);
  assert.deepEqual(shipped.files, ["hero-3.jpg"]);
  assert.deepEqual(await bytes("hero.jpg"), hero, "hero.jpg was written over by the route");
  assert.deepEqual(await bytes("hero-2.jpg"), hero2, "hero-2.jpg was written over by the route");
  await access(path.join(out, "hero-3.json"));
  await access(path.join(out, "hero-3.css"));

  /* and a stem held by a stranger's file is a stem held */
  await writeFile(path.join(out, "square-2.png"), "not a crop");
  await rm(path.join(out, "square-2.jpg"));
  await rm(path.join(out, "square-2.json"));
  await rm(path.join(out, "square-2.css"));
  const fourth = await exportCrops({ root, config, only: "square" });
  assert.equal(path.basename(fourth.rows[0].file), "square-3.jpg");
  assert.equal(await readFile(path.join(out, "square-2.png"), "utf8"), "not a crop");
});
