import { typed } from "/app.js";
import { feel } from "/feel.js";
import { pick as chord } from "/host.js";

/**
 * Two stacks, and where you are is the gap between them.
 *
 * KEEPER USED TO UNDO NOTHING, AND THAT WAS THE REASON FOR HALF THE ARMING
 * IN THIS APP. Every write here goes to a file on a disk the moment it is
 * made, so the only protection a wrong keystroke had was a second keystroke
 * asking whether you meant it. That is still true of the one action that
 * moves an original file, and it is no longer true of anything else.
 *
 * A step is a thing you did and two closures: one that puts it back and one
 * that does it again. Both are written at the call site, where the value
 * before and the value after are already sitting in variables, rather than
 * being worked out later from a diff of the world.
 *
 * IT IS NOT A HISTORY OF THE ARCHIVE. It lives on this page and it dies with
 * it, because the file on disk is the truth and a stack that outlived a
 * reload would be a set of instructions for putting back a world that may
 * have moved underneath it in the meantime.
 */
const stack = [];

/**
 * Everything undone, newest first, waiting to be done again.
 *
 * It is emptied by the next ordinary action, because at that moment the
 * future those steps described stops being reachable: you have walked back
 * three steps and gone somewhere else, and "again" no longer names anything
 * that could happen. Keeping them would offer to redo a world that has been
 * built over.
 */
const redos = [];

/* Deep enough for an afternoon, shallow enough that it cannot grow into a
   reason the tab is slow. A run is a keystroke every half second, so this is
   most of two hours of tagging. */
const MAX = 200;

/**
 * True while an inverse or a repeat is running.
 *
 * Both directions reuse the ordinary writers wherever one already says the
 * right thing, and an ordinary writer records what it did. Without this the
 * first undo would push its own inverse on top of the stack and the key
 * would flip the same decision back and forth for ever. It also keeps a
 * repeat from clearing the redo stack it is in the middle of walking.
 */
let running = false;

/**
 * Record a step. `back` puts it back, `again` does it again.
 *
 * `key` coalesces: a burst of nudges on the same crop is one thing a person
 * did and should be one press to take back, so a step whose key matches the
 * step already on top is folded into it. The two directions fold in opposite
 * directions, and that asymmetry is the whole point. The older `back` is
 * kept, because it restores to before the burst began. The newer `again` is
 * kept, because it repeats the burst as it finally stood. Taking the newest
 * of both would make undo a single nudge; taking the oldest of both would
 * make redo replay the first press and lose the rest.
 */
export function did(what, back, again = null, key = null) {
  if (running) return;

  /* a fresh action forks the history, so the branch that was undone is gone */
  redos.length = 0;

  const top = stack[stack.length - 1];
  if (key && top?.key === key) {
    top.what = what;
    top.again = again;
    return;
  }
  stack.push({ what, back, again, key });
  if (stack.length > MAX) stack.shift();
}

/**
 * Record something that cannot be taken back.
 *
 * It goes on the stack rather than being left off it, so the key stops at it
 * and says why instead of silently reaching past it and undoing a tag from
 * four minutes ago. The one thing worse than an undo that will not work is
 * an undo that quietly works on the wrong thing.
 */
export function didFinal(what, why) {
  if (running) return;
  redos.length = 0;
  stack.push({ what, why });
  if (stack.length > MAX) stack.shift();
}

/** thrown away when the world they describe is gone */
export function forget() {
  stack.length = 0;
  redos.length = 0;
}

let timer = 0;
/**
 * The one line of voice this app has. Exported now, because the shelf
 * borrows it to admit a write that never reached the disk: same corner of
 * the screen, same fade, so the page keeps one way of speaking instead of
 * growing a second toast that behaves almost but not quite the same.
 */
export function say(text) {
  const el = document.querySelector("#undo-say");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/**
 * One walk, both directions.
 *
 * Undo and redo are the same operation over two stacks pointed at each
 * other: take the top of one, run the closure it keeps for this direction,
 * and put it on the other. Written once rather than twice so the two can
 * never drift, which matters most in the failure case: a closure that throws
 * has changed nothing, so the step goes back where it came from and the pair
 * stays a mirror instead of quietly losing a step from one side.
 */
async function walk({ from, to, pick, word }) {
  const top = from[from.length - 1];
  if (!top) { feel("no"); return say(`nothing to ${word}.`); }

  /* left where it is on purpose. it is a wall, not a step. */
  if (top.why) { feel("no"); return say(top.why); }

  const move = pick(top);
  if (!move) { feel("no"); return say(`${top.what} cannot be ${word}ne.`); }

  from.pop();
  running = true;
  try {
    await move();
    to.push(top);
    feel("tap");
    say(`${word}ne: ${top.what}`);
  } catch {
    /* a failed closure has not changed anything, and a stack that ate the
       step would leave nothing to try again with. */
    from.push(top);
    feel("no");
    say(`could not ${word} ${top.what}.`);
  } finally {
    running = false;
  }
}

export const undo = () =>
  walk({ from: stack, to: redos, pick: (s) => s.back, word: "undo" });

export const redo = () =>
  walk({ from: redos, to: stack, pick: (s) => s.again, word: "redo" });

/**
 * Cmd Z and cmd shift Z, on the window, because they belong to the app and
 * not to a view. The shelf and the bench both read cmd chords of their own
 * and neither claims these, so they are caught here once rather than twice.
 *
 * Read off `code` rather than `key`, because shift turns the character into
 * a capital and matching on the letter would mean spelling both cases. Alt
 * is refused rather than ignored so a chord meant for something else does
 * not land here by being a superset of this one.
 *
 * They stay off a field someone is typing in. The browser's own undo owns
 * the text in the search box, and taking that away to put a tag back would
 * be the most surprising thing this key could do.
 */
export function mountUndo() {
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyZ" || !chord(e) || e.altKey) return;
    if (typed(e)) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });
}
