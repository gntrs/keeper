import { S } from "/app.js";

/**
 * WHICH MACHINE THE PHOTOGRAPHS ARE ON, WHICH IS NOT THE SAME QUESTION AS
 * WHICH MACHINE THIS PAGE IS ON.
 *
 * The server says, in /api/state, and this reads its answer rather than the
 * user agent. Keeper binds to loopback so the two are almost always the same
 * machine, but almost is the wrong word to build a delete confirmation on: a
 * page open on a laptop against a keeper running on the desk would otherwise
 * offer to put a file back from the wrong wastebasket.
 *
 * Every one of these is a function and not a constant. State arrives on a
 * top level await inside app.js, and a module this one imports is evaluated
 * before that line runs, so anything read at import time would read nothing.
 */
const h = () => S.host ?? null;

/** the file manager, in the words that machine's own menus use */
export const files = () => h()?.files ?? "the file manager";

/** where a deleted file goes, and the word for getting it out again */
export const bin = () => h()?.bin ?? "the trash";
export const restore = () => h()?.restore ?? "put back";

/**
 * THE PICKING MODIFIER, AND WHY IT IS NOT ALWAYS THE SAME KEY.
 *
 * A mac picks with command and a pc picks with control, and that is not a
 * preference. It is the key every other window on that machine already uses
 * to add one more thing to a selection, so getting it wrong makes keeper the
 * only application on the machine that is strange.
 *
 * Option is option on both, and that stays as it is: the three bindings that
 * use it, reveal, open and the view switch, moved off the picking modifier
 * because the browser resolves cmd R, cmd O and cmd 1 above the page on a mac
 * and control R, control O and control 1 above the page on a pc. It is the
 * same problem on both, so it wants the same answer on both.
 */
export const mac = () => (h()?.keys ?? (/Mac/i.test(navigator.platform || navigator.userAgent) ? "mac" : "pc")) === "mac";

/** true when the chord being pressed is the picking one for this machine */
export const pick = (e) => (mac() ? e.metaKey : e.ctrlKey);

/**
 * The glyphs printed on a mac keyboard, turned into the words printed on a
 * pc one.
 *
 * The legend is written once in the html, in the mac spelling, because that
 * is the version somebody can read while writing it. A pc has no glyph for
 * any of these and nobody reads a placed square, so on a pc they become the
 * words, spaced the way the keys are written on the keys.
 */
const SAID = {
  "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift",
  "⌫": "Backspace", "⏎": "Enter", "⎋": "Esc",
  "␣": "Space", "⇥": "Tab",
};

export function paintKeys(root = document) {
  if (mac()) return;
  for (const k of root.querySelectorAll("kbd")) {
    const was = k.textContent;
    /* Split rather than replace, so ⌘F becomes "Ctrl F" with a space in it.
       "CtrlF" reads as one word and a person looking for the key they have to
       hold does not find it in there. */
    const now = [...was].map((c) => SAID[c] ?? c).join(SAID[was[0]] && was.length > 1 ? " " : "");
    if (now !== was) k.textContent = now;
  }
  /* the one label that names the file manager rather than a key */
  for (const el of root.querySelectorAll("[data-files]")) {
    el.textContent = el.textContent.replace(/finder/gi, files());
  }
}
