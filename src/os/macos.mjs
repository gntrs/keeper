import { execFile } from "node:child_process";

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
export async function chooseFolder() {
  try {
    const out = await run("osascript", ["-e", "POSIX path of (choose folder)"]);
    // a POSIX path of a folder comes back with a trailing slash. it goes
    // straight into path.join afterwards, which reads cleaner without it.
    return { path: out.trim().replace(/\/+$/, "") || "/" };
  } catch (e) {
    // cancel is exit 1 with "User canceled" on stderr, and it is the ordinary
    // outcome of putting a dialog up rather than an error to report to
    // somebody who just changed their mind.
    if (/User canceled/i.test(e.message)) return { cancelled: true };
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
}

/**
 * A finder alias is not a file this process can write. Only the finder makes
 * them, and it makes them one at a time through apple events, so the naive
 * version is one osascript per frame: two hundred processes, each paying its
 * own interpreter startup and its own round trip, and a tray that takes a
 * minute to export nothing. So the whole set becomes one script with a repeat
 * loop in it and osascript runs once.
 *
 * The script is fed on stdin rather than through -e. A few hundred paths is
 * tens of kilobytes of argument otherwise, and an argument list has a ceiling
 * while a pipe does not.
 */
export async function links(jobs, dest) {
  /* AppleScript string literals take the same two escapes a javascript one
     does, and a photographer's folder name is exactly the place a stray quote
     turns a script into a syntax error. */
  const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  /* Everything but the one make call is kept outside the tell block. POSIX
     file and its coercion are AppleScript's own, and the finder is only asked
     the thing that is actually its job, which is the shortest version of this
     script that cannot be tripped up by terminology. */
  const script = [
    `set srcs to {${jobs.map((j) => q(j.src)).join(", ")}}`,
    `set nms to {${jobs.map((j) => q(j.name)).join(", ")}}`,
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

  const out = await new Promise((ok, no) => {
    const child = execFile("osascript", ["-"], (err, stdout, stderr) => {
      if (err) return no(new Error(String(stderr || err.message).trim().toLowerCase() || "the finder would not make the aliases"));
      ok(String(stdout));
    });
    child.stdin.end(script);
  });

  /* AppleScript prints a list of integers as "1, 4, 9" and an empty list as
     nothing at all, so the count of matches is the count of failures and no
     parse is needed beyond pulling the numbers out. */
  return new Set((out.match(/\d+/g) ?? []).map((n) => Number(n) - 1));
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

/** the source's own pixels, as sips reports them, which is sensor order */
export async function measure(src) {
  const out = await sips(["-g", "pixelWidth", "-g", "pixelHeight", src]).catch(() => "");
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
  const size = await measure(src).catch(() => null);
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
