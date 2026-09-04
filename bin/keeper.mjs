#!/usr/bin/env node
import { readFile, copyFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "../src/open.mjs";
import { buildSheets, GRID_ADVICE, cellWidth } from "../src/sheets.mjs";
import { parseCompact, applyToIndex, VOCAB } from "../src/tags.mjs";
import { adopt, paths, readIndex, readTags, writeTags } from "../src/store.mjs";
import { alive, claim, holder, release, serving } from "../src/lock.mjs";
import { loadConfig, CONFIG_NAME } from "../src/config.mjs";
import { exportCrops } from "../src/crops.mjs";
import { serve } from "../src/server.mjs";
import { readTrays, trayById, exportTray, MODES } from "../src/trays.mjs";
import { startOpen } from "../src/open.mjs";
import {
  appDir, blankRoot, claimRun, forgetRunSync, freePort, hushed, lastArchive, plain, rememberArchive, running,
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
  const cwd = process.cwd();
  /* An app opened from its icon runs with the working directory at the root
     of the disk, and a relative path from there is the absolute one with its
     leading slash filed off: it still looks like a path and it no longer is
     one. This is the line a stuck tester copies back to you, so it has to be
     pasteable. */
  if (cwd === path.parse(cwd).root) return p;
  const rel = path.relative(cwd, p);
  return !rel ? "." : rel.startsWith("..") ? p : rel;
}

/** a path with a space in it is two arguments unless it is quoted */
const arg = (p) => (/[\s"'\\$`]/.test(p) ? JSON.stringify(p) : p);

/**
 * HOW TO RUN KEEPER AGAIN ON THIS MACHINE, WORD FOR WORD.
 *
 * Nothing installs keeper onto a PATH. The mac bundle runs its own copy of
 * node against its own copy of this file, the windows folder runs a batch
 * file beside it, and a clone runs whatever node the person already had. So
 * every line that told somebody to run `keeper something` was telling them
 * to run a command that does not exist anywhere, which is worse than saying
 * nothing: they type it, the shell says command not found, and the tool that
 * printed it looks broken.
 *
 * The runner is shortened to its bare name only when a PATH entry of that
 * name is this same file, followed through its links: a version manager puts
 * a shim on the PATH and runs the real binary from somewhere else, and the
 * word that works in that shell is still `node`. When nothing on the PATH
 * leads here, which is the mac bundle carrying its own runtime, the whole
 * path is printed, because the whole path is what runs.
 */
const ME = (() => {
  const base = path.basename(process.execPath);
  let runner = process.execPath;
  try {
    const real = realpathSync(process.execPath);
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir) continue;
      try {
        if (realpathSync(path.join(dir, base)) === real) { runner = base; break; }
      } catch { /* not there, which is the ordinary answer for most of PATH */ }
    }
  } catch { /* an execPath that cannot be resolved is printed as it stands */ }
  return `${arg(runner)} ${arg(nice(process.argv[1] ?? "bin/keeper.mjs"))}`;
})();

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

/**
 * One row of the help, and the reason it is built rather than written out is
 * that the command on the left is now as long as this machine makes it.
 * Padding to a fixed column would put half of these lines' descriptions on
 * top of their commands on a bundle whose runner lives eight folders deep.
 */
const COL = ME.length + 22;
const use = (cmd, ...lines) =>
  lines.map((l, i) => `  ${(i ? "" : `${ME} ${cmd}`).padEnd(COL)}${l}`).join("\n");

const HELP = `
${hot("keeper")}  find the frames worth keeping, and crop them into the holes they fill

${use("<folder>", "scan, thumbnail, and open the shelf")}
${use("app [folder]", "the way the icon opens it: remembers the",
  "last archive, picks its own port, and",
  "reuses a copy that is already running")}
${use("sheets <folder>", "contact sheets for a coding agent to read")}
${use("tag <folder> <file>", "apply the tags that agent wrote")}
${use("export <folder>", "write the placed crops out")}
${use("trays <folder>", "what is in the trays, and how much")}
${use("init [folder]", `create ${CONFIG_NAME}`)}
${use("doctor", "check this machine can run all of it")}

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
function sayWhatItWalkedPast({ ignored, barren, shut }) {
  if (!ignored?.length && !barren?.length && !shut?.length) return;
  say("");
  /**
   * The libraries, first, because this is the only skip that hides
   * PHOTOGRAPHS rather than clutter. Everything else on this report is a
   * project file or an empty folder. A photos library is thousands of frames
   * somebody owns, and walking past it silently would leave them counting the
   * wall and wondering where half their pictures went. It also says why, once,
   * because "skipped" on its own reads as a failure and it is not one.
   */
  if (shut?.length) {
    const shown = shut.slice(0, 3).map((p) => dim(p)).join(", ");
    const more = shut.length > 3 ? dim(` and ${shut.length - 3} more`) : "";
    say(`  ${dim(`${shut.length} ${shut.length === 1 ? "library" : "libraries"} left closed:`)} ${shown}${more}`);
    say(`    ${dim("these are apps' own folders. export from the app to cull what is inside them.")}`);
  }
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
    /* a code the vocabulary does not know prints as itself rather than
       taking the whole boot down. archives written before the server
       validated tags can carry one, and a tally is not the place to die
       over it. */
    say("  " + chunk.map(([c, n]) => `${VOCAB[c]?.[0] ?? c} ${dim(n)}`).join("   "));
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

/**
 * THE NINE CHECKS, PRINTED.
 *
 * Shared by the `doctor` command and by the app path when it cannot start,
 * because those are two different people. The first typed a command and can
 * read the answer. The second double clicked an icon on a mac, where the
 * bundle is the only way in and everything it prints goes to a log file:
 * windows ships a doctor.cmd beside keeper.cmd and the bundle ships nothing
 * at all, so a tester whose app does nothing when clicked had one stack
 * trace to send and no command to run. Now the log already holds the checks.
 */
async function report() {
  const { doctor, OK, NO, MEH } = await import("../src/doctor.mjs");
  const rows = await doctor();
  const wide = Math.max(...rows.map((r) => r.what.length));
  for (const r of rows) {
    const mark = r.state === OK ? "  ok  " : r.state === NO ? hot("  no  ") : hot(" warn ");
    say(`${mark}${r.what.padEnd(wide)}  ${r.said}`);
  }
  /* A warn is not a clear row. The summary counted only the broken ones, so
     a machine with no ffmpeg and no search index was told all nine were
     clear while two lines above it said otherwise, and the one number
     somebody pastes back was the one number that was wrong. */
  const broken = rows.filter((r) => r.state === NO).length;
  const soft = rows.filter((r) => r.state === MEH).length;
  say("");
  say(broken
    ? hot(`  ${broken} of ${rows.length} would stop something working. the lines above say which.`)
    : soft
      ? dim(`  ${rows.length - soft} of ${rows.length} clear, and ${soft} worth a look. nothing here stops keeper running.`)
      : dim(`  all ${rows.length} clear. point keeper at a folder and it will run.`));
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
    say("");
    await report();
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
   * serves, starts the scan, and only then opens the browser. A person who
   * double clicked an icon should see their own app inside a second, and what
   * they should see in it is the scan: opening the tab first was measured at
   * 0.7s of an empty wall on a folder whose progress, had anything been
   * polling it, said thumbnailing 229 of 2000. The scan is under way and
   * /api/progress is answering before the tab exists.
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
          headers: { "content-type": "application/json", "x-keeper-token": live.token ?? "" },
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
    let here = remembered && existsSync(remembered) ? remembered : await blankRoot();

    /* The same answer for a keeper started from a terminal, which the check
       above cannot see because a command line run writes no app run file. It
       does leave a claim beside the photographs, and that claim names the
       port its window is on. */
    const held = await holder(here);
    if (held && alive(held.pid) && held.port && await serving(held, here)) {
      const there = `http://127.0.0.1:${held.port}`;
      if (!flags["no-open"]) await openIn(there);
      say(`  ${hot(there)}`);
      say(dim("  that archive is already open there, so this is that keeper and not a second one."));
      return;
    }

    const port = await freePort(Number(flags.port) || 7777);
    let up;
    try {
      up = await serve({ root: here, config: await loadConfig(here), port, launched: "app" });
    } catch (e) {
      /* A busy archive is not a broken machine. Another keeper is holding
         this folder without serving it, sheets for instance, so there is no
         port to send anybody to and the claim's own sentence is the answer. */
      if (e.code === "EBUSY") { say(`  ${hot(e.message)}`); process.exit(1); }
      /* Everything else opens the empty page, and this is the whole point of
         the icon path.
       *
         Nobody typed anything to get here and there is no terminal to read,
         so exiting is a dock icon that bounces, spins, and quits with nothing
         on screen, for ever, because the remembered folder is still the
         remembered folder on the next click too. That is the shape of a
         program that is broken beyond a tester's reach, and the cause can be
         as ordinary as a folder that has gone read only or a drive that is
         not plugged in. The log still gets the sentence and the nine checks
         for anybody who goes looking, and the person gets a window they can
         drop another folder onto. */
      say(`\n  ${hot("!")} ${plain(e.message)}\n`);
      if (e.code !== "EUNREADABLE") { await report(); say(""); }
      here = await blankRoot();
      up = await serve({ root: here, config: await loadConfig(here), port, launched: "app" });
    }
    const { url, token } = up;
    await claimRun(port, token);
    if (here !== (await blankRoot())) await rememberArchive(here);

    /* The run file describes a process, so it dies with the process, by
       every route out including the quit button and a machine shutting
       down. `exit` covers the ordinary returns and the two signals cover
       being asked to stop, which `exit` alone does not. */
    process.on("exit", forgetRunSync);
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

    /* An archive with an index already opens instantly and is left alone. One
       without gets scanned now, before the tab, because the alternative is a
       shelf that sits empty until somebody works out that they were supposed
       to drop the folder they had already chosen. startOpen sets the phase
       before it returns, so the page's first poll is answered. */
    if (!(await readIndex(here))) startOpen(here);

    /* An update restarts keeper with a tab already open and watching, and
       that tab reloads itself. Opening a second one would leave two pages
       against one server, one of them stale. */
    if (!flags["no-open"] && !(await hushed())) await openIn(url);
    say(`  ${hot(url)}`);
    say(dim(`  state in ${nice(appDir())}`));
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
    say(dim(`  edit the slots, then run \`${ME} <your archive folder>\``));
    return;
  }

  if (!existsSync(root)) { say(hot(`  no such folder: ${root}`)); process.exit(1); }
  await adopt(root);
  say("");
  say(`  ${hot("keeper")} ${dim(root)}`);

  if (cmd === "sheets") {
    /* The claim before the scan. Sheets writes thumbnails and its own index
       into .keeper, and a second keeper writing that folder from another
       process is the thing this whole file now refuses to do. */
    try {
      await claim(root);
    } catch (e) {
      /* plain() for the same reason main().catch uses it: EBUSY carries a
         sentence written for a person and comes through untouched, while an
         EACCES on a folder nobody can write is an errno and has to be turned
         into one. This used to print e.message straight out, so the one
         command a stuck tester runs answered with `EACCES: permission denied,
         mkdir` while `keeper app` on the same folder answered in English. */
      say(hot(`  ${plain(e.message)}`));
      process.exit(1);
    }
    try {
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
      say(`     ${ME} tag ${arg(nice(root))} tags.txt`);
    } finally {
      await release(root);
    }
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
    const rows = Object.entries(fresh).map(([id, v]) => ({ id, ...v }));

    /* THIS USED TO BE A READ, A MERGE AND A WRITE FROM A SECOND PROCESS.
       The readme hands this exact command to an agent while the page is open
       in front of somebody, and both of them were writing the whole tags file
       from a copy they had read a minute apart. Measured against starring in
       the browser: eighty rows became three, no tag letters survived, and
       both sides said they had succeeded. So when a keeper is already serving
       this archive the tags go through it, into the one queue that orders
       every write to this folder, and only a folder nobody is holding gets
       written here. */
    const held = await holder(root);
    if (held && alive(held.pid) && held.port) {
      const res = await fetch(`http://127.0.0.1:${held.port}/api/tag`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-keeper-token": held.token ?? "" },
        body: JSON.stringify({ rows }),
      }).catch(() => null);
      if (!res?.ok) {
        const why = res ? await res.json().then((d) => `: ${d.error}`).catch(() => "") : "";
        say(hot(`  the keeper on port ${held.port} did not take the tags${why}`));
        process.exit(1);
      }
      say(dim("  through the keeper already open on this archive"));
    } else {
      /* No port on a live claim means a keeper is working in here without
         serving, sheets for instance, and there is nowhere to send the rows.
         The lock's own sentence is the one to print. */
      try {
        await claim(root);
      } catch (e) { say(hot(`  ${e.message}`)); process.exit(1); }
      try {
        const all = { ...(await readTags(root)) };
        for (const { id, ...v } of rows) all[id] = { ...all[id], ...v };
        await writeTags(root, all);
      } finally {
        await release(root);
      }
    }

    say(`  tagged ${hot(applied)} frames`);
    for (const p of [...parsed.problems, ...problems]) say(hot(`  ! ${p}`));
    const index = await readIndex(root);
    /* read back rather than reported from memory: the summary is a claim
       about what is on the disk, and on the server path this process never
       held the file it is describing. */
    summarise(index?.items ?? [], await readTags(root));
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
      say(dim(`  ${out.empty} of your ${out.mine} slots are still empty. run \`${ME} <folder>\` and fill them.`));
    }
    if (!n && config.missing) {
      say(dim(`  there is no ${CONFIG_NAME} in this folder, so keeper only knows`));
      say(dim(`  the standard shapes. \`${ME} init\` adds your own.`));
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
      const verb = {
        copy: ["copying", "copied"], symlink: ["linking", "linked"],
        alias: ["aliasing", "aliased"], shortcut: ["making shortcuts", "shortcuts made"],
      }[mode];
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
      // three numbers, because folding "already there" into either of the
      // others made a re-export lie: counted as written it promised files it
      // had not made, and counted as skipped it read as a tray of failures
      bar.done(`${out.written} ${verb[1]}`
        + (out.already.length ? dim(`  ${out.already.length} already there`) : "")
        + (out.skipped.length ? hot(`  ${out.skipped.length} skipped`) : ""));
      say("");
      say(`  ${dim("they are in")} ${nice(out.dest)}`);
      // which mode ran, every time. a folder of symlinks and a folder of
      // copies look identical in a terminal listing and weigh nothing alike,
      // and finding out which one you made a week later costs an hour.
      say(dim({
        copy: "  the originals have not moved. this was a copy.",
        symlink: "  the originals have not moved and nothing was copied. those are symlinks to them.",
        alias: "  the originals have not moved and nothing was copied. those are finder aliases.",
        shortcut: "  the originals have not moved and nothing was copied. those are shortcuts to them.",
      }[mode]));
      // each refusal in the frame's own words, because "skipped" on its own
      // reads as a failure and only the reason says whether it was one. a
      // skip with no reason is a frame the index dropped after it was trayed.
      for (const p of out.problems) say(dim(`  ${p.name}: ${p.why}`));
      const gone = out.skipped.length - out.problems.length;
      if (gone > 0) {
        say(dim(`  ${gone} skipped because ${gone === 1 ? "it is" : "they are"} no longer in the index.`));
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
    say(dim(`  ${ME} trays ${arg(nice(root))} --export <tray> --to <folder>`));
    say(dim(`  add --mode symlink to point at the originals instead of copying them`));
    return;
  }

  // default: shelf
  const config = await loadConfig(process.cwd());
  /* The claim before the scan, and the same claim the app path reads: one
     keeper per archive, whichever way it was started. serve() rewrites it
     with the port a moment later and takes over letting it go. */
  try {
    await claim(root);
  } catch (e) { say(hot(`  ${plain(e.message)}`)); process.exit(1); }

  /* Everything between the claim and serve() can still refuse the archive, a
     tags.json that will not parse being the likely one, and the claim is
     already taken by then. Exiting through main().catch without putting it
     down leaves a file naming a pid that is already dead. The next run sweeps
     that, until the day the number belongs to something else and the archive
     locks itself out for good.

     An empty archive still opens. It used to stop here with one line in the
     terminal, which is the least useful moment to say nothing: someone who
     pointed keeper at the wrong folder learns more from a page that says what
     it reads than from a sentence that says it found nothing. The shelf has a
     state for this. */
  let index;
  try {
    index = await indexWithBar(root, { rescan: !!flags.rescan });
    summarise(index.items, await readTags(root));
  } catch (e) {
    await release(root);
    throw e;
  }

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

/* plain() and not the raw message: an errno is a fact about a system call,
   and the person reading this wants the sentence about their drive. */
main().catch((e) => { console.error(`\n  ${hot("!")} ${plain(e.message)}\n`); process.exit(1); });
