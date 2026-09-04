import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

/**
 * What macOS calls the four things in os/index.mjs, in its own words.
 *
 * These are read straight into user facing sentences, so they are lowercase
 * and they are the words printed on this machine's own menus. Somebody who
 * has just lost a photograph is looking for the thing their computer calls
 * it, not the thing the abstraction calls it.
 */
export const name = "macos";
export const files = "finder";
export const bin = "the macos trash";
export const restore = "put back";

/** beyond copy, which is plain file io and works everywhere */
export const LINKS = ["symlink", "alias"];

const run = (cmd, args, opts = {}) =>
  new Promise((ok, no) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      err ? no(new Error(String(stderr || err.message).trim())) : ok(String(stdout)));
  });

/**
 * The real folder chooser, for when the search index comes back with nothing.
 *
 * The request stays open for as long as the dialog is up. That is not a hang:
 * the browser has nothing to do until a folder is picked, and the dialog is
 * the answer it is waiting on.
 */
export async function chooseFolder(startIn = "") {
  try {
    /* opening the dialog inside the folder the archive already sits in, when
       there is one. a picker that lands wherever it last was makes the person
       who just dropped a folder on the window go and find it by hand. */
    /* Through System Events, and activated, because keeper has no application
       of its own to bring forward.
     *
       The server is a headless background process, so a bare `choose folder`
       puts a dialog up that never becomes frontmost: measured with
       `lsappinfo front` while it was open, the frontmost application did not
       change. Meanwhile the panel in the page says "the dialog is open in
       front of this window, keeper is waiting for it", which is then simply
       untrue, and this is the only way into an archive spotlight has not
       indexed, which is most external drives and every fresh card copy.
       System Events is a real application that can be activated, and the
       dialog comes forward with it. */
    const pick = startIn
      ? `choose folder default location POSIX file ${JSON.stringify(startIn)}`
      : "choose folder";
    const script = `tell application "System Events"\nactivate\nPOSIX path of (${pick})\nend tell`;
    const out = await run("osascript", ["-e", script]);
    // a POSIX path of a folder comes back with a trailing slash. it goes
    // straight into path.join afterwards, which reads cleaner without it.
    return { path: out.trim().replace(/\/+$/, "") || "/" };
  } catch (e) {
    /* Cancel is exit 1 with a -128 on stderr, and it is the ordinary outcome
       of putting a dialog up rather than an error to report to somebody who
       just changed their mind.
     *
       Both spellings, and the code. A bare `choose folder` says "User
       canceled" with one l; through System Events, which is how this dialog
       is raised now so that it comes to the front, the same cancel comes back
       as "system events got an error: user cancelled. (-128)". The one l test
       stopped matching the moment that changed, and pressing cancel started
       printing an applescript error at somebody who had simply changed their
       mind. -128 is the number for it and is there whichever wording the
       machine chooses. */
    if (/-128|user cancell?ed/i.test(e.message)) return { cancelled: true };
    return { error: e.message.toLowerCase() };
  }
}

/**
 * `open -R` cannot run an arbitrary command and does exactly one thing: the
 * finder, frontmost, with that file already selected.
 */
export function reveal(file) {
  execFile("open", ["-R", file], () => {});
}

export function openDir(dir) {
  execFile("open", [dir], () => {});
}

/**
 * FINDER'S OWN DELETE, AND THAT IS THE WHOLE POINT.
 *
 * It puts the file in the trash with its Put Back record intact, so the move
 * is undone from the finder in one keystroke. `unlink` would be one line and
 * it would be permanent, and permanent is not a thing a culling tool gets to
 * do to somebody's negatives.
 *
 * The paths go to osascript as an argv list rather than inside a built
 * string, so nothing in a filename can end the quoting and start a command.
 *
 * Gone from where it was is the only claim worth making, so it is the one
 * that gets tested. The finder is not reliably loud either: an apple event
 * can come back clean with the file still sitting on the drive, and osascript
 * exiting 0 is not the same sentence as the photograph being in the trash.
 * The caller reads a clean return as licence to drop those frames from the
 * index, which is the one mistake this module must not let it make. The check
 * lives on both platforms now because the fix for the windows disaster had
 * been applied on one of them only.
 */
