import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * What Windows calls the four things in os/index.mjs, in its own words.
 *
 * Not "the trash" and not "the finder". Somebody who has just set a hundred
 * photographs aside is going to go looking for the thing their own machine
 * calls it, and being told the wrong name is worse than being told nothing.
 */
export const name = "windows";
export const files = "file explorer";
export const bin = "the recycle bin";
export const restore = "restore";

/**
 * Beyond copy. `shortcut` is where the mac says `alias`, and it is the same
 * idea: a small file that stands for a file somewhere else. It is not the
 * same guarantee, because a .lnk holds a path and a link id rather than a
 * file reference, so windows finds a moved target only sometimes.
 */
export const LINKS = ["symlink", "shortcut"];

/* ------------------------------------------------------------------ */
/* powershell, and how data reaches it                                 */
/* ------------------------------------------------------------------ */

/**
 * NOTHING FROM OUTSIDE IS EVER WRITTEN INTO THE SCRIPT TEXT.
 *
 * This is the same rule the mac side keeps by handing osascript an argv list,
 * and there is no argv to hand a powershell script either, so it is kept a
 * different way: the script is a constant, and every value it works on
 * arrives through the environment or through a file whose path arrives
 * through the environment. A folder called `'; rm -r C:\` is then just a
 * folder with a strange name, because the script was already compiled before
 * the value existed.
 *
 * `-File` AND NOT `-Command -`, AND THIS IS NOT A PREFERENCE.
 *
 * Every script in this module is a multi line block, and a multi line block
 * fed to `-Command -` down a pipe is thrown away without being run. Reading
 * commands from a pipe, powershell 5.1 submits one line at a time as though
 * somebody were typing them: a line ending in an open brace is an unfinished
 * statement, a console would prompt for the rest, and a pipe cannot be
 * prompted. The run then ends at exit 0 with an empty stdout and an empty
 * stderr. Measured on windows 11: `foreach ($i in 1..2) { Write-Output $i }`
 * on one line prints two numbers, and the same loop spread across three
 * lines prints nothing at all and reports success.
 *
 * That is why none of this module had ever worked. The trash, the folder
 * chooser, the shortcut export and the search each handed their script to a
 * pipe that dropped it on the floor, and every one of them came back looking
 * like it had succeeded. A file on disk has none of that: it is parsed whole,
 * it runs, and `exit` sets the process exit code.
 *
 * `powershell.exe` and not `pwsh`, because 5.1 ships with windows and 7 is
 * something a person had to go and install.
 */
