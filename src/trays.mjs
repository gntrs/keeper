import {
  copyFile, lstat, mkdir, open, readdir, readFile, readlink, realpath, stat, symlink, writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { host } from "./os/index.mjs";
import { paths } from "./store.mjs";

/**
 * A tray is the pile on the light table: the frames you pulled out of the
 * archive while browsing, in the order you pulled them.
 *
 * It is deliberately not a tag. A tag says what a photograph is and survives
 * the shoot; a tray says what you are doing with it this afternoon, and it is
 * meant to be filled, emptied and thrown away. Keeping the two apart is what
 * stops the tag vocabulary growing a `for-the-website-v3` entry that means
 * nothing to anyone in a month.
 *
 * The read and write live here rather than in store.mjs because trays arrived
 * after everything else that imports that file, and a sidecar reader is cheap
 * enough to keep beside the thing that owns it.
 */
const file = (root) => path.join(paths(root).dir, "trays.json");

const FIRST = { id: "tray-1", name: "tray 1" };

/**
 * The three ways a tray can leave the archive.
 *
 *   copy     real files. the only one you can put on a stick and post.
 *   symlink  an absolute link to the original. zero bytes, and it dies if
 *            the original is moved or renamed.
 *   the third is the platform's own, and it is the one the machine's file
 *            manager understands: a finder alias on a mac, which tracks the
 *            file by its id and follows it when it moves, or a .lnk shortcut
 *            on windows, which holds a path and finds a moved target only
 *            sometimes.
 *
 * copy is first and is the default, because it is the only one of the three
 * that is still true when the folder is handed to somebody else. The third
 * one's name is read off the platform rather than spelled here, so nobody is
 * ever offered an export mode their machine has never heard of.
 */
export const MODES = ["copy", "symlink", ...(host?.LINKS.filter((m) => m !== "symlink") ?? [])];

/**
 * There is always a tray, and it is not written to disk until something goes
 * into it. A user who never touches the feature never gets a trays.json, and
 * an archive with no trays.json still answers every route as though it had an
 * empty one, which means the browser never has to special case the first run.
 */
export async function readTrays(root) {
  let doc;
  try {
    doc = JSON.parse(await readFile(file(root), "utf8"));
  } catch {
    doc = null;
  }
  const trays = (doc?.trays ?? [])
    .filter((t) => t && typeof t.id === "string")
    .map((t) => ({
      id: t.id,
      name: String(t.name ?? t.id),
      /* Deduped on the way in, because a repeated id is not a second frame
         and every reader downstream treats it as one. An export walked it
         twice and wrote the same photograph under both of the names it is
         allowed, so a tray of one frame reported two files. addTo has always
         refused a duplicate, which is why this was never seen from the
         browser, and a trays.json edited by hand or written by an older
         build carried them in under it. A Set keeps the order it was given,
         and order is the one thing a tray promises. */
      ids: Array.isArray(t.ids)
        ? [...new Set(t.ids.filter((i) => typeof i === "string"))]
        : [],
      /* Both optional, and both left off the object entirely when they are
         not set, so JSON.stringify drops them and a trays.json written
         before either existed round trips unchanged. A tray that has never
         been exported has no opinion about how, and inventing "copy" here
         would be a stored answer to a question nobody asked yet. */
      ...(MODES.includes(t.mode) ? { mode: t.mode } : {}),
      ...(typeof t.dest === "string" && t.dest.trim() ? { dest: t.dest.trim() } : {}),
    }));
  if (!trays.length) trays.push({ ...FIRST, ids: [] });
  const active = trays.some((t) => t.id === doc?.active) ? doc.active : trays[0].id;
  return { trays, active };
}

export async function writeTrays(root, doc) {
  await mkdir(path.dirname(file(root)), { recursive: true });
  await writeFile(file(root), JSON.stringify(doc, null, 1));
}

export const trayById = (doc, id) => doc.trays.find((t) => t.id === id);

/**
 * A tray's id is a slug of the name it was given, because the id shows up in
 * urls and in `keeper trays --export <id>` and a person has to be able to
 * type it from memory. The name itself stays exactly as typed, since renaming
 * a tray must not repoint anything that already refers to it by id.
 */
export function newTray(doc, name) {
  const clean = String(name ?? "").trim().slice(0, 60);
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tray";
  let id = base;
  for (let n = 2; doc.trays.some((t) => t.id === id); n++) id = `${base}-${n}`;
  const tray = { id, name: clean || `tray ${doc.trays.length + 1}`, ids: [] };
  doc.trays.push(tray);
  return tray;
}

/** appended, never sorted, and a frame already in the tray keeps its place */
export function addTo(tray, ids) {
  const have = new Set(tray.ids);
  for (const id of ids) {
    if (have.has(id)) continue;
    have.add(id);
    tray.ids.push(id);
  }
  return tray;
}

export function removeFrom(tray, ids) {
  const gone = new Set(ids);
  tray.ids = tray.ids.filter((id) => !gone.has(id));
  return tray;
}

/**
 * Deleting the last tray would leave the browser with nothing to add to and
 * no obvious way to get a tray back, so the last one is emptied instead and
 * the caller is told which of the two happened. Silently doing one when the
 * user asked for the other is the kind of thing you only notice afterwards.
 */
export function dropTray(doc, id) {
  const tray = trayById(doc, id);
  if (!tray) return { ok: false };
  if (doc.trays.length === 1) {
    tray.ids = [];
    return { ok: true, cleared: true };
  }
  doc.trays = doc.trays.filter((t) => t.id !== id);
  if (doc.active === id) doc.active = doc.trays[0].id;
  return { ok: true, cleared: false };
}

/** which trays hold a given frame, so the shelf can mark what is already in */
export function membership(doc) {
  const out = {};
  for (const t of doc.trays) {
    for (const id of t.ids) (out[id] ??= []).push(t.id);
  }
  return out;
}

const expand = (p) =>
  p === "~" ? homedir() : p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;

/**
 * Resolves as far up the path as actually exists and then puts the missing
 * tail back on. A destination folder usually does not exist yet, and
 * comparing two paths where only one has had its symlinks collapsed is how
 * an "is this inside the archive" test quietly returns the wrong answer for
 * anyone whose drive is reached through a link.
 */
export async function settled(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(await realpath(cur), ...[...tail].reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = up;
    }
  }
}

