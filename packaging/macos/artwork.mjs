/* ---------------------------------------------------------------------
   the picture behind the disk image window.

     node packaging/macos/artwork.mjs

   Run by hand when the drawing changes, not by the build. It needs a
   chromium to render the real typeface, and the release runner has none, so
   what it writes is committed as art and the build only copies it in.

   THE ICONS ARE NOT IN THIS PICTURE. Finder draws those, from the real files
   on the volume, at the positions the layout script puts them. Everything
   here has to stay out of their way, which is what the two clear rectangles
   below are about: draw into them and you get an arrow with an app icon
   sitting on top of it.
   --------------------------------------------------------------------- */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..", "..", "web", "font");

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

/* points, which is what finder measures a window in. the png is rendered at
   twice this and carries the density to say so, so it is sharp on a retina
   display and the right size on both. */
const W = 720;
const H = 440;

const b64 = async (f) => (await readFile(path.join(WEB, f))).toString("base64");

/* Where finder puts the icons, and how big. The artwork must not draw into
   either box or into the name underneath it, and there is no way to see that
   from the png alone, because the icons are not in the png. `--preview`
   draws them so a collision is visible here rather than after a build, a
   mount and a look. What it writes is never shipped. */
const ICON = 128;
const SLOTS = [{ x: 200, y: 208 }, { x: 520, y: 208 }];

const ghosts = SLOTS.map(({ x, y }) => `
  <div style="position:absolute;left:${x - ICON / 2}px;top:${y - ICON / 2}px;
              width:${ICON}px;height:${ICON}px;border-radius:14px;
              background:#ffffff1a;outline:1px dashed #e1062c66"></div>
  <div style="position:absolute;left:${x - 60}px;top:${y + ICON / 2 + 4}px;
              width:120px;height:16px;background:#ffffff12;
              outline:1px dashed #e1062c33"></div>`).join("");

async function page(preview = false) {
  const sans = await b64("geist-latin.woff2");
  const mono = await b64("geist-mono-latin.woff2");
  return `<!doctype html><meta charset="utf-8"><style>
/* the same range the app declares. it was clamped at 500 here, so asking
   for a real bold got a faux one, which on a variable face is a synthetic
   smear rather than the weight the designer drew. */
@font-face { font-family: Geist; font-weight: 300 700;
  src: url(data:font/woff2;base64,${sans}) format("woff2"); }
@font-face { font-family: "Geist Mono"; font-weight: 300 700;
  src: url(data:font/woff2;base64,${mono}) format("woff2"); }

* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; }
body {
  /* Not flat. A window of dead black with things floating on it is the look
     of nobody having decided anything, and the lift is small enough that
     nobody will name it and large enough that the middle has a centre. */
  background:
    radial-gradient(120% 85% at 50% 34%, #17171b 0%, #0e0e10 46%, #0b0b0c 100%);
  color: #ededee;
  font: 400 15px/1.5 Geist, system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}
.edge { position: absolute; inset: 10px; border: 1px solid #ffffff12; border-radius: 5px; }

/* THE WORDMARK GOES IN A CORNER. Centred, it was a poster, and the window is
   not a poster: it is a place where two objects sit and one of them has to be
   moved. A corner mark says whose window it is and gets out of the way. */
.mark { position: absolute; left: 34px; top: 30px; display: flex; align-items: center; gap: 8px; }
.mark i { width: 14px; height: 14px; border-radius: 2.1px; background: #e1062c; display: block; }
.mark b { font: 500 15px/1 Geist, system-ui, sans-serif; letter-spacing: -.01em; }

/* and the instruction goes in the opposite corner, so the two anchor the top
   between them instead of one sitting alone in the middle of it.
   
   It was small caps in the mono at 43 percent grey, which is how this app
   sets a label, and a label is the wrong thing for it to be. It is the one
   instruction in the window. So it is the wordmark's own face at the
   wordmark's own size in the wordmark's own white, one weight heavier,
   because a thing worth saying once should be said out loud. */
.say {
  position: absolute; right: 34px; top: 30px;
  font: 600 15px/1 Geist, system-ui, sans-serif;
  letter-spacing: -.01em; color: #ededee;
}

/* THE PLATES ARE GONE, and the icon is why.
   
   They were never decoration. Keeper's icon was near black on a near black
   window next to a bright blue system folder, and it vanished, so both got a
   raised plate to stand on. The icon is the mark itself now, in the accent,
   and it holds its own ground. A plate under it would be scaffolding left
   standing after the building went up. */

.aside {
  position: absolute; left: 0; right: 0; bottom: 42px; text-align: center;
  font: 400 12px/1.7 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .02em; color: #ededee;
}

/* ONE ARROW, STRAIGHT, IN THE GAP.

   It has been a thin lap round the window, a thick marker scribble with three
   curls, and a shallow hop, and every one of them was the loudest thing in a
   window whose entire job is two icons and a drag. A decoration that outranks
   the subject is not decoration, it is noise with good intentions.

   So it points from the one you have at the one you want, at a weight that
   supports the icons instead of competing with them, and there is nothing
   else in it. */
.arrow { position: absolute; inset: 0; }
</style>
<div class="edge"></div>



<svg class="arrow" viewBox="0 0 ${W} ${H}" fill="none">
  <g stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
    <path stroke-opacity=".3" d="M300,208 L416,208"/>
    <path stroke-opacity=".5" d="M408,199 L420,208 L408,217"/>
  </g>
</svg>

<div class="mark"><i></i><b>keeper</b></div>
<p class="say">drag it across</p>
<p class="aside">Heyo. you like privacy? we do too.<br>so that's why it's local and private.</p>
${preview ? ghosts : ""}
`;

}

async function main() {
  const preview = process.argv.includes("--preview");
  const html = path.join(HERE, "artwork.html");
  const shot = preview
    ? path.resolve(HERE, "..", "out", "dmg-preview.png")
    : path.join(HERE, "dmg-background.png");
  await mkdir(path.dirname(shot), { recursive: true });
  await writeFile(html, await page(preview));

  await run(BRAVE, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${W},${H}`,
    `--screenshot=${shot}`,
    "--virtual-time-budget=4000",
    `file://${html}`,
  ]);
  await rm(html, { force: true });

  /* Rendered at twice the size and told it is 144 dots per inch, which is how
     finder is told to draw it at ${W} by ${H} points rather than filling a
     window twice that wide with a picture at half the resolution. */
  const sharp = (await import("sharp")).default;
  const at2x = await readFile(shot);
  await sharp(at2x).withMetadata({ density: 144 }).toFile(`${shot}.tmp`);
  await run("mv", [`${shot}.tmp`, shot]);

  const meta = await sharp(shot).metadata();
  console.log(`\n  ${path.relative(process.cwd(), shot)}`);
  console.log(`  ${meta.width} by ${meta.height} pixels at ${meta.density} dpi, so ${W} by ${H} points`);
  if (preview) console.log("  the dashed boxes are finder's, not ours. nothing may touch them.");
  console.log("");
}

main().catch((e) => { console.error(`\n  ! ${e.message}\n`); process.exit(1); });
