import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAspect } from "./geometry.mjs";

export const CONFIG_NAME = "keepers.config.json";

/**
 * The slots a project wants filled. This file is the whole of what makes
 * keepers yours rather than mine: without it the bench has nothing to place
 * into, and with it keepers knows nothing about your project beyond a list
 * of holes and their shapes.
 */
export async function loadConfig(dir) {
  const file = path.join(dir, CONFIG_NAME);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { slots: [], file, missing: true };
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
    };
  });

  const ids = new Set();
  for (const s of slots) {
    if (ids.has(s.id)) throw new Error(`two slots share the id ${s.id}`);
    ids.add(s.id);
  }

  return { slots, file, missing: false, out: json.out ?? "keepers-out" };
}