export const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * NEVER MOVES. This is the whole contract of the feature and it is worth
 * being blunt about: the archive is the negative, and a tool that shuffles a
 * photographer's originals around to build a folder for a website is a tool
 * that has lost their originals. Export reads the archive and writes
 * somewhere else, and the archive comes out of it byte for byte identical in
 * every mode.
 *
 * The destination may not sit inside the archive either. A copy would work,
 * once: the next `keeper <archive>` would scan the copies, hand them fresh
 * ids, thumbnail them, and the shelf would show every exported frame twice
 * with the tags on only one of the pair. A link inside the archive is worse
 * rather than better, because it is a loop back into the tree it lives in
 * and the scan walks straight into it.
 *
 * Both sides are resolved through realpath before that comparison, and that
 * is not a nicety on a mac: /tmp is a symlink to /private/tmp, so an archive
 * opened at one of those and a destination typed as the other are the same
 * folder wearing two names, and a plain string compare says they are not.
 *
 * A name that collides inside the destination gets the frame's id appended
 * rather than the file underneath it overwritten. Two folders in an archive
 * both holding `DSC_0041.jpg` is normal, and losing one of them because they
 * landed in the same tray is not a trade anyone would accept.
 *
 * EXPORTING A TRAY TWICE INTO THE SAME FOLDER GIVES THE SAME FOLDER.
 *
 * That suffix is for two different photographs meeting each other, and it
 * used to be spent on one photograph meeting itself. The second run found
 * `DSC_0041.jpg` occupied, read the collision as "try the next name", and
 * wrote a byte identical second copy called `DSC_0041-<id>.jpg`. Measured
 * before this was written: forty frames into an empty folder gave forty
 * files, the same export again gave seventy nine, and the line on the end of
 * it said 39 copied, which was true and useless. Building a folder for a job
 * over an afternoon is the ordinary way this feature gets used, so the
 * ordinary way of using it doubled the shoot.
 *
 * A destination file that is already this frame is work that has been done
 * rather than a collision. It is left alone and counted apart from what was
 * written, so the sentence at the end reads "40 already there, 3 written"
 * instead of handing somebody 43 files for a tray of 43.
 *
 * Telling that from a different photograph of the same name is a different
 * question in each mode, and each is answered with the strongest thing that
 * mode actually knows: a copy by its size, a symlink by where it points, a
 * platform shortcut by what the file manager resolves it to. Where the
 * answer cannot be had the frame is skipped and said out loud, because the
 * one outcome that is not allowed here is quietly writing a photograph the
 * folder already holds.
 *
 * ONE FRAME THAT WILL NOT READ IS ONE FRAME. A single EACCES on frame ten of
 * twenty used to throw out of the whole export, leaving a folder holding
 * nine photographs, looking finished, with nothing anywhere saying the other
 * eleven were missing, and a retry then doubled the nine. Every refusal a
 * frame can raise is that frame's own now and comes back with its reason
 * attached. The one exception is the windows symlink permission, which is
 * about the machine rather than about the photograph and is worth stopping
 * the whole run for.
 */
