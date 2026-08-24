import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paths, readIndex, writeIndex, readTags, writeTags, readPlacements, writePlacements, readBinned, writeBinned } from "./store.mjs";
import { startOpen, jobState } from "./open.mjs";
import { locate } from "./locate.mjs";
import {
  readTrays, writeTrays, trayById, newTray, addTo, removeFrom, dropTray, membership, exportTray, MODES,
} from "./trays.mjs";
import { VOCAB } from "./tags.mjs";
import { placeOf } from "./places.mjs";
import { exportCrops, DEFAULT_OUT } from "./crops.mjs";
import { HOSTS, host as machine } from "./os/index.mjs";
import { readableSource } from "./raw.mjs";
import { clock } from "./film.mjs";
import { loadConfig } from "./config.mjs";
import { rememberArchive, setUpdatePolicy, updatePolicy } from "./runtime.mjs";

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
  ".gif": "image/gif",

  /* Film, because /full hands a clip straight to a <video> element, and a
     browser refuses to play bytes it was told are an octet stream, which is
     what everything not named in here silently becomes. The raw formats are
     deliberately absent: they never reach this table at all, being served as
     the jpeg proxy and taking the jpeg type with it.

     `.insv` is mp4 inside, whatever the 360 camera chose to call it, and the
     type has to describe the bytes rather than the extension or the element
     will not touch it. */
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".insv": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".3gp": "video/3gpp",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".ogv": "video/ogg",
  ".mxf": "application/mxf",
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
export function serve({ root, config: opened, port = 7777, host = "127.0.0.1", launched = "cli" }) {
  /* The config belongs to the archive, not to the process, so it moves when
     the archive moves. It used to be captured once at boot, which was right
     while the folder was fixed at boot too. Opened from the icon it is always
     wrong: the app starts on an empty folder and is pointed at the real
     archive a second later, so a person with slots of their own would have
     had every one of them ignored for the whole session. */
  let config = opened;
  // root moves. /api/open re-points the whole server at another folder, so
  // anything derived from it has to be derived again per request: paths(root)
  // was hoisted out here once and every thumbnail after the first open came
  // from the folder that was left behind.

  /**
   * A page on any origin can POST to a localhost port, and /api/open now aims
   * keeper at any folder on the disk. The json content type these three
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
      if (["/api/open", "/api/locate", "/api/choose", "/api/export", "/api/quit", "/api/update/allow", "/api/update/apply"].includes(route) && !ownOrigin(req)) {
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

      /**
       * The bench needs the real negative at full size, because the whole
       * point is judging a crop of it. Deliberately not resized.
       *
       * Except for raw, where the original bytes are the one thing that
       * cannot go down this route: no browser on earth renders an ARW, and
       * sending it would put a broken image in the preview and an empty
       * bench under the crop rectangle. The proxy goes instead, built here
       * if the frame was never thumbnailed, and it is served as what it
       * actually is: a jpeg, with the jpeg content type, at the dimensions
       * the index already reports for that frame.
       */
      if (route.startsWith("/full/")) {
        const id = route.slice(6).replace(/[^a-f0-9]/g, "");
        const index = await readIndex(root);
        const hit = index?.items?.find((i) => i.id === id);
        if (!hit) return json(res, 404, { error: "unknown frame" });
        let file;
        try {
          file = await readableSource(root, hit);
        } catch (e) {
          // one negative the decoder cannot read, said plainly, rather than
          // a 500 that reads as the server having fallen over
          return json(res, 415, { error: String(e.message).toLowerCase() });
        }
        return sendFile(res, file, { cache: "max-age=3600" });
      }

      if (route === "/api/state") {
        const [index, tags, placements, trays, binned] = await Promise.all([
          readIndex(root), readTags(root), readPlacements(root), readTrays(root), readBinned(root),
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
          // the frames set aside. they are still on the drive and still in
          // the index; the shelf simply stops showing them.
          binned,
          // frame id to the trays holding it, so the shelf can mark a frame
          // that is already in without asking a second time per thumbnail
          trays: membership(trays),
          slots: config.slots,
          // whether there is anything on screen that can stop this process.
          // an icon launch has no terminal behind it, so the page carries the
          // only quit there is; a terminal launch already has one and a
          // button that killed it would be a surprise, not a convenience.
          app: launched === "app",
          /**
           * What this machine calls the things keeper hands back to it.
           *
           * The browser needs these because it writes the sentences: "put it
           * back from finder" and "put it back from the recycle bin" are the
           * same sentence with the machine's own word in it, and a page that
           * guessed from the user agent would get it wrong for anyone running
           * keeper on one machine and reading it on another, which is a thing
           * a loopback server on a home network makes easy to do.
           *
           * `keys` is here rather than sniffed for the same reason. It says
           * which modifier is the picking one, and the answer belongs to the
           * machine the files are on, not the one the browser is on.
           */
          host: machine && {
            name: machine.name,
            files: machine.files,
            bin: machine.bin,
            restore: machine.restore,
            keys: machine.name === "macos" ? "mac" : "pc",
          },
          // whether there is a keeper.config.json at all. the bench prints an
          // object-position line only for someone who has one, because that
          // line is a thing to paste into a stylesheet and only a person who
          // wrote their own slots is holding a stylesheet.
          configured: !config.missing,
          // where a crop lands, said before anything is written rather than
          // only in the sentence after. it is the one thing about export
          // nobody could guess.
          out: config.out ? path.resolve(config.out) : DEFAULT_OUT,
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
       * person dragging one photograph in is showing keeper where their
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
        config = await loadConfig(target);
        /* only the icon needs this. someone who typed the folder will type it
           again, and writing their history to a file they never asked for is
           not a service. */
        if (launched === "app") await rememberArchive(target);
        return json(res, 200, { ok: true, root });
      }

      /**
       * Proof that the thing on this port is keeper and not whatever else
       * happened to want 7777 today.
       *
       * It exists for the launcher, which finds a port written in a file and
       * has to decide between opening a browser at it and starting a second
       * server. A file cannot answer that question and a port can, so the
       * file is only ever a rumour and this route is what confirms it.
       */
      if (route === "/api/ping") {
        return json(res, 200, { keeper: true, pid: process.pid, root, launched });
      }

      /**
       * Is there a newer keeper, and may we even ask.
       *
       * The permission is checked before the request rather than after, so
       * a keeper nobody has said yes to answers this without a single packet
       * leaving the machine. That ordering is the whole promise.
       */
      if (route === "/api/update" && req.method === "GET") {
        const { asks, check, isClone, version } = await import("./update.mjs");
        const policy = await updatePolicy();
        if (policy !== "on") {
          /* The address is sent even when the answer is no, because the page
             asking permission has to be able to show what it would ask for.
             Nothing is requested to produce it: it is a constant. */
          return json(res, 200, { policy, current: await version(), clone: isClone(), where: asks() });
        }
        return json(res, 200, { policy, ...(await check()) });
      }

      /**
       * The answer to the question the page asks once, and the answer to the
       * question that follows it.
       *
       * Saying yes used to cost two round trips, because the page set the
       * preference and then asked again what the preference had turned up.
       * The second one is the one that talks to github, so the button sat on
       * a dead word for both. One call now: yes comes back with the check
       * already in it.
       */
      if (route === "/api/update/allow" && req.method === "POST") {
        const b = await body(req).catch(() => ({}));
        const yes = !!b?.yes;
        await setUpdatePolicy(yes);
        if (!yes) return json(res, 200, { ok: true, policy: "off" });
        const { check } = await import("./update.mjs");
        return json(res, 200, { ok: true, policy: "on", ...(await check()) });
      }

      /**
       * Install it and start the new one.
       *
       * The reply goes first for the same reason quit's does: everything
       * after it kills the process this socket belongs to. If the swap
       * throws, nothing has changed on disk and the error is the reply.
       */
      if (route === "/api/update/apply" && req.method === "POST") {
        if ((await updatePolicy()) !== "on") return json(res, 403, { error: "updates are turned off" });
        const { apply, relaunch } = await import("./update.mjs");
        let done;
        try {
          done = await apply();
        } catch (e) {
          return json(res, 409, { error: e.message });
        }
        const restarts = launched === "app";
        json(res, 200, { ok: true, ...done, restarts });
        if (restarts) {
          /* Close first, then start the new one. The other order looks
             identical and is not: the new process would try to bind while
             this one still held the port, land on the next port up, and the
             tab waiting on this one would wait for ever. Keep alive sockets
             have to be dropped by hand or close waits on the browser. */
          setTimeout(() => {
            server.closeAllConnections?.();
            server.close(async () => {
              await relaunch().catch(() => {});
              process.exit(0);
            });
          }, 200);
        }
        return;
      }

      /**
       * Stop.
       *
       * Only reachable when keeper was opened from its icon, because that is
       * the only case where there is no terminal to press ctrl-c in. Someone
       * who started it by typing already has a way to stop it and would not
       * thank a web page for taking the process down under them.
       *
       * The reply goes out before the shutdown, and the shutdown is a beat
       * late on purpose: closing the server inside the handler kills the
       * socket carrying the answer, so the page never hears that it worked
       * and shows a failure for the one action that did not fail.
       */
      if (route === "/api/quit" && req.method === "POST") {
        if (launched !== "app") return json(res, 403, { error: "started from a terminal, so ctrl-c owns this" });
        json(res, 200, { ok: true });
        setTimeout(() => { server.close(); process.exit(0); }, 120);
        return;
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
       * What is left when the search index comes back with nothing, which
       * happens on an external drive that was never indexed. This is the
       * machine's real folder chooser, so the path it returns is not a guess.
       */
      if (route === "/api/choose" && req.method === "POST") {
        if (!machine) return json(res, 400, { error: `the folder chooser needs ${HOSTS}` });
        const picked = await machine.chooseFolder();
        if (picked.error) return json(res, 500, { error: picked.error });
        return json(res, 200, picked);
      }

      /**
       * The moment you find the frame you were looking for, the next thing
       * you want is the file itself, and the way you get a file on either of
       * these machines is the file manager with it already selected. The call
       * underneath cannot run an arbitrary command, and the path is checked
       * against the index first, so this can only ever reveal a file keeper
       * has already scanned.
       */
      if (route === "/api/reveal" && req.method === "POST") {
        if (!machine) return json(res, 400, { error: `reveal needs ${HOSTS}` });
        const b = await body(req);
        const index = await readIndex(root);
        const hit = index?.items?.find((i) => i.id === b.id);
        if (!hit) return json(res, 404, { error: "unknown frame" });
        machine.reveal(path.join(root, hit.path));
        return json(res, 200, { ok: true });
      }

      /**
       * Put a frame out of sight. NOTHING ON THE DISK MOVES.
       *
       * `delete` in a culling tool used to mean the macOS trash, and that was
       * wrong in a way that took a real drive to notice: a shot can be bad
       * and still be the only copy, and a tool whose fast key is wired to
       * the one irreversible thing on the machine is a tool that will
       * eventually eat somebody's footage. The frame you do not want to look
       * at any more is not the same frame as the file you want off the disk,
       * and keeper was treating them as one.
       *
       * So this writes an id to a list. The photograph stays exactly where it
       * was, the index still holds it, the tags still hold it, and putting it
       * back is the same request with `put` set. Actually removing a file is
       * a separate, slower, louder thing, and it can only be asked for about
       * a frame that is already in here.
       */
      if (route === "/api/bin" && req.method === "POST") {
        const b = await body(req);
        const ids = Array.isArray(b.ids) ? b.ids : [];
        if (!ids.length) return json(res, 400, { error: "no frames named" });

        const have = new Set(await readBinned(root));
        for (const id of ids) b.put ? have.delete(id) : have.add(id);
        const next = [...have];
        await writeBinned(root, next);
        return json(res, 200, { ok: true, binned: next });
      }

      /**
       * The one thing in keeper that touches an original, and it moves it
       * rather than removing it.
       *
       * The machine's own delete is used, and never `unlink`, for one reason:
       * it puts the file in the wastebasket with the record that lets it be
       * put back afterwards. `unlink` would be one line and it would be
       * permanent, and permanent is not a thing a culling tool gets to do to
       * somebody's negatives.
       *
       * Every id is checked against the index first, so this can only ever
       * name a file keeper has already scanned, and no path is ever written
       * into the text of the script that moves it.
       */
      if (route === "/api/trash" && req.method === "POST") {
        if (!machine) return json(res, 400, { error: `deleting needs ${HOSTS}` });
        if (!ownOrigin(req)) return json(res, 403, { error: "that request came from another page" });

        const b = await body(req);
        const ids = Array.isArray(b.ids) ? b.ids : [];
        if (!ids.length) return json(res, 400, { error: "no frames named" });

        const index = await readIndex(root);
        const known = new Map((index?.items ?? []).map((i) => [i.id, i]));
        const hits = ids.map((id) => known.get(id)).filter(Boolean);
        if (hits.length !== ids.length) return json(res, 404, { error: "unknown frame" });

        /* Only out of the bin, and there is no way round this from the
           browser. Two stages is the whole safety: the fast key sets a frame
           aside and cannot reach a file, and the slow one that can reach a
           file is only reachable from a screen you had to go to on purpose.
           A single request that both binned and trashed would put the file
           back within one keystroke of a photograph. */
        const set = new Set(await readBinned(root));
        if (!ids.every((id) => set.has(id))) {
          return json(res, 409, { error: "only frames already in the bin can be deleted" });
        }

        try {
          await machine.trash(hits.map((h) => path.join(root, h.path)));
        } catch (e) {
          return json(res, 500, { error: e.message.toLowerCase() });
        }

        /* The index is the app's copy of what is on the drive, so it has to
           lose them too. Tags and placements are deliberately left alone: a
           frame put back from the Trash comes back to its own tags, because
           an id is a hash of the path and the path did not change. */
        const gone = new Set(ids);
        await writeIndex(root, {
          ...index,
          items: (index?.items ?? []).filter((i) => !gone.has(i.id)),
        });
        // out of the bin as well, because the bin is a list of frames on the
        // drive and these are not on the drive any more
        await writeBinned(root, [...set].filter((id) => !gone.has(id)));

        return json(res, 200, { ok: true, trashed: hits.length });
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
       * with no button anywhere and one sentence in `keeper help`.
       *
       * It runs the same function the `export` command runs, and it takes no
       * body: what to write is whatever is placed, and where it goes is the
       * config's, so there is nothing here for a caller to aim.
       */
      /**
       * Open the finder on something this export just wrote.
       *
       * "wrote yt-thumb.jpg" is a claim, and a person who has been burned by
       * a tool once wants the folder, not the sentence. A basename and
       * nothing else: no separators, no dots, so nothing outside the export
       * folder can be named from the browser however the request is dressed.
       * With no name it opens the folder itself, which is what the row at the
       * foot of the bench asks for after writing nineteen of them.
       */
      if (route === "/api/reveal-export" && req.method === "POST") {
        if (!machine) return json(res, 400, { error: `reveal needs ${HOSTS}` });
        const b = await body(req).catch(() => ({}));
        const dir = config.out ? path.resolve(config.out) : DEFAULT_OUT;
        const name = typeof b?.file === "string" ? b.file : "";
        if (name && (name.includes("/") || name.includes("\\") || name.startsWith("."))) {
          return json(res, 400, { error: "that is not a file this export wrote" });
        }
        if (name) machine.reveal(path.join(dir, name));
        else machine.openDir(dir);
        return json(res, 200, { ok: true });
      }

      if (route === "/api/export" && req.method === "POST") {
        /* A slot id means that slot alone, which is what the button under a
           picture asks for. No id is still everything placed. Checked here
           rather than in the exporter, because a name that matches nothing
           would come back as a cheerful "wrote 0 crops" and read as the
           export being broken. */
        const b = await body(req).catch(() => ({}));
        const only = typeof b?.slot === "string" && b.slot ? b.slot : null;
        if (only && !config.slots.some((sl) => sl.id === only)) {
          return json(res, 404, { error: `no slot called ${only}` });
        }
        const out = await exportCrops({ root, config, only });
        return json(res, 200, {
          ok: true, written: out.written, soft: out.soft, lost: out.lost, failed: out.failed, dir: out.dir,
          // the names, so the bench can say which file it just made rather
          // than only how many
          files: out.rows.filter((r) => r.file).map((r) => path.basename(r.file)),
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
