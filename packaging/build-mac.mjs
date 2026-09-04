/* ---------------------------------------------------------------------
   keeper.app, and a dmg to put it in.

     node packaging/build-mac.mjs            for this machine
     node packaging/build-mac.mjs --arch x64 for an intel mac

   Run it on a mac. It needs the network once, to fetch the node it bundles,
   and after that everything is local.

   THE APP IS NOT SIGNED BY ANYONE. It is signed ad hoc, which is a different
   thing: apple silicon refuses to run a binary carrying no signature at all,
   so an ad hoc signature is the minimum that makes the file executable, and
   it identifies nobody. A dmg downloaded from the internet is quarantined
   and gatekeeper will refuse it on the first open until the person allows it
   by hand in system settings. That is the honest cost of not paying apple,
   it is written in the readme rather than hidden, and the day a developer id
   exists this script grows one flag.
   --------------------------------------------------------------------- */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(HERE, "out");
const CACHE = path.join(HERE, "cache");

/* Pinned, not "latest". A build that quietly changes its own runtime between
   two runs is a build that cannot be asked what it shipped. */
const NODE = "v24.19.0";

/* Everything the app is, and nothing else. Named one by one rather than
   copying the folder and deleting: a list that has to be added to when a
   directory appears is safer than a list that has to be added to when a
   private one does. */
const SHIP = ["bin", "src", "web", "package.json", "package-lock.json", "LICENSE", "NOTICE", "keeper.config.example.json"];

const say = (s) => console.log(s);

/**
 * The official tarball, with its checksum checked against the one nodejs.org
 * publishes beside it. Two downloads instead of one, and the second is the
 * only reason the first can be trusted: this binary is about to be given to
 * somebody else with keeper's name on it.
 */
async function node(arch) {
  const name = `node-${NODE}-darwin-${arch}`;
  const kept = path.join(CACHE, name, "bin", "node");
  if (existsSync(kept)) return kept;

  await mkdir(CACHE, { recursive: true });
  const tar = `${name}.tar.gz`;
  const base = `https://nodejs.org/dist/${NODE}`;

  say(`  fetching ${tar}`);
  const bytes = Buffer.from(await (await fetch(`${base}/${tar}`)).arrayBuffer());

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums.split("\n").find((l) => l.trim().endsWith(tar))?.split(/\s+/)[0];
  const got = createHash("sha256").update(bytes).digest("hex");
  if (!want) throw new Error(`no published checksum for ${tar}`);
  if (want !== got) throw new Error(`checksum mismatch on ${tar}\n    published ${want}\n    downloaded ${got}`);
  say(`  checksum ok`);

  const file = path.join(CACHE, tar);
  await writeFile(file, bytes);
  await run("tar", ["-xzf", file, "-C", CACHE]);
  await rm(file, { force: true });
  return kept;
}