export async function exportTray({ root, tray, folder, index, mode = "copy" }) {
  const how = String(mode ?? "copy");
  if (!MODES.includes(how)) {
    throw new Error(`no export mode called ${how}. it is one of ${MODES.join(", ")}.`);
  }
  if (!host) throw new Error("export needs macos or windows");

  const asked = String(folder ?? "").trim();
  if (!asked) throw new Error("export needs a folder to write to");

  const dest = await settled(expand(asked));
  const home = await settled(root);
  if (inside(home, dest)) {
    throw new Error(how === "copy"
      ? "that folder is inside the archive, and the next scan would pick the copies up as new frames. pick somewhere outside it."
      : "that folder is inside the archive, so those links would point back into the tree they sit in. pick somewhere outside it.");
  }

  const byId = new Map((index?.items ?? []).map((i) => [i.id, i]));
  await mkdir(dest, { recursive: true });

  /* A frame listed twice in one tray is one frame. A Set keeps the order it
     was given, which is the order the tray was filled in and the only order
     an export is allowed to walk. */
  const ids = [...new Set(tray.ids)];

  const skipped = [];   // in the tray and not in the folder afterwards
  const already = [];   // in the folder already, as this same frame
  const problems = [];  // and why, for the ones that were refused

  /**
   * The two names a frame is allowed to land under, in order. The first is
   * the photograph's own name. The second carries the frame's id, which is a
   * hash of its path inside the archive, so that name names one frame and
   * can never name another, and that is what makes it worth reading back.
   */
  const names = (item, id) => {
    const ext = path.extname(item.path);
    const stem = path.basename(item.path, ext);
    return [`${stem}${ext}`, `${stem}-${id}${ext}`];
  };

  if (how !== "copy" && how !== "symlink") {
    return shortcuts({ home, ids, byId, dest, skipped, already, problems, names, how });
  }

  /**
   * copy and symlink are the same loop because both calls refuse to touch a
   * path that already exists and say so with EEXIST. That is what makes the
   * collision rule safe: the check and the write are one operation, so
   * nothing can appear in the gap between them.
   *
   * The symlink is absolute and points at the archive's resolved path. A
   * relative link would break the moment the project folder was moved, which
   * is the ordinary life of a folder made for one job, and a link written
   * through whatever alias the archive was opened under would break when
   * that alias went.
   */
  const write = how === "copy"
    ? (item, to) => copyFile(path.join(root, item.path), to, constants.COPYFILE_EXCL)
    : (item, to) => symlink(path.join(home, item.path), to);

  /**
   * IS THE FILE ALREADY UNDER THAT NAME THIS SAME FRAME, OR A DIFFERENT
   * PHOTOGRAPH THAT HAPPENS TO SHARE A NAME?
   *
   * Everything downstream of this answer is destructive in one direction or
   * the other. Say yes wrongly and the frame is never written, and the run
   * reports it as work already done rather than as a frame that did not
   * land. Say no wrongly and the folder grows a second copy of a photograph
   * it already holds. So it is asked exactly and not estimated.
   *
   * A symlink answers it outright: it either points at this frame's original
   * or it points somewhere else, and reading it back is the whole test.
   *
   * A copy is compared by size and then, only if the sizes agree, by its
   * bytes. Size alone is not enough and the cheap version of this was a
   * silent loss: two scans of one negative come off a scanner under the same
   * name at the same uncompressed byte count, and reading those as one
   * photograph means the second tray exported into that folder writes
   * nothing and says everything was already there. The bytes are only ever
   * read on the path where the alternative was copying the whole file
   * anyway, and the compare stops at the first block that differs, so the
   * ordinary re-export of a folder that really is finished costs one pass of
   * a file that was about to be written end to end.
   */
  const sameBytes = async (a, b) => {
    const [x, y] = await Promise.all([open(a, "r"), open(b, "r")]);
    try {
      const one = Buffer.alloc(1 << 16);
      const two = Buffer.alloc(1 << 16);
      for (let at = 0; ; at += one.length) {
        const [p, q] = await Promise.all([x.read(one, 0, one.length, at), y.read(two, 0, two.length, at)]);
        if (p.bytesRead !== q.bytesRead) return false;
        if (!p.bytesRead) return true;
        if (!one.subarray(0, p.bytesRead).equals(two.subarray(0, q.bytesRead))) return false;
      }
    } finally {
      await Promise.all([x.close().catch(() => {}), y.close().catch(() => {})]);
    }
  };

  const identical = how === "symlink"
    ? async (item, at) => (await readlink(at)) === path.join(home, item.path)
    : async (item, at) => {
        const src = path.join(root, item.path);
        const [from, there] = await Promise.all([stat(src), stat(at)]);
        return from.size === there.size && sameBytes(src, at);
      };
  const isSame = (item, at) => identical(item, at).catch(() => false);

  const taken = new Set();
  let written = 0;

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) { skipped.push(id); continue; } // gone from the index since it was trayed

    const [bare, tagged] = names(item, id);
    /* The bare name is not offered a second time in one run, so the second
       frame called DSC_0041.jpg does not have to fail a write to learn what
       the first one already proved. */
    let done = false;
    for (const name of taken.has(bare) ? [tagged] : [bare, tagged]) {
      const at = path.join(dest, name);
      try {
        await write(item, at);
        taken.add(name);
        written++;
        done = true;
      } catch (e) {
        /* Windows only hands out symlinks to an administrator, or to anyone
           once developer mode is on. It is worth saying which of those it is,
           because the raw errno reads like a permissions problem with the
           photograph rather than with the machine, and the tray has two other
           modes that need neither. */
        if (e.code === "EPERM" && how === "symlink" && process.platform === "win32") {
          throw new Error("windows only makes symlinks for an administrator, or for anyone with developer mode turned on in settings. copy and shortcut both work as you are.");
        }
        if (e.code === "EEXIST") {
          /* The name is spoken for either way, so no later frame in this run
             may be offered it, whichever of the two this turns out to be. */
          taken.add(name);
          if (await isSame(item, at)) { already.push(id); done = true; }
          // otherwise a different photograph holds it, and the next name down
          // is exactly what the id suffix exists for
        } else {
          problems.push({ id, name, why: why(e) });
          skipped.push(id);
          done = true;
        }
      }
      if (done) break;
    }
    if (!done) {
      skipped.push(id);
      problems.push({ id, name: bare, why: "both of the names it could use are held by other files" });
    }
  }

  return { written, already, skipped, problems, dest, mode: how };
}

