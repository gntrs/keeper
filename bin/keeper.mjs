#!/usr/bin/env node
import { readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "../src/open.mjs";
import { buildSheets, GRID_ADVICE, cellWidth } from "../src/sheets.mjs";
import { parseCompact, applyToIndex, VOCAB } from "../src/tags.mjs";
import { adopt, paths, readIndex, readTags, writeTags } from "../src/store.mjs";
import { loadConfig, CONFIG_NAME } from "../src/config.mjs";
import { exportCrops } from "../src/crops.mjs";
import { serve } from "../src/server.mjs";
import { readTrays, trayById, exportTray, MODES } from "../src/trays.mjs";
import { startOpen } from "../src/open.mjs";
import {
  appDir, blankRoot, claimRun, forgetRunSync, freePort, hushed, lastArchive, rememberArchive, running,
} from "../src/runtime.mjs";

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

/**
 * Flags that are on or off and never carry a value. Without this list the
 * next word gets eaten as the flag's argument, so `keeper --no-open ~/shoot`
 * would set no-open to the folder and then index the current directory
 * instead. `--open` is here although opening is the default now: it costs a
 * line, and someone with it in their fingers should not be punished by having
 * their archive swallowed.
 */
const BOOLS = new Set(["open", "no-open", "rescan", "help"]);

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v === undefined && BOOLS.has(k)) { flags[k] = true; continue; }
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true);
    } else rest.push(a);
  }
  return { flags, rest };
}

const HELP = `
${hot("keeper")}  find the frames worth keeping, and crop them into the holes they fill

  keeper <folder>                 scan, thumbnail, and open the shelf
  keeper app [folder]             the way the icon opens it: remembers the
                                  last archive, picks its own port, and
                                  reuses a copy that is already running
  keeper sheets <folder>          contact sheets for a coding agent to read
  keeper tag <folder> <file>      apply the tags that agent wrote
  keeper export <folder>          write the placed crops out
  keeper trays <folder>           what is in the trays, and how much
  keeper init [folder]            create ${CONFIG_NAME}
  keeper doctor                   check this machine can run all of it

${dim("options")}
  --port <n>        default 7777
  --cols <n>        cells across a contact sheet, default 6
  --rows <n>        cells down a contact sheet, default 4
  --no-open         leave the browser alone. it opens by default
  --rescan          rebuild the index even if one exists
  --export <tray>   with the trays command, copy that tray out
  --to <folder>     with --export, where the copies go
  --mode <how>      with --export: copy, symlink or alias. default copy.
                    symlink and alias write nothing, they point at the originals

${dim("the grid trade, because it is the only real choice in `sheets`")}
${GRID_ADVICE.map(([c, d]) => `  --cols ${c}   ${String(cellWidth(c)).padStart(4)}px per frame   ${d}`).join("\n")}
`;

/**
 * The terminal half of buildIndex. The scan and the thumbnails live in
 * src/open.mjs now, because the server has to run them too, and everything
 * printed here comes back through the phase events.
 *
 * An index that was already on disk emits nothing but "ready", and the bar
 * stays silent for it: a run that did no work should not draw a bar saying
 * it did.
 */
async function indexWithBar(root, { rescan = false } = {}) {
  let scanning = false;
  let counted = false;
  let bar = null;

  const index = await buildIndex(root, {
    rescan,
    onPhase(e) {
      if (e.phase === "scanning") {
        if (!scanning) { scanning = true; process.stdout.write(dim("  scanning ... ")); }
        return;
      }
      // An index already on disk does no work and draws no bar, but it still
      // knows what the drive holds that it cannot read, and that is exactly
      // the run where someone is asking whether a file is in here at all.
      if (e.phase === "ready" && !scanning) { sayWhatItWalkedPast(e); return; }
      if (!scanning) return;
      // the frame count closes the scanning line, and it is the same line
      // whether or not there turned out to be anything to thumbnail
      if (!counted) { counted = true; say(`${e.frames} frames`); }

      if (e.phase === "thumbnailing") {
        if (!bar) bar = progress("thumbnailing");
        bar.tick(`${Math.floor((e.done / e.total) * 100)}%`);
        return;
      }
      if (e.phase === "ready") {
        if (bar) bar.done(`done${e.failed ? hot(`  ${e.failed} unreadable`) : ""}`);
        if (e.filmSkipped) {
          say(hot(`  ! ${e.filmSkipped} clips have no poster: ffmpeg is not on PATH.`));
          say(dim("    brew install ffmpeg, then run again with --rescan."));
        }
        sayWhatItWalkedPast(e);
      }
    },
  });

  if (!index.items.length) say(dim("  no photographs and no film here that keeper can read."));
  return index;
}

