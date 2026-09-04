import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  paths, readIndex, writeIndex, readTags, writeTags, readPlacements, writePlacements,
  readBinned, writeBinned, writeTrays, checkArchive,
} from "./store.mjs";
import { claim, release, releaseSync } from "./lock.mjs";
import { RAW_EXT } from "./scan.mjs";
import { startOpen, jobState } from "./open.mjs";
import { locate, nearby, warmRoots } from "./locate.mjs";
import {
  readTrays, trayById, newTray, addTo, removeFrom, dropTray, membership, exportTray, MODES,
} from "./trays.mjs";
import { VOCAB } from "./tags.mjs";
import { placeOf } from "./places.mjs";
import { exportCrops, DEFAULT_OUT } from "./crops.mjs";
import { HOSTS, host as platform } from "./os/index.mjs";
import { readableSource } from "./raw.mjs";
import { clock } from "./film.mjs";
import { loadConfig } from "./config.mjs";
import { appDir, plain, rememberArchive, rememberRan, returning, setToured, setUpdatePolicy, toured, updatePolicy } from "./runtime.mjs";

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

/**
 * Every write to the archive's json goes through here, one at a time.
 *
 * The mutating routes all read a file, change it, and write it back, with
 * awaits in the middle, and the page sends real bursts: tagging a picked
 * set posts one request per frame in parallel. Two of those interleave, the
 * slower read misses the faster write, and the last one to land quietly
 * erases the rest, while every request in the burst reports ok. So the
 * read, the change and the write are made one turn each: the queue is this
 * process, which is the only writer these files have.
 *
 * AND EVERY JOB NAMES THE ARCHIVE IT IS FOR, taken when the request arrived
 * rather than read when the job runs. The folder is a variable /api/open
 * reassigns, and the page sends one request per frame for a bulk keep, so
 * dropping a new folder on the window a second after pressing keep used to
 * land the rest of that burst in the folder that had just been opened.
 * Measured: 240 tag writes left the first archive holding 1 row of 30 and put
 * 30 of its ids into the second, 200 bin writes left 2 of 200, and on two
 * copies of one shoot, which share ids because an id is a hash of the path
 * inside the archive, a delete emptied the index of the archive nobody had
 * touched. Every one of them answered 200.
 */
