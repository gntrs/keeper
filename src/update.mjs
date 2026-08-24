/* ---------------------------------------------------------------------
   keeper updating itself, which is the one thing in here that touches the
   network, and therefore the one thing in here that has to be argued for.

   THE PROMISE IS THAT KEEPER TALKS TO NOTHING, AND THIS DOES NOT BREAK IT,
   because nothing here runs until somebody says it may. There is a question
   asked once, in the page, in plain words, and until it is answered no
   request is made. Answer no and this file is dead code for good. Nothing is
   ever sent: the only outbound request is a GET for a small file that says
   what the newest version is, and it carries no identifier, no archive, no
   count of anything, and no cookie.

   WHAT IT REPLACES IS KEEPER, NOT THE MACHINE UNDER IT. An update is
   bin, src and web, which together are under a megabyte, and it leaves node
   and node_modules exactly where they are. That is not only for the size:
   swapping a running node.exe on windows is the kind of operation that
   leaves somebody with neither the old version nor the new one, and this way
   the question never comes up. When a release needs different dependencies
   it says so and asks the person to download a whole build instead, which is
   rare and honest and beats a half finished install.
   --------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** the folder holding bin, src and web, whatever kind of install this is */
export const ROOT = path.resolve(HERE, "..");

/* Where the newest version announces itself. A plain file at a stable
   address rather than the github api: the api is rate limited per address,
   which on an office network is a limit shared with everybody else in the
   building, and it answers with two hundred fields when the question has
   four. `latest/download` is a permanent redirect to whatever the newest
   release is, so this url never changes. */
/* KEEPER_RELEASES points all of this somewhere else. It exists so a release
   can be tested against a copy of github before it is a release, which is
   the only way to find out that an update works before shipping one that
   does not. Unset, which it is for everybody, this is github. */
const WHERE = process.env.KEEPER_RELEASES || "https://github.com/gntrs/keeper/releases/latest/download";
const NEWS = `${WHERE}/latest.json`;
const FROM = WHERE;

/* What an update is allowed to contain, and therefore all it can replace. A
   payload naming anything else is rejected rather than partially applied:
   the archive is not in this list and neither is node_modules, so no update
   can reach either even if one is built wrong. */
const PARTS = ["bin", "src", "web", "package.json"];

export async function version() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * A clone updates with git and must not be updated with this.
 *
 * Somebody running from a checkout has a working tree, probably has changes
 * in it, and pointing a downloader at it would throw their work away to
 * install a copy of what they already have a better copy of.
 */
export const isClone = () => existsSync(path.join(ROOT, ".git"));

