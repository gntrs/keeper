import { copyFile, lstat, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
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
      ids: Array.isArray(t.ids) ? t.ids.filter((i) => typeof i === "string") : [],
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
async function settled(p) {
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

const inside = (parent, child) => {
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

  const taken = new Set();
  const skipped = [];

  /* The two names a frame is allowed to land under, in order. The bare one
     is skipped outright once this run has already used it, so the second
     frame called DSC_0041.jpg does not have to fail a write to learn that. */
  const candidates = (item, id) => {
    const ext = path.extname(item.path);
    const stem = path.basename(item.path, ext);
    const first = `${stem}${ext}`;
    return taken.has(first) ? [`${stem}-${id}${ext}`] : [first, `${stem}-${id}${ext}`];
  };

  if (how !== "copy" && how !== "symlink") {
    return shortcuts({ root, tray, byId, dest, taken, skipped, candidates, how });
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

  let written = 0;
  for (const id of tray.ids) {
    const item = byId.get(id);
    if (!item) { skipped.push(id); continue; } // gone from the index since it was trayed

    let done = false;
    for (const name of candidates(item, id)) {
      try {
        await write(item, path.join(dest, name));
        taken.add(name);
        written++;
        done = true;
        break;
      } catch (e) {
        /* Windows only hands out symlinks to an administrator, or to anyone
           once developer mode is on. It is worth saying which of those it is,
           because the raw errno reads like a permissions problem with the
           photograph rather than with the machine, and the tray has two other
           modes that need neither. */
        if (e.code === "EPERM" && how === "symlink" && process.platform === "win32") {
          throw new Error("windows only makes symlinks for an administrator, or for anyone with developer mode turned on in settings. copy and shortcut both work as you are.");
        }
        if (e.code !== "EEXIST") throw e;
        taken.add(name);
      }
    }
    if (!done) skipped.push(id);
  }

  return { written, skipped, dest, mode: how };
}

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
 * exclusively the way copyFile and symlink can. lstat and not stat: a broken
 * link already sitting in the destination still occupies the name, and stat
 * would follow it, find nothing, and report the name free.
 */
async function shortcuts({ root, tray, byId, dest, taken, skipped, candidates, how }) {
  const free = async (p) => {
    try { await lstat(p); return false; } catch { return true; }
  };

  const jobs = [];
  for (const id of tray.ids) {
    const item = byId.get(id);
    if (!item) { skipped.push(id); continue; }

    let name = null;
    for (const c of candidates(item, id)) {
      const asked = host.linkName(c);
      if (await free(path.join(dest, asked))) { name = asked; break; }
      taken.add(c);
    }
    if (!name) { skipped.push(id); continue; }
    taken.add(name);
    jobs.push({ id, name, src: path.join(root, item.path) });
  }

  if (!jobs.length) return { written: 0, skipped, dest, mode: how };

  const bad = await host.links(jobs, dest);
  for (const i of bad) if (jobs[i]) skipped.push(jobs[i].id);

  return { written: jobs.length - bad.size, skipped, dest, mode: how };
}
