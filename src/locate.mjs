import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { STILL_EXT, FILM_EXT } from "./scan.mjs";

const run = promisify(execFile);

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
 * mdfind takes the whole query as one argument. Through a shell it would be
 * a folder name from a browser landing in a command line, so it goes through
 * execFile with the query as a single argv element and never touches sh.
 */
const quote = (s) => String(s).replace(/'/g, "\\'");

async function mdfind(query) {
  try {
    const { stdout } = await run("mdfind", [query], { maxBuffer: 8 << 20 });
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // spotlight off, the drive unindexed, or not a mac at all. all three are
    // "no idea where that is", which the caller already has to handle.
    return [];
  }
}

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
 * The browser is not being difficult: a folder dropped out of Finder arrives
 * as a name and a list of what is directly inside it, and the absolute path
 * is withheld on purpose. Spotlight already has that index, and answers a
 * name query in tens of milliseconds, so the path comes back from mdfind and
 * the entries in the drop are used to tell the right "photos" from the other
 * six.
 *
 * Zero candidates is an expected answer. Spotlight can be switched off and an
 * external drive can be unindexed, which is why /api/choose exists.
 */
export async function locate({ name, kind, files } = {}) {
  const wanted = (files ?? []).map(nameOf).filter(Boolean);

  if (kind === "files") return byFiles(wanted);
  if (!name) return [];

  const hits = (await mdfind(
    `kMDItemFSName == '${quote(name)}' && kMDItemContentTypeTree == 'public.folder'`,
  )).filter((p) => !junky(p)).slice(0, SCORE_CAP);

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
    names.slice(0, CAP).map((n) => mdfind(`kMDItemFSName == '${quote(n)}'`)),
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