async function main() {
  const arch = process.argv.includes("--arch")
    ? process.argv[process.argv.indexOf("--arch") + 1]
    : (os.arch() === "x64" ? "x64" : "arm64");
  if (!["arm64", "x64"].includes(arch)) throw new Error(`arch is arm64 or x64, not ${arch}`);

  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  say(`\n  keeper ${pkg.version}, darwin ${arch}\n`);

  await run("node", [path.join(HERE, "icons.mjs")]);

  const bin = await node(arch);

  const stage = await mkdtemp(path.join(os.tmpdir(), "keeper-dmg-"));
  const app = path.join(stage, "keeper.app");
  const res = path.join(app, "Contents", "Resources");
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(res, "app"), { recursive: true });

  /* --- the bundle ----------------------------------------------------- */
  const plist = (await readFile(path.join(HERE, "macos", "Info.plist"), "utf8"))
    .replaceAll("__VERSION__", pkg.version);
  await writeFile(path.join(app, "Contents", "Info.plist"), plist);

  await cp(path.join(HERE, "macos", "launcher.sh"), path.join(app, "Contents", "MacOS", "keeper"));
  await chmod(path.join(app, "Contents", "MacOS", "keeper"), 0o755);

  await cp(path.join(OUT, "keeper.icns"), path.join(res, "keeper.icns"));
  await cp(bin, path.join(res, "node"));
  await chmod(path.join(res, "node"), 0o755);

  for (const f of SHIP) {
    const from = path.join(ROOT, f);
    if (!existsSync(from)) { say(`  ! ${f} is missing and was not bundled`); continue; }
    await cp(from, path.join(res, "app", f), { recursive: true });
  }

  /* --- what it needs to run ------------------------------------------- */
  /* Installed into the bundle rather than copied out of the working tree,
     because the working tree holds this machine's binaries and this build may
     be for the other kind of mac. sharp ships one compiled library per
     platform and copying the wrong one produces an app that opens, serves a
     page, and cannot make a single thumbnail. */
  say(`  installing dependencies for darwin ${arch}`);
  await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", `--os=darwin`, `--cpu=${arch}`], {
    cwd: path.join(res, "app"),
  });

  /* --- the minimum that will execute at all ---------------------------- */
  say("  signing ad hoc");
  await run("codesign", ["--force", "--deep", "--sign", "-", app]);

  /* --- the same app, in a tarball -------------------------------------- */
  /**
   * THE ONE MAC INSTALL THAT NEVER MEETS GATEKEEPER, and it is here because
   * of an apple account nobody has paid for.
   *
   * A disk image downloaded by a browser is quarantined: safari and chrome
   * write `com.apple.quarantine` onto the file, macos carries it into
   * whatever comes out of the image, and the first open of an app that
   * carries it and is not notarised is refused. There is a way through, it
   * is written out in the readme, and it is four steps deep in system
   * settings and past a sentence that says the developer cannot be verified,
   * which for most people is where trying keeper ends.
   *
   * `curl` writes no quarantine attribute. Nothing else about the app
   * changes, the same ad hoc signature, the same bytes: it is only that a
   * file fetched by a program the person ran themselves is treated as
   * something they chose rather than something the web handed them. So the
   * app also ships as a plain tarball with two lines in the readme to unpack
   * it, and those two lines are the install that works today.
   *
   * THE NAME CARRIES NO VERSION, and that is deliberate. Those two lines are
   * meant to be copied out of a release note or a message and to keep
   * working next month, which they only do if the address resolves through
   * `releases/latest/download` to whatever is newest. The version is inside,
   * in package.json, and keeper prints it in the corner of its own window.
   *
   * COPYFILE_DISABLE, because bsdtar on a mac otherwise writes a second
   * `._name` entry beside every file to carry extended attributes that this
   * bundle does not have and does not need. It doubles the file count and
   * puts a folder of dot files in front of anyone who unpacks it by hand.
   */
  const tgz = path.join(OUT, `keeper-macos-${arch}.tar.gz`);
  await rm(tgz, { force: true });
  await run("tar", ["-czf", tgz, "-C", stage, "keeper.app"], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const tsum = createHash("sha256").update(await readFile(tgz)).digest("hex");
  await writeFile(`${tgz}.sha256`, `${tsum}  ${path.basename(tgz)}\n`);

  /* --- the disk image -------------------------------------------------- */
  /* The window has a picture behind it and its icons in known places, and
     none of that is arranged here. A layout is a .DS_Store, the only thing
     that writes one is the finder, and asking the finder means apple events
     on a machine with a desktop and a permission somebody granted by hand.
     A build that needs that fails on a release runner for a reason nobody
     would guess. So it was made once by packaging/macos/layout.mjs, it is
     committed, and this copies it in. */
  await run("ln", ["-s", "/Applications", path.join(stage, "Applications")]);
  await mkdir(path.join(stage, ".background"), { recursive: true });
  await cp(path.join(HERE, "macos", "dmg-background.png"), path.join(stage, ".background", "dmg-background.png"));
  await cp(path.join(HERE, "macos", "dmg.DS_Store"), path.join(stage, ".DS_Store"));
  /* Visible, because a notice about what a program does with your
     photographs is worth nothing if reading it requires knowing the shortcut
     that shows hidden files. The windows build has shipped a readable "read
     me first.txt" at the top of its folder since it existed and the mac
     shipped a dot file, so the two platforms disagreed about whether anybody
     was meant to read this. */
  await cp(path.join(HERE, "macos", "privacy.txt"), path.join(stage, "privacy.txt"));

  const dmg = path.join(OUT, `keeper-${pkg.version}-macos-${arch}.dmg`);
  await rm(dmg, { force: true });

  /* Built writable, branded, then compressed. The volume icon is a file at
     the root plus one attribute on the volume itself, and an attribute
     cannot be set on a read only image, so the compressed one everybody
     downloads has to be converted from a writable one rather than made
     directly. It is two extra commands and it is the difference between a
     window with keeper's mark on it and a window with a blank disk. */
  const raw = path.join(OUT, "keeper-writable.dmg");
  const mnt = path.join(stage, "..", "mnt");
  await rm(raw, { force: true });
  await mkdir(mnt, { recursive: true });
  await run("hdiutil", [
    "create", "-volname", "keeper", "-srcfolder", stage, "-ov", "-format", "UDRW", "-quiet", raw,
  ]);
  await run("hdiutil", ["attach", raw, "-nobrowse", "-quiet", "-mountpoint", mnt]);
  await cp(path.join(OUT, "keeper.icns"), path.join(mnt, ".VolumeIcon.icns"));
  await run("SetFile", ["-a", "C", mnt]);
  await run("hdiutil", ["detach", mnt, "-quiet"]);
  await run("hdiutil", ["convert", raw, "-format", "UDZO", "-o", dmg, "-ov", "-quiet"]);
  await rm(raw, { force: true });

  const sum = createHash("sha256").update(await readFile(dmg)).digest("hex");
  await writeFile(`${dmg}.sha256`, `${sum}  ${path.basename(dmg)}\n`);

  const size = (await readFile(dmg)).length;
  await rm(stage, { recursive: true, force: true });

  say(`\n  ${path.relative(process.cwd(), tgz)}`);
  say(`  sha256 ${tsum}`);
  say(`\n  ${path.relative(process.cwd(), dmg)}`);
  say(`  ${(size / 1e6).toFixed(1)} mb`);
  say(`  sha256 ${sum}\n`);
}

main().catch((e) => { console.error(`\n  ! ${e.message}\n`); process.exit(1); });
