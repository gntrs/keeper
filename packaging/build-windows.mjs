/* ---------------------------------------------------------------------
   the windows folder, and a zip of it.

     node packaging/build-windows.mjs

   Runs anywhere, including on the mac, because nothing here is compiled:
   the windows build of node is downloaded, the app is copied in, and npm is
   asked for the windows build of sharp rather than this machine's. That is
   the whole reason a cross build is possible at all.

   IT DOES NOT MAKE AN INSTALLER. An exe has to be compiled by inno setup on
   a real windows machine, and packaging/windows/keeper.iss is the script
   that does it, run by the release workflow. What comes out of here is the
   folder that installer would install: unzip it anywhere, double click, and
   it runs. For one person being handed a tool by a friend that is the whole
   product, and it needs no administrator and no uninstaller.
   --------------------------------------------------------------------- */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(HERE, "out");
const CACHE = path.join(HERE, "cache");

const NODE = "v24.19.0";

/**
 * npm, in the two different things it is on the two machines.
 *
 * On windows it is npm.cmd, a batch file, and node has refused to start one
 * of those without a shell since it was made to: running a .cmd through the
 * bare spawn was a command injection, so node closed it and the refusal
 * comes back as the least helpful error in the set, `spawn EINVAL`.
 *
 * So the shell goes on, for this one call, on that one platform. Every
 * argument below is a literal written in this file. Nothing a person typed
 * and nothing off a network reaches it, which is the condition that makes
 * turning a shell on fine here and would make it careless anywhere else.
 */
const NPM = process.platform === "win32"
  ? { cmd: "npm.cmd", shell: true }
  : { cmd: "npm", shell: false };
const SHIP = ["bin", "src", "web", "package.json", "package-lock.json", "keeper.config.example.json"];

const say = (s) => console.log(s);

/** the same fetch and the same checksum check as the mac build, on the zip */
async function node(arch) {
  const name = `node-${NODE}-win-${arch}`;
  const kept = path.join(CACHE, name, "node.exe");
  if (existsSync(kept)) return path.dirname(kept);

  await mkdir(CACHE, { recursive: true });
  const zip = `${name}.zip`;
  const base = `https://nodejs.org/dist/${NODE}`;

  say(`  fetching ${zip}`);
  const bytes = Buffer.from(await (await fetch(`${base}/${zip}`)).arrayBuffer());

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums.split("\n").find((l) => l.trim().endsWith(zip))?.split(/\s+/)[0];
  const got = createHash("sha256").update(bytes).digest("hex");
  if (!want) throw new Error(`no published checksum for ${zip}`);
  if (want !== got) throw new Error(`checksum mismatch on ${zip}\n    published ${want}\n    downloaded ${got}`);
  say("  checksum ok");

  const file = path.join(CACHE, zip);
  await writeFile(file, bytes);
  /* tar and not unzip, because this script has to run on windows too and
     windows has no unzip. it does have tar: bsdtar has shipped in the box
     since windows 10 and it reads a zip as readily as it reads a tar, which
     is the only reason one command can serve both machines here. */
  await run("tar", ["-xf", file, "-C", CACHE]);
  await rm(file, { force: true });
  return path.dirname(kept);
}

async function main() {
  const arch = process.argv.includes("--arch")
    ? process.argv[process.argv.indexOf("--arch") + 1]
    : "x64";
  if (!["x64", "arm64"].includes(arch)) throw new Error(`arch is x64 or arm64, not ${arch}`);

  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  say(`\n  keeper ${pkg.version}, windows ${arch}\n`);

  await run("node", [path.join(HERE, "icons.mjs")]);
  const runtime = await node(arch);

  /* Staged in the open rather than in a temp folder, and left behind, because
     the installer script is compiled from exactly this and inno has to be
     able to point at it. It also means a failed build can be looked at. */
  const stage = path.join(OUT, "stage");
  const folder = path.join(stage, "keeper");
  await rm(stage, { recursive: true, force: true });
  await mkdir(path.join(folder, "app"), { recursive: true });

  /* node ships a lot of things a bundled runtime never uses. only the exe
     and the two libraries beside it are copied, which is the difference
     between a 90 megabyte folder and a 30 megabyte one. */
  for (const f of ["node.exe"]) await cp(path.join(runtime, f), path.join(folder, "node", f));

  for (const f of SHIP) {
    const from = path.join(ROOT, f);
    if (!existsSync(from)) { say(`  ! ${f} is missing and was not bundled`); continue; }
    await cp(from, path.join(folder, "app", f), { recursive: true });
  }
  for (const f of ["LICENSE", "NOTICE"]) {
    await cp(path.join(ROOT, f), path.join(folder, f));
  }
  for (const f of ["keeper.cmd", "keeper.vbs", "doctor.cmd", "read me first.txt"]) {
    await cp(path.join(HERE, "windows", f), path.join(folder, f));
  }
  await cp(path.join(OUT, "keeper.ico"), path.join(folder, "keeper.ico"));

  say(`  installing dependencies for win32 ${arch}`);
  await run(NPM.cmd, ["install", "--omit=dev", "--no-audit", "--no-fund", "--os=win32", `--cpu=${arch}`], {
    cwd: path.join(folder, "app"),
    shell: NPM.shell,
  });

  /* Every text file windows will ever show in notepad gets crlf, because
     notepad is still what a photographer opens a txt with and lf alone
     turns the whole file into one line. The batch files matter more than
     that: a cmd file with lf endings can fail on a label or a for loop in
     ways that read as the file being corrupt. */
  for (const f of ["keeper.cmd", "keeper.vbs", "doctor.cmd", "read me first.txt"]) {
    const at = path.join(folder, f);
    const text = await readFile(at, "utf8");
    await writeFile(at, text.replace(/\r?\n/g, "\r\n"));
  }

  const zip = path.join(OUT, `keeper-${pkg.version}-windows-${arch}.zip`);
  await rm(zip, { force: true });
  /* and the same tar writing a zip, for the same reason: windows has no zip
     command either. `--format zip` is libarchive's, it deflates by default,
     and what comes out is an ordinary zip that windows explorer opens by
     double click with nothing installed. */
  await run("tar", ["-c", "-f", zip, "--format", "zip", "keeper"], { cwd: stage });

  const bytes = await readFile(zip);
  const sum = createHash("sha256").update(bytes).digest("hex");
  await writeFile(`${zip}.sha256`, `${sum}  ${path.basename(zip)}\n`);

  say(`\n  ${path.relative(process.cwd(), zip)}`);
  say(`  ${(bytes.length / 1e6).toFixed(1)} mb`);
  say(`  sha256 ${sum}`);
  say(`\n  the installer is compiled from ${path.relative(process.cwd(), folder)}`);
  say(`  iscc packaging\\windows\\keeper.iss /DAppVersion=${pkg.version} /DStage=<that folder>\n`);
}

main().catch((e) => { console.error(`\n  ! ${e.message}\n`); process.exit(1); });
