import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paths, readIndex, readTags, writeTags, readPlacements, writePlacements } from "./store.mjs";
import { startOpen, jobState } from "./open.mjs";
import { locate } from "./locate.mjs";
import {
  readTrays, writeTrays, trayById, newTray, addTo, removeFrom, dropTray, membership, exportTray, MODES,
} from "./trays.mjs";
import { VOCAB } from "./tags.mjs";
import { placeOf } from "./places.mjs";
import { exportCrops } from "./crops.mjs";
import { clock } from "./film.mjs";
import { execFile } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "web");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".dng": "image/x-adobe-dng",
};

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": TYPES[".json"], "content-length": Buffer.byteLength(s) });
  res.end(s);
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function sendFile(res, file, { cache = "no-store", req } = {}) {
  let s;
  try {
    s = await stat(file);
  } catch {
    return json(res, 404, { error: "not found" });
  }

  /**
   * A thumbnail's url is /thumb/<id>, and an id is a hash of the frame's path
   * RELATIVE to the archive. That is the right call for tags, because it lets
   * an archive grow without every tag sliding onto the wrong photograph. It
   * is a trap for a browser cache: two archives that both hold
   * photos/IMG_0001.jpg produce the same id, so opening a second folder shows
   * the first folder's picture, from disk, with no request made. Before the
   * shelf could open a folder that was picked in the browser this could not
   * happen, because the root was fixed at boot.
   *
   * So the thumb route validates rather than trusting a duration. On
   * localhost a 304 costs a fraction of a millisecond and the file never
   * moves, which is cheaper than a wrong picture.
   */
  const tag = req ? `"${s.mtimeMs.toString(36)}-${s.size.toString(36)}"` : null;
  if (tag && req.headers["if-none-match"] === tag) {
    res.writeHead(304, { etag: tag, "cache-control": cache });
    return res.end();
  }

  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": s.size,
    "cache-control": cache,
    ...(tag ? { etag: tag } : {}),
  });
  createReadStream(file).pipe(res);
}

/**
 * Everything is served from localhost and nothing is served from the network.
 * This is a tool that reads a person's whole photo archive off a drive: it
 * binds to the loopback address on purpose, and that is not a default anyone
 * should relax without meaning it.
 */
