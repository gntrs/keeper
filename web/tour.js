/* ---------------------------------------------------------------------
   the walkthrough.

   THE PROBLEM IT SOLVES IS THAT THE KEYBOARD IS INVISIBLE. keeper's whole
   argument is that a thousand photographs is twenty minutes with one hand
   and an afternoon with a mouse, and nothing on the screen says so. A person
   who has never read the readme sits down, sees tiles, and clicks, because
   clicking is what an unlabelled page teaches. They then conclude keeper is
   a slower finder and close it, which is a fair conclusion from what they
   were shown.

   One sentence on the wall used to be the answer, and one sentence is not
   enough to carry a bin that is not a bin, a tray, and a bench. So this
   walks the room instead: eight cards, each one ringing the thing it is
   talking about, in the order the day actually happens in. Look, keep, tag,
   set aside, pile up, cut to shape.

   IT DOES NOT TAKE THE APP AWAY WHILE IT TALKS. There is no dimmed backdrop
   and nothing is blocked, so every key it names can be pressed the moment it
   is named, and pressing one moves the card on. That is the whole reason to
   run a walkthrough over a live archive rather than over a video: the person
   leaves having already done it once.

   IT RUNS ONCE. Not once per browser, once per machine: the answer lives in
   keeper's seat on disk, because the page's origin carries a port and
   `keeper app` takes the first free one from 7777, so a browser's own
   storage would forget on any day something else held that port. Skipping
   counts as having seen it, for the same reason a hint that comes back on
   every load stops being a hint and becomes the dialog everybody dismisses
   without reading. The settings pane is where it comes back from, and that
   is the only way it comes back.

   IT HAS TWO ENTRANCES AND THEY ARE NOT THE SAME. A machine that has never
   run keeper gets the cards, because a first run has nothing to interrupt
   and a wall of unlabelled tiles is the whole problem. A machine that has
   run keeper before gets asked, once, in one card with two buttons. Those
   people already have their own way of working and updating to a version
   that immediately teaches them their own tool is a bad way to be thanked
   for updating. `S.returning` is the server's answer to which one this is,
   and it is snapshotted before the process writes to the seat, because five
   seconds in a first run and a hundredth look identical.

   WHEN THE CARDS CHANGE, BUMP `TOUR` IN src/runtime.mjs. It is the revision
   somebody answered, so raising it offers this to everybody once more, and
   the ask above is what keeps that from being rude. Do not raise it for a
   fix or a rewording, and never because the version number moved.
   --------------------------------------------------------------------- */

import { S, post, typed } from "/app.js";
import { feel } from "/feel.js";
import { mac } from "/host.js";

/**
 * The day, in order.
 *
 * `at` is what gets the ring, and a step whose element is not on this screen
 * simply loses its ring rather than being dropped: the sentence about the
 * tray is worth reading whether or not the button is where it was.
 *
 * `key` is the step's own escape hatch from being read at. When it matches a
 * real press the card moves on, and the press is never swallowed, so the
 * frame really is kept and the card really does agree that it was. Only the
 * steps that name a key have one, because a card that quietly advanced on a
 * keystroke it never mentioned would read as a bug.
 */
const STEPS = [
  {
    at: "#root",
    head: "this is the folder you pointed at",
    say: "every photograph and every clip in it, on one wall. nothing was copied and nothing was moved to get here.",
  },
  {
    at: "#grid figure",
    head: "the arrows move, space looks",
    say: "the cursor is the ring on a frame, not the mouse. space opens the one you are on as big as the screen goes, and space again puts it away.",
    key: (e) => e.key === " " || e.key.startsWith("Arrow"),
  },
  {
    at: "#tally",
    head: "k keeps it",
    say: "one key, one hand, no looking down. the count up here is the only thing that moves, and it is the count you are working towards.",
    key: (e) => e.key === "k" || e.key === "K",
  },
  {
    at: "#f-tag",
    head: "a letter says what it is",
    say: "1 to 9 are these tags, and each one also answers to its own letter. pick a run of frames first and one letter tags the lot of them at once.",
  },
  {
    at: "#f-binned",
    head: "delete does not delete",
    say: "it sets the frame aside and the file does not move off your drive. it comes back from in here, and {cmd} z takes back the last thing you did either way.",
  },
  {
    at: "#tray-toggle",
    head: "a pile you can hand to somebody",
    say: "{cmd} {enter} sends everything you have picked to the tray. name it, press export, and it comes out as a real folder of real files. your originals stay exactly where they are.",
  },
  {
    at: 'header nav [data-view="bench"]',
    head: "then cut them to shape",
    say: "the bench tries one frame in every shape at once: a post, a story, a youtube thumbnail, a banner across a page. drag it into the one you want and export that.",
  },
  {
    at: "#keys-toggle",
    head: "nothing here leaves this machine",
    say: "no account, no upload, nothing counted. it works with the wifi off. every other key, and the settings, are behind this question mark.",
  },
];

const $ = (s) => document.querySelector(s);

let at = 0;
let card = null;
let ring = null;
let live = false;

/* ------------------------------------------------------------------ */

