/* ---------------------------------------------------------------------
   where the two icons sit in the disk image window.

     node packaging/macos/layout.mjs

   Run by hand on a mac when the window design changes. It is not part of the
   build and must not become part of it.

   A window layout is a `.DS_Store`, and the only thing that writes one is
   the finder. Asking the finder means apple events, which means a machine
   with a logged in desktop and a permission somebody granted by hand, and a
   release runner has neither reliably. So the layout is made here once, on a
   real mac, and committed. Every build after that copies the file in and
   never talks to the finder at all.

   The app is a placeholder here. The finder records a position against a
   name, not against the thing, so an empty folder called keeper.app
   positions the real one exactly the same way and this script does not have
   to build a whole app to move an icon.
   --------------------------------------------------------------------- */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "out");

/* the same numbers the artwork was drawn against. change one and the arrow
   stops pointing at anything. */
const W = 720;
const H = 440;
const ICON = 128;
const LEFT = { x: 200, y: 208 };
const RIGHT = { x: 520, y: 208 };

const script = `
tell application "Finder"
  tell disk "keeper"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {240, 140, ${240 + W}, ${140 + H}}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to ${ICON}
    set text size of opts to 12
    set label position of opts to bottom
    set background picture of opts to file ".background:dmg-background.png"
    set position of item "keeper.app" of container window to {${LEFT.x}, ${LEFT.y}}
    set position of item "Applications" of container window to {${RIGHT.x}, ${RIGHT.y}}
    close
    open
    update without registering applications
    delay 3
    close
  end tell
end tell
`;

async function main() {
  await mkdir(OUT, { recursive: true });
  const work = await mkdtemp(path.join(os.tmpdir(), "keeper-layout-"));
  const stage = path.join(work, "stage");
  await mkdir(path.join(stage, ".background"), { recursive: true });

  /* a stand in, because a name is all the finder records */
  await mkdir(path.join(stage, "keeper.app"), { recursive: true });
  await run("ln", ["-s", "/Applications", path.join(stage, "Applications")]);
  await cp(path.join(HERE, "dmg-background.png"), path.join(stage, ".background", "dmg-background.png"));

  const dmg = path.join(work, "layout.dmg");
  await run("hdiutil", ["create", "-volname", "keeper", "-srcfolder", stage,
    "-ov", "-format", "UDRW", "-quiet", dmg]);
  await run("hdiutil", ["detach", "/Volumes/keeper", "-quiet"]).catch(() => {});
  /* browsable on purpose. the finder cannot arrange a window it was told not
     to open. */
  await run("hdiutil", ["attach", dmg, "-quiet"]);

  console.log("  asking the finder to arrange it");
  await run("osascript", ["-e", script]);

  await cp("/Volumes/keeper/.DS_Store", path.join(HERE, "dmg.DS_Store"));
  await run("hdiutil", ["detach", "/Volumes/keeper", "-quiet"]);
  await rm(work, { recursive: true, force: true });

  console.log(`\n  ${path.relative(process.cwd(), path.join(HERE, "dmg.DS_Store"))}`);
  console.log(`  ${W} by ${H}, icons at ${LEFT.x},${LEFT.y} and ${RIGHT.x},${RIGHT.y}\n`);
  console.log("  commit it. the build copies it and never asks the finder anything.\n");
}

main().catch((e) => { console.error(`\n  ! ${e.message}\n`); process.exit(1); });