export function serve({ root, config, port = 7777, host = "127.0.0.1" }) {
  // root moves. /api/open re-points the whole server at another folder, so
  // anything derived from it has to be derived again per request: paths(root)
  // was hoisted out here once and every thumbnail after the first open came
  // from the folder that was left behind.

  /**
   * A page on any origin can POST to a localhost port, and /api/open now aims
   * keepers at any folder on the disk. The json content type these three
   * routes are called with already forces a CORS preflight that a cross site
   * page cannot pass, and this is the belt to that pair of braces. No CORS
   * headers are sent back, deliberately: one browser on one machine.
   */
  const ownOrigin = (req) => {
    const origin = req.headers.origin;
    return !origin || origin === `http://${req.headers.host}`;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;

    try {
      if (["/api/open", "/api/locate", "/api/choose", "/api/export"].includes(route) && !ownOrigin(req)) {
        return json(res, 403, { error: "that request came from another page" });
      }

      if (route === "/" || route === "/index.html") {
        return sendFile(res, path.join(WEB, "index.html"));
      }

      // the crop model is shared source, not a copy: the browser gets the
      // same file the exporter imports, so the two can never drift.
      if (route === "/geometry.mjs") {
        return sendFile(res, path.join(HERE, "geometry.mjs"), { cache: "no-cache" });
      }

      /**
       * Any single js or css file in web/, rather than a list of the ones
       * that exist today. The list version cost an afternoon: web/tray.js
       * was written, imported, and returned 404, which takes the whole app
       * down at boot because one failed module import stops the graph. A
       * route that has to be edited every time a file is added is a route
       * that will be forgotten.
       *
       * Safe because the pattern admits no slash and no dot beyond the
       * extension, so it cannot climb out of web/ or name a dotfile.
       */
      if (/^\/[a-z0-9][a-z0-9-]*\.(js|css)$/i.test(route)) {
        return sendFile(res, path.join(WEB, route.slice(1)), { cache: "no-cache" });
      }

      if (/^\/font\/[a-z0-9._-]+$/i.test(route)) {
        return sendFile(res, path.join(WEB, route.slice(1)), { cache: "max-age=604800" });
      }

      if (route.startsWith("/thumb/")) {
        const id = route.slice(7).replace(/[^a-f0-9]/g, "");
        return sendFile(res, path.join(paths(root).thumbs, `${id}.webp`), { cache: "no-cache", req });
      }

      // the bench needs the real negative at full size, because the whole
      // point is judging a crop of it. deliberately not resized.
      if (route.startsWith("/full/")) {
        const id = route.slice(6).replace(/[^a-f0-9]/g, "");
        const index = await readIndex(root);
        const hit = index?.items?.find((i) => i.id === id);
        if (!hit) return json(res, 404, { error: "unknown frame" });
        return sendFile(res, path.join(root, hit.path), { cache: "max-age=3600" });
      }

      if (route === "/api/state") {
        const [index, tags, placements, trays] = await Promise.all([
          readIndex(root), readTags(root), readPlacements(root), readTrays(root),
        ]);
        const items = (index?.items ?? []).map((i) => ({
          ...i,
          place: placeOf(i.path, config.places ?? []),
          clock: i.seconds ? clock(i.seconds) : undefined,
        }));
        return json(res, 200, {
          root,
          items,
          builtAt: index?.builtAt ?? null,
          tags,
          placements,
          // frame id to the trays holding it, so the shelf can mark a frame
          // that is already in without asking a second time per thumbnail
          trays: membership(trays),
          slots: config.slots,
          // whether there is a keepers.config.json at all. the bench prints an
          // object-position line only for someone who has one, because that
          // line is a thing to paste into a stylesheet and only a person who
          // wrote their own slots is holding a stylesheet.
          configured: !config.missing,
          vocab: Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, v[0]])),
          hints: Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, v[1]])),
        });
      }

      /**
       * Point the running server at another folder. The archive used to be
       * fixed at boot, which meant the only way to look at a second one was
       * to kill the process and type the path again.
       *
       * A path that names a file opens the folder holding it, because a
       * person dragging one photograph in is showing keepers where their
       * photographs are, not asking for an archive of one.
       */
      if (route === "/api/open" && req.method === "POST") {
        const b = await body(req);
        const asked = String(b.path ?? "").trim();
        if (!asked) return json(res, 400, { error: "no path" });

        let target;
        try {
          // realpath resolves the symlink too. an alias to the archive is a
          // normal way to keep one on a desktop, and the index has to be
          // written where the photographs actually are.
          target = await realpath(path.resolve(asked));
          if (!(await stat(target)).isDirectory()) target = path.dirname(target);
        } catch {
          return json(res, 400, { error: `no such folder: ${asked}` });
        }

        try {
          startOpen(target, { rescan: !!b.rescan });
        } catch (e) {
          return json(res, 409, { error: e.message });
        }
        root = target;
        return json(res, 200, { ok: true, root });
      }

      // scanning ten thousand frames takes a minute, so the answer is a job
      // to poll rather than a request held open for it
      if (route === "/api/progress") {
        return json(res, 200, jobState());
      }

      if (route === "/api/locate" && req.method === "POST") {
        const b = await body(req);
        return json(res, 200, { candidates: await locate({ name: b.name, kind: b.kind, files: b.files }) });
      }

      /**
       * What is left when spotlight comes back with nothing, which happens on
       * an unindexed external drive. This is the real Finder folder chooser,
       * so the path it returns is not a guess.
       *
       * The request stays open for as long as the dialog is up. That is not a
       * hang: the browser has nothing to do until a folder is picked, and the
       * dialog is the answer it is waiting on.
       */
      if (route === "/api/choose" && req.method === "POST") {
        if (process.platform !== "darwin") {
          return json(res, 400, { error: "the folder chooser is macOS only" });
        }
        const picked = await new Promise((done) => {
          execFile("osascript", ["-e", "POSIX path of (choose folder)"], (err, stdout, stderr) => {
            // cancel comes back as exit 1 with "User canceled" on stderr, and
            // it is the ordinary outcome of putting a dialog up, not an error
            // to report to someone who just changed their mind.
            if (err) return done(/User canceled/i.test(String(stderr)) ? { cancelled: true } : { error: String(stderr || err.message).trim() });
            // a POSIX path of a folder comes back with a trailing slash. it
            // goes straight back into /api/open and then into path.join, and
            // both of those read cleaner without it.
            done({ path: stdout.trim().replace(/\/+$/, "") || "/" });
          });
        });
        if (picked.error) return json(res, 500, { error: picked.error.toLowerCase() });
        return json(res, 200, picked);
      }

      /**
       * Mac only, and unapologetically. The moment you find the frame you
       * were looking for, the next thing you want is the file, and the way
       * you get a file on this machine is Finder with it already selected.
       * `open -R` does exactly that and nothing else: it cannot run an
       * arbitrary command, and the path is checked against the index first
       * so it can only ever reveal a file keepers already scanned.
       */
      if (route === "/api/reveal" && req.method === "POST") {
        if (process.platform !== "darwin") {
          return json(res, 400, { error: "reveal is macOS only" });
        }
        const b = await body(req);
        const index = await readIndex(root);
        const hit = index?.items?.find((i) => i.id === b.id);
        if (!hit) return json(res, 404, { error: "unknown frame" });
        execFile("open", ["-R", path.join(root, hit.path)], () => {});
        return json(res, 200, { ok: true });
      }

      if (route === "/api/tag" && req.method === "POST") {
        const b = await body(req);
        const tags = await readTags(root);
        const cur = tags[b.id] ?? {};
        if ("tag" in b) cur.tag = b.tag || undefined;
        if ("star" in b) cur.star = b.star ? 1 : 0;
        tags[b.id] = cur;
        await writeTags(root, tags);
        return json(res, 200, { ok: true });
      }

      if (route === "/api/place" && req.method === "POST") {
        const b = await body(req);
        if (!config.slots.some((s) => s.id === b.slot)) {
          return json(res, 400, { error: `no slot called ${b.slot}` });
        }
        const p = await readPlacements(root);
        p[b.slot] = { id: b.id, place: b.place };
        await writePlacements(root, p);
        return json(res, 200, { ok: true });
      }

      if (route === "/api/place" && req.method === "DELETE") {
        const p = await readPlacements(root);
        delete p[url.searchParams.get("slot")];
        await writePlacements(root, p);
        return json(res, 200, { ok: true });
      }

      /**
       * Trays. The whole set comes back on every read because a tray is a
       * list of ids and even a greedy afternoon produces a few hundred of
       * them, which is smaller than one thumbnail. Paginating that would be
       * work spent to save nothing.
       */
      if (route === "/api/trays" && req.method === "GET") {
        return json(res, 200, await readTrays(root));
      }

      if (route === "/api/trays" && req.method === "POST") {
        const b = await body(req);
        const doc = await readTrays(root);
        const tray = newTray(doc, b.name);
        doc.active = tray.id;
        await writeTrays(root, doc);
        return json(res, 200, { ok: true, tray, ...doc });
      }

      /**
       * One route for every edit a tray can take, because add, remove, clear
       * and rename all end in the same read, mutate and write, and four
       * routes doing that would be four places to get the write wrong.
       *
       * Nothing gets into a tray without being in the index first. A tray
       * full of ids that point at no photograph is a tray that exports
       * nothing and reports that it worked.
       */
      if (route === "/api/trays" && req.method === "PATCH") {
        const b = await body(req);
        const doc = await readTrays(root);
        const tray = trayById(doc, b.id);
        if (!tray) return json(res, 404, { error: "no such tray" });

        // only an add is checked. a remove is allowed to name a frame the
        // index has since lost, otherwise a tray that outlived one of its
        // photographs could never be got clean again.
        if (b.add?.length) {
          const index = await readIndex(root);
          const known = new Set((index?.items ?? []).map((i) => i.id));
          if (b.add.some((id) => !known.has(id))) return json(res, 404, { error: "unknown frame" });
        }

        /* The two fields that make a tray behave like a project folder
           rather than a question asked twice. Both are validated here and
           not on the way out, because a mode this route does not recognise
           would otherwise sit in trays.json until an export tried to run it. */
        if (typeof b.mode === "string") {
          if (!MODES.includes(b.mode)) return json(res, 400, { error: `no export mode called ${b.mode}` });
          tray.mode = b.mode;
        }
        // an empty string is how the panel says "forget where it went", so
        // it clears the field rather than being ignored as falsy
        if (typeof b.dest === "string") tray.dest = b.dest.trim() || undefined;

        if (typeof b.name === "string" && b.name.trim()) tray.name = b.name.trim().slice(0, 60);
        if (b.clear) tray.ids = [];
        if (b.add?.length) addTo(tray, b.add);
        if (b.remove?.length) removeFrom(tray, b.remove);
        if (b.active) doc.active = tray.id;

        await writeTrays(root, doc);
        return json(res, 200, { ok: true, ...doc });
      }

      if (route === "/api/trays" && req.method === "DELETE") {
        const doc = await readTrays(root);
        const last = doc.trays.length === 1;
        const gone = dropTray(doc, url.searchParams.get("id"));
        if (!gone.ok) return json(res, 404, { error: "no such tray" });
        await writeTrays(root, doc);
        return json(res, 200, {
          ok: true,
          cleared: gone.cleared,
          note: last ? "that was the last tray, so it was emptied rather than deleted" : undefined,
          ...doc,
        });
      }

      /**
       * The originals never move. This writes out of the archive into a
       * folder the user named, as copies, as symlinks or as finder aliases,
       * and refuses a destination inside the archive in every one of the
       * three. See exportTray for the rest of the reasoning.
       *
       * A run that worked is remembered on the tray. Someone exporting the
       * same tray twice in an afternoon, which is the ordinary way a folder
       * for a job gets built, should not have to retype the folder or pick
       * the mode again, and the run that just succeeded is better evidence
       * of what they want than anything the panel could ask.
       */
      if (route === "/api/trays/export" && req.method === "POST") {
        const b = await body(req);
        const doc = await readTrays(root);
        const tray = trayById(doc, b.id);
        if (!tray) return json(res, 404, { error: "no such tray" });
        const index = await readIndex(root);
        try {
          const out = await exportTray({ root, tray, folder: b.folder, index, mode: b.mode ?? tray.mode ?? "copy" });
          tray.mode = out.mode;
          tray.dest = out.dest;
          await writeTrays(root, doc);
          return json(res, 200, {
            ok: true, written: out.written, skipped: out.skipped.length, dest: out.dest, mode: out.mode,
          });
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }

      /**
       * The crops, cut and written, from the bench instead of from a second
       * terminal. Twenty minutes of fitting frames into shapes used to end
       * with no button anywhere and one sentence in `keepers help`.
       *
       * It runs the same function the `export` command runs, and it takes no
       * body: what to write is whatever is placed, and where it goes is the
       * config's, so there is nothing here for a caller to aim.
       */
      if (route === "/api/export" && req.method === "POST") {
        const out = await exportCrops({ root, config });
        return json(res, 200, {
          ok: true, written: out.written, soft: out.soft, lost: out.lost, failed: out.failed, dir: out.dir,
        });
      }

      return json(res, 404, { error: "no such route" });
    } catch (e) {
      return json(res, 500, { error: String(e.message) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${port}` }));
  });
}
