import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/* Every seat this run writes goes to a folder of its own, so a test can
   never read or move the seat belonging to the person running it. */
process.env.KEEPER_HOME = await mkdtemp(path.join(tmpdir(), "keeper-home-"));

const STORE = new URL("../src/store.mjs", import.meta.url).href;
const LOCK = new URL("../src/lock.mjs", import.meta.url).href;
const store = await import(STORE);
const lock = await import(LOCK);

const made = [process.env.KEEPER_HOME];
after(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function archive() {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-store-"));
  made.push(dir);
  return dir;
}

/* node -e cannot hold a top level await without being told it is a module,
   and every child below imports the very files under test. */
const child = (code, io = "ignore") =>
  spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: io });

/* a fingerprint of the folder, so the parent can see the instant the child
   starts putting bytes down without caring which name it puts them under */
const sizes = (dir) =>
  readdirSync(dir)
    .sort()
    .map((n) => `${n}:${statSync(path.join(dir, n)).size}`)
    .join(" ");

/* 200,000 rows carrying a note apiece. The row count is what a heavy
   archive really looks like; the note is there because 200,000 bare rows
   are written in about three milliseconds on this machine, which is
   quicker than any kill the test could aim, and a test that cannot fail is
   not a test. Fat rows put the write at roughly fifty milliseconds, so the
   kills below land inside it. */
const ROWS = 200000;
const NOTE = "n".repeat(400);
const BIG = () => {
  const o = {};
  for (let i = 0; i < ROWS; i++) o["id" + i] = { star: 1, tag: "P", note: NOTE };
  return o;
};

test("a write killed mid flight leaves the file whole", async () => {
  const big = BIG();
  for (const delay of [5, 20, 60]) {
    const root = await archive();
    await store.writeTags(root, { a: 1 });
    const dir = store.paths(root).dir;
    const before = sizes(dir);

    const kid = child(
      `
      const s = await import(${JSON.stringify(STORE)});
      const o = {};
      const note = "n".repeat(${NOTE.length});
      for (let i = 0; i < ${ROWS}; i++) o["id" + i] = { star: 1, tag: "P", note };
      await s.writeTags(${JSON.stringify(root)}, o);
    `,
    );
    /* the listener goes on before the wait, because a write that beats the
       delay has already fired exit by the time the kill lands */
    const exited = once(kid, "exit");

    /* the delay is counted from the first byte that lands, not from the
       spawn. node's own start and the stringify are a couple of hundred
       milliseconds on their own, and a kill inside those proves nothing.
       the spin is tight rather than a timer because the whole window being
       aimed at is tens of milliseconds long. */
    const giveUp = Date.now() + 30000;
    while (sizes(dir) === before && Date.now() < giveUp) {}
    await sleep(delay);
    kid.kill("SIGKILL");
    await exited;

    const got = await store.readTags(root);
    assert.deepEqual(got, Object.keys(got).length === 1 ? { a: 1 } : big, `killed ${delay}ms into the write`);
  }
});

test("an unreadable tags.json throws and names the backup", async () => {
  const root = await archive();
  await store.writeTags(root, { a: 1 });
  await writeFile(store.paths(root).tags, "nope");

  await assert.rejects(
    () => store.readTags(root),
    (e) => {
      assert.equal(e.code, "EUNREADABLE");
      assert.match(e.message, /tags\.json\.bak/);
      return true;
    },
  );

  /* the archive check refuses the folder for the same reason */
  await assert.rejects(() => store.checkArchive(root), (e) => e.code === "EUNREADABLE");
});

test("a missing file is its fallback", async () => {
  const root = await archive();
  assert.deepEqual(await store.readTags(root), {});
  assert.deepEqual(await store.readBinned(root), []);
  assert.equal(await store.readIndex(root), null);
  await store.checkArchive(root);
});

test("an unreadable index is rebuilt rather than trusted", async () => {
  const root = await archive();
  await mkdir(store.paths(root).dir, { recursive: true });
  await writeFile(store.paths(root).index, "{ half");
  assert.equal(await store.readIndex(root), null);
});

test("claim refuses a live holder and takes a stale one", async () => {
  const root = await archive();

  const kid = child(
    `
    const l = await import(${JSON.stringify(LOCK)});
    await l.claim(${JSON.stringify(root)});
    console.log("held");
    setInterval(() => {}, 1e9);
  `,
    ["ignore", "pipe", "inherit"],
  );
  const exited = once(kid, "exit");
  for await (const chunk of kid.stdout) if (String(chunk).includes("held")) break;

  await assert.rejects(
    () => lock.claim(root),
    (e) => {
      assert.equal(e.code, "EBUSY");
      assert.match(e.message, new RegExp(`pid ${kid.pid}\\b`));
      assert.match(e.message, /wait for it/);
      return true;
    },
  );

  kid.kill("SIGKILL");
  await exited;

  await lock.claim(root);
  assert.equal((await lock.holder(root)).pid, process.pid);

  await lock.claim(root, { port: 7940, token: "t" });
  const held = await lock.holder(root);
  assert.equal(held.port, 7940);
  assert.equal(held.token, "t");

  await lock.release(root);
  assert.equal(await lock.holder(root), null);
});

test("release never removes another pid's claim", async () => {
  const root = await archive();
  const file = store.paths(root).run;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ pid: 1, port: null, token: null, at: "now" }));

  await lock.release(root);
  assert.equal(existsSync(file), true);
  lock.releaseSync(root);
  assert.equal(existsSync(file), true);
  assert.equal(JSON.parse(await readFile(file, "utf8")).pid, 1);
});