/** three numbers, compared as numbers. anything unparseable sorts oldest. */
function newer(a, b) {
  const n = (v) => String(v).split(".").map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/**
 * What the dependencies are, as one short string.
 *
 * An update carries no node_modules, so it can only be applied to an install
 * whose node_modules already matches what the new code expects. Comparing
 * the dependency block rather than the whole file means a version bump or a
 * new script does not falsely look like a change that needs a full download.
 */
export async function depsFingerprint(file = path.join(ROOT, "package.json")) {
  const pkg = JSON.parse(await readFile(file, "utf8"));
  return createHash("sha256").update(JSON.stringify(pkg.dependencies ?? {})).digest("hex").slice(0, 12);
}

/**
 * Is there a newer one. Makes exactly one request and gives up quickly:
 * a check that hangs is worse than a check that fails, because the thing
 * waiting for it is a person who wanted to look at photographs.
 */
export async function check() {
  const current = await version();
  if (isClone()) return { current, clone: true };

  let news;
  try {
    const res = await fetch(NEWS, { signal: AbortSignal.timeout(6000), redirect: "follow" });
    if (!res.ok) throw new Error(`github answered ${res.status}`);
    news = await res.json();
  } catch (e) {
    return { current, error: `could not reach github: ${e.message}` };
  }

  if (!news?.version || !news?.app || !news?.sha256) {
    return { current, error: "the release did not say what it was" };
  }

  const ready = newer(news.version, current);
  return {
    current,
    latest: news.version,
    ready,
    /* A release that changed its dependencies cannot be installed by
       swapping source files, and saying so up front is better than finding
       out after the download. */
    full: ready && news.deps !== (await depsFingerprint()),
    notes: news.notes ?? null,
    asset: news.app,
    sha256: news.sha256,
  };
}

/**
 * Fetch it, prove it is what the release said it was, and put it in place.
 *
 * The old copy is moved aside rather than deleted, and it goes back if any
 * part of the swap fails. The window where neither is in place is one rename
 * per folder, and a rename inside the same filesystem does not half happen.
 */
export async function apply() {
  if (isClone()) throw new Error("this is a git clone. `git pull` is the update.");

  const found = await check();
  if (found.error) throw new Error(found.error);
  if (!found.ready) throw new Error("this is already the newest one");
  if (found.full) throw new Error("this release needs a full download, because what it depends on changed");

  const url = `${FROM}/${encodeURIComponent(found.asset)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!res.ok) throw new Error(`download answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== found.sha256) throw new Error("the download does not match the checksum the release published");

  const work = await mkdtemp(path.join(os.tmpdir(), "keeper-update-"));
  const next = path.join(work, "next");
  const prev = path.join(work, "prev");
  await mkdir(next, { recursive: true });
  await mkdir(prev, { recursive: true });

  const tgz = path.join(work, found.asset);
  await writeFile(tgz, bytes);
  /* tar rather than a zip library. it is on both machines already, windows
     has shipped bsdtar since windows 10, and a compression dependency for
     one file a month is a dependency with a poor argument behind it. */
  await run("tar", ["-xzf", tgz, "-C", next]);

  for (const part of PARTS) {
    if (!existsSync(path.join(next, part))) throw new Error(`the update is missing ${part}, so none of it was installed`);
  }

  const moved = [];
  try {
    for (const part of PARTS) {
      const live = path.join(ROOT, part);
      if (existsSync(live)) { await rename(live, path.join(prev, part)); moved.push(part); }
      await rename(path.join(next, part), live);
    }
  } catch (e) {
    /* put back what was moved, in the order it was moved, so a failure
       halfway leaves the version that was working this morning */
    for (const part of moved.reverse()) {
      await rm(path.join(ROOT, part), { recursive: true, force: true }).catch(() => {});
      await rename(path.join(prev, part), path.join(ROOT, part)).catch(() => {});
    }
    throw new Error(`could not swap the files in, so nothing changed: ${e.message}`);
  }

  await rm(work, { recursive: true, force: true }).catch(() => {});
  return { version: found.version ?? found.latest, from: found.current };
}

/**
 * Start the new copy and let this one die.
 *
 * Both installs know where their own launcher is, because both were laid out
 * by the build scripts in packaging and neither layout is a guess:
 *
 *   macos    keeper.app/Contents/Resources/app   ->  three up is the bundle
 *   windows  keeper\app                          ->  one up holds keeper.cmd
 *
 * Detached in both, so the new keeper is not a child of the process that is
 * about to exit and does not go down with it.
 */
export async function relaunch() {
  const { spawn } = await import("node:child_process");
  const { hush } = await import("./runtime.mjs");

  /* The tab that pressed update is still open and is already waiting on this
     port. Telling the new process to skip the browser is what turns an
     update into the page coming back by itself, rather than a second tab
     appearing beside a dead one. */
  await hush();

  if (process.platform === "darwin") {
    const bundle = path.resolve(ROOT, "..", "..", "..");
    if (!bundle.endsWith(".app")) return false;
    spawn("open", [bundle], { stdio: "ignore", detached: true }).unref();
    return true;
  }

  if (process.platform === "win32") {
    const cmd = path.resolve(ROOT, "..", "keeper.cmd");
    if (!existsSync(cmd)) return false;
    spawn("cmd", ["/c", "start", "", cmd], { stdio: "ignore", detached: true, windowsHide: true }).unref();
    return true;
  }

  return false;
}
