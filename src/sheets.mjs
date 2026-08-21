import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

/**
 * Contact sheets, sized for a machine to read rather than for a human to
 * print. This is the part of keepers that exists because tagging an archive
 * by hand does not scale and paying per frame for an API does not either:
 * you hand these to a coding agent, it reads them, it writes the tags back.
 *
 * THE ONE NUMBER EVERYTHING HERE TURNS ON. Vision models resize an image
 * down to roughly 1568px on its long edge before they look at it. A sheet
 * wider than that is not a more detailed sheet, it is the same sheet with
 * the extra pixels thrown away on arrival. So the sheet is built at the cap,
 * and the only real lever is how many cells you divide it into:
 *
 *     cols   cell width   what can be judged
 *     ----   ----------   ------------------------------------------
 *      8       192px      scene only: crowd, empty room, outdoors
 *      6       256px      posture and gesture. faces read as faces
 *      5       307px      expressions: laughing apart from talking
 *      4       384px      who a person is, if you know them
 *
 * Six is the default because it is the widest grid on which a smile is still
 * a smile, and every extra column is a cheaper run with worse tags. Drop to
 * four when the job is choosing between three good frames of one person.
 *
 * CELLS ARE LETTERBOXED, NEVER COVER CROPPED. A portrait frame squeezed into
 * a landscape cell by `cover` loses its top and bottom, which is exactly
 * where a face is, and the agent then confidently tags a photograph it has
 * only seen the middle third of. `contain` wastes some sheet area. Wasted
 * area is cheap and a wrong tag is not.
 */
export const VISION_LONG_EDGE = 1568;

export const GRID_ADVICE = [
  [8, "scene only: crowd, empty room, outdoors"],
  [6, "posture and gesture, faces read as faces"],
  [5, "expressions: laughing apart from talking"],
  [4, "who a person is, if you know them"],
];

export function cellWidth(cols, sheetWidth = VISION_LONG_EDGE) {
  return Math.floor(sheetWidth / cols);
}

/**
 * Builds every sheet and the index that addresses them. A cell is named
 * `r<row>c<col>`, 1 based, reading left to right and top to bottom, which is
 * the order a person reads and therefore the order an agent will report in.
 */
export async function buildSheets(root, items, outDir, {
  cols = 6,
  rows = 4,
  sheetWidth = VISION_LONG_EDGE,
  cellAspect = 3 / 2,
  onProgress,
} = {}) {
  await mkdir(outDir, { recursive: true });

  const cw = cellWidth(cols, sheetWidth);
  const ch = Math.round(cw / cellAspect);
  const perSheet = cols * rows;
  const sheets = Math.ceil(items.length / perSheet);
  const index = [];

  for (let s = 0; s < sheets; s++) {
    const slice = items.slice(s * perSheet, (s + 1) * perSheet);
    const tiles = [];

    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      const row = Math.floor(i / cols) + 1;
      const col = (i % cols) + 1;
      index.push({
        sheet: s + 1,
        cell: `r${row}c${col}`,
        id: item.id,
        path: item.path,
      });
      try {
        const buf = await sharp(path.join(root, item.path))
          .rotate()
          .resize(cw, ch, { fit: "contain", background: { r: 17, g: 17, b: 17 } })
          .toBuffer();
        tiles.push({ input: buf, left: (col - 1) * cw, top: (row - 1) * ch });
      } catch {
        /* an unreadable frame leaves its cell dark, and the index still
           names it, so the agent can tag it unusable rather than guess */
      }
    }

    const usedRows = Math.ceil(slice.length / cols);
    const file = path.join(outDir, `sheet-${String(s + 1).padStart(3, "0")}.jpg`);
    await sharp({
      create: {
        width: cw * cols,
        height: ch * usedRows,
        channels: 3,
        background: { r: 17, g: 17, b: 17 },
      },
    })
      .composite(tiles)
      .jpeg({ quality: 82 })
      .toFile(file);

    onProgress?.(s + 1, sheets);
  }

  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
  return { sheets, perSheet, cellWidth: cw, cellHeight: ch, index };
}
