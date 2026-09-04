import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const DIR = ".keeper";

/** what the scratch folder was called before the tool was, and the archives
 *  written under that name are still full of thumbnails and placements */
const WAS = ".keepers";

/**
 * Take over an archive that was indexed under the old folder name. A rename
 * rather than a rebuild, because the expensive half of an archive is the
 * thumbnails and the irreplaceable half is the placements, and both are
 * already sitting there under a name one letter longer than the one this
 * looks for.
 *
 * It only ever runs when there is nothing to lose: a folder that already has
 * a `.keeper` in it is left exactly as it is, both folders and all.
 */
export async function adopt(root) {
  const now = path.join(root, DIR);
  const then = path.join(root, WAS);
  if (existsSync(now) || !existsSync(then)) return false;
  await rename(then, now);
  return true;
}

/**
 * A frame's id is a hash of its path inside the archive, not its position in
 * the scan. That choice is what lets an archive grow: drop 200 new frames in
 * and every tag written last month still points at the same photograph.
 * Position based ids would have silently slid by 200 and repointed the lot.
 */
export function idFor(relPath) {
  /* Separators are normalised here as well as at the scan, so an index
     written by an older build, or a path that reached this from anywhere
     else, still hashes to the one id. On a mac this is a no-op. */
  return createHash("sha1").update(relPath.split("\\").join("/")).digest("hex").slice(0, 12);
}

export const paths = (root) => ({
  dir: path.join(root, DIR),
  index: path.join(root, DIR, "index.json"),
  tags: path.join(root, DIR, "tags.json"),
  placements: path.join(root, DIR, "placements.json"),
  binned: path.join(root, DIR, "binned.json"),
  thumbs: path.join(root, DIR, "thumbs"),
  sheets: path.join(root, DIR, "sheets"),
  // the trays sidecar is read in src/trays.mjs and written here, so that
  // every write in the archive goes through the one atomic path
  trays: path.join(root, DIR, "trays.json"),
  // one process claims an archive at a time, and this is the claim. src/lock.mjs
  // owns what goes in it
  run: path.join(root, DIR, "run.json"),
  // one jpeg per raw negative, keyed by the same id as the thumbnail beside
  // it, because nothing downstream of the scan can open an ARW itself
  proxy: path.join(root, DIR, "proxy"),
});

/**
 * Write a sidecar so that a run killed halfway through it costs nothing.
 *
 * The bytes go to a temp name beside the file, are flushed to the platter
 * with fsync, and only then are renamed over the real name. A rename inside
 * one directory is atomic, so a reader opening the file at any moment gets
 * the whole of the old one or the whole of the new one and never the half
 * written thing in between. The bare writeFile this replaces truncated
 * first: a SIGKILL 240ms into one tag write left tags.json six megabytes
 * long and unparseable, and the next write made that permanent.
 *
 * The copy to `<name>.bak` is the last good copy, kept for a person rather
 * than for the program. Nothing here reads it back automatically, because a
 * backup restored by a machine that cannot tell a good file from a bad one
 * is how one bad write becomes two.
 */
export async function putJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(JSON.stringify(value, null, 1));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await copyFile(file, `${file}.bak`).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * What a person is told when a sidecar will not parse.
 *
 * It names the file, it names the copy sitting beside it, and it says what
 * to do with the pair. The old reader answered an unreadable tags.json with
 * an empty object, which is the same answer as "you have never tagged
 * anything", and the next write then wrote that answer down.
 */
function unreadable(file, why) {
  const name = path.basename(file);
  const e = new Error(
    `${name} in ${path.dirname(file)} is unreadable (${why}). keeper will not ` +
      `guess at it. the last good copy is ${name}.bak beside it: check it, put ` +
      `it in place of the broken one, and open the folder again.`,
  );
  e.code = "EUNREADABLE";
  return e;
}

/** A sidecar that is not there yet is its fallback, and nothing else is. */
async function readJson(file, fallback, shaped) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw unreadable(file, e.message);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw unreadable(file, e.message);
  }
  /* A file can parse and still be nothing keeper wrote, and a tags.json
     holding an array would be read as an empty tag set by every caller
     below. Shape is checked here so that it is refused in one place. */
  if (shaped && !shaped(value)) throw unreadable(file, "it parses but it is not the shape keeper writes");
  return value;
}

const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The index is the one sidecar that is allowed to be broken, because it is
 * the one sidecar that can be made again: a scan rebuilds it from the
 * photographs. Tags and placements cannot be made again by anything, so they
 * throw, and a refusal to open the folder is cheaper than a silent reset.
 */
export async function readIndex(root) {
  try {
    return await readJson(paths(root).index, null, plainObject);
  } catch (e) {
    if (e.code === "EUNREADABLE") return null;
    throw e;
  }
}
export const writeIndex = (root, v) => putJson(paths(root).index, v);
export const readTags = (root) => readJson(paths(root).tags, {}, plainObject);
export const writeTags = (root, v) => putJson(paths(root).tags, v);

/**
 * The frames you are done looking at.
 *
 * A list of ids and nothing else. It is not a folder of files and nothing
 * moves into it, because the whole point of it is that nothing moves: a
 * frame in here is exactly where it always was on the drive, and keeper has
 * simply stopped putting it on the wall. That makes the list throwaway. Lose
 * binned.json and you lose an opinion about which frames were boring, not a
 * single photograph.
 */
export const readBinned = (root) => readJson(paths(root).binned, [], Array.isArray);
export const writeBinned = (root, v) => putJson(paths(root).binned, v);
export const readPlacements = (root) => readJson(paths(root).placements, {}, plainObject);
export const writePlacements = (root, v) => putJson(paths(root).placements, v);

/**
 * The write half of the trays sidecar. The read half stays in src/trays.mjs,
 * beside the tray rules it belongs to, but the write comes here because
 * every write into an archive is atomic or none of them are.
 */
export const writeTrays = (root, v) => putJson(paths(root).trays, v);

/**
 * Read everything a person would lose, before the app touches any of it.
 *
 * The server calls this at boot and again for a folder it is asked to open,
 * so that a broken sidecar stops the archive at the door with a sentence
 * rather than being discovered halfway through a session by a write that
 * flattens it. The first failure is the one that gets out: a person fixing
 * files by hand wants one thing to fix at a time.
 */
export async function checkArchive(root) {
  const p = paths(root);
  await readJson(p.tags, {}, plainObject);
  await readJson(p.placements, {}, plainObject);
  await readJson(p.binned, [], Array.isArray);
  await readJson(p.trays, null, plainObject);
}
