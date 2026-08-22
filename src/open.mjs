import { scan } from "./scan.mjs";
import { buildThumbs } from "./thumbs.mjs";
import { adopt, idFor, paths, readIndex, writeIndex } from "./store.mjs";

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
    emit({ phase: "ready", done: n, total: n, frames: n });
    return existing;
  }

  emit({ phase: "scanning", done: 0, total: 0, frames: 0 });
  const found = await scan(root, {
    onProgress: (n) => emit({ phase: "scanning", done: n, total: 0, frames: n }),
  });
  const items = found.map((f) => ({ ...f, id: idFor(f.path) }));

  if (!items.length) {
    // a folder with nothing readable in it is an answer, not a failure. the
    // empty index gets written anyway so the shelf reads a real document
    // saying zero rather than a null it has to guess about.
    const empty = { items: [], builtAt: new Date().toISOString(), root };
    await writeIndex(root, empty);
    emit({ phase: "ready", done: 0, total: 0, frames: 0 });
    return empty;
  }

  emit({ phase: "thumbnailing", done: 0, total: items.length, frames: items.length });
  const res = await buildThumbs(root, items, paths(root).thumbs, {
    onProgress: (n) => emit({ phase: "thumbnailing", done: n, total: items.length, frames: items.length }),
  });

  const byId = new Map(res.meta.map((m) => [m.id, m]));
  const merged = items.map((i) => ({ ...i, ...(byId.get(i.id) ?? {}) }));
  const index = { items: merged, builtAt: new Date().toISOString(), root };
  await writeIndex(root, index);
  emit({
    phase: "ready",
    done: items.length,
    total: items.length,
    frames: items.length,
    failed: res.failed,
    filmSkipped: res.filmSkipped,
  });
  return index;
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