export async function trash(paths) {
  const script = `on run argv
  set l to {}
  repeat with p in argv
    set end of l to POSIX file (p as text)
  end repeat
  tell application "Finder" to delete l
end run`;
  await run("osascript", ["-e", script, ...paths]);

  const left = [];
  for (const p of paths) {
    try {
      await access(p, constants.F_OK);
      left.push(path.basename(p));
    } catch { /* not there any more, which is the whole point */ }
  }
  if (!left.length) return;

  const names = left.slice(0, 3).join(", ") + (left.length > 3 ? ", and more" : "");
  throw new Error(`${left.length} of ${paths.length} did not reach ${bin} and are still on the drive: ${names}`);
}

/**
 * A finder alias is not a file this process can write. Only the finder makes
 * them, and it makes them one at a time through apple events, so the naive
 * version is one osascript per frame: two hundred processes, each paying its
 * own interpreter startup and its own round trip, and a tray that takes a
 * minute to export nothing. So a batch of frames becomes one script with a
 * repeat loop in it and osascript runs once for the batch.
 *
 * The script is fed on stdin rather than through -e. A few hundred paths is
 * tens of kilobytes of argument otherwise, and an argument list has a ceiling
 * while a pipe does not.
 */
const osa = (script) =>
  new Promise((ok, no) => {
    const child = execFile("osascript", ["-"], { maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) return no(new Error(String(stderr || err.message).trim().toLowerCase() || "the finder would not answer"));
      ok(String(stdout));
    });
    child.stdin.end(script);
  });

/* AppleScript string literals take the same two escapes a javascript one
   does, and a photographer's folder name is exactly the place a stray quote
   turns a script into a syntax error. */
const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/* AppleScript prints a list of integers as "1, 4, 9" and an empty list as
   nothing at all, so no parse is needed beyond pulling the numbers out. They
   are one based coming out of a repeat loop and zero based going back to the
   caller, and `at` puts the batch back where it came from. */
const rows = (text, at) => (String(text).match(/\d+/g) ?? []).map((n) => at + Number(n) - 1);

/**
 * HOW MANY OF THESE FIT IN ONE SCRIPT, WHICH IS FEWER THAN YOU WOULD THINK
 * AND IS NOT ABOUT HOW LONG THE SCRIPT IS.
 *
 * Every path in a batch goes into one AppleScript list literal, and
 * AppleScript overflows its own stack evaluating a long enough one. Measured
 * on this machine: 8,000 items parse and run, 8,079 come back as `execution
 * error: Stack overflow. (-2706)`, and it is a count rather than a byte
 * budget, since the cliff falls in the same place whether the list is 350KB
 * or 1.4MB. A tray of eight thousand frames is a real tray, and what it used
 * to get was that raw applescript error with no mention of trays, frames or
 * anything a photographer could act on.
 *
 * So the tray is cut into batches, and the batch is 500 because the two
 * costs pull in opposite directions and 500 is where neither one shows.
 * Sixteen times under the measured ceiling leaves room for a machine less
 * generous than this one; parse time climbs faster than the list does, so
 * shorter batches are cheaper to parse rather than dearer (500 items parse
 * in 43ms, 8,000 in 1.1s); and the price of a batch is one osascript start
 * against roughly 17ms per frame of finder work, measured over 400 real
 * aliases at 6.79s in one call and 7.10s in four, which puts a 500 frame
 * batch at well under a percent of a run it can no longer fail.
 */
const BATCH = 500;

export async function links(jobs, dest) {
  const bad = new Set();

  for (let at = 0; at < jobs.length; at += BATCH) {
    const batch = jobs.slice(at, at + BATCH);

    /* Everything but the one make call is kept outside the tell block. POSIX
       file and its coercion are AppleScript's own, and the finder is only
       asked the thing that is actually its job, which is the shortest version
       of this script that cannot be tripped up by terminology. */
    const script = [
      `set srcs to {${batch.map((j) => q(j.src)).join(", ")}}`,
      `set nms to {${batch.map((j) => q(j.name)).join(", ")}}`,
      `set d to (POSIX file ${q(dest)}) as alias`,
      "set bad to {}",
      "repeat with i from 1 to count of srcs",
      "  try",
      "    set f to (POSIX file (item i of srcs)) as alias",
      "    tell application \"Finder\" to make new alias file at d to f with properties {name:(item i of nms)}",
      "  on error",
      // one frame the finder would not alias, a file gone from the disk since
      // the index was built, is a skip and not a reason to abandon the other
      // hundred and ninety nine
      "    set end of bad to i",
      "  end try",
      "end repeat",
      "return bad",
    ].join("\n");

    try {
      for (const i of rows(await osa(script), at)) bad.add(i);
    } catch (e) {
      /* A whole batch refused is the machine talking rather than one frame:
         apple events turned off for this process, or the finder not running.
         Before anything has landed that is the only useful thing to say, so
         it is said and the export stops. Once files are in the folder the
         person needs the count and the list of what is missing more than
         they need an exception, so the rest of the batches still run and
         these frames come back as ones the finder would not make. */
      if (!at) throw e;
      for (let i = 0; i < batch.length; i++) bad.add(at + i);
    }
  }

  return bad;
}

