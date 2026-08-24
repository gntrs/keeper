/* ---------------------------------------------------------------------
   what an already installed keeper downloads when it updates itself.

     node packaging/payload.mjs

   Two files. A tar of bin, src, web and package.json, which is the whole of
   keeper and about a megabyte, and a latest.json describing it. Both are
   attached to the release, and latest.json is the file a running keeper
   fetches to find out whether there is anything worth fetching.

   THE RUNTIME IS NOT IN HERE AND THAT IS THE POINT. Node and node_modules
   are the heavy, compiled, platform specific half and they almost never
   change. Leaving them alone makes an update a one megabyte download instead
   of a fifty megabyte one, and it means nothing ever tries to overwrite the
   node.exe it is currently running out of.
   --------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { depsFingerprint } from "../src/update.mjs";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(HERE, "out");

const REPO = "https://github.com/gntrs/keeper";

async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  await mkdir(OUT, { recursive: true });

  const name = `keeper-app-${pkg.version}.tar.gz`;
  const tar = path.join(OUT, name);
  await rm(tar, { force: true });

  await run("tar", [
    "-czf", tar,
    "--exclude", ".DS_Store",
    "-C", ROOT,
    "bin", "src", "web", "package.json",
  ], {
    /* macos tar writes a ._ file per entry to carry extended attributes, and
       they land in the extracted tree as junk next to every real file. this
       is off by default everywhere else and has to be said here. */
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });

  const bytes = await readFile(tar);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const latest = {
    version: pkg.version,
    app: name,
    sha256,
    /* The same fingerprint the installed copy computes about itself. When
       they differ, the swap cannot work and keeper says so instead of
       installing code whose dependencies are not on the machine. */
    deps: await depsFingerprint(path.join(ROOT, "package.json")),
    notes: `${REPO}/releases/tag/v${pkg.version}`,
  };

  await writeFile(path.join(OUT, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  await writeFile(`${tar}.sha256`, `${sha256}  ${name}\n`);

  console.log(`\n  ${path.relative(process.cwd(), tar)}`);
  console.log(`  ${(bytes.length / 1e6).toFixed(2)} mb`);
  console.log(`  sha256 ${sha256}`);
  console.log(`\n  latest.json`);
  console.log(`  ${JSON.stringify(latest)}\n`);
}

main().catch((e) => { console.error(`\n  ! ${e.message}\n`); process.exit(1); });