let turn = Promise.resolve();
function amend(at, job) {
  const run = turn.then(() => job(at), () => job(at));
  turn = run.then(() => {}, () => {});
  return run;
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
 *
 * `machine` is the platform module, taken as an argument rather than reached
 * for at the top of the file, because the one route here that can destroy a
 * photograph has to be testable against a platform that lies. A delete that
 * reports success and removes nothing is the exact failure /api/trash now
 * checks for, and there is no way to stage it without handing this server a
 * different os layer for the length of one test.
 */
export async function serve({ root, config: opened, port = 7777, host = "127.0.0.1", launched = "cli", machine = platform }) {
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

  /* Nothing is served until the sidecars a person would grieve for have been
     read once. A tags.json that will not parse is a folder refused at the
     door with a sentence, because the alternative is finding out on the first
     write, and the first write is the one that flattens it. */
  await checkArchive(root);

  /* One secret per process, written into the page as it goes out and demanded
     back on every write. A page on another origin can post to this port and
     was measured doing exactly that; what it cannot do is read this page, so
     it cannot learn this. It is minted here and never written to disk by this
     file: the claim file is lock.mjs's, and it goes there so the CLI on this
     machine can find it. */
  const TOKEN = randomBytes(16).toString("hex");

  /* The port that was actually taken, which is not the port that was asked
     for when the caller asked for 0 and let the operating system pick. Filled
     in after listen, and read by the claim and by /api/open. */
  let live = port;

  /**
   * A page on any origin can POST to a localhost port, and /api/open aims
   * keeper at any folder on the disk. The json content type was taken for a
   * defence and it is not one: a page served from somewhere else was measured
   * posting to /api/trays/export and copying photographs out of the archive
   * into a folder it named. So a write has to pass two layers now, and this
   * is the first of them.
   *
   * `Origin` is checked when the browser sends one, and `Sec-Fetch-Site` is
   * checked as well because a form post carries no `Origin` at all. Neither
   * is required, because keeper's own CLI posts with neither and refusing it
   * would break the only caller here that is not a browser. That gap is what
   * the second layer, the token, closes.
   *
   * No CORS headers are sent back, deliberately: one browser on one machine.
   */
  const ownOrigin = (req) => {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return false;
    const site = req.headers["sec-fetch-site"];
    return !site || site === "same-origin" || site === "none";
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;

    try {
      /* Every write, before anything works out which route it is. The list
         this replaces named eight routes and missed /api/tag, /api/bin,
         /api/place and the whole of /api/trays, which is how a foreign page
         reached the export. A rule that has to be added to whenever a route
         is added is a rule that will be forgotten, so what is asked here is
         the method and never the path.

         Origin first, then the token, so a request that came from somewhere
         else is refused without this server ever comparing a secret. */
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating && !ownOrigin(req)) {
        return json(res, 403, { error: "that request came from another page" });
      }
      if (mutating && req.headers["x-keeper-token"] !== TOKEN) {
        return json(res, 403, { error: "that request did not carry this keeper's token" });
      }

      /* The page, with this process's token written into its head on the way
         past. It is put in here rather than into the file on disk because the
         file on disk is read by every later process too, and a token that
         outlived the process that minted it would be a secret sitting in a
         repository. */
      if (route === "/" || route === "/index.html") {
        const page = await readFile(path.join(WEB, "index.html"), "utf8");
        res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
        return res.end(page.replace("</head>", `<script>window.KEEPER_TOKEN="${TOKEN}"</script>\n</head>`));
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

      /**
       * A THUMBNAIL THAT IS NOT A PICTURE IS A MISSING THUMBNAIL, NOT A HIT.
       *
       * An empty file under the right name is what a run killed mid encode
       * used to leave, and serving it with a 200 is the worst of the three
       * possible answers: the browser has no picture, the tile is blank, and
       * nothing anywhere said so. The scan cannot make these any more, and
       * this is what stops the ones already on disk from being passed off as
       * a photograph.
       */
      if (route.startsWith("/thumb/")) {
        const id = route.slice(7).replace(/[^a-f0-9]/g, "");
        const file = path.join(paths(root).thumbs, `${id}.webp`);
        const found = await stat(file).catch(() => null);
        if (!found?.size) return json(res, 404, { error: "no thumbnail for that frame" });
        return sendFile(res, file, { cache: "no-cache", req });
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
        /**
         * The frame is in the index and the photograph is not on the drive,
         * which is a folder that moved under a keeper that was already open.
         * Said as its own answer, because the card that receives it has one
         * useful thing to tell somebody and it is not "not found": it is that
         * this file is not where it was, and a rescan will settle it.
         */
        const there = await stat(path.join(root, hit.path)).then(() => true).catch(() => false);
        if (!there) return json(res, 410, { error: "that file is not where keeper left it" });
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
        /* Is the archive still where it was.
         *
         * The index is a list of paths and the page draws a tile for each of
         * them, so a folder that was renamed or a drive that was unplugged
         * while keeper was open produced a wall of broken image icons, a
         * header still counting nine hundred frames, and not one word
         * anywhere saying the folder had gone. One stat answers it, and the
         * page has a sentence for it. */
        const gone = await stat(root).then(() => false).catch((e) => e.code === "ENOENT");

        const [index, tags, placements, trays, binned] = await Promise.all([
          readIndex(root), readTags(root), readPlacements(root), readTrays(root), readBinned(root),
        ]);
        const items = (index?.items ?? []).map((i) => ({
          ...i,
          place: placeOf(i.path, config.places ?? []),
          clock: i.seconds ? clock(i.seconds) : undefined,
          /**
           * Whether this frame is a negative.
           *
           * Decided here rather than in the browser, off the same set the
           * decoder is pointed at, because a second list of extensions kept
           * in the page is a second answer to the question of what a raw is
           * and the two would drift the first time a camera mount was added.
           *
           * It is RAW_EXT and not needsProxy, which is the same set plus bmp
           * and jxl. Those two also go through the jpeg proxy, for their own
           * reason, and neither of them is a negative. A badge saying raw on
           * a bmp would be a lie about the file.
           */
          raw: RAW_EXT.has(path.extname(i.path).toLowerCase()) || undefined,
        }));
        return json(res, 200, {
          root,
          items,
          // the archive is not where the index says it is: renamed, or on a
          // drive that has been unplugged. the page stops drawing tiles for
          // files it cannot fetch and says so instead.
          gone,
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
          // whether this machine has been through the walkthrough, and what
          // it has said about keeper looking for a newer keeper. both are
          // preferences rather than facts about the archive, and both are
          // read from the seat rather than from the browser, because the
          // page's origin carries a port that can change under it.
          toured: await toured(),
          updates: await updatePolicy(),
          // whether keeper had already been used on this machine before this
          // launch. it decides how the walkthrough introduces itself: a first
          // run gets the cards, and somebody who already knows keeper gets
          // asked first. see runtime.mjs, where the answer is snapshotted
          // before anything in this process can write to the seat.
          returning: returning(),
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
          /* Whether this is the empty folder keeper opens when it has nothing
             else to open. The page says "keeper looked through <path> and
             found nothing" on an archive that came up empty, and that sentence
             is a lie about a folder nobody chose: on a first launch it named a
             directory inside the application's own support folder. */
          blank: root === path.join(appDir(), "start"),
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

        /* The two questions boot asks, asked again, because opening a folder
           from the page is opening an archive and the page is the likelier way
           to reach a broken one: a person hunting for the folder that will not
           open is doing it here, not on a command line. */
        try {
          await checkArchive(target);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        try {
          await claim(target, { port: live, token: TOKEN });
        } catch (e) {
          /* Through plain(), because the claim is the first thing in the open
             that writes, so it is the first thing to fail on a read only drive
             and the errno would be what the drop panel showed. The busy
             sentence is already a sentence and comes back out of it whole. */
          return json(res, 409, { error: plain(e.message) });
        }

        try {
          startOpen(target, { rescan: !!b.rescan });
        } catch (e) {
          /* The claim just taken goes back, unless it is the claim this server
             already held: opening the folder that is already open is a refresh
             of the claim, and releasing that would leave this server serving
             an archive it no longer holds. */
          if (target !== root) await release(target);
          return json(res, 409, { error: e.message });
        }
        const was = root;
        root = target;
        config = await loadConfig(target);
        /* only the icon needs this. someone who typed the folder will type it
           again, and writing their history to a file they never asked for is
           not a service. */
        if (launched === "app") await rememberArchive(target);
        // the folder being left goes free only once the new one is held, so
        // there is no moment in between where this server holds neither
        if (was !== target) await release(was);
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
      /**
       * The walkthrough has been through, or is being asked for again.
       *
       * It is a route rather than a line in the browser's own storage for
       * the reason written over `toured` in runtime.mjs: the origin carries
       * a port and the port can move. `done` is the whole body, and false is
       * as meaningful as true, because the settings pane offers the
       * walkthrough again and that has to survive a reload the same way
       * finishing it does.
       */
      if (route === "/api/tour" && req.method === "POST") {
        const b = await body(req).catch(() => ({}));
        /* The answer and the version it was answered on, in one write. `seen`
           belongs to the walkthrough and to nothing else: it was being stamped
           at boot, so the second launch of a fresh install read as a machine
           that had already been through this and got the card about what
           changed instead of the eight cards it had never been shown. */
        const { version } = await import("./update.mjs");
        await setToured(!!b?.done, await version());
        return json(res, 200, { ok: true, toured: !!b?.done });
      }

      if (route === "/api/update" && req.method === "GET") {
        const { asks, check, isClone, version } = await import("./update.mjs");
        const policy = await updatePolicy();
        /* A check somebody asked for by pressing the version, which is a
           different thing from keeper deciding to look. It makes the one
           request and writes nothing: a person who answered never is not
           opted back in by wanting to know once, and the next launch is as
           quiet as they asked for. */
        if (url.searchParams.get("once") === "1") {
          return json(res, 200, { policy, asked: true, ...(await check()) });
        }
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
       *
       * THE POLICY DOES NOT GATE THIS, AND USED TO. Two different questions
       * were being answered by one preference: may keeper look on its own,
       * and may it install the one you are pointing at. Somebody who answered
       * never to the first still gets a check by pressing the version, because
       * asking once writes nothing, and that check offers an install. Gating
       * the install on the policy made that offer a dead end: the card said
       * updates are turned off, and the only control that could have turned
       * them on is the consent card, which never appears again once it has
       * been answered. A person who wanted the newest keeper had no way to say
       * so from inside keeper.
       *
       * So the second question is answered by pressing the button, which is
       * the only way it can be reached. Nothing is written either way, so the
       * next launch is still as quiet as never asked for. What guards this
       * route is what always really guarded it: it is refused unless the
       * request came from keeper's own page.
       */
      if (route === "/api/update/apply" && req.method === "POST") {
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
       * What works on this machine, without a terminal.
       *
       * `keeper doctor` is these same nine checks and it needs a command
       * line. The mac build ships an icon and puts nothing on the path, so the
       * one person who most needs the answer, a tester on a machine nobody
       * here can see, had no way to ask for it. It is a POST because it runs
       * programs, and it is guarded like every other write.
       */
      if (route === "/api/doctor" && req.method === "POST") {
        const { doctor } = await import("./doctor.mjs");
        return json(res, 200, { rows: await doctor() });
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
        /* The failure comes back as a sentence, not as the errno the scan
           threw. A read only folder answers EACCES and the page printed that
           word for word, which told the person nothing about the folder they
           had just picked or about what to do with it. */
        const state = jobState();
        return json(res, 200, { ...state, error: state.error ? plain(state.error) : null });
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
        const picked = await machine.chooseFolder(nearby(root));
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

        const next = await amend(root, async (here) => {
          const have = new Set(await readBinned(here));
          for (const id of ids) b.put ? have.delete(id) : have.add(id);
          const out = [...have];
          await writeBinned(here, out);
          return out;
        });
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

        /* Taken once, at the top, and used for the whole of it. This route
           reads the index, reads the bin, builds absolute paths and then
           moves files, with an await between every pair of those, and the
           folder underneath it can be reassigned by /api/open at any of them.
           Deleting out of one archive while reading the index of another is
           the worst version of that, so it is not left to chance here. */
        const here = root;
        const b = await body(req);
        const ids = Array.isArray(b.ids) ? b.ids : [];
        if (!ids.length) return json(res, 400, { error: "no frames named" });

        const index = await readIndex(here);
        const known = new Map((index?.items ?? []).map((i) => [i.id, i]));
        const hits = ids.map((id) => known.get(id)).filter(Boolean);
        if (hits.length !== ids.length) return json(res, 404, { error: "unknown frame" });

        /* Only out of the bin, and there is no way round this from the
           browser. Two stages is the whole safety: the fast key sets a frame
           aside and cannot reach a file, and the slow one that can reach a
           file is only reachable from a screen you had to go to on purpose.
           A single request that both binned and trashed would put the file
           back within one keystroke of a photograph. */
        const set = new Set(await readBinned(here));
        if (!ids.every((id) => set.has(id))) {
          return json(res, 409, { error: "only frames already in the bin can be deleted" });
        }

        const abs = hits.map((h) => path.join(here, h.path));

        /* WHAT THE PLATFORM SAYS HAPPENED IS NOT WHAT HAPPENED, AND ONLY ONE
           OF THE TWO IS WORTH ACTING ON. On windows a file another program
           held open came back from the shell delete with no exception and no
           error text and was still on the drive afterwards; the ids were taken
           out of the index anyway, and the wall and the drive disagreed from
           then on with nothing on screen to say so.

           So the answer, resolved or rejected, is treated as a claim, and the
           claim is checked here against the disk. Only the frames this process
           could no longer find where they used to be leave the index, and the
           reply names the ones that stayed. */
        let said = null;
        try {
          await machine.trash(abs);
        } catch (e) {
          said = String(e.message).toLowerCase();
        }

        /* The sweep runs inside the turn, so nothing can write the index or
           the bin between the check and the two writes that act on it.

           Both files are re-read in here: the copies above were for
           validation, and a bin write landing between that read and this one
           must not be erased by writing the stale copy back. Tags and
           placements are deliberately left alone, because a frame put back
           from the wastebasket comes back to its own tags: an id is a hash of
           the path and the path did not change. */
        const out = await amend(here, async () => {
          const gone = [];
          const left = [];
          /* ONLY A FILE THAT IS NOT THERE COUNTS AS GONE.
             This catch used to take every errno as proof the delete worked,
             which is the opposite of what the check is for. A folder whose
             permissions changed under it, a volume that dropped, a read macos
             refused: all of them answered "trashed", the frame left the index
             and the bin, and the photograph stayed on the drive where keeper
             could no longer see it. Measured with a chmod 000 folder: ok true,
             trashed 1, file still there, and the bin decision destroyed.
             ENOENT is the only errno that means what this needs it to mean.
             Anything else is a file keeper could not ask about, which is not
             the same as a file that has gone, and it stays. */
          for (let i = 0; i < hits.length; i++) {
            try {
              await access(abs[i]);
              left.push(hits[i].id);
            } catch (e) {
              if (e.code === "ENOENT") gone.push(hits[i].id);
              else left.push(hits[i].id);
            }
          }
          const drop = new Set(gone);
          const now = await readIndex(here);
          await writeIndex(here, {
            ...now,
            items: (now?.items ?? []).filter((i) => !drop.has(i.id)),
          });
          // out of the bin as well, because the bin is a list of frames on
          // the drive and these are not on the drive any more
          const binned = await readBinned(here);
          await writeBinned(here, binned.filter((id) => !drop.has(id)));
          return { gone, left };
        });

        const ok = !out.left.length;
        return json(res, ok ? 200 : 500, {
          ok,
          trashed: out.gone.length,
          ...out,
          ...(ok ? {} : { error: said ?? `${out.left.length} of ${hits.length} are still on the drive` }),
        });
      }

      if (route === "/api/tag" && req.method === "POST") {
        const b = await body(req);
        /* One row or a whole sheet, because the two callers ask for different
           things. The page tags one frame as a person presses a key, and
           `keeper tag` arrives holding a contact sheet somebody marked up on
           paper. A sheet sent as a hundred requests is a hundred read modify
           writes queued behind each other; as a batch it is one turn however
           long it is, and the CLI no longer writes the file itself. */
        const rows = Array.isArray(b.rows) ? b.rows : [b];

        /* Only a word from the vocabulary, or nothing. Anything else written
           here outlives this process: the CLI prints the tally by looking
           the code up in VOCAB, and one junk code on disk crashed every
           later `keeper <folder>` on that archive at boot. The page can
           never send one, so a request that does is a caller that is wrong,
           and it is told so instead of being written down. Every row is read
           before any row is written, so a batch carrying one bad word writes
           nothing at all rather than half of itself. */
        for (const r of rows) {
          if (r && "tag" in r && r.tag && !VOCAB[r.tag]) {
            return json(res, 400, { error: `no tag called ${String(r.tag).slice(0, 24)}` });
          }
        }

        const wanted = rows.filter((r) => r && typeof r.id === "string" && r.id);
        await amend(root, async (here) => {
          const tags = await readTags(here);
          for (const r of wanted) {
            const cur = tags[r.id] ?? {};
            if ("tag" in r) cur.tag = r.tag || undefined;
            if ("star" in r) cur.star = r.star ? 1 : 0;
            tags[r.id] = cur;
          }
          await writeTags(here, tags);
        });
        return json(res, 200, { ok: true, applied: wanted.length });
      }

      if (route === "/api/place" && req.method === "POST") {
        const b = await body(req);
        if (!config.slots.some((s) => s.id === b.slot)) {
          return json(res, 400, { error: `no slot called ${b.slot}` });
        }
        /* A clip is refused, in a sentence, rather than placed. The bench cuts
           a rectangle out of a negative with sharp, and handed a mov it wrote
           a slot that painted black and an export that failed with a decoder
           message nobody was ever shown. The poster film.mjs makes is a 400px
           wide thumbnail and not a frame, so cropping that instead would hand
           somebody a 400px hero and call it their picture. */
        const index = await readIndex(root);
        const hit = index?.items?.find((i) => i.id === b.id);
        if (!hit) return json(res, 404, { error: "unknown frame" });
        if (hit.kind === "film") {
          return json(res, 400, { error: "a clip cannot be placed. the bench cuts stills, and a clip is film." });
        }
        await amend(root, async (here) => {
          const p = await readPlacements(here);
          p[b.slot] = { id: b.id, place: b.place };
          await writePlacements(here, p);
        });
        return json(res, 200, { ok: true });
      }

      if (route === "/api/place" && req.method === "DELETE") {
        await amend(root, async (here) => {
          const p = await readPlacements(here);
          delete p[url.searchParams.get("slot")];
          await writePlacements(here, p);
        });
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
        const { doc, tray } = await amend(root, async (here) => {
          const doc2 = await readTrays(here);
          const tray2 = newTray(doc2, b.name);
          doc2.active = tray2.id;
          await writeTrays(here, doc2);
          return { doc: doc2, tray: tray2 };
        });
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
        if (typeof b.mode === "string" && !MODES.includes(b.mode)) {
          return json(res, 400, { error: `no export mode called ${b.mode}` });
        }

        const doc = await amend(root, async (here) => {
          const doc2 = await readTrays(here);
          const tray = trayById(doc2, b.id);
          if (!tray) return null;

          if (typeof b.mode === "string") tray.mode = b.mode;
          // an empty string is how the panel says "forget where it went", so
          // it clears the field rather than being ignored as falsy
          if (typeof b.dest === "string") tray.dest = b.dest.trim() || undefined;

          if (typeof b.name === "string" && b.name.trim()) tray.name = b.name.trim().slice(0, 60);
          if (b.clear) tray.ids = [];
          if (b.add?.length) addTo(tray, b.add);
          if (b.remove?.length) removeFrom(tray, b.remove);
          if (b.active) doc2.active = tray.id;

          await writeTrays(here, doc2);
          return doc2;
        });
        if (!doc) return json(res, 404, { error: "no such tray" });
        return json(res, 200, { ok: true, ...doc });
      }

      if (route === "/api/trays" && req.method === "DELETE") {
        const { doc, last, gone } = await amend(root, async (here) => {
          const doc2 = await readTrays(here);
          const last2 = doc2.trays.length === 1;
          const gone2 = dropTray(doc2, url.searchParams.get("id"));
          if (gone2.ok) await writeTrays(here, doc2);
          return { doc: doc2, last: last2, gone: gone2 };
        });
        if (!gone.ok) return json(res, 404, { error: "no such tray" });
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
          /* The remembering goes through the queue, and the document read
             above is only ever used to find the tray. Writing `doc` back
             straight from here was a write outside the queue holding a copy of
             trays.json from before the export started, and a rename typed
             while an export ran was measured being erased by it. */
          await amend(root, async (here) => {
            const d = await readTrays(here);
            const t = trayById(d, b.id);
            if (t) {
              t.mode = out.mode;
              t.dest = out.dest;
              await writeTrays(here, d);
            }
          });
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
          /* And the reasons. Counts alone came back before, so a refused crop
             reached the page as "1 refused: the terminal has the reason" while
             the terminal, on a launch from the icon, did not exist at all. The
             row carries the decoder's own words and the bench prints them. */
          rows: out.rows.map((r) => ({
            slot: r.slot,
            source: r.source,
            file: r.file && path.basename(r.file),
            failed: r.failed,
            lost: r.lost,
            soft: r.soft,
          })),
        });
      }

      return json(res, 404, { error: "no such route" });
    } catch (e) {
      /* plain(), the same as every other error that reaches a person. The
         catch-all is where a full disk lands, and it was answering with
         `ENOSPC: no space left on device, open .../tags.json.<pid>.tmp`,
         which names a temp file that only exists because the write is atomic
         and tells the reader nothing they can act on. */
      return json(res, 500, { error: plain(e.message) });
    }
  });

  /* Opened from the icon, the folders keeper looks in are behind a permission
     it has not been given yet, and asking for it costs the first request that
     needs it. Asked for here, it costs nothing anybody is waiting on. A
     terminal has already been granted whatever it has, so there is nothing to
     warm and no reason to put a dialog up. */
  if (launched === "app") warmRoots();

  /* The version that ran here, and only that. This line used to write `seen`,
     which is the walkthrough's field: a machine that had merely started keeper
     once had, as far as the seat was concerned, answered a walkthrough it was
     never offered, and its second launch got the card about what changed. The
     record itself is still worth keeping, so it goes in a field of its own
     that nobody else reads. */
  import("./update.mjs").then(({ version }) => version().then(rememberRan)).catch(() => {});

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  /* The port asked for and the port given are different questions when the
     caller asked for 0 and let the operating system choose, which is what a
     test does. Everything downstream reads the one that was given. */
  live = server.address().port;

  /* ONE KEEPER PER ARCHIVE, and the claim is taken now because now is when
     there is a port to write into it. Two servers on one folder is not a
     theory: eighty star writes split across two of them left two rows on disk,
     seventy eight gone, and every one of the eighty answered ok. The queue
     above is this process and cannot see another one, so the exclusion has to
     be a file both processes can read. */
  try {
    await claim(root, { port: live, token: TOKEN });
  } catch (e) {
    server.close();
    throw e;
  }

  /* And it is given back on the way out. `root` is read at exit rather than
     captured here, so the folder let go of is the one that was open at the
     end and not the one this process started on. ctrl-c and a kill from a
     script arrive as signals, and a signal runs no exit handler by itself, so
     both are turned into an ordinary exit and one handler covers all three
     ways of stopping. */
  process.on("exit", () => releaseSync(root));
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => process.exit(0));

  return { server, url: `http://${host}:${live}`, token: TOKEN };
}