/**
 * WHAT IS ALREADY SITTING UNDER THAT NAME IN THE DESTINATION.
 *
 * An export into a folder that has been exported into before has to tell its
 * own work from a different photograph that happens to share a name, and an
 * alias is the one mode where that answer is not in the file itself. Only
 * the finder knows what one of these points at.
 *
 * THREE ANSWERS AND NOT TWO, which is why two lists come back. An index in
 * `same` is a link that resolves to exactly that frame's original, so the
 * frame is already exported and nothing needs writing. An index in neither
 * list is a name held by something else, which is an honest collision and is
 * what the id suffixed name exists to answer. An index in `unknown` is the
 * finder declining to say, and the caller must not read that as a collision:
 * being wrong in that direction writes a second alias to a photograph the
 * folder already holds, which is the whole fault this exists to close.
 *
 * Integers come back rather than paths, deliberately. A mac filename may
 * contain a newline, so a list of resolved paths is not a thing that can be
 * split back apart reliably, and the comparison is cheaper inside the script
 * than out of it anyway.
 *
 * Measured on this machine: `class of item (POSIX file p)` is `alias file`
 * for a finder alias and for a posix symlink both, and `document file` for
 * an ordinary photograph, so an ordinary file of the same name falls through
 * to the collision branch rather than being guessed at. A finder alias whose
 * original has gone raises -1700 on `original item` instead of answering,
 * and lands in `unknown` where it belongs.
 */
export async function linksAlready(jobs, dest) {
  const same = new Set();
  const unknown = new Set();

  for (let at = 0; at < jobs.length; at += BATCH) {
    const batch = jobs.slice(at, at + BATCH);
    const script = [
      `set nms to {${batch.map((j) => q(j.name)).join(", ")}}`,
      `set srcs to {${batch.map((j) => q(j.src)).join(", ")}}`,
      `set d to ${q(dest)}`,
      /* `hits` and not `yes`: yes is an AppleScript constant, and assigning
         to it is a syntax error the whole script dies of. It failed quietly
         too, because a script that will not compile is one this function
         reads as the finder declining to answer about any of these names. */
      "set hits to {}",
      "set dunno to {}",
      "repeat with i from 1 to count of nms",
      "  set p to (POSIX file (d & \"/\" & (item i of nms)))",
      "  try",
      "    tell application \"Finder\"",
      "      if (class of item p) is alias file then",
      "        if (POSIX path of ((original item of item p) as alias)) is (item i of srcs) then",
      "          set end of hits to i",
      "        end if",
      "      end if",
      "    end tell",
      "  on error",
      "    set end of dunno to i",
      "  end try",
      "end repeat",
      "set text item delimiters to \",\"",
      "return (hits as text) & \" \" & (dunno as text)",
    ].join("\n");

    /* One line, two lists, split on the space between them. Neither half can
       hold anything but digits and commas, so there is nothing here a
       filename could reach into. A batch the finder refuses outright says
       nothing about any of its names, which is exactly `unknown`. */
    let said = " ";
    try {
      said = await osa(script);
    } catch {
      for (let i = 0; i < batch.length; i++) unknown.add(at + i);
      continue;
    }
    const [a, b] = said.split(" ");
    for (const i of rows(a, at)) same.add(i);
    for (const i of rows(b, at)) unknown.add(i);
  }

  return { same, unknown };
}

/**
 * A finder alias keeps the name it is given and wears no suffix of its own,
 * which is why this exists: the windows side has to add .lnk or the file is
 * not a shortcut at all.
 */