/**
 * The errno, said as the half of the sentence a photographer can act on.
 *
 * These are about one photograph rather than about the archive, which is why
 * they are not runtime's sentences: `EACCES` here is a frame keeper is not
 * allowed to read, and being told instead that keeper keeps its index in a
 * .keeper folder beside the photographs would send somebody looking in the
 * wrong place entirely.
 */
const WHY = {
  EACCES: "keeper is not allowed to read that one",
  EPERM: "keeper is not allowed to read that one",
  ENOENT: "that one is not on the drive any more",
  ENOSPC: "the disk that folder is on ran out of space",
  EROFS: "that folder is on a read only disk",
  EIO: "the drive gave a read error on that one",
  ENAMETOOLONG: "that name is too long for that folder",
};

const why = (e) => WHY[e?.code] ?? String(e?.message ?? "").toLowerCase();

/**
 * The platform's own shortcut, made for a whole tray in one call.
 *
 * Neither machine lets a process write one of these as bytes. A finder alias
 * is made by the finder over apple events and a .lnk is made by the windows
 * shell over com, so both are one subprocess that loops internally rather
 * than one subprocess per frame: two hundred processes, each paying its own
 * interpreter startup, is a tray that takes a minute to export nothing. The
 * how of that is in os/, and what is left here is the part that is the same
 * on both, which is deciding what each file gets called.
 *
 * The name is chosen by looking first, because neither of them can create
 * exclusively the way copyFile and symlink can. The folder is read once and
 * compared by name: a broken link already sitting in the destination still
 * occupies the name, and a stat that followed it would find nothing and
 * report the name free.
 *
 * The name is also the only thing this mode can look at for free. A shortcut
 * carries no bytes of its own to compare, so whether the file already under
 * a name is this frame's own shortcut is a question only the file manager
 * can answer, and it is asked for the whole folder in one call for the same
 * reason the making of them is.
 */
