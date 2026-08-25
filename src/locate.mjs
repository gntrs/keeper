import { readdir } from "node:fs/promises";
import path from "node:path";

import { host } from "./os/index.mjs";
import { STILL_EXT, FILM_EXT } from "./scan.mjs";

/** how many candidates ever come back, and how many file lookups are spent */
const CAP = 8;
/** spotlight will happily name a hundred folders called "photos". score a few, not all of them */
const SCORE_CAP = 40;

/**
 * A dragged folder is a copy of a system folder as often as it is the real
 * one, and a .keeper folder is keeper's own scratch directory. None of the
 * three is ever the archive someone meant to open.
 */
const JUNK = new Set([".Trash", ".Trashes", "node_modules", ".keeper", ".keepers"]);
const junky = (p) => p.split(path.sep).some((seg) => JUNK.has(seg));

/**
 * A FOLDER THE OPERATING SYSTEM PRESENTS AS A SINGLE FILE, AND READING INTO
 * ONE IS NOT FREE.
 *
 * `Photos Library.photoslibrary` sits in the pictures folder and is a
 * directory like any other as far as readdir is concerned. It is not one to
 * the person who owns it, and on macos it is behind its own permission: the
 * first read puts a photos prompt on screen. Somebody who dropped a folder on
 * the window did not ask to be asked that, and a prompt they did not expect
 * is a prompt they say no to.
 *
 * So the sweep walks past every one of these rather than into it. Nothing is
 * lost: an archive keeper can open is a folder of files, and none of these is
 * that.
 */
const PACKAGES = new Set([
  ".photoslibrary", ".photolibrary", ".aplibrary", ".migratedaperturelibrary",
  ".fcpbundle", ".imovielibrary", ".theater", ".tvlibrary", ".musiclibrary",
  ".lrdata", ".lrcat", ".sparsebundle", ".app", ".bundle", ".framework", ".pkg",
]);
const sealed = (name) => PACKAGES.has(path.extname(name).toLowerCase());

/**
 * The machine's own search index, which already holds what turns a folder
 * name back into a path. Spotlight on a mac, Windows Search on the other,
 * and neither is asked a question the other cannot answer: one name, and
 * whether it has to be a folder.
 *
 * Zero results is an expected answer on both. An index can be switched off
 * and an external drive is often not in one at all, which is why /api/choose
 * exists and why nothing here treats an empty list as a failure.
 */
const find = (term, kind) => host?.search(term, kind) ?? [];

/**
 * How many directories the sweep below may read before it gives up. The depth
 * already stops it at two, and this stops it again on a machine where two is
 * still thousands: a downloads folder with six hundred things in it should
 * not turn a dropped folder into a disk crawl. What matters is the count of
 * directories read while somebody waits with a folder under the cursor.
 */
const SWEEP_DIRS = 240;

/**
 * And the stop for a directory that will not answer at all: a mapped network
 * drive that is offline, or an external disk asleep, can hold a single
 * readdir for half a minute while somebody stands there with a folder under
 * the cursor. One that has not answered by the deadline contributes nothing
 * and the sweep goes on without it.
 *
 * GENEROUS ON PURPOSE, BECAUSE IT IS NOT A PERFORMANCE BUDGET. A sweep that
 * finds anything is finished in about a tenth of this, and the first one
 * after an install is slower than every one after it: the first read of a
 * protected folder waits on the permission machinery before it returns a
 * single name. Set to something tight, this stops being the guard against a
 * dead drive and starts being the reason a desktop folder is not found.
 * Measured at 1.5s, it cut off the desktop and the drop fell through to the
 * folder dialog for no reason a person could see.
 */
const SWEEP_MS = 5000;

/**
 * THE OTHER WAY TO ANSWER "WHERE IS THAT FOLDER", AND IT IS NOT A FALLBACK.
 *
 * Spotlight is filtered per app. Opened from its icon rather than a terminal,
 * keeper is handed an index with the protected folders cut out of it: mdfind
 * finds `~/pictures-2026` and comes back empty for the identical folder on the
 * desktop, while readdir on that desktop folder works perfectly. Measured on
 * macos 15. Every archive anyone keeps on a desktop, in documents, or on an
 * external drive is in the half that got cut, which is to say all of them.
 *
 * So the standard roots are read directly, two levels down, and what that
 * finds is merged with whatever the index said rather than used only when the
 * index says nothing. The two see different halves of the same disk and
 * neither is a substitute for the other.
 */