export const linkName = (base) => base;

/**
 * Spotlight, which already holds the index that turns a folder name back into
 * a path. mdfind takes the whole query as one argument: through a shell it
 * would be four words and a quoting problem, so this is execFile with the
 * query as a single argv element and it never touches sh.
 */
export async function search(term, kind) {
  const quoted = String(term).replace(/'/g, "\\'");
  const q = kind === "folder"
    ? `kMDItemFSName == '${quoted}' && kMDItemContentTypeTree == 'public.folder'`
    : `kMDItemFSName == '${quoted}'`;
  try {
    const out = await run("mdfind", [q], { maxBuffer: 8 << 20 });
    return out.split("\n").filter(Boolean);
  } catch {
    // spotlight off or the drive unindexed. both are ordinary, and the folder
    // chooser is the answer to all of them.
    return [];
  }
}

/**
 * THE FOLDERS WORTH LOOKING IN WHEN SPOTLIGHT WILL NOT ANSWER.
 *
 * Measured, not assumed: an app launched from its icon gets spotlight
 * results filtered by the same permission system that guards the folders
 * themselves, so `mdfind` finds a folder in the home root and comes back
 * empty for the identical folder on the desktop. `readdir` on that same
 * desktop folder works. The index is filtered, the disk is not.
 *
 * So these are the places a person actually keeps an archive, and they are
 * read directly. /Volumes is on the list twice over: an external drive is
 * where most of these live, and it is also the thing most often missing from
 * the index entirely.
 */
export function roots() {
  const home = process.env.HOME || "";
  return [
    home,
    ...["Desktop", "Documents", "Downloads", "Pictures", "Movies"].map((d) => `${home}/${d}`),
    "/Volumes",
  ].filter(Boolean);
}

/**
 * macOS decodes every raw this app meets through Image I/O, and sips is the
 * front door to it. Nothing to install and nothing to check for.
 */
export const canDecode = async () => true;

export const decodeHint = "";

const sips = (args, timeout) =>
  run("sips", args, { timeout, maxBuffer: 1 << 20 }).catch((e) => {
    // sips puts its refusals on stderr and its progress on stdout, and the
    // first stderr line is the only one that says anything: the two after it
    // are a numbered code and an advert for --help.
    const said = e.message.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "sips failed";
    throw new Error(said.replace(/^error:\s*/i, "").toLowerCase());
  });

/**
 * The source's own pixels, as sips reports them, which is sensor order.
 *
 * The timeout is not optional and is not a tidy default. Without one this
 * call is the only sips in the program with no upper bound on it, and a sips
 * that wedges, which a damaged file on a failing drive will do, holds the
 * whole scan on "thumbnailing ..." with nothing to distinguish it from a slow
 * disk. Measured against a sips that slept: the convert gave up at 121
 * seconds and this one sat for the full 400, then started the convert, and
 * the frame finally failed at 521.
 */
export async function measure(src, timeoutMs = 0) {
  const out = await sips(["-g", "pixelWidth", "-g", "pixelHeight", src], timeoutMs).catch(() => "");
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  return w && h ? { w, h } : null;
}

/**
 * `--resampleHeightWidthMax` IS NOT A CAP, WHATEVER THE NAME SAYS. It sets the
 * long edge to that number in both directions: a 1600px flatbed scan comes
 * back at 3072px, six times the pixels and twelve times the bytes, every one
 * of them invented, and the index then reports a resolution the file has
 * never had. Measured, not assumed: 500x333 in, 3072x2046 out.
 *
 * So the source is measured first and the flag is only passed when there is
 * something to lose by keeping it. That is a second sips call, about 100ms,
 * paid once per file for the life of the archive, and it cannot be folded
 * into the first: sips refuses to read properties and write a file in one
 * invocation, by name, with error 6.
 *
 * A source that cannot even be measured still gets the flag. It is about to
 * fail the convert anyway, and the failure is the useful answer.
 */
export async function decode(src, out, longEdge, quality, timeoutMs) {
  const size = await measure(src, timeoutMs).catch(() => null);
  const resample = !size || Math.max(size.w, size.h) > longEdge
    ? ["--resampleHeightWidthMax", String(longEdge)]
    : [];

  await sips([
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(quality),
    ...resample,
    "--out", out,
    src,
  ], timeoutMs);
}