async function ps(script, env = {}, timeout = 0, interactive = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-ps-"));
  const file = path.join(dir, "run.ps1");
  try {
    /* the same BOM as the list file, and for the same reason: 5.1 reads a
       .ps1 without one as the ANSI code page. */
    await writeFile(file, "\uFEFF" + guarded(script), "utf8");
    return await new Promise((ok, no) => {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          /* Left off the one call that puts a window up. It is meant to stop a
             cmdlet blocking on a prompt nobody can see, and a winforms dialog
             is not that, but it is not worth finding out the hard way on the
             one call whose whole job is to be interactive. */
          ...(interactive ? [] : ["-NonInteractive"]),
          "-ExecutionPolicy", "Bypass",
          /* winforms will not run on a multithreaded apartment, and it costs
             nothing on the calls that never open a window. */
          "-STA",
          "-File", file,
        ],
        { env: { ...process.env, ...env }, maxBuffer: 8 << 20, windowsHide: true, timeout },
        (err, stdout, stderr) => {
          if (err) return no(new Error(String(stderr || err.message).trim().split("\n")[0] || "powershell failed"));
          ok(String(stdout));
        },
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A FAILED SCRIPT HAS TO COME BACK AS A FAILURE, AND IT DOES NOT BY DEFAULT.
 *
 * Running from a file fixed what never ran; it does not on its own make a
 * failure loud. An error inside the script can still end the run at exit 0
 * with an empty stderr, and `execFile` reads that as success, so a delete
 * that happened and a delete that did not would arrive here as the same
 * event. That is the shape of every bug in this file's history.
 *
 * So the script is wrapped rather than trusted. Anything reaching the catch
 * writes one line to stderr and exits 1, which is what `ps` already reads,
 * and the last line makes the success case stated rather than inherited.
 */
const guarded = (script) => `try {
${script}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
exit 0
`;

/**
 * A list too long to be an environment variable, handed over as a file.
 *
 * Windows caps the whole environment block at around 32KB, and a tray of two
 * hundred frames on a deep path is comfortably inside a quarter of that but
 * not reliably so. A file has no ceiling and the same injection safety, since
 * the script reads it rather than being built from it.
 *
 * UTF-8 with a BOM, because ReadAllLines on 5.1 assumes the ANSI code page
 * for a file without one, and a photographer's folder names are exactly where
 * that goes wrong.
 */
async function withList(lines, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "keeper-"));
  const file = path.join(dir, "list.txt");
  try {
    await writeFile(file, "\uFEFF" + lines.join("\n"), "utf8");
    return await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* the file manager                                                    */
/* ------------------------------------------------------------------ */

const CHOOSE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'choose the folder keeper should read'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
else { Write-Output '<cancelled>' }
`;

/**
 * The request stays open for as long as the dialog is up. That is not a hang:
 * the browser has nothing to do until a folder is picked, and the dialog is
 * the answer it is waiting on.
 */
export async function chooseFolder() {
  try {
    const out = (await ps(CHOOSE, {}, 0, true)).trim();
    if (!out || out === "<cancelled>") return { cancelled: true };
    return { path: out.replace(/\\+$/, "") };
  } catch (e) {
    return { error: e.message.toLowerCase() };
  }
}

/**
 * `/select,` with no space after the comma and the path quoted, which is the
 * one spelling explorer accepts and the reason for the verbatim flag.
 *
 * Node quotes an argument containing spaces by wrapping the whole token, so
 * the ordinary path produces `"/select,C:\a b\c.jpg"` with the switch inside
 * the quotes, and explorer answers that by opening the documents folder.
 * windowsVerbatimArguments hands the command line over exactly as written
 * instead, which is safe here for a reason worth stating: a windows filename
 * cannot contain a double quote, so nothing in a path can end the quoting.
 *
 * Explorer exits 1 on success as often as not, so the result is not read.
 * This either put a window up or it did not, and there is nothing useful to
 * say about the difference.
 */
export function reveal(file) {
  execFile("explorer.exe", [`/select,"${file}"`],
    { windowsVerbatimArguments: true, windowsHide: true }, () => {});
}

export function openDir(dir) {
  execFile("explorer.exe", [`"${dir}"`],
    { windowsVerbatimArguments: true, windowsHide: true }, () => {});
}

/* ------------------------------------------------------------------ */
/* the recycle bin                                                     */
/* ------------------------------------------------------------------ */

/**
 * THE RECYCLE BIN, AND THAT IS THE WHOLE POINT.
 *
 * `Remove-Item` would be one line and it would be permanent. The VisualBasic
 * file system is the only thing in the box that performs the shell's own
 * delete, which is what writes the record that lets somebody right click in
 * the recycle bin and choose restore. Permanent is not a thing a culling tool
 * gets to do to somebody's negatives.
 *
 * `OnlyErrorDialogs` because it is the quiet one, and because it is the only
 * one there is. `UIOption` holds exactly `OnlyErrorDialogs` and `AllDialogs`.
 * `DoNotShowDialogs`, which reads like the right answer and was the one here
 * until this ran on a real windows machine, is not a member of that enum and
 * never has been. It cost nothing to write and it deleted nothing for the
 * whole life of the windows line: the argument would not bind, the run exited
 * 0 with an empty stderr, and the route above took that for a delete and
 * dropped the frames out of the index while every file sat where it was.
 *
 * The fear that put the wrong name there is real and is answered anyway. A
 * hidden non interactive process puts up neither dialog; the delete either
 * happens or it comes back, and it is checked below either way.
 */
const TRASH = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($p in [IO.File]::ReadAllLines($env:KEEPER_LIST)) {
  if ($p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
}
`;

/**
 * Gone from where it was is the only claim worth making, so it is the one
 * that gets tested. The shell delete is not reliably loud: a file another
 * program is holding open comes back with no exception and no error text and
 * is still on the drive afterwards. The caller reads a clean return as
 * licence to drop those frames from the index, which is the one mistake this
 * module must not let it make.
 */
export async function trash(paths) {
  await withList(paths, (list) => ps(TRASH, { KEEPER_LIST: list }));

  const left = [];
  for (const p of paths) {
    try {
      await access(p, constants.F_OK);
      left.push(path.basename(p));
    } catch { /* not there any more, which is the whole point */ }
  }
  if (!left.length) return;

  const names = left.slice(0, 3).join(", ") + (left.length > 3 ? ", and more" : "");
  throw new Error(`${left.length} of ${paths.length} did not reach the recycle bin and are still on the drive: ${names}`);
}

/* ------------------------------------------------------------------ */
/* shortcuts                                                           */
/* ------------------------------------------------------------------ */

/**
 * One powershell for the whole tray, for the same reason the mac side runs
 * one osascript: two hundred processes each paying their own startup is a
 * tray that takes a minute to export nothing.
 *
 * The list is two lines per shortcut, the target then the name, because a
 * pair of parallel lists would go wrong the first time one of them had a
 * blank in it.
 *
 * A shortcut that will not save, a target gone from the disk since the index
 * was built, is a skip and not a reason to abandon the other hundred and
 * ninety nine, so the failures come back as indexes and the caller reports
 * them as skipped.
 */
const LINK = `
$ErrorActionPreference = 'Stop'
$rows = [IO.File]::ReadAllLines($env:KEEPER_LIST)
$sh = New-Object -ComObject WScript.Shell
$bad = @()
for ($i = 0; $i -lt $rows.Count - 1; $i += 2) {
  try {
    $lnk = $sh.CreateShortcut((Join-Path $env:KEEPER_DEST $rows[$i + 1]))
    $lnk.TargetPath = $rows[$i]
    $lnk.Save()
  } catch { $bad += [string]($i / 2) }
}
Write-Output ($bad -join ',')
`;

export async function links(jobs, dest) {
  const rows = jobs.flatMap((j) => [j.src, j.name]);
  const out = await withList(rows, (list) =>
    ps(LINK, { KEEPER_LIST: list, KEEPER_DEST: dest }));
  return new Set((out.match(/\d+/g) ?? []).map(Number));
}

/**
 * What a shortcut has to be called. Windows only treats a file as one if it
 * ends .lnk, and explorer hides that suffix, so a tray exported as shortcuts
 * still reads as a folder of photograph names.
 */
export const linkName = (base) => `${base}.lnk`;

/* ------------------------------------------------------------------ */
/* the search index                                                    */
/* ------------------------------------------------------------------ */

/**
 * Windows Search, which is the same idea as spotlight and is reached through
 * the same query language everything else on the machine uses.
 *
 * The term is doubled rather than escaped, which is how a literal quote is
 * written in this dialect, and it happens inside powershell against a value
 * that arrived through the environment, so the query is assembled where the
 * value cannot become syntax.
 *
 * Zero results is an ordinary answer here, more ordinary than on a mac: the
 * index covers the user's own folders by default and an external drive is
 * usually not in it at all. That is what the folder chooser is for.
 */
const SEARCH = `
$ErrorActionPreference = 'Stop'
$term = $env:KEEPER_TERM.Replace("'", "''")
$q = "SELECT System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileName = '" + $term + "'"
if ($env:KEEPER_KIND -eq 'folder') { $q = $q + " AND System.Kind = 'folder'" }
$c = New-Object -ComObject ADODB.Connection
$c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
$rs = $c.Execute($q)
while (-not $rs.EOF) {
  $v = $rs.Fields.Item(0).Value
  if ($v) { Write-Output $v }
  $rs.MoveNext()
}
$rs.Close()
$c.Close()
`;

export async function search(term, kind) {
  try {
    const out = await ps(SEARCH, { KEEPER_TERM: String(term), KEEPER_KIND: kind }, 10_000);
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    // the index switched off, the drive not in it, or the service stopped.
    // all three are ordinary and all three have the same answer.
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* raw                                                                 */
/* ------------------------------------------------------------------ */

const run = (cmd, args, opts = {}) =>
  new Promise((ok, no) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) =>
      err ? no(new Error(String(stderr || err.message).trim().split("\n").filter(Boolean).pop() ?? `${cmd} failed`)) : ok(String(stdout)));
  });

/**
 * WINDOWS SHIPS NO RAW DECODER, AND THIS IS THE HONEST VERSION OF THAT.
 *
 * macOS decodes every one of these itself through Image I/O and sips is the
 * front door to it, so the mac side has nothing to install and nothing to
 * check. Here there is no such door. ffmpeg is already an optional dependency
 * for film, most people culling video have it, and it reads dng, heic and the
 * duller half of this list outright.
 *
 * It does not read every camera raw. A cr3 or an arw may come back as the
 * embedded preview or not at all, depending on the build. That is a real gap
 * rather than a bug, so a frame it cannot open is reported unreadable by name
 * and the rest of the archive carries on, which is exactly what happens to a
 * clip when ffmpeg is missing.
 */
let decoder = null;

export async function canDecode() {
  if (decoder !== null) return decoder;
  try {
    await run("ffprobe", ["-version"]);
    decoder = true;
  } catch {
    decoder = false;
  }
  return decoder;
}

export const decodeHint =
  "windows has no raw decoder of its own. install ffmpeg and put it on the path, and keeper will read what it can.";

/** the source's own pixels, before any orientation tag is applied */
export async function measure(src) {
  try {
    const out = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      src,
    ]);
    const st = JSON.parse(out).streams?.[0];
    return st?.width && st?.height ? { w: st.width, h: st.height } : null;
  } catch {
    return null;
  }
}

/**
 * The scale is written as two expressions rather than as a fit box, because
 * `force_original_aspect_ratio=decrease` still enlarges a source smaller than
 * the box and this must never enlarge anything. A 1600px flatbed scan blown
 * up to 3072 is six times the pixels, every one of them invented, and the
 * index would then report a resolution the file has never had.
 *
 * -2 keeps the aspect and rounds to an even number, which the jpeg encoder
 * wants for its chroma planes.
 */
export async function decode(src, out, longEdge, quality, timeoutMs) {
  const L = String(longEdge);
  const scale =
    `scale='if(gt(iw,ih),min(iw,${L}),-2)':'if(gt(iw,ih),-2,min(ih,${L}))'`;

  /* sips takes 0 to 100 and rising is better. mjpeg takes 2 to 31 and rising
     is worse, so the one number in the codebase stays the sips one and is
     turned around here rather than every caller learning two scales. */
  const q = Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29)));

  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-y",
    "-i", src,
    "-vf", scale,
    "-qscale:v", String(q),
    "-frames:v", "1",
    out,
  ], { timeout: timeoutMs, maxBuffer: 1 << 20 });
}
