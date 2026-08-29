/* ---------------------------------------------------------------------
   the two facts an app has to remember that a command does not.

   Run from a terminal, keeper is told the folder and the port every time,
   and when it stops there is nothing left behind. Run from an icon there is
   nobody to tell it anything, so it has to remember where you were last,
   and it has to know whether a copy of itself is already running before it
   puts up a second one on a second port and leaves you with two tabs that
   disagree about the same archive.

   Both facts live in one small folder outside the archive, because they are
   about this machine rather than about a set of photographs. Nothing here
   ever leaves the disk and nothing here is worth backing up: delete the
   folder and keeper forgets which archive was open, which is the whole of
   the damage.
   --------------------------------------------------------------------- */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Where a platform expects an application to keep state that is not a
 * document. Written out per platform rather than reached for through a
 * dependency, because it is three lines and the dependency would be the
 * only one in the project that exists to answer a question this small.
 *
 * Linux is not a supported host for the rest of keeper, but the path is
 * correct there anyway: this module is asked for a directory long before
 * anything asks the platform to move a file to a wastebasket.
 */
export function appDir() {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "keeper");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "keeper");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(home, ".local", "state"), "keeper");
}

const RUN = () => path.join(appDir(), "run.json");
const SEAT = () => path.join(appDir(), "seat.json");

/**
 * An empty folder to open when there is nothing else to open.
 *
 * The alternative was pointing a first launch at Pictures, and that is a
 * worse idea than it sounds: it is a folder nobody chose, it can hold forty
 * thousand frames, and the first thing a person would see is a progress bar
 * for work they did not ask for. An empty archive opens instantly and the
 * page it shows is the one that asks for a folder, which is the question
 * that actually needs answering.
 */
export async function blankRoot() {
  const dir = path.join(appDir(), "start");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * The seat: everything keeper remembers about you between launches, which is
 * two things. It is read and written whole rather than field by field,
 * because it is two fields and a file this small has no use for a format
 * that can be half updated.
 */
async function seat() {
  try {
    return JSON.parse(await readFile(SEAT(), "utf8")) ?? {};
  } catch {
    return {};
  }
}

async function reseat(patch) {
  try {
    await mkdir(appDir(), { recursive: true });
    await writeFile(SEAT(), JSON.stringify({ ...(await seat()), ...patch }, null, 2));
  } catch {
    /* forgetting is not a reason to fail to open */
  }
}

/** the archive that was open when keeper last closed, if it is still there */
export async function lastArchive() {
  const root = (await seat()).root;
  return typeof root === "string" && root ? root : null;
}

export const rememberArchive = (root) => reseat({ root });

/**
 * Whether keeper may ask github if there is a newer keeper.
 *
 * Three states and not two, because the third one is the honest one: until
 * somebody has been asked, the answer is not no and it is certainly not yes.
 * `ask` means no request has been made and none will be until the question
 * on the page is answered. It is the default, and a fresh install therefore
 * touches the network zero times.
 */
export async function updatePolicy() {
  const said = (await seat()).updates;
  return said === "on" || said === "off" ? said : "ask";
}

export const setUpdatePolicy = (yes) => reseat({ updates: yes ? "on" : "off" });

/**
 * WHICH WALKTHROUGH HAS BEEN ANSWERED, NOT WHETHER ONE HAS.
 *
 * A number and not a bit, because keeper is going to gain things and the
 * cards will have to say so. Somebody who sat through this set has answered
 * this set, and a later keeper with something new to show is entitled to ask
 * them once. A bit could not tell those two apart and would either ambush
 * everybody on every release or never speak again.
 *
 * BUMP THIS WHEN THE CARDS CHANGE ENOUGH TO BE WORTH SOMEBODY'S MINUTE, and
 * for nothing else. Not for a fix, not for a rewording, not because the
 * version number moved: a patch release that reopened a tutorial on a person
 * who had already answered it would be exactly the thing this is here to
 * avoid. The cards themselves are in `web/tour.js` and its header says the
 * same thing from that end.
 *
 * IT LIVES HERE AND NOT IN THE BROWSER. A page's storage is keyed to its
 * origin, and keeper's origin carries a port: `keeper app` takes the first
 * free one from 7777 upwards, so opening keeper on a day when something else
 * holds 7777 hands the same person a different origin with an empty store,
 * and a walkthrough they have already sat through comes back. What somebody
 * has been shown is a fact about them and their machine, not about which
 * port happened to be free.
 */
export const TOUR = 1;

export async function toured() {
  return Number((await seat()).toured ?? 0) >= TOUR;
}

/** answered, whichever way. declining is an answer and it is remembered. */
export const setToured = (yes) => reseat({ toured: yes ? TOUR : 0 });

/**
 * WHAT THE SEAT SAID BEFORE THIS PROCESS WROTE A WORD TO IT.
 *
 * Read at import, on purpose, and that is the only moment it can be read.
 * The question it answers is whether keeper has ever run on this machine
 * before, and keeper answers that question by leaving a mark, so anything
 * asked after the server has opened an archive is asking about a file this
 * launch has already changed. A first run and a hundredth look identical
 * five seconds in.
 *
 * It is one small json read on a path that usually does not exist, and every
 * command pays it. That is the price of the answer being true.
 */
const ARRIVED = await seat();

/**
 * Has keeper been used on this machine before this launch.
 *
 * Any mark counts: an archive, an answer about updates, a version, an
 * answered walkthrough. Somebody who has all four and somebody who has one
 * are both people who know what keeper is, and the only person this is
 * really sorting out is the one with none of them.
 */
export const returning = () =>
  ARRIVED.root !== undefined || ARRIVED.updates !== undefined ||
  ARRIVED.seen !== undefined || ARRIVED.toured !== undefined;

/** the keeper that ran here last, or null on a machine that has had none */
export const lastSeen = () => (typeof ARRIVED.seen === "string" ? ARRIVED.seen : null);

export const rememberSeen = (v) => reseat({ seen: v });

/**
 * The first port from `from` upwards that this machine will actually let go
 * of. A fixed port is right for a command someone typed and wrong for an
 * icon someone clicked twice: the second click used to die on EADDRINUSE,
 * with the error going to a log file nobody opens, so the app simply did
 * nothing when you clicked it.
 *
 * Bound and released rather than probed, because probing asks whether
 * something answers and binding asks the only question that matters, which
 * is whether the next line of this program can have the port.
 */
export function freePort(from = 7777, tries = 24) {
  const test = (port) =>
    new Promise((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(false));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
    });

  return (async () => {
    for (let port = from; port < from + tries; port++) {
      if (await test(port)) return port;
    }
    throw new Error(`nothing free between ${from} and ${from + tries - 1}`);
  })();
}