const size = (b) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)}GB` : b >= 1e6 ? `${Math.round(b / 1e6)}MB` : `${Math.round(b / 1e3)}KB`;

/**
 * What the scan walked past. It exists because a 903GB drive scanned to 2,836
 * frames and said nothing else, so the audio, the project files and thirty
 * three empty render folders stayed invisible, and answering "are my videos
 * even on this drive" took an hour instead of one line.
 *
 * A tool that reports only what it liked cannot be trusted for a negative,
 * and the negative is half of what anyone asks an archive.
 */
function sayWhatItWalkedPast({ ignored, barren }) {
  if (!ignored?.length && !barren?.length) return;
  say("");
  if (ignored?.length) {
    const n = ignored.reduce((t, i) => t + i.count, 0);
    const bytes = ignored.reduce((t, i) => t + i.bytes, 0);
    const top = ignored.slice(0, 6).map((i) => `${i.ext.replace(/^\./, "")} ${dim(i.count)}`).join("   ");
    const more = ignored.length > 6 ? dim(`  and ${ignored.length - 6} more types`) : "";
    say(`  ${dim("walked past")} ${n} ${n === 1 ? "file" : "files"} ${dim(`it cannot read, ${size(bytes)}`)}`);
    say(`    ${top}${more}`);
  }
  if (barren?.length) {
    const shown = barren.slice(0, 4).map((p) => dim(p)).join(", ");
    const more = barren.length > 4 ? dim(` and ${barren.length - 4} more`) : "";
    say(`  ${dim(`${barren.length} ${barren.length === 1 ? "folder holds" : "folders hold"} nothing it can read:`)} ${shown}${more}`);
  }
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

/**
 * Hand the url to whatever browser this person actually uses.
 *
 * Detached and unreferenced in every branch, because the browser must not
 * become a child this process is waiting on: keeper opened from an icon has
 * to be able to outlive the launch, and keeper opened from a terminal has to
 * be able to die on ctrl-c without taking a window full of tabs with it.
 */
async function openIn(url) {
  const { spawn } = await import("node:child_process");
  if (process.platform === "win32") {
    /* `start` is a cmd builtin rather than a program, so it needs a shell,
       and its first quoted argument is taken as the window title rather
       than the thing to open. The empty pair is that title. Without it a
       url that ever needs quoting opens a console window called after
       itself and nothing else happens. */
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } else {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  }
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const known = ["app", "sheets", "tag", "export", "trays", "init", "doctor", "help"];
  const cmd = known.includes(rest[0]) ? rest.shift() : "shelf";
  const root = path.resolve(rest[0] ?? ".");

  if (cmd === "help" || flags.help) { say(HELP); return; }

  /**
   * What works on this machine, before anybody has an archive to be
   * disappointed by. It takes no folder and touches none: the whole point is
   * that it is the one command somebody can run the minute they have cloned
   * this, on a machine nobody else can see, and paste the answer back.
   */
  if (cmd === "doctor") {
    const { doctor, OK, NO } = await import("../src/doctor.mjs");
    say("");
    const rows = await doctor();
    const wide = Math.max(...rows.map((r) => r.what.length));
    for (const r of rows) {
      const mark = r.state === OK ? "  ok  " : r.state === NO ? hot("  no  ") : hot(" warn ");
      say(`${mark}${r.what.padEnd(wide)}  ${r.said}`);
    }
    const broken = rows.filter((r) => r.state === NO).length;
    say("");
    say(broken
      ? hot(`  ${broken} of ${rows.length} would stop something working. the lines above say which.`)
      : dim(`  all ${rows.length} clear. point keeper at a folder and it will run.`));
    say("");
    return;
  }

  /**
   * Keeper opened from an icon rather than from a sentence.
   *
   * It is the same server and the same page. What is different is everything
   * around them, because nobody typed anything: there is no folder in the
   * command, no port, no terminal to print the url into and no ctrl-c to
   * stop it with. So this path answers those four on its own and then gets
   * out of the way.
   *
   * The order matters and is not the order the shelf uses. The shelf indexes
   * and then serves, which is right when a progress bar is being watched in
   * the terminal it is printing to. Here there is nowhere to print, so it
   * serves first and opens the browser immediately, and the scan runs behind
   * the page that is already up and reports itself through the same progress
   * the drop panel polls. A person who double clicked an icon should see
   * their own app inside a second, not a bouncing dock icon and then nothing
   * for a minute while ten thousand thumbnails are made.
   */
  if (cmd === "app") {
    const asked = rest[0] ? path.resolve(rest[0]) : null;

    /* A second double click is not a request for a second keeper. It is
       somebody who lost the window, and the useful answer is the tab they
       already had rather than a rival server on 7778 writing to the same
       archive from a second index. */
    const live = await running();
    if (live) {
      if (asked) {
        await fetch(`${live.url}/api/open`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: asked }),
        }).catch(() => {});
      }
      if (!flags["no-open"]) await openIn(live.url);
      say(`  ${hot(live.url)}`);
      return;
    }

    /* Where you were, unless where you were was on a drive that is not
       plugged in this morning. An archive that has gone is not an error
       worth an error message: it is the ordinary life of an external disk,
       and the right response is the empty page that asks for a folder. */
    const remembered = asked ?? (await lastArchive());
    const here = remembered && existsSync(remembered) ? remembered : await blankRoot();

    const port = await freePort(Number(flags.port) || 7777);
    const config = await loadConfig(here);
    const { url } = await serve({ root: here, config, port, launched: "app" });
    await claimRun(port);
    if (here !== (await blankRoot())) await rememberArchive(here);

    /* The run file describes a process, so it dies with the process, by
       every route out including the quit button and a machine shutting
       down. `exit` covers the ordinary returns and the two signals cover
       being asked to stop, which `exit` alone does not. */
    process.on("exit", forgetRunSync);
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

    /* An update restarts keeper with a tab already open and watching, and
       that tab reloads itself. Opening a second one would leave two pages
       against one server, one of them stale. */
    if (!flags["no-open"] && !(await hushed())) await openIn(url);
    say(`  ${hot(url)}`);
    say(dim(`  state in ${nice(appDir())}`));

    /* An archive with an index already opens instantly and is left alone. One
       without gets scanned now, behind the page, because the alternative is a
       shelf that sits empty until somebody works out that they were supposed
       to drop the folder they had already chosen. */
    if (!(await readIndex(here))) startOpen(here);
    return;
  }

  /* A bare `keeper` used to resolve to "." and start indexing it. Typed in a
     home folder, which is where a terminal opens, that is a thumbnail of
     every file you own and a .keeper folder written into your home, for
     someone who was only asking what the command does. No folder is not a
     folder, so it gets the help. */
  if (cmd === "shelf" && !rest.length) { say(HELP); return; }

  if (cmd === "init") {
    const dst = path.join(root, CONFIG_NAME);
    if (existsSync(dst)) { say(hot(`  ${CONFIG_NAME} already exists, leaving it alone`)); return; }
    await copyFile(path.join(HERE, "..", "keeper.config.example.json"), dst);
    say(`  wrote ${hot(CONFIG_NAME)}`);
    say(dim("  edit the slots, then run `keeper <your archive folder>`"));
    return;
  }

  if (!existsSync(root)) { say(hot(`  no such folder: ${root}`)); process.exit(1); }
  await adopt(root);
  say("");
  say(`  ${hot("keeper")} ${dim(root)}`);

  if (cmd === "sheets") {
    const index = await indexWithBar(root, { rescan: !!flags.rescan });
    if (!index.items.length) return;
    const cols = Number(flags.cols) || 6;
    const rows = Number(flags.rows) || 4;
    const P = paths(root);
    const bar = progress("sheets");
    const out = await buildSheets(root, index.items, P.sheets, {
      thumbsDir: P.thumbs,
      cols, rows,
      onProgress: (n, total) => bar.tick(`${n}/${total}`),
    });
    bar.done(`${out.sheets} sheets, ${out.perSheet} frames each, ${out.cellWidth}px a frame`);
    say("");
    say(`  ${dim("they are in")} ${nice(P.sheets)}`);
    say(`  ${dim("hand them to a coding agent with AGENTS.md, then:")}`);
    say(`     keeper tag ${nice(root)} tags.txt`);
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
    // There is always something to export now, because the standard shapes
    // are built in: someone with no config at all can still have placed a
    // frame into the reel and want the crop. So a missing config is no longer
    // a reason to refuse, only a thing worth saying if nothing came out.
    if (!config.slots.length) {
      say(hot(`  ${CONFIG_NAME} turns the standard shapes off and adds none of its own.`));
      say(dim("  add a slot, or drop `\"formats\": false`, and the bench has something to place into."));
      return;
    }
    const out = await exportCrops({ root, config });
    for (const r of out.rows) {
      if (r.lost) { say(hot(`  ! ${r.slot}: the frame it held is gone from the index`)); continue; }
      if (r.failed) { say(hot(`  ! ${r.slot}: ${r.failed}`)); say(dim(`    ${r.source}`)); continue; }
      say(`  ${r.slot.padEnd(16)} ${dim(r.source)}${r.soft ? hot("  soft: crop is narrower than the slot") : ""}`);
    }
    const n = out.written;
    say("");
    say(`  wrote ${hot(n)} ${n === 1 ? "crop" : "crops"} to ${dim(nice(out.dir))}`);
    if (out.empty) {
      say(dim(`  ${out.empty} of your ${out.mine} slots are still empty. run \`keeper <folder>\` and fill them.`));
    }
    if (!n && config.missing) {
      say(dim(`  there is no ${CONFIG_NAME} in this folder, so keeper only knows`));
      say(dim(`  the standard shapes. \`keeper init\` adds your own.`));
    }
    return;
  }

  if (cmd === "trays") {
    const doc = await readTrays(root);

    if (flags.export) {
      const tray = trayById(doc, String(flags.export));
      if (!tray) {
        say(hot(`  no tray called ${flags.export}`));
        say(dim(`  the ones there are: ${doc.trays.map((t) => t.id).join(", ")}`));
        process.exit(1);
      }
      const to = typeof flags.to === "string" ? flags.to : "";
      if (!to) { say(hot("  where to? pass --to <folder>")); process.exit(1); }

      // `link` because that is the word the tray panel puts on the button,
      // and someone who learned the mode there should be able to type it
      const asked = typeof flags.mode === "string" ? flags.mode : (tray.mode ?? "copy");
      const mode = asked === "link" ? "symlink" : asked;
      if (!MODES.includes(mode)) {
        say(hot(`  no export mode called ${asked}`));
        say(dim(`  it is one of: ${MODES.join(", ")}`));
        process.exit(1);
      }

      const index = await readIndex(root);
      const verb = { copy: ["copying", "copied"], symlink: ["linking", "linked"], alias: ["aliasing", "aliased"] }[mode];
      const bar = progress(verb[0]);
      bar.tick(`${tray.ids.length} frames`);
      // the refusals are all worth reading, so the bar gets closed off first
      // rather than left hanging half drawn above the message that matters
      let out;
      try {
        out = await exportTray({ root, tray, folder: to, index, mode });
      } catch (e) {
        bar.done(hot("refused"));
        say(`  ${hot("!")} ${e.message}`);
        process.exit(1);
      }
      bar.done(`${out.written} ${verb[1]}${out.skipped.length ? hot(`  ${out.skipped.length} skipped`) : ""}`);
      say("");
      say(`  ${dim("they are in")} ${nice(out.dest)}`);
      // which mode ran, every time. a folder of symlinks and a folder of
      // copies look identical in a terminal listing and weigh nothing alike,
      // and finding out which one you made a week later costs an hour.
      say(dim({
        copy: "  the originals have not moved. this was a copy.",
        symlink: "  the originals have not moved and nothing was copied. those are symlinks to them.",
        alias: "  the originals have not moved and nothing was copied. those are finder aliases.",
      }[mode]));
      if (out.skipped.length) {
        say(dim("  the skipped ones are either gone from the index or already in that folder."));
      }
      return;
    }

    say("");
    for (const t of doc.trays) {
      const mark = t.id === doc.active ? hot("  active") : "";
      const n = `${t.ids.length} ${t.ids.length === 1 ? "frame" : "frames"}`;
      say(`  ${t.name.padEnd(20)} ${n.padEnd(12)} ${dim(t.id)}${mark}`);
    }
    say("");
    say(dim(`  keeper trays ${nice(root)} --export <tray> --to <folder>`));
    say(dim(`  add --mode symlink to point at the originals instead of copying them`));
    return;
  }

  // default: shelf
  const config = await loadConfig(process.cwd());
  const index = await indexWithBar(root, { rescan: !!flags.rescan });
  // An empty archive still opens. It used to stop here with one line in the
  // terminal, which is the least useful moment to say nothing: someone who
  // pointed keeper at the wrong folder learns more from a page that says
  // what it reads than from a sentence that says it found nothing. The shelf
  // has a state for this.
  summarise(index.items, await readTags(root));

  const { url } = await serve({ root, config, port: Number(flags.port) || 7777 });
  say("");
  say(`  ${hot(url)}`);
  /* Only for someone who already wrote a config, because they are the one
     person the count tells anything. The two lines that used to print in its
     absence explained a file the reader had never heard of and did not need,
     and they were half of everything on the screen at the moment the app was
     supposed to be handing over to the browser. The bench says it, on the
     bench, where there are shapes to point at while saying it. */
  if (!config.missing) {
    const mine = config.slots.filter((s) => s.group === "yours").length;
    say(dim(`  ${mine} slots from ${CONFIG_NAME}, and ${config.slots.length - mine} standard shapes`));
  }
  say(dim("  ctrl-c to stop"));
  /* Opening is the default and staying put is the flag. A tool that prints a
     url and waits has asked a person who ran one command to go and do a
     second thing, and the terminal is not where any of the work happens. */
  if (!flags["no-open"]) await openIn(url);
}

main().catch((e) => { console.error(`\n  ${hot("!")} ${e.message}\n`); process.exit(1); });
