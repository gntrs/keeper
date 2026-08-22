import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAspect } from "./geometry.mjs";
import { compile } from "./places.mjs";
import { FORMATS } from "./formats.mjs";

export const CONFIG_NAME = "keeper.config.json";

/**
 * The slots a project wants filled. This file is the whole of what makes
 * keeper yours rather than mine: without it the bench has nothing to place
 * into, and with it keeper knows nothing about your project beyond a list
 * of holes and their shapes.
 */
export async function loadConfig(dir) {
  const file = path.join(dir, CONFIG_NAME);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    // No config is the first run, not a failure, and it is exactly the moment
    // the built in shapes earn their keep: there is nothing to place into yet
    // and the question a person already has is how their photograph reads as
    // a reel. The bench opens full of shapes and the config adds theirs later.
    return { slots: standardSlots(new Set(), undefined), file, missing: true, places: [] };
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_NAME} is not valid JSON: ${e.message}`);
  }

  const slots = (json.slots ?? []).map((s, i) => {
    if (!s.id) throw new Error(`slot ${i} has no id`);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(s.id)) {
      // ids become folder names on export, so they may not carry a separator
      throw new Error(`slot id ${JSON.stringify(s.id)} must be letters, digits, dot, dash or underscore`);
    }
    return {
      id: s.id,
      label: s.label ?? s.id,
      aspect: parseAspect(s.aspect ?? "3/2"),
      aspectText: String(s.aspect ?? "3/2"),
      width: Number(s.width) || 0,
      note: s.note ?? "",
      group: "yours",
    };
  });

  const ids = new Set();
  for (const s of slots) {
    if (ids.has(s.id)) throw new Error(`two slots share the id ${s.id}`);
    ids.add(s.id);
  }

  return {
    slots: [...slots, ...standardSlots(ids, json.formats)],
    file,
    missing: false,
    /* Undefined and not a default. Where a crop goes when nobody said lives
       in crops.mjs beside the code that writes it, so there is one answer to
       that question and not two that can disagree. */
    out: json.out,
    places: compile(json.places ?? []),
  };
}

/**
 * The built in shapes, in the same form a config slot comes out in, so
 * nothing downstream has to know which kind it is holding.
 *
 * A config slot of the same id wins and the built in is dropped, silently.
 * That is the useful way round: someone who writes their own `wide` has a
 * reason for it, and a keeper that shouted about a name collision with a
 * list the user never wrote would be scolding them for our choices.
 *
 * `"formats": false` turns the whole set off, for the project that knows
 * exactly what it wants and does not want twenty more boxes under it.
 */
function standardSlots(taken, want) {
  if (want === false) return [];
  return FORMATS.filter((f) => !taken.has(f.id)).map((f) => ({
    id: f.id,
    label: f.label,
    aspect: parseAspect(f.aspect),
    aspectText: f.aspect,
    width: f.width,
    note: f.note ?? "",
    group: f.group,
  }));
}
