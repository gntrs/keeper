import { scan } from "./scan.mjs";
import { buildThumbs } from "./thumbs.mjs";
import {
  adopt, idFor, paths, readIndex, writeIndex,
  readTags, writeTags, readBinned, writeBinned, readPlacements, writePlacements,
} from "./store.mjs";
import { readTrays, writeTrays } from "./trays.mjs";
import { carryBinned, carryPlacements, carryTags, carryTrays, moved } from "./carry.mjs";

/**
 * Scan a folder and thumbnail what is in it, reusing the index that is
 * already there unless rescan says otherwise.
 *
 * onPhase is the only way out. The terminal draws a bar from it and the
 * server keeps a job record from it, and neither of those two belongs in
 * here: this ran inside the CLI until the browser needed to point keeper at
 * a second folder without restarting the process.
 *
 * Every event carries {phase, done, total, frames}. frames is the scanned
 * count, which is what a caller wants to print the moment scanning ends,
 * before a single thumbnail exists. The final "ready" event also carries
 * failed and filmSkipped, because those two are worth saying out loud and
 * are gone from the index by then.
 */
export async function buildIndex(root, { rescan = false, onPhase } = {}) {
  const emit = (e) => { try { onPhase?.(e); } catch { /* a broken listener is not a broken scan */ } };

  await adopt(root);

  const existing = rescan ? null : await readIndex(root);
  if (existing?.items?.length) {
    const n = existing.items.length;
    // an index written before this travelled with it carries neither, and a
    // missing census is not an empty one, so it says nothing rather than
    // claiming the drive held nothing else
    emit({
      phase: "ready", done: n, total: n, frames: n,
      ignored: existing.ignored, barren: existing.barren, shut: existing.shut,
    });
    return existing;
  }

  emit({ phase: "scanning", done: 0, total: 0, frames: 0 });
  const found = await scan(root, {
    onProgress: (n) => emit({ phase: "scanning", done: n, total: 0, frames: n }),
  });
  // What the scan walked past travels with the index rather than only with
  // the run that built it, because the question it answers, "is the thing I
  // am looking for even on this drive", gets asked long after the scan.
  const passed = { ignored: found.ignored, barren: found.barren, shut: found.shut };
  const items = found.items.map((f) => ({ ...f, id: idFor(f.path) }));

  if (!items.length) {
    // a folder with nothing readable in it is an answer, not a failure. the
    // empty index gets written anyway so the shelf reads a real document
    // saying zero rather than a null it has to guess about.
    const empty = { items: [], builtAt: new Date().toISOString(), root, ...passed };
    await writeIndex(root, empty);
    emit({ phase: "ready", done: 0, total: 0, frames: 0, ...passed });
    return empty;
  }

  emit({ phase: "thumbnailing", done: 0, total: items.length, frames: items.length });
  const res = await buildThumbs(root, items, paths(root).thumbs, {
    onProgress: (n) => emit({ phase: "thumbnailing", done: n, total: items.length, frames: items.length }),
  });

  const byId = new Map(res.meta.map((m) => [m.id, m]));
  const merged = items.map((i) => ({ ...i, ...(byId.get(i.id) ?? {}) }));
  const index = { items: merged, builtAt: new Date().toISOString(), root, ...passed };

  /* THE DECISIONS COME ACROSS BEFORE THE INDEX DOES, AND THAT ORDER IS LOAD
     BEARING.
   *
     The sidecars are rewritten first and the index second, because those two
     writes cannot be made one and something has to be true if the machine
     stops between them. Sidecars first and the stars are keyed to frames the
     index does not name yet, which the next rescan finds and finishes, and it
     finishes correctly because there is nothing left to carry. Index first and
     the old index is gone, so the only record of where those decisions used to
     point has been thrown away and no later run can ever reunite them.

     `before` is read here rather than reused from the top of this function
     because a rescan takes that branch and never reads it. */
  const before = (await readIndex(root))?.items ?? [];
  const map = moved(before, merged);
  if (map.size) await carry(root, map);

  await writeIndex(root, index);
  emit({
    phase: "ready",
    done: items.length,
    total: items.length,
    frames: items.length,
    failed: res.failed,
    filmSkipped: res.filmSkipped,
    ...passed,
  });
  return index;
}

/**
 * Moves every decision the archive holds onto the ids the frames have now.
 *
 * All four, because all four are keyed by id and a rename broke all four in
 * the same breath: the tags and the stars, the bin, the bench's placements
 * and whatever is sitting in a tray. Each file is left alone unless something
 * in it actually changed, so an archive where one folder was renamed does not
 * come back with four rewritten sidecars and four new backups.
 */
async function carry(root, map) {
  const [tags, binned, placements, trays] = await Promise.all([
    readTags(root), readBinned(root), readPlacements(root), readTrays(root),
  ]);

  const t = carryTags(tags, map);
  const b = carryBinned(binned, map);
  const p = carryPlacements(placements, map);
  const y = carryTrays(trays, map);

  if (t.touched) await writeTags(root, t.out);
  if (b.touched) await writeBinned(root, b.out);
  if (p.touched) await writePlacements(root, p.out);
  if (y.touched) await writeTrays(root, y.out);
}

/**
 * One job at a time, in module state, because one server serves one person
 * looking at one archive. A queue or a map keyed by request would be
 * machinery for a second user who does not exist, and two scans racing on
 * the same .keeper folder would both write the index.
 */
const job = { root: null, phase: "idle", done: 0, total: 0, frames: 0, error: null };
let running = false;

export function jobState() {
  return { ...job };
}

export function startOpen(folder, opts = {}) {
  if (running) throw new Error("a folder is already opening");
  running = true;
  Object.assign(job, { root: folder, phase: "scanning", done: 0, total: 0, frames: 0, error: null });

  buildIndex(folder, {
    ...opts,
    onPhase: (e) => {
      // "ready" is not taken from the build. the index is written after the
      // last event fires, and a browser that polled in that gap would go
      // fetch a state that is not on disk yet.
      if (e.phase !== "ready") job.phase = e.phase;
      job.done = e.done;
      job.total = e.total;
      job.frames = e.frames;
      opts.onPhase?.(e);
    },
  }).then(
    (index) => { job.frames = index.items.length; job.phase = "ready"; },
    (e) => { job.error = String(e?.message ?? e); job.phase = "failed"; },
  ).finally(() => { running = false; });

  return { ok: true };
}
