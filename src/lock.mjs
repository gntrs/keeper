import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

import { paths } from "./store.mjs";

/**
 * One process at a time owns an archive.
 *
 * Two keepers pointed at one folder ate each other in silence: the amend
 * queue in server.mjs is one in process promise chain, and a promise chain
 * cannot see a second process, so eighty star writes split across two
 * servers left a two row tags.json with the tag letters stripped and every
 * response said ok. `keeper app` will happily start a second server beside a
 * CLI one, and `keeper tag` read, modified and wrote the same file from
 * outside both. The claim below is what makes the second one say so instead.
 *
 * It is a file, not a lock in the kernel, because it has to survive being
 * read by a person: `.keeper/run.json` says which process has the archive,
 * on which port, and it carries the boot token so that a second command can
 * hand its work to the keeper already running rather than fight it.
 */

/**
 * Stale means the process is gone, and nothing else.
 *
 * Signal 0 asks the operating system about a pid without sending anything.
 * ESRCH is the only answer that means dead: EPERM means the pid is alive and
 * owned by somebody else, and treating that as stale would let a second user
 * on the same machine steal a live archive. A pid that is not a positive
 * whole number came from a file that is not a claim, so it is not alive.
 */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

/** The claim as it stands, or null when there is not one to read. */
export async function holder(root) {
  try {
    return JSON.parse(await readFile(paths(root).run, "utf8"));
  } catch {
    return null;
  }
}

const busy = (held, file) =>
  held.port
    ? `another keeper (pid ${held.pid}) has this archive open at http://127.0.0.1:${held.port}. use that one, or delete ${file} if it is gone.`
    : `another keeper (pid ${held.pid}) is working on this archive. wait for it, or delete ${file} if it is gone.`;

/**
 * Take the archive, or refuse and say who has it.
 *
 * The open is `wx`, which fails when the file is already there, so two
 * processes racing for a fresh archive cannot both believe they won. Only
 * after that fails is the existing claim read and judged, and the only claim
 * that stands is one whose process is still running: a dead pid, or a file
 * that will not parse, is swept and the claim is retaken.
 *
 * A claim we already hold is rewritten rather than refused, because the
 * command line takes the archive before it scans, when there is no port yet,
 * and the server refreshes that same claim with the port and the token once
 * it is listening.
 */
/**
 * Is the keeper this claim names still answering on the port it named?
 *
 * A pid is not enough on its own. `.keeper` sits beside the photographs, so a
 * claim travels with the archive to another machine and outlives the crash or
 * the unplugged drive that left it there, and pids are handed out again. When
 * the number in a stale file happens to belong to some unrelated process that
 * is alive, every route in refuses an archive nobody is holding: the app path
 * prints a url with nothing behind it, the shelf path exits, and `keeper tag`
 * says the keeper on that port did not take the tags.
 *
 * So a claim carrying a port has to prove itself. /api/ping answers with the
 * pid, which is the exact thing being doubted, and half a second is generous
 * for a server on the loopback. A claim with no port yet is the window between
 * the command line taking the archive and serve() listening, and there the pid
 * is all there is.
 */
/**
 * Whether two paths name the same folder, erring hard toward yes.
 *
 * A wrong no here is the expensive one. Say no about a keeper that really is
 * holding this archive and the claim is deleted, a second keeper opens the
 * same folder, and two processes write the same tags.json: the exact silent
 * disaster the lock exists to prevent. A wrong yes only means refusing to
 * open a folder that was in fact free, which is a sentence on screen and a
 * second attempt.
 *
 * So a missing answer is yes, and a path that will not resolve is yes. The
 * realpath is what makes it useful at all: the browser claims the resolved
 * path while a command line claims whatever was typed, so /tmp/shoot and
 * /private/tmp/shoot are the same folder arriving under two names.
 */
async function sameFolder(a, b) {
  if (!a || !b || a === b) return true;
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return true;
  }
}

export async function serving(held, root) {
  if (!held?.port) return true;
  try {
    const ac = new AbortController();
    const bell = setTimeout(() => ac.abort(), 500);
    const r = await fetch(`http://127.0.0.1:${held.port}/api/ping`, { signal: ac.signal });
    clearTimeout(bell);
    if (!r.ok) return false;
    const j = await r.json();
    if (j?.keeper !== true || j?.pid !== held.pid) return false;
    /**
     * AND IT HAS TO BE HOLDING THIS FOLDER, NOT SOME FOLDER.
     *
     * A claim travels with the folder it sits in, because it is a file inside
     * it. Duplicate a shoot in the finder, restore one from a backup, copy a
     * card onto a second drive, and the copy arrives carrying the original's
     * pid, port and token. The pid is alive and the port answers, so keeper
     * refuses to open the copy and points at a window showing an entirely
     * different folder. Measured, not assumed: a copied archive was refused
     * while its ping named the original's path.
     */
    return sameFolder(j?.root, root);
  } catch {
    return false;
  }
}

export async function claim(root, { port = null, token = null } = {}) {
  const file = paths(root).run;
  await mkdir(path.dirname(file), { recursive: true });

  let fh = await open(file, "wx").catch((e) => {
    if (e.code !== "EEXIST") throw e;
    return null;
  });

  if (!fh) {
    const held = await holder(root);
    if (held && held.pid === process.pid) {
      fh = await open(file, "w");
    } else if (held && alive(held.pid) && await serving(held, root)) {
      const e = new Error(busy(held, file));
      e.code = "EBUSY";
      throw e;
    } else {
      await unlink(file).catch(() => {});
      fh = await open(file, "wx");
    }
  }

  try {
    await fh.writeFile(JSON.stringify({ pid: process.pid, port, token, at: new Date().toISOString() }, null, 1));
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Put the archive down, and only ever our own.
 *
 * The pid is checked first because a keeper that crashed and left its claim
 * behind is a nuisance, while a keeper that deletes a running keeper's claim
 * is the two servers problem again. Neither of these throws: they run on the
 * way out, where there is nobody left to tell.
 */
export async function release(root) {
  const held = await holder(root);
  if (held?.pid !== process.pid) return;
  await unlink(paths(root).run).catch(() => {});
}

/** The same thing for an exit handler, which cannot wait for a promise. */
export function releaseSync(root) {
  const file = paths(root).run;
  try {
    if (JSON.parse(readFileSync(file, "utf8")).pid !== process.pid) return;
    unlinkSync(file);
  } catch {
    /* an exit handler has nowhere to put an error, and a claim that is
       already gone or already somebody else's needs nothing done to it */
  }
}
