import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paths, readIndex, readTags, writeTags, readPlacements, writePlacements } from "./store.mjs";
import { VOCAB } from "./tags.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "web");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
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

async function sendFile(res, file, { cache = "no-store" } = {}) {
  let s;
  try {
    s = await stat(file);
  } catch {
    return json(res, 404, { error: "not found" });
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": s.size,
    "cache-control": cache,
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
  const P = paths(root);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;

    try {
      if (route === "/" || route === "/index.html") {
        return sendFile(res, path.join(WEB, "index.html"));
      }

      // the crop model is shared source, not a copy: the browser gets the
      // same file the exporter imports, so the two can never drift.
      if (route === "/geometry.mjs") {
        return sendFile(res, path.join(HERE, "geometry.mjs"), { cache: "no-cache" });
      }

      if (/^\/(app|shelf|bench)\.js$|^\/style\.css$/.test(route)) {
        return sendFile(res, path.join(WEB, route.slice(1)), { cache: "no-cache" });
      }

      if (route.startsWith("/thumb/")) {
        const id = route.slice(7).replace(/[^a-f0-9]/g, "");
        return sendFile(res, path.join(P.thumbs, `${id}.webp`), { cache: "max-age=86400" });
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
        const [index, tags, placements] = await Promise.all([
          readIndex(root), readTags(root), readPlacements(root),
        ]);
        return json(res, 200, {
          root,
          items: index?.items ?? [],
          builtAt: index?.builtAt ?? null,
          tags,
          placements,
          slots: config.slots,
          vocab: Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, v[0]])),
          hints: Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, v[1]])),
        });
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
