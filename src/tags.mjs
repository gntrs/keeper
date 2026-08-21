/**
 * The tag vocabulary, and the two formats an agent may write it in.
 *
 * One letter per frame is not a stylistic choice. An archive of a few
 * thousand frames is a few thousand tags, and the difference between a
 * one letter code and a JSON object per frame is the difference between a
 * tagging pass that fits in one context window and one that does not.
 */
export const VOCAB = {
  P: ["portrait", "one person, aware of the camera"],
  L: ["laughing", "visible joy, mid laugh, a real face"],
  T: ["talking", "two to four people in conversation"],
  W: ["working", "heads down, laptops open"],
  S: ["presenting", "someone with the room, a mic or a screen"],
  A: ["audience", "seated, all facing one way"],
  C: ["crowd", "many people, unposed, mingling"],
  G: ["group shot", "everyone lined up for the camera"],
  V: ["celebrating", "arms up, a trophy, a cheque"],
  N: ["night", "a bar, a table, low light"],
  F: ["food", "a plate, a table, a meal"],
  R: ["resting", "sofas, beanbags, lying about"],
  E: ["empty room", "the space with nobody in it"],
  D: ["detail", "an object, a sign, a whiteboard"],
  O: ["outdoors", "street, park, a building from outside"],
  X: ["unusable", "blurred, black, or a title card"],
};

export const CODES = Object.keys(VOCAB);

/**
 * The compact format, one line per sheet:
 *
 *     3  PWWPSAAA TPSSLPSC ECCPFPLL NSDSSSSL SSLPSTWL PPPWLSSG  * r2c5 r3c7
 *
 * Sheet number, then one letter per cell reading left to right and top to
 * bottom. Whitespace inside the codes is ignored, so grouping them by row is
 * free and makes a miscount visible to the eye. Everything after `*` is the
 * cells worth opening. Lines starting with # are comments.
 */
export function parseCompact(text) {
  const out = [];
  const problems = [];

  for (const [n, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const m = line.match(/^(\d+)\s*[:.]?\s+(.+)$/);
    if (!m) {
      problems.push(`line ${n + 1}: expected a sheet number first`);
      continue;
    }
    const sheet = Number(m[1]);
    const [codePart, starPart = ""] = m[2].split("*");
    const codes = codePart.replace(/\s+/g, "").toUpperCase();

    const bad = [...codes].filter((c) => !VOCAB[c]);
    if (bad.length) {
      problems.push(`sheet ${sheet}: unknown code ${[...new Set(bad)].join(", ")}`);
      continue;
    }
    out.push({
      sheet,
      codes,
      stars: starPart.trim().split(/\s+/).filter(Boolean),
    });
  }
  return { rows: out, problems };
}

/**
 * Turns parsed sheets into tags against frame ids, using the sheet index to
 * resolve which photograph a cell was. Anything that does not line up is
 * reported rather than guessed at: a cell count that disagrees with the
 * index means the agent lost its place, and applying it anyway would file
 * every tag after the slip against the wrong picture.
 */
export function applyToIndex(rows, sheetIndex, { cols = 6 } = {}) {
  const bySheet = new Map();
  for (const e of sheetIndex) {
    if (!bySheet.has(e.sheet)) bySheet.set(e.sheet, []);
    bySheet.get(e.sheet).push(e);
  }

  const tags = {};
  const problems = [];
  let applied = 0;

  for (const row of rows) {
    const cells = bySheet.get(row.sheet);
    if (!cells) {
      problems.push(`sheet ${row.sheet}: no such sheet in the index`);
      continue;
    }
    if (row.codes.length !== cells.length) {
      problems.push(
        `sheet ${row.sheet}: ${row.codes.length} codes for ${cells.length} cells. ` +
        `nothing from this sheet was applied, because a miscount shifts every ` +
        `tag after it onto the wrong frame.`,
      );
      continue;
    }
    for (const [i, cell] of cells.entries()) {
      tags[cell.id] = {
        tag: row.codes[i],
        star: row.stars.includes(cell.cell) ? 1 : 0,
      };
      applied++;
    }
  }
  return { tags, problems, applied };
}
