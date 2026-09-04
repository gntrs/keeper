/* ---------------------------------------------------------------------
   what gets written down about the walkthrough, and what refuses to be.

   The walkthrough runs once per machine and the answer lives in the seat, so
   the seat is the only thing standing between a person and being shown this
   again, or never being shown it at all. Both failures were real. A first
   launch that never ran a single card came back next time as a machine that
   had already been through it, and one escape key aimed at the update card
   in the corner recorded the whole walkthrough as answered after one card.

   So these are as much about what the route refuses to write as about what
   it writes. Anything that is not the word `done` set to true is a body the
   walkthrough did not send, and the seat has to come out of it untouched:
   not stamped with this version, and with no `toured` key in it at all,
   because that key existing at any value is what tells the next launch this
   machine is not a first run.

   Nothing here touches an archive anybody owns. Every test makes its own
   folder in the system temp directory and takes it away again.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/* the seat goes somewhere disposable before a line of src/ runs, because
   runtime.mjs reads it at import and a test that read the real one would be
   answering questions about the person running the tests. the dynamic
   imports below are what make that ordering possible at all. */
const SEAT = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
process.env.KEEPER_HOME = SEAT;

const { serve } = await import("../src/server.mjs");
const { loadConfig } = await import("../src/config.mjs");
const { idFor, writeIndex } = await import("../src/store.mjs");

/**
 * A seat of its own for each test, so one test's answer is never the thing
 * the next one is reading. appDir() asks the environment every time it is
 * called rather than once at import, which is what makes this work.
 */
async function seat(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-seat-"));
  const was = process.env.KEEPER_HOME;
  process.env.KEEPER_HOME = dir;
  t.after(async () => {
    process.env.KEEPER_HOME = was;
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    /* the seat as it stands. it is rarely empty even before anybody has
       answered anything: opening an archive stamps the version that ran, so
       what these tests look at is which keys are in it and never whether a
       file is there at all. */
    read: async () => {
      try {
        return JSON.parse(await readFile(path.join(dir, "seat.json"), "utf8"));
      } catch {
        return {};
      }
    },
  };
}

/** an archive with something in it, because a walkthrough over nothing is not offered */
async function archive(t, n = 2) {
  const root = await mkdtemp(path.join(tmpdir(), "keeper-arc-"));
  await mkdir(path.join(root, "roll 01"), { recursive: true });
  const items = [];
  for (let i = 1; i <= n; i++) {
    const rel = `roll 01/DSC_${String(i).padStart(4, "0")}.jpg`;
    await sharp({
      create: { width: 48, height: 32, channels: 3, background: { r: 30 + i, g: 60, b: 90 } },
    }).jpeg().toFile(path.join(root, rel));
    items.push({ path: rel, bytes: 1, kind: "still", id: idFor(rel), w: 48, h: 32 });
  }
  await writeIndex(root, { items, builtAt: new Date().toISOString(), root });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function up(t, root) {
  const config = await loadConfig(root);
  const { server, url, token } = await serve({ root, config, port: 0 });
  t.after(() => new Promise((done) => {
    server.closeAllConnections?.();
    server.close(done);
  }));
  return { url, token };
}

/** the walkthrough's own write, exactly as web/tour.js sends it */
const answer = (url, token, body) =>
  fetch(url + "/api/tour", {
    method: "POST",
    headers: { "content-type": "application/json", "x-keeper-token": token },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/* ---- the one body that writes ---------------------------------------- */

test("finishing the walkthrough is written down, with the version it was finished on", async (t) => {
  const seed = await seat(t);
  const { url, token } = await up(t, await archive(t));

  assert.equal("toured" in (await seed.read()), false, "nothing has answered anything yet");

  const res = await answer(url, token, { done: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, toured: true });

  const said = await seed.read();
  assert.equal(said.toured, 1, "the revision of the cards that was answered");
  assert.equal(typeof said.seen, "string", "and the keeper it was answered on");
  assert.ok(said.seen.length, "a version and not an empty string");
});

/* ---- and every body that does not ------------------------------------ */

for (const [name, body] of [
  ["done set to false", { done: false }],
  ["an empty object", {}],
  ["a truthy thing that is not true", { done: "yes" }],
  ["a one that is not a true", { done: 1 }],
  ["the word done somewhere else", { tour: { done: true } }],
  ["null", null],
  ["a list", [{ done: true }]],
  ["a string that is not json at all", "not json"],
  ["nothing at all", ""],
]) {
  test(`${name} writes nothing to the seat`, async (t) => {
    const seed = await seat(t);
    const { url, token } = await up(t, await archive(t));

    const res = await answer(url, token, body);
    assert.equal(res.status, 200, "it is answered rather than refused");
    assert.deepEqual(await res.json(), { ok: true, toured: false });

    const said = await seed.read();
    assert.equal("toured" in said, false, "the walkthrough wrote no answer");
    assert.equal("seen" in said, false, "and stamped no version on the seat");
  });
}

/**
 * The one that is not obvious, and the reason the check above is `!== true`
 * rather than a falsy test that quietly writes a zero.
 *
 * `returning()` in runtime.mjs asks whether the seat has a `toured` key, at
 * any value, because that key is only ever put there by somebody answering.
 * A walkthrough that wrote `toured: 0` on its way past would hand the next
 * launch a machine that looks experienced, and an experienced machine is
 * offered a card about what changed instead of the cards it has never seen.
 */
test("a body that did not finish leaves no toured key, so the next launch is still a first run", async (t) => {
  const seed = await seat(t);
  const { url, token } = await up(t, await archive(t));

  await answer(url, token, { done: false });
  await answer(url, token, {});

  assert.equal("toured" in (await seed.read()), false, "still a first run");

  /* and it stays a first run after something else has written to the seat,
     which is the shape the real bug had: the update answer lands in the same
     file and the walkthrough must not be riding along with it. */
  await fetch(url + "/api/update/allow", {
    method: "POST",
    headers: { "content-type": "application/json", "x-keeper-token": token },
    body: JSON.stringify({ yes: false }),
  });
  const after = await seed.read();
  assert.equal(after.updates, "off", "the update answer wrote its own field");
  assert.equal("toured" in after, false, "and the walkthrough put nothing in it");
  assert.equal("seen" in after, false, "and stamped no version on it");
});

/* ---- the token, and what a refusal must not leave behind -------------- */

test("a write with no token changes nothing about the walkthrough", async (t) => {
  const seed = await seat(t);
  const { url } = await up(t, await archive(t));

  const res = await fetch(url + "/api/tour", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done: true }),
  });
  assert.notEqual(res.status, 200);
  assert.equal("toured" in (await seed.read()), false, "and nothing was answered");
});

/* ---- what the page is told on the way in ------------------------------ */

test("the state says whether this machine has answered, before and after", async (t) => {
  const seed = await seat(t);
  const root = await archive(t);
  const { url, token } = await up(t, root);

  const before = await (await fetch(url + "/api/state")).json();
  assert.equal(before.toured, false, "nothing answered, so the cards are owed");

  await answer(url, token, { done: true });
  assert.equal((await seed.read()).toured, 1);

  /* a second server, because `toured` is read from the seat per request but
     the point of the field is that it survives the process that wrote it */
  const next = await up(t, root);
  const after = await (await fetch(next.url + "/api/state")).json();
  assert.equal(after.toured, true, "answered once, and it stays answered");
});
