/**
 * Where a photograph was taken, said in words a person would use.
 *
 * A folder path is already a place, and for most archives the folder is
 * enough. But a drive that files by date says `space/2026-06-19`, which
 * tells you when and not where, and a shelf filtered by dates is a shelf
 * nobody uses. So places are rules: a pattern against the path, and the
 * name you actually call it.
 *
 * The rules live in keeper.config.json because only the person who shot
 * the archive knows that june the nineteenth was the london house. Nothing
 * here guesses.
 */
export function compile(rules = []) {
  return rules.map((r, i) => {
    if (!r.name) throw new Error(`place rule ${i} has no name`);
    let re;
    try {
      re = new RegExp(r.match ?? "", "i");
    } catch (e) {
      throw new Error(`place rule ${i} (${r.name}) has a bad pattern: ${e.message}`);
    }
    return { re, name: r.name };
  });
}

/**
 * First rule wins, so order is meaning: put the narrow patterns above the
 * broad ones, the same way you would read them out loud.
 *
 * With no rule matching, the fallback is the folder the file sits in, which
 * is what an archive that files by place already gives you for free.
 */
export function placeOf(relPath, compiled) {
  for (const r of compiled) if (r.re.test(relPath)) return r.name;
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "the top folder" : relPath.slice(0, i);
}
