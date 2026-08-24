import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  // one jpeg per raw negative, keyed by the same id as the thumbnail beside
  // it, because nothing downstream of the scan can open an ARW itself
  proxy: path.join(root, DIR, "proxy"),
});

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 1));
}

export const readIndex = (root) => readJson(paths(root).index, null);
export const writeIndex = (root, v) => writeJson(paths(root).index, v);
export const readTags = (root) => readJson(paths(root).tags, {});
export const writeTags = (root, v) => writeJson(paths(root).tags, v);

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
export const readBinned = (root) => readJson(paths(root).binned, []);
export const writeBinned = (root, v) => writeJson(paths(root).binned, v);
export const readPlacements = (root) => readJson(paths(root).placements, {});
export const writePlacements = (root, v) => writeJson(paths(root).placements, v);
