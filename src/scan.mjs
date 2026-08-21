import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Everything keepers is willing to look at. Raw formats are deliberately in:
 * sharp reads the embedded preview out of most of them, which is all a
 * contact sheet needs, and a photographer's drive is full of them.
 */
export const STILL_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff",
  ".heic", ".heif", ".dng",
]);

/** skipped wherever they appear, at any depth */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".keepers", ".Trashes", ".Spotlight-V100",
  ".fseventsd", "__MACOSX", ".DS_Store",
]);

/**
 * Walks a folder and returns every still under it, sorted by path so the
 * order is the same on every machine and every run. That stability is not
 * cosmetic: cell ids are derived from position, and an id that moves between
 * runs would silently repoint every tag written against it.
 */
export async function scan(root, { onProgress } = {}) {
  const out = [];
  let seen = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory, e.g. a permissions-locked system folder
    }
    for (const e of entries) {
      if (e.name.startsWith("._")) continue; // apple resource fork sidecars
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        if (!STILL_EXT.has(path.extname(e.name).toLowerCase())) continue;
        const s = await stat(full).catch(() => null);
        if (!s || s.size < 1024) continue; // a sub-1KB "image" is not one
        out.push({ path: path.relative(root, full), bytes: s.size });
        if (++seen % 250 === 0) onProgress?.(seen);
      }
    }
  }

  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