async function sweep(name, kind) {
  if (!host?.roots || !name) return [];

  let level = host.roots();
  const hits = [];
  let read = 0;

  /* one timer for the whole sweep rather than one per directory, so a level
     of two hundred does not schedule two hundred of them. it resolves to
     null, which is the same thing a directory that cannot be read resolves
     to, so nothing downstream has to tell the two apart. */
  let ring;
  const left = new Promise((done) => { ring = setTimeout(() => done(null), SWEEP_MS); });

  /* A LEVEL AT A TIME, AND IT STOPS AT THE FIRST ONE THAT ANSWERS.
     The desktop is read in the first pass, so the ordinary case costs about
     as many readdirs as there are roots and is done in milliseconds. Only a
     name that is nowhere obvious pays for the second pass, and nothing pays
     for a third. */
  for (let depth = 0; depth <= 1 && level.length && !hits.length; depth++) {
    const batch = level.slice(0, SWEEP_DIRS - read);
    read += batch.length;

    /* All at once rather than one after another. This is waiting on the disk
       and not on the cpu, and a level is a couple of hundred directories: in
       sequence that is three seconds of somebody watching a card, and in
       parallel it is a fraction of one. */
    const listed = await Promise.all(batch.map((dir) =>
      Promise.race([
        readdir(dir, { withFileTypes: true }).then(
          (entries) => ({ dir, entries }),
          () => null), // not on this machine, or not readable
        left,
      ])));

    const next = [];
    for (const got of listed) {
      if (!got) continue;
      for (const e of got.entries) {
        if (e.name.startsWith(".") || JUNK.has(e.name) || sealed(e.name)) continue;
        const full = path.join(got.dir, e.name);
        const folder = e.isDirectory();
        if (e.name === name && (kind === "folder" ? folder : e.isFile())) hits.push(full);
        if (folder) next.push(full);
      }
    }
    level = next;
  }

  clearTimeout(ring);
  return hits;
}

/** the index and the disk, each seeing what the other cannot, counted once */
const both = async (term, kind) => {
  const [indexed, swept] = await Promise.all([find(term, kind), sweep(term, kind)]);
  return [...new Set([...indexed, ...swept])];
};

/**
 * What a folder holds, from a single readdir. Deliberately not recursive:
 * this runs on up to forty candidates while a person waits with a folder
 * still under the cursor, and walking a photo archive to answer "is this the
 * one" would cost more than the scan it is trying to save.
 */
async function look(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null; // gone, or not readable, which is the same to a picker
  }
  const names = new Set();
  let frames = 0;
  for (const e of entries) {
    if (e.name.startsWith("._")) continue; // apple resource fork sidecars
    names.add(e.name);
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (STILL_EXT.has(ext) || FILM_EXT.has(ext)) frames++;
  }
  return { names, frames };
}

const nameOf = (f) => (typeof f === "string" ? f : f?.name);

/**
 * Turn what a browser knows about a drop back into a path on this disk.
 *
 * The browser is not being difficult: a folder dropped out of the file
 * manager arrives as a name and a list of what is directly inside it, and the
 * absolute path is withheld on purpose. The machine's own search index
 * already holds that, and answers a name query in tens of milliseconds, so
 * the path comes back from there and the entries in the drop are used to tell
 * the right "photos" from the other six.
 *
 * Zero candidates is an expected answer. An index can be switched off and an
 * external drive can be missing from one, which is why /api/choose exists.
 */
export async function locate({ name, kind, files } = {}) {
  const wanted = (files ?? []).map(nameOf).filter(Boolean);

  if (kind === "files") return byFiles(wanted);
  if (!name) return [];

  const hits = (await both(name, "folder"))
    .filter((p) => !junky(p))
    .slice(0, SCORE_CAP);

  const want = new Set(wanted);
  const scored = [];
  for (const dir of hits) {
    const seen = await look(dir);
    if (!seen) continue;
    let score = 0;
    for (const n of want) if (seen.names.has(n)) score++;
    scored.push({ path: dir, name: path.basename(dir), frames: seen.frames, score });
  }

  return rank(scored);
}

/**
 * The other half of the drop: a handful of loose photographs rather than the
 * folder holding them. Every one of them is somewhere, and the folder that
 * holds the most of them is the archive. Eight lookups is the ceiling because
 * the answer stops improving long before that and the person is waiting.
 */
async function byFiles(names) {
  const lists = await Promise.all(
    names.slice(0, CAP).map((n) => both(n, "file")),
  );

  const counts = new Map();
  for (const hits of lists) {
    const seen = new Set();
    for (const file of hits) {
      const dir = path.dirname(file);
      if (junky(dir) || seen.has(dir)) continue; // one file, one vote per folder
      seen.add(dir);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }

  const best = [...counts].sort((a, b) => b[1] - a[1]).slice(0, SCORE_CAP);
  const scored = [];
  for (const [dir, score] of best) {
    const seen = await look(dir);
    if (!seen) continue;
    scored.push({ path: dir, name: path.basename(dir), frames: seen.frames, score });
  }

  return rank(scored);
}

/**
 * Best first: the folder that matched the most of the drop, and where two
 * matched the same, the one with more photographs in it. score is dropped on
 * the way out because it means nothing outside this file.
 */
function rank(scored) {
  return scored
    .sort((a, b) => b.score - a.score || b.frames - a.frames || a.path.length - b.path.length)
    .slice(0, CAP)
    .map(({ path: p, name, frames }) => ({ path: p, name, frames }));
}
