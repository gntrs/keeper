import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/* A seat of its own, set before anything under src/ is imported, so a test
   run cannot read or write the seat belonging to the person on this machine. */
process.env.KEEPER_HOME = await mkdtemp(path.join(tmpdir(), "keeper-home-"));

/* Darwin only, and not because the other platforms are untested: windows has
   the same check and its own history, and this file drives the real finder
   through apple events, which is a thing only a mac has. The file lands in
   the trash of whoever runs it, the same way doctor's own check does. */
const mac = process.platform === "darwin";

test("a file the finder took is gone from where it was", { skip: mac ? false : "macos only" }, async (t) => {
  const { trash } = await import("../src/os/macos.mjs");

  const dir = await mkdtemp(path.join(tmpdir(), "keeper-trash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "keeper test frame.txt");
  await writeFile(file, "a stand in for a photograph, safe to throw away");

  await trash([file]);

  await assert.rejects(access(file), "the file is still where it was");
});