function build() {
  card = document.createElement("aside");
  card.id = "tour";
  card.innerHTML =
    `<p class="label tour-n"></p>` +
    `<h3 class="tour-head"></h3>` +
    `<p class="tour-say"></p>` +
    `<div class="tour-acts">` +
      `<button class="chip tour-skip" type="button">skip</button>` +
      `<span class="grow"></span>` +
      `<button class="chip tour-back" type="button">back</button>` +
      `<button class="chip tour-next" type="button"></button>` +
    `</div>`;

  ring = document.createElement("div");
  ring.id = "tour-ring";
  ring.hidden = true;

  document.body.append(ring, card);

  card.querySelector(".tour-skip").onclick = () => leave();
  card.querySelector(".tour-back").onclick = () => go(at - 1);
  card.querySelector(".tour-next").onclick = () => go(at + 1);
}

/**
 * Put the ring around a thing, in the viewport's coordinates.
 *
 * A ring drawn as a border on the element itself would have to be taken off
 * again, and half of what it rings is a chip whose own border says whether
 * it is on. So it is a separate box laid over the top, which touches nothing
 * and can be pointed at anything, including a header button and a figure in
 * a scrolling grid.
 */
function around(el) {
  if (!el) { ring.hidden = true; return null; }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) { ring.hidden = true; return null; }
  const pad = 4;
  ring.style.left = `${r.left - pad}px`;
  ring.style.top = `${r.top - pad}px`;
  ring.style.width = `${r.width + pad * 2}px`;
  ring.style.height = `${r.height + pad * 2}px`;
  ring.hidden = false;
  return r;
}

/**
 * The card goes under the thing it is ringing, or over it when there is no
 * room under, and it is kept inside the window either way.
 *
 * Under first because the two things the walkthrough rings most are in the
 * header, and a card that covered the header while explaining the header
 * would be the only bug in here anybody remembered. With no ring at all it
 * sits at the bottom middle, which is the seat the old one-line hint had and
 * the one part of the screen no photograph is ever the point of.
 */