/**
 * The copy of keeper that is already running, or null.
 *
 * A pid on its own is not enough, because pids are reused and a stale file
 * pointing at a number some other program now holds would send a browser at
 * a port that answers with something else entirely. So the file is treated
 * as a rumour and the port is asked to confirm it: only a reply that says
 * keeper counts, and anything else means the file is rubbish and gets
 * cleared rather than left to lie again on the next launch.
 */
export async function running() {
  let said;
  try {
    said = JSON.parse(await readFile(RUN(), "utf8"));
  } catch {
    return null;
  }
  const port = Number(said?.port);
  if (!port) return null;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1200) });
    const body = await res.json();
    if (body?.keeper !== true) throw new Error("not keeper");
    return { port, pid: body.pid, root: body.root, url: `http://127.0.0.1:${port}` };
  } catch {
    await forgetRun();
    return null;
  }
}

export async function claimRun(port) {
  await mkdir(appDir(), { recursive: true });
  await writeFile(RUN(), JSON.stringify({ port, pid: process.pid }, null, 2));
}

export async function forgetRun() {
  await rm(RUN(), { force: true }).catch(() => {});
}

/**
 * The same, from inside an exit handler.
 *
 * `process.exit` does not wait for a promise, so the async version above
 * would be started and abandoned, and the file would survive the process it
 * describes. A stale file is not fatal, since the port is asked to confirm
 * it, but it costs the next launch a timeout before it can decide, and that
 * is a second of a person looking at an icon that has apparently done
 * nothing.
 */
export function forgetRunSync() {
  try { unlinkSync(RUN()); } catch { /* already gone, which is the goal */ }
}

/**
 * A note the old keeper leaves for the new one during an update: come up,
 * but do not open a browser, because there is already a tab open and it is
 * watching this port and will reload itself the moment you answer.
 *
 * A file rather than a flag because of what sits in between the two
 * processes. The new one is started through the platform's own launcher, a
 * bundle on macos and a batch file on windows, and neither of those passes
 * arguments through. A file is the one channel both of them cannot lose.
 */
const HUSH = () => path.join(appDir(), "hush");

export async function hush() {
  await mkdir(appDir(), { recursive: true });
  await writeFile(HUSH(), "");
}

/** true once, and never twice: reading it is what clears it */
export async function hushed() {
  try {
    await readFile(HUSH());
  } catch {
    return false;
  }
  await rm(HUSH(), { force: true }).catch(() => {});
  return true;
}
