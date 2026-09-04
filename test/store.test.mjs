import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
const child = (code, io = "ignore", ...argv) =>
  spawn(process.execPath, ["--input-type=module", "-e", code, ...argv], { stdio: io });

/* A real keeper server in a process of its own, on a port the operating
   system picks, torn down even when the test that started it fails. Without
   the t.after the parent holds an open pipe to a live child and the whole run
   hangs after the last assertion instead of exiting. */
async function server(t, root) {
  const kid = child(
    `
    process.env.KEEPER_HOME = ${JSON.stringify(process.env.KEEPER_HOME)};
    const { serve } = await import(${JSON.stringify(new URL("../src/server.mjs", import.meta.url).href)});
    const { loadConfig } = await import(${JSON.stringify(new URL("../src/config.mjs", import.meta.url).href)});
    const root = process.argv[1];
    const up = await serve({ root, config: await loadConfig(root), port: 0 });
    console.log("up " + new URL(up.url).port);
    setInterval(() => {}, 1e9);
  `,
    ["ignore", "pipe", "inherit"],
    root,
  );
  const exited = once(kid, "exit");
  t.after(async () => { kid.kill("SIGKILL"); await exited; });

  for await (const chunk of kid.stdout) {
    const said = /up (\d+)/.exec(String(chunk));
    if (said) return { kid, port: Number(said[1]) };
  }
  throw new Error("the child server never said which port it took");
}

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

/* A CLAIM TRAVELS WITH THE FOLDER, AND A COPIED FOLDER IS NOT THE FOLDER.
   Duplicating a shoot in the finder copies .keeper/run.json along with the
   photographs, so the copy arrives holding the original's pid, port and
   token. The pid is alive and the port answers, and until this was fixed
   keeper refused to open the copy and pointed at a window showing a
   completely different folder. */
test("a claim copied in from another archive does not hold this one", async (t) => {
  const mine = await archive();
  const theirs = await archive();
  await mkdir(path.join(mine, ".keeper"), { recursive: true });
  await mkdir(path.join(theirs, ".keeper"), { recursive: true });

  /* A real server on a real port, answering for `theirs` and nothing else.
     Nothing less would do: the whole question is what the port says it is
     serving, so a stub that answered would be a test of the stub. */
  const { kid, port } = await server(t, theirs);
  const held = { pid: kid.pid, port, token: "t", at: new Date().toISOString() };
  await writeFile(path.join(theirs, ".keeper", "run.json"), JSON.stringify(held));
  // the copy, carrying the original's claim, exactly as cp -R would leave it
  await writeFile(path.join(mine, ".keeper", "run.json"), JSON.stringify(held));

  assert.equal(await lock.serving(held, theirs), true, "it really is serving its own archive");
  assert.equal(await lock.serving(held, mine), false, "and it is not serving the copy");

  // so the copy opens, and the original stays refused
  await lock.claim(mine);
  assert.equal((await lock.holder(mine)).pid, process.pid);
  await assert.rejects(() => lock.claim(theirs), (e) => e.code === "EBUSY");
});

/* THE DANGEROUS DIRECTION, and the reason the comparison errs toward yes.
   A wrong no deletes a live keeper's claim and puts two processes on one
   tags.json, which is the silent disaster the lock exists to prevent. The
   browser claims the resolved path and a command line claims whatever was
   typed, so one folder arrives under two names all the time. */
test("the same folder under two names is still the same folder", async (t) => {
  const root = await archive();
  const alias = `${root}-alias`;
  await symlink(root, alias);
  made.push(alias);

  const { kid, port } = await server(t, root);
  const held = { pid: kid.pid, port, token: "t" };

  assert.equal(await lock.serving(held, alias), true, "a symlink to the folder is the folder");
  assert.equal(await lock.serving(held, root), true);
});

test("nothing to compare on is treated as still holding it", async () => {
  // no port to ask, so there is no answer, and the claim stands
  assert.equal(await lock.serving({ pid: process.pid, port: null }, "/no/such/folder"), true);
});
