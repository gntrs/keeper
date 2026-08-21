#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scan } from "../src/scan.mjs";
import { buildThumbs } from "../src/thumbs.mjs";
import { buildSheets, GRID_ADVICE, cellWidth } from "../src/sheets.mjs";
import { parseCompact, applyToIndex, VOCAB } from "../src/tags.mjs";
import { idFor, paths, readIndex, writeIndex, readTags, writeTags, readPlacements } from "../src/store.mjs";
import { loadConfig, CONFIG_NAME } from "../src/config.mjs";
import { resolve as resolveCrop, parseAspect, isAtCover, toObjectPosition } from "../src/geometry.mjs";
import { exportCrop } from "../src/thumbs.mjs";
import { serve } from "../src/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : String(s));
const hot = (s) => (TTY ? `\x1b[38;5;197m${s}\x1b[0m` : String(s));
const say = (...a) => console.log(...a);

/**
 * A progress line that redraws itself on a terminal and stays silent
 * everywhere else. Without the TTY test a piped run prints one line per
 * percent, which is a hundred lines of noise in a CI log or an agent's
 * transcript, and the carriage returns do not even land.
 */
function progress(label) {
  if (!TTY) { process.stdout.write(dim(`  ${label} ... `)); return { tick() {}, done(m = "done") { say(m); } }; }
  process.stdout.write(dim(`  ${label} ... `));
  let last = "";
  return {
    tick(text) {
      if (text === last) return;
      last = text;
      process.stdout.write(`\r${dim(`  ${label} ... `)}${text}   `);
    },
    done(text = "done") { process.stdout.write(`\r${dim(`  ${label} ... `)}${text}   \n`); },
  };
}

/** an absolute path beats a relative one the moment the relative one climbs */
function nice(p) {
  const rel = path.relative(process.cwd(), p);
  return !rel ? "." : rel.startsWith("..") ? p : rel;
}

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true);
    } else rest.push(a);
  }
  return { flags, rest };
}

const HELP = `
${hot("keepers")}  find the frames worth keeping, and crop them into the holes they fill

  keepers <folder>                 scan, thumbnail, and open the shelf
  keepers sheets <folder>          contact sheets for a coding agent to read
  keepers tag <folder> <file>      apply the tags that agent wrote
  keepers export <folder>          write the placed crops out
  keepers init [folder]            create ${CONFIG_NAME}

${dim("options")}
  --port <n>        default 7777
  --cols <n>        cells across a contact sheet, default 6
  --rows <n>        cells down a contact sheet, default 4
  --open            open the browser
  --rescan          rebuild the index even if one exists

${dim("the grid trade, because it is the only real choice in `sheets`")}
${GRID_ADVICE.map(([c, d]) => `  --cols ${c}   ${String(cellWidth(c)).padStart(4)}px per frame   ${d}`).join("\n")}
`;

async function ensureIndex(root, { rescan = false } = {}) {
  const existing = rescan ? null : await readIndex(root);
  if (existing?.items?.length) return existing;

  process.stdout.write(dim("  scanning ... "));
  const found = await scan(root);
  const items = found.map((f) => ({ ...f, id: idFor(f.path) }));
  say(`${items.length} frames`);

  if (!items.length) {
    say(dim("  nothing to do. that folder holds no photographs keepers can read."));
    return { items: [], builtAt: new Date().toISOString() };
  }

  const P = paths(root);
  const bar = progress("thumbnailing");
  const { meta, failed } = await buildThumbs(root, items, P.thumbs, {
    onProgress: (n) => bar.tick(`${Math.floor((n / items.length) * 100)}%`),
  });
  bar.done(`done${failed ? hot(`  ${failed} unreadable`) : ""}`);

  const byId = new Map(meta.map((m) => [m.id, m]));
  const merged = items.map((i) => ({ ...i, ...(byId.get(i.id) ?? {}) }));
  const index = { items: merged, builtAt: new Date().toISOString(), root };
  await writeIndex(root, index);
  return index;
}