function place(r) {
  const gap = 12;
  const edge = 16;
  const w = card.offsetWidth;
  const h = card.offsetHeight;

  if (!r) {
    card.style.left = `${Math.round((innerWidth - w) / 2)}px`;
    card.style.top = `${innerHeight - h - 40}px`;
    return;
  }

  let top = r.bottom + gap;
  if (top + h > innerHeight - edge) top = r.top - gap - h;
  top = Math.min(Math.max(top, edge), Math.max(edge, innerHeight - h - edge));

  let left = r.left + r.width / 2 - w / 2;
  left = Math.min(Math.max(left, edge), Math.max(edge, innerWidth - w - edge));

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

/** re-measure without re-animating, for a window that changed size under it */
function again() {
  if (!live) return;
  const step = STEPS[at];
  place(around(step.at ? $(step.at) : null));
}

function go(next) {
  if (!live) return;
  if (next < 0) return;
  if (next >= STEPS.length) return leave();

  at = next;
  const step = STEPS[at];

  card.querySelector(".tour-n").textContent = `${at + 1} / ${STEPS.length}`;
  card.querySelector(".tour-head").textContent = step.head;
  /**
   * The keys are named in the words printed on this machine's keyboard.
   *
   * The sheet full of keycaps already does this, in host.js, by rewriting the
   * glyphs. These are sentences rather than caps, so they carry a token
   * instead: a pc picks with control and its key says enter, and a
   * walkthrough that told a windows user to press cmd would be teaching them
   * a key their keyboard does not have.
   */
  card.querySelector(".tour-say").textContent = step.say
    .replaceAll("{cmd}", mac() ? "cmd" : "ctrl")
    .replaceAll("{enter}", mac() ? "return" : "enter");
  card.querySelector(".tour-back").hidden = at === 0;
  card.querySelector(".tour-next").textContent = at === STEPS.length - 1 ? "done" : "next";

  /* restart the entry move. reading the offset is what forces the browser to
     notice the class went away before it came back, and without it the
     second card and every card after it arrives with no motion at all. */
  card.classList.remove("in");
  void card.offsetWidth;
  card.classList.add("in");

  place(around(step.at ? $(step.at) : null));
  feel("tick");
}

/**
 * Done, skipped and escaped are one exit and write the same bit.
 *
 * Skipping is not "ask me later". Somebody who pressed skip has been shown
 * the walkthrough and decided against it, and bringing it back next launch
 * would teach them that this app's cards are things you dismiss without
 * reading, which is worth more than anything the cards say.
 */
function leave() {
  if (!live) return;
  live = false;
  card.classList.add("going");
  ring.hidden = true;
  setTimeout(() => { card.remove(); ring.remove(); card = ring = null; }, 260);
  removeEventListener("keydown", onKey, true);
  removeEventListener("resize", again);
  removeEventListener("scroll", again, true);
  post("/api/tour", { done: true });
}

/** anything the walkthrough is standing under rather than over */
const above = () =>
  document.querySelector("#preview:not([hidden]), #keys:not([hidden]), .drop:not([hidden])");

/**
 * ON THE WAY DOWN, NOT ON THE WAY UP, and that is not a detail.
 *
 * The shelf answers a bare return by opening the quick look, and it wired
 * that up long before this file mounted. A bubbling listener registered
 * afterwards can call stopImmediatePropagation all it likes: the only
 * handlers it stops are the ones added after itself, so the first press of
 * return advanced the card and opened a photograph over the top of it, and
 * every press after that went to the photograph. Capture is the phase that
 * runs before all of them.
 *
 * Return is therefore taken off the app for the eight cards this is up, and
 * that costs nothing, because return on the shelf is the second way to do
 * what space does and space is what the card in front of you is naming.
 */
function onKey(e) {
  if (!live) return;
  if (typed(e)) return;

  if (e.key === "Enter") {
    e.preventDefault();
    e.stopImmediatePropagation();
    return go(at + 1);
  }

  /* Escape leaves, unless something is standing over this. A photograph, the
     shortcuts sheet and the folder panel all answer escape, and a keystroke
     spent closing the thing somebody is actually looking at must not also
     take the walkthrough with it. Checked rather than read off
     defaultPrevented, because nothing has run yet this early in the event. */
  if (e.key === "Escape") return above() ? undefined : leave();

  /* the step's own key, watched and never taken: it is not prevented and not
     stopped, so the frame really is kept and the card only agrees with what
     the app is about to do. */
  if (STEPS[at].key?.(e)) go(at + 1);
}

/* ------------------------------------------------------------------ */

/** from the settings pane, and from nowhere else */
export function startTour() {
  if (live) return;
  if (!S.items.length) return;
  live = true;
  at = 0;
  build();
  addEventListener("keydown", onKey, true);
  addEventListener("resize", again);
  /* capture, because the grid scrolls inside itself and a scroll event on a
     child never reaches the window on the way up. */
  addEventListener("scroll", again, true);
  go(0);
}

/**
 * The one card somebody who already uses keeper gets instead of eight.
 *
 * It wears the same clothes as a step, because it is the same object making
 * the same offer, and it sits where a step with nothing to point at sits.
 * There is no third button. "not now" would be a lie about what happens
 * next, since the only thing that brings this back is the settings pane
 * either way, and a card that pretends to be temporary is how a person
 * learns to dismiss the next one unread.
 */
function offer() {
  card = document.createElement("aside");
  card.id = "tour";
  card.innerHTML =
    `<p class="label tour-n">new in this keeper</p>` +
    `<h3 class="tour-head">there is a walkthrough now</h3>` +
    `<p class="tour-say">eight cards over your own archive, saying what the ` +
    `keys do and what delete does not do. about a minute, and you have ` +
    `probably worked most of it out already.</p>` +
    `<div class="tour-acts">` +
      `<button class="chip tour-skip" type="button">no thanks</button>` +
      `<span class="grow"></span>` +
      `<button class="chip tour-next" type="button">show me</button>` +
    `</div>`;
  document.body.append(card);
  card.classList.add("in");
  place(null);

  const shut = (then) => {
    card.classList.add("going");
    removeEventListener("keydown", onAsk, true);
    const el = card;
    card = null;
    setTimeout(() => { el.remove(); then?.(); }, 260);
  };

  /* No is an answer and it is written down. The settings pane is where it
     comes back from, which is the same door the cards themselves leave by. */
  card.querySelector(".tour-skip").onclick = () => { post("/api/tour", { done: true }); shut(); };
  card.querySelector(".tour-next").onclick = () => shut(startTour);

  function onAsk(e) {
    if (!card || typed(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      return shut(startTour);
    }
    /* escape is the same as no, deliberately. two cards that look alike must
       not answer the same key two different ways, and nothing here is lost
       that the settings pane cannot hand back. */
    if (e.key === "Escape" && !above()) { post("/api/tour", { done: true }); shut(); }
  }
  addEventListener("keydown", onAsk, true);
  feel("tick");
}

/**
 * On the first launch, and after whatever else was already asking.
 *
 * An archive with nothing in it keeps the walkthrough to itself. The blank
 * page is already its own explanation and there is nothing there for a
 * letter to tag yet, so it waits for the folder that comes next: opening one
 * reloads the page and this runs again with something to walk through.
 *
 * The update card asks a yes or no question on a first icon launch and stays
 * until it is answered. Two things talking at once on the first screen is one
 * too many and the question is the more urgent of them, so the walkthrough
 * waits it out.
 */
export async function mountTour() {
  if (!S.items.length) return;
  if (S.toured) return;

  if (S.app) {
    const up = () => document.querySelector(".up:not([hidden])");
    /* the card is put up after a fetch, so looking for it right now is
       looking too early. */
    await new Promise((r) => setTimeout(r, 500));
    if (up()) {
      await new Promise((resolve) => {
        const watch = new MutationObserver(() => { if (!up()) { watch.disconnect(); resolve(); } });
        watch.observe(document.body, {
          subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"],
        });
      });
      /* let the card finish leaving before another one arrives */
      await new Promise((r) => setTimeout(r, 320));
    }
  }

  /* the cards for a machine that has never run keeper, the offer for one
     that has. see the header. */
  if (S.returning) return offer();
  startTour();
}
