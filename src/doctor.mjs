import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { HOSTS, host } from "./os/index.mjs";

/**
 * WHAT WORKS ON THIS MACHINE, SAID IN PLAIN LANGUAGE.
 *
 * keeper leans on five things it does not ship: a decoder, a file manager, a
 * wastebasket, a shortcut maker and a search index. On a mac every one of
 * them is in the box. On windows two are, two need a working powershell, and
 * the decoder is not there at all.
 *
 * So the first run on somebody else's machine is a guessing game, and it is a
 * guessing game played at a distance, over a message, by two people who
 * cannot see each other's screen. This turns it into one command whose output
 * can be pasted back.
 *
 * IT NEVER FAILS THE WHOLE RUN. Every check that goes wrong is a line saying
 * what is missing and what stops working without it, because a person trying
 * a tool for the first time needs to know which half of it they still have,
 * not that something somewhere returned non zero.
 *
 * Nothing here writes to an archive and nothing deletes anything. The one
 * check that needs to touch a disk writes a file into the system temp folder
 * and removes it again.
 */

const OK = "ok";
const NO = "no";
const MEH = "warn";

const run = (cmd, args, opts = {}) =>
  new Promise((ok, no) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15_000, ...opts }, (err, stdout, stderr) =>
      err ? no(new Error(String(stderr || err.message).trim().split("\n")[0])) : ok(String(stdout)));
  });

/** one row of the report */
const row = (state, what, said) => ({ state, what, said });

async function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) return row(OK, "node", `${process.versions.node}`);
  return row(NO, "node", `${process.versions.node}, and keeper needs 20 or newer. nothing will work until this one is fixed.`);
}

async function checkSharp() {
  try {
    const sharp = (await import("sharp")).default;
    const px = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg().toBuffer();
    if (!px?.length) throw new Error("wrote nothing");
    return row(OK, "images", "sharp reads and writes, so thumbnails and crops will work");
  } catch (e) {
    return row(NO, "images", `sharp did not load: ${String(e.message).toLowerCase()}. run npm install in the keeper folder. without it there are no thumbnails, no contact sheets and no exports.`);
  }
}

async function checkPlatform() {
  if (host) return row(OK, "machine", `${host.name}, so the ${host.files} and ${host.bin} are both reachable`);
  return row(NO, "machine", `${process.platform}, and keeper runs on ${HOSTS}. the shelf would work and deleting would not, which is the wrong half to be missing.`);
}

/**
 * The one that matters most on windows, because four separate features go
 * through it and all four fail the same silent way if it is locked down.
 */
async function checkShell() {
  if (process.platform !== "win32") {
    try {
      await run("osascript", ["-e", "return 1"]);
      return row(OK, "scripting", "osascript answers, so reveal, delete and aliases will work");
    } catch (e) {
      return row(NO, "scripting", `osascript would not run: ${String(e.message).toLowerCase()}. reveal in finder, delete off the drive and alias export all go through it.`);
    }
  }
  try {
    const out = await run("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$PSVersionTable.PSVersion.Major"]);
    const v = Number(String(out).trim());
    return row(OK, "scripting", `windows powershell ${v || "5"}, so reveal, delete and shortcuts will work`);
  } catch (e) {
    return row(NO, "scripting", `powershell would not run: ${String(e.message).toLowerCase()}. showing a file in explorer, deleting to the recycle bin and exporting a tray as shortcuts all go through it.`);
  }
}

/** the wastebasket, tested on a file this check made itself */
async function checkTrash() {
  if (!host) return row(NO, "delete", `needs ${HOSTS}`);
  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "keeper-doctor-"));
    const victim = path.join(dir, "keeper-doctor-delete-me.txt");
    await writeFile(victim, "this file was made by keeper doctor and can be thrown away\n");
    await host.trash([victim]);
    /* gone from where it was is the whole test. where it went is the
       platform's business and both of them put it somewhere recoverable. */
    try {
      await access(victim, constants.F_OK);
      return row(NO, "delete", `the file was still there afterwards, so ${host.bin} is not actually receiving anything.`);
    } catch {
      return row(OK, "delete", `a test file went to ${host.bin} and can be put back from there`);
    }
  } catch (e) {
    return row(NO, "delete", `could not reach ${host.bin}: ${String(e.message).toLowerCase()}. setting frames aside still works, deleting off the drive does not.`);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** film, which is optional everywhere and load bearing for raw on windows */
async function checkFfmpeg() {
  const { haveFfmpeg } = await import("./film.mjs");
  const have = await haveFfmpeg();
  if (have) return row(OK, "film", "ffmpeg is on the path, so clips get a poster frame");
  return row(MEH, "film", "no ffmpeg. stills all work, clips appear on the shelf with no poster behind them. install it only if there is video in the archive.");
}

async function checkRaw() {
  if (!host) return row(NO, "raw", `needs ${HOSTS}`);
  const can = await host.canDecode();
  if (can && host.name === "macos") {
    return row(OK, "raw", "macos decodes raw itself, so arw, cr3, nef, dng and heic all read");
  }
  if (can) {
    return row(MEH, "raw", "ffmpeg will be used for raw. dng and heic read. a cr3 or an arw may not, and any frame it cannot open is listed as unreadable rather than silently skipped.");
  }
  return row(MEH, "raw", `${host.decodeHint} jpg, png, webp, avif and tif all work without it.`);
}

/** the search index, which only decides how nice dropping a folder in is */
async function checkIndex() {
  if (!host) return row(NO, "search", `needs ${HOSTS}`);
  try {
    const hits = await host.search(path.basename(homedir()), "folder");
    if (hits.length) return row(OK, "search", "the machine's search index answers, so dragging a folder onto the window finds it");
    return row(MEH, "search", "the search index returned nothing. dragging a folder in will ask you to point at it once instead, which is one extra click and nothing else.");
  } catch {
    return row(MEH, "search", "the search index did not answer. dragging a folder in will ask you to point at it once instead.");
  }
}

const CHECKS = [
  ["node", checkNode],
  ["machine", checkPlatform],
  ["images", checkSharp],
  ["scripting", checkShell],
  ["delete", checkTrash],
  ["raw", checkRaw],
  ["film", checkFfmpeg],
  ["search", checkIndex],
];

/**
 * Runs them one after another rather than all at once. It is eight checks and
 * a couple of seconds, and two of them put a subprocess up: doing that
 * concurrently on a machine that is already struggling is how a diagnostic
 * becomes the thing that needs diagnosing.
 */
export async function doctor() {
  const rows = [];
  for (const [name, fn] of CHECKS) {
    try {
      rows.push(await fn());
    } catch (e) {
      rows.push(row(NO, name, `the check itself failed: ${String(e.message).toLowerCase()}`));
    }
  }
  return rows;
}

export { OK, NO, MEH };