async function shortcuts({ home, ids, byId, dest, skipped, already, problems, names, how }) {
  const there = new Set(await readdir(dest).catch(() => []));

  const wants = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) { skipped.push(id); continue; } // gone from the index since it was trayed
    /* The archive's resolved path, and not the one it was opened under. It
       is what the link is made to point at and what the file manager hands
       back when it is asked what a link points at, and the two have to be
       the same string or every re-export reads as a folder full of other
       people's photographs. */
    wants.push({ id, src: path.join(home, item.path), asked: names(item, id) });
  }

  /* Every occupied name, asked about once. A question costs an apple event
     or a com object either way, so the ones worth asking are gathered first
     and asked together rather than one at a time down the tray. */
  const held = [];
  for (const w of wants) {
    for (const c of w.asked) {
      const file = host.linkName(c);
      if (there.has(file)) held.push({ name: file, src: w.src });
    }
  }
  const answer = held.length
    ? await host.linksAlready(held, dest)
    : { same: new Set(), unknown: new Set() };

  /* Keyed on both halves, because the same name gets asked about for two
     different frames when they share a basename and the answer that comes
     back is not the same one. Stringified rather than joined on a separator:
     there is no character a filename cannot contain that is also easy to
     read back, and every one that looks safe is a name somebody's camera
     will eventually produce. */
  const key = (name, src) => JSON.stringify([name, src]);
  const ours = new Set();
  const murky = new Set();
  held.forEach((h, i) => {
    if (answer.same.has(i)) ours.add(key(h.name, h.src));
    else if (answer.unknown.has(i)) murky.add(key(h.name, h.src));
  });

  const taken = new Set();
  const jobs = [];
  for (const w of wants) {
    const [bare, tagged] = w.asked;
    let done = false;
    for (const c of taken.has(bare) ? [tagged] : [bare, tagged]) {
      const file = host.linkName(c);
      taken.add(c);
      if (!there.has(file)) {
        jobs.push({ id: w.id, name: file, src: w.src, at: path.join(dest, file) });
        done = true;
      } else if (ours.has(key(file, w.src))) {
        already.push(w.id);
        done = true;
      } else if (murky.has(key(file, w.src))) {
        /* The file manager would not say what is under that name. A broken
           link and a folder it cannot read both land here, and the safe
           answer is the one that cannot write a second copy of a photograph
           the folder may already hold. */
        problems.push({ id: w.id, name: file, why: `${host.files} would not say what is already there under that name` });
        skipped.push(w.id);
        done = true;
      }
      // and anything else is a different photograph holding the name, which
      // is exactly what the id suffixed name below it is for
      if (done) break;
    }
    if (!done) {
      skipped.push(w.id);
      problems.push({ id: w.id, name: host.linkName(bare), why: "both of the names it could use are held by other files" });
    }
  }

  if (!jobs.length) return { written: 0, already, skipped, problems, dest, mode: how };

  const bad = await host.links(jobs, dest);
  for (const i of bad) {
    if (!jobs[i]) continue;
    skipped.push(jobs[i].id);
    problems.push({ id: jobs[i].id, name: jobs[i].name, why: `${host.files} would not make that one` });
  }

  /**
   * WRITTEN IS COUNTED OFF THE DISK AND NOT OFF WHAT THE SCRIPT SAID.
   *
   * `jobs.length - bad.size` is arithmetic on a report, and this is the one
   * mode where the writing is done by another program. A file manager that
   * comes back with no error having made nothing is not a hypothetical: it
   * is the exact shape of the bug that made the windows trash delete nothing
   * for the whole life of that line while every run looked like a success,
   * and both trash paths grew a check of the drive because of it. This is
   * that check, for the other direction.
   */
  let written = 0;
  for (const [i, j] of jobs.entries()) {
    if (bad.has(i)) continue;
    try {
      await lstat(j.at);
      written++;
    } catch {
      skipped.push(j.id);
      problems.push({ id: j.id, name: j.name, why: `${host.files} reported no trouble and made nothing` });
    }
  }

  return { written, already, skipped, problems, dest, mode: how };
}
