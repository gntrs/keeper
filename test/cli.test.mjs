import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/* A seat of this run's own, set before anything under src/ is imported,
   because appDir reads the environment and the person running these tests
   has an archive and a walkthrough answer of their own to lose. */
process.env.KEEPER_HOME = await mkdtemp(path.join(tmpdir(), "keeper-home-"));

const BIN = new URL("../bin/keeper.mjs", import.meta.url).pathname;
const LOCK = new URL("../src/lock.mjs", import.meta.url).href;

const { buildIndex } = await import("../src/open.mjs");
const { loadConfig } = await import("../src/config.mjs");
const { serve } = await import("../src/server.mjs");
const { readTags, paths } = await import("../src/store.mjs");

const made = [process.env.KEEPER_HOME];
after(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/**
 * Six frames in two rolls, small enough that the scan and the thumbnails are
 * over before the assertion below it, real enough that the ids are the ids
 * keeper would use on a drive.
 */
async function archive() {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-cli-"));
  made.push(dir);
  for (const [roll, n] of [["roll 01", 4], ["roll 02", 2]]) {
    await mkdir(path.join(dir, roll), { recursive: true });
    for (let i = 1; i <= n; i++) {
      /* 640 across and not smaller: the scan walks past anything under a
         kilobyte, because a sub-1KB image is a spacer and not a photograph,
         and a fixture that trips that rule tests nothing at all. */
      await sharp({ create: { width: 640, height: 427, channels: 3, background: { r: 40 + i * 20, g: 70, b: 110 } } })
        .jpeg()
        .toFile(path.join(dir, roll, `DSC_${String(i).padStart(4, "0")}.jpg`));
    }
  }
  const index = await buildIndex(dir);
  return { root: dir, ids: index.items.map((i) => i.id) };
}

/**
 * The four frames a contact sheet would have carried, written by hand
 * because building the sheets is a different command's job and this test is
 * about what happens to the file afterwards.
 */
async function sheet(root, ids) {
  const rows = ids.map((id, n) => ({ sheet: 1, cell: `r1c${n + 1}`, id }));
  await mkdir(paths(root).sheets, { recursive: true });
  await writeFile(path.join(paths(root).sheets, "index.json"), JSON.stringify(rows, null, 1));
  const file = path.join(root, "tags.txt");
  await writeFile(file, "1  PLTW * r1c1\n");
  return file;
}

/** the cli as somebody would run it, with its own seat and no colour codes */
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

/**
 * THE ONE THE RESEARCH MEASURED.
 *
 * A keeper is serving the archive and somebody is starring frames in it while
 * an agent's tags arrive from a second process. The cli used to read the tags
 * file, merge its own rows into the copy it had read, and write the whole
 * thing back: eighty rows became three and the tag letters went with them,
 * and both processes reported success. The two stars below are the rows that
 * were lost, and they belong to frames the contact sheet never mentions.
 */
test("keeper tag goes through a live server and loses nothing", async () => {
  const { root, ids } = await archive();
  const file = await sheet(root, ids.slice(0, 4));

  const { server, url, token } = await serve({ root, config: await loadConfig(root), port: 0 });
  try {
    for (const id of ids.slice(4)) {
      const res = await fetch(`${url}/api/tag`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-keeper-token": token },
        body: JSON.stringify({ id, star: 1 }),
      });
      assert.equal(res.status, 200);
    }

    const { code, said } = await keeper(["tag", root, file]);
    assert.equal(code, 0, said);
    assert.match(said, /through the keeper already open/);
  } finally {
    server.close();
    await once(server, "close");
  }

  const tags = await readTags(root);
  assert.equal(Object.keys(tags).length, 6);
  for (const id of ids.slice(4)) assert.equal(tags[id].star, 1, "a star written in the page survived the tags");
  assert.deepEqual(ids.slice(0, 4).map((id) => tags[id].tag), ["P", "L", "T", "W"]);
  assert.equal(tags[ids[0]].star, 1, "the star marked on the sheet landed too");
});

test("keeper tag takes the claim when nobody is home", async () => {
  const { root, ids } = await archive();
  const file = await sheet(root, ids.slice(0, 4));

  const { code, said } = await keeper(["tag", root, file]);
  assert.equal(code, 0, said);

  const tags = await readTags(root);
  assert.deepEqual(ids.slice(0, 4).map((id) => tags[id].tag), ["P", "L", "T", "W"]);
  /* it took the archive to write and put it back down again, so the next
     command finds a folder nobody is holding */
  assert.equal(existsSync(paths(root).run), false);
});

test("keeper tag waits when the claim has no port", async () => {
  const { root, ids } = await archive();
  const file = await sheet(root, ids.slice(0, 4));

  /* a keeper working in here without serving, which is what `keeper sheets`
     is: there is a claim and there is no port to hand the rows to */
  const kid = spawn(process.execPath, ["--input-type=module", "-e", `
    const lock = await import(${JSON.stringify(LOCK)});
    await lock.claim(${JSON.stringify(root)});
    console.log("held");
    setInterval(() => {}, 1e9);
  `], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((ok) => kid.stdout.once("data", ok));

  try {
    const { code, said } = await keeper(["tag", root, file]);
    assert.equal(code, 1, said);
    assert.match(said, /wait for it/);
    assert.deepEqual(await readTags(root), {}, "nothing was written behind the keeper that has it");
  } finally {
    kid.kill("SIGKILL");
    await once(kid, "exit");
  }
});