function summarise(items, tags) {
  const counts = new Map();
  for (const i of items) {
    const t = tags[i.id]?.tag;
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (!counts.size) return;
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  say("");
  for (const chunk of [sorted.slice(0, 8), sorted.slice(8)]) {
    if (!chunk.length) continue;
    say("  " + chunk.map(([c, n]) => `${VOCAB[c][0]} ${dim(n)}`).join("   "));
  }
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const known = ["sheets", "tag", "export", "init", "help"];
  const cmd = known.includes(rest[0]) ? rest.shift() : "shelf";
  const root = path.resolve(rest[0] ?? ".");

  if (cmd === "help" || flags.help || (cmd === "shelf" && !rest.length && !existsSync(path.join(root, CONFIG_NAME)))) {
    if (cmd === "help" || flags.help) { say(HELP); return; }
  }

  if (cmd === "init") {
    const dst = path.join(root, CONFIG_NAME);
    if (existsSync(dst)) { say(hot(`  ${CONFIG_NAME} already exists, leaving it alone`)); return; }
    await copyFile(path.join(HERE, "..", "keepers.config.example.json"), dst);
    say(`  wrote ${hot(CONFIG_NAME)}`);
    say(dim("  edit the slots, then run `keepers <your archive folder>`"));
    return;
  }

  if (!existsSync(root)) { say(hot(`  no such folder: ${root}`)); process.exit(1); }
  say("");
  say(`  ${hot("keepers")} ${dim(root)}`);

  if (cmd === "sheets") {
    const index = await ensureIndex(root, { rescan: !!flags.rescan });
    if (!index.items.length) return;
    const cols = Number(flags.cols) || 6;
    const rows = Number(flags.rows) || 4;
    const P = paths(root);
    const bar = progress("sheets");
    const out = await buildSheets(root, index.items, P.sheets, {
      cols, rows,
      onProgress: (n, total) => bar.tick(`${n}/${total}`),
    });
    bar.done(`${out.sheets} sheets, ${out.perSheet} frames each, ${out.cellWidth}px a frame`);
    say("");
    say(`  ${dim("they are in")} ${nice(P.sheets)}`);
    say(`  ${dim("hand them to a coding agent with AGENTS.md, then:")}`);
    say(`     keepers tag ${nice(root)} tags.txt`);
    return;
  }

  if (cmd === "tag") {
    const file = rest[1];
    if (!file) { say(hot("  which file holds the tags?")); process.exit(1); }
    const P = paths(root);
    const sheetIndex = JSON.parse(await readFile(path.join(P.sheets, "index.json"), "utf8"));
    const text = await readFile(path.resolve(file), "utf8");

    const parsed = text.trimStart().startsWith("{")
      ? { rows: JSON.parse(text).sheets ?? [], problems: [] }
      : parseCompact(text);

    const { tags: fresh, problems, applied } = applyToIndex(parsed.rows, sheetIndex);
    const all = { ...(await readTags(root)) };
    for (const [id, v] of Object.entries(fresh)) all[id] = { ...all[id], ...v };
    await writeTags(root, all);

    say(`  tagged ${hot(applied)} frames`);
    for (const p of [...parsed.problems, ...problems]) say(hot(`  ! ${p}`));
    const index = await readIndex(root);
    summarise(index?.items ?? [], all);
    return;
  }

  if (cmd === "export") {
    const config = await loadConfig(process.cwd());
    const index = await readIndex(root);
    const placements = await readPlacements(root);
    const outDir = path.resolve(config.out ?? "keepers-out");
    const byId = new Map((index?.items ?? []).map((i) => [i.id, i]));
    let n = 0;

    for (const slot of config.slots) {
      const p = placements[slot.id];
      if (!p) continue;
      const item = byId.get(p.id);
      if (!item) { say(hot(`  ! ${slot.id}: the frame it held is gone from the index`)); continue; }

      const rect = resolveCrop(p.place, item.w, item.h, slot.aspect);
      const dir = path.join(outDir, slot.id);
      await mkdir(dir, { recursive: true });
      const dst = path.join(dir, `${slot.id}${path.extname(item.path).toLowerCase()}`);
      await exportCrop(path.join(root, item.path), dst, rect, slot.width);

      await writeFile(path.join(dir, "placement.json"), JSON.stringify({
        slot: slot.id,
        source: item.path,
        sourceSize: { w: item.w, h: item.h },
        aspect: slot.aspectText,
        crop: {
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.w), h: Math.round(rect.h),
        },
        atCover: isAtCover(p.place, item.w, item.h, slot.aspect),
        objectPosition: toObjectPosition(rect, item.w, item.h),
        place: p.place,
      }, null, 2));

      const soft = slot.width && rect.w < slot.width;
      say(`  ${slot.id.padEnd(16)} ${dim(item.path)}${soft ? hot("  soft: crop is narrower than the slot") : ""}`);
      n++;
    }
    say("");
    say(`  wrote ${hot(n)} of ${config.slots.length} slots to ${dim(nice(outDir))}`);
    if (n < config.slots.length) say(dim("  the rest are still empty. run `keepers <folder>` and fill them."));
    return;
  }

  // default: shelf
  const config = await loadConfig(process.cwd());
  const index = await ensureIndex(root, { rescan: !!flags.rescan });
  if (!index.items.length) return;
  summarise(index.items, await readTags(root));

  const { url } = await serve({ root, config, port: Number(flags.port) || 7777 });
  say("");
  say(`  ${hot(url)}`);
  if (config.missing) {
    say(dim(`  no ${CONFIG_NAME} here, so the bench has no slots. \`keepers init\` makes one.`));
  } else {
    say(dim(`  ${config.slots.length} slots from ${CONFIG_NAME}`));
  }
  say(dim("  ctrl-c to stop"));
  if (flags.open) {
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  }
}

main().catch((e) => { console.error(`\n  ${hot("!")} ${e.message}\n`); process.exit(1); });
