/* ---------------------------------------------------------------------
   one drawing, every size both platforms ask for.

   Run from the repo root: `node packaging/icons.mjs`. It writes into
   packaging/out, which is not committed, because a png rendered from an svg
   that is committed is a build artifact and a repo that keeps both has two
   sources of truth for the same square.

   The ico is written by hand. It is a nine line container around png files,
   and every library that does it is a dependency taken on for nine lines.
   --------------------------------------------------------------------- */

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

/* the sizes an .iconset must hold, by the names iconutil insists on */
const MAC = [16, 32, 64, 128, 256, 512, 1024];

/* what windows explorer actually reaches for. 256 is the one the file
   properties dialog and the large icon view use, 16 is the taskbar, and the
   ones between are what the shell picks at odd display scales. Leaving them
   out does not fail: windows scales the nearest one and the result is a
   smeared square at exactly the size most people see. */
const WIN = [16, 24, 32, 48, 64, 128, 256];

const png = (svg, size) => sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/**
 * An ico is a six byte header, a sixteen byte row per image, and then the
 * images. Since Vista each image may be a png rather than a bitmap, which is
 * what makes this short: the encoding work is sharp's and this only has to
 * say where each one starts.
 */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);          // reserved
  head.writeUInt16LE(1, 2);          // 1 is an icon, 2 would be a cursor
  head.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let at = head.length + dir.length;

  images.forEach(({ size, data }, i) => {
    const row = i * 16;
    /* 256 does not fit in a byte and is written as zero, which the format
       defines as meaning 256. A literal 256 here silently becomes a zero by
       zero icon that windows skips. */
    dir.writeUInt8(size === 256 ? 0 : size, row);
    dir.writeUInt8(size === 256 ? 0 : size, row + 1);
    dir.writeUInt8(0, row + 2);      // palette size, none, it is truecolour
    dir.writeUInt8(0, row + 3);      // reserved
    dir.writeUInt16LE(1, row + 4);   // colour planes
    dir.writeUInt16LE(32, row + 6);  // bits per pixel
    dir.writeUInt32LE(data.length, row + 8);
    dir.writeUInt32LE(at, row + 12);
    at += data.length;
  });

  return Buffer.concat([head, dir, ...images.map((i) => i.data)]);
}

async function main() {
  /* Only what this script owns. Clearing the whole out folder was the
     obvious line and it was wrong: the mac build calls this first, so
     building for the mac quietly deleted the windows zip sitting beside it,
     and the only sign was a release with half of it missing. */
  await mkdir(OUT, { recursive: true });
  await rm(path.join(OUT, "keeper.iconset"), { recursive: true, force: true });

  const mac = path.join(HERE, "keeper.svg");
  const win = path.join(HERE, "keeper-win.svg");
  const macSvg = await readFile(mac);
  const winSvg = await readFile(win);

  /* --- macos ---------------------------------------------------------- */
  const set = path.join(OUT, "keeper.iconset");
  await mkdir(set, { recursive: true });
  for (const size of MAC) {
    const buf = await png(macSvg, size);
    await writeFile(path.join(set, `icon_${size}x${size}.png`), buf);
    /* the retina name for the size below it, which is the same file. an
       iconset missing its @2x entries builds, and then looks soft on every
       display made in the last decade. */
    if (MAC.includes(size / 2)) await writeFile(path.join(set, `icon_${size / 2}x${size / 2}@2x.png`), buf);
  }
  await run("iconutil", ["-c", "icns", set, "-o", path.join(OUT, "keeper.icns")]);

  /* --- windows -------------------------------------------------------- */
  const images = [];
  for (const size of WIN) images.push({ size, data: await png(winSvg, size) });
  await writeFile(path.join(OUT, "keeper.ico"), ico(images));

  /* --- the installer's own artwork ------------------------------------ */
  /* inno wants bitmaps at fixed sizes and will not scale an oversized one
     gracefully, so they are rendered rather than cropped later. */
  await writeFile(path.join(OUT, "keeper-512.png"), await png(macSvg, 512));

  console.log(`  wrote ${path.relative(process.cwd(), OUT)}`);
  console.log("    keeper.icns   macos app bundle");
  console.log("    keeper.ico    windows exe and shortcuts");
  console.log("    keeper-512.png");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
