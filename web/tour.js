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
   walks the room instead: a short card at a time, each one ringing the thing
   it is talking about, in the order the day actually happens in. Look, keep,
   tag, set aside, pile up, cut to shape.

   ONE FACT PER CARD AND THE SHORTEST SENTENCE THAT CARRIES IT. Every card
   here is read once, by somebody who wants to get to their photographs, and
   a card is not the place to make keeper's argument. The card that used to
   open this said the wall was the folder they had just chosen, which they
   knew, and the promise that nothing gets moved was said on three separate
   cards. Both are gone. What is left is a key or a gesture the screen does
   not say anywhere, and the one sentence somebody cannot act without.

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

   A CARD WITH NOTHING TO POINT AT IS NOT SHOWN AT ALL. The set is decided
   once, at the moment the walkthrough starts, by asking the browser which of
   these things it has actually laid out. That is not defensive coding, it is
   the only honest answer: the bin chip is hidden until something is in the
   bin, and the machine this runs on is by definition the machine whose bin
   is empty, so the card explaining what delete does was ringing a zero by
   zero box and saying "in here" at nothing on every first launch there has
   ever been. The sidebar can be shut, and then two more cards were doing it.
   A card that rings nothing is worse than no card, so it does not run and
   the count on the corner of the card says the number that will actually be
   walked.

   IT DOES NOT WAIT FOR THE UPDATE CARD, AND THAT WAS THE WHOLE BUG. This
   used to sleep half a second, look for the update card, and then park
   behind it until it went away. On a first launch the update card is always
   up, because a seat with no answer in it asks the question, and the card
   that says a newer keeper is out has no dismiss button on it at all. So the
   walkthrough waited for something that was never going to leave, on every
   launch, for ever, on exactly the machine it exists for. Worse, when the
   check to github took longer than the half second the order flipped: the
   cards started, the update card landed on top of them, and one escape aimed
   at the update card ran through this file's own handler and wrote the
   walkthrough down as answered after one card. The two of them share the
   screen now. `above()` knows about the update card so an escape spent on it
   is not also spent on this, and `place()` treats it as furniture to sit
   clear of rather than something to draw over.

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
 * `at` is what gets the ring, and it is a list because the first thing in it
 * is not always on the screen. The browser picks: the first one it has laid
 * out with a real size wins, and a step where none of them are laid out is
 * dropped before the walkthrough starts rather than shown ringing nothing.
 * That is why the frame under the cursor is the second answer twice. It is
 * the thing the key in the sentence acts on, so it is never the wrong thing
 * to be pointing at.
 *
 * `key` is the step's own escape hatch from being read at. When it matches a
 * real press the card moves on, and the press is never swallowed, so the
 * frame really is kept and the card really does agree that it was. Only the
 * steps that name a key have one, because a card that quietly advanced on a
 * keystroke it never mentioned would read as a bug.
 */
const STEPS = [
  {
    at: ["#grid figure.cursor", "#grid figure"],
    head: "arrows move, space looks",
    say: "the ring is where you are, not the mouse.",
    key: (e) => e.key === " " || e.key.startsWith("Arrow"),
  },
  {
    at: ["#tally"],
    head: "k keeps it",
    say: "this is the count that moves.",
    key: (e) => e.key === "k" || e.key === "K",
  },
  {
    at: ["#f-tag"],
    head: "these tag the frame you are on",
    /* the key and not the digit, because only the first nine rows get one:
       shelf.js prints the tag's own letter on every row after that, and a
       card promising digits would be describing a column the reader can see
       is not all digits. */
    say: "press the key on its row.",
  },
  {
    /* the bin chip when there is a bin, and otherwise the frame the key is
       about to act on. it is hidden on every machine this runs on, which is
       what made the old wording, "it comes back from in here", point at a
       gap in the sidebar. */
    at: ["#f-binned", "#grid figure.cursor", "#grid figure"],
    head: "delete does not delete",
    say: "backspace sets the frame aside. the file stays on your drive.",
    key: (e) => e.key === "Backspace" || e.key === "Delete",
  },
  {
    at: ["#tray-toggle"],
    head: "a pile you can hand over",
    say: "{cmd} {enter} puts what you picked in here.",
  },
  {
    at: ['header nav [data-view="bench"]'],
    head: "then cut them to shape",
    say: "one frame in every shape at once. drag it into the one you want.",
  },
  {
    at: ["#keys-toggle"],
    head: "every other key is on ?",
    say: "the settings are in there too.",
  },
];

const $ = (s) => document.querySelector(s);

let at = 0;
let card = null;
let ring = null;
let live = false;
/* the steps that had something to point at when this started, which is the
   only set the count on the card is ever allowed to be counting. */
let run = [];

/**
 * The thing on screen a step is about, or nothing.
 *
 * Laid out is the test, not present. Half of what these point at is a chip
 * that exists in the markup on every load and is display:none until it has
 * a reason to be there, and a hidden element answers querySelector perfectly
 * happily while measuring zero by zero. Asking the browser for the box is
 * the only question whose answer is the one the ring needs.
 */
function anchor(step) {
  for (const sel of step.at) {
    const el = $(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) return el;
  }
  return null;
}

/**
 * The update card, which is the only other thing that ever sits over the app
 * without taking it away.
 *
 * It is drawn under this one, so a card parked on top of it hides the
 * buttons of a question somebody has to answer, and there is no stacking
 * order that fixes that. Only room fixes it.
 */
const upCard = () => document.querySelector(".up:not([hidden])");

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
 * The card goes under the thing it is ringing, or over it, or beside it, and
 * it is kept inside the window and off the update card either way.
 *
 * Under first because the two things the walkthrough rings most are in the
 * header, and a card that covered the header while explaining the header
 * would be the only bug in here anybody remembered. With no ring at all it
 * sits at the bottom middle, which is the seat the old one-line hint had and
 * the one part of the screen no photograph is ever the point of.
 *
 * BESIDE IS THE THIRD ANSWER AND IT IS THERE FOR THE TAG COLUMN. That ring
 * is the whole sidebar section, four hundred and eighty pixels of it, so on
 * a window 1280 wide there is no room under it and no room over it either.
 * Under and over were the only two answers, so the card clamped to the top
 * edge and was drawn across the top third of the very chips its sentence was
 * describing. A tall thing has room at its side by definition, which is the
 * one place a card is never in the way of what it is pointing at.
 */
function place(r) {
  const gap = 12;
  const edge = 16;
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const hit = upCard()?.getBoundingClientRect();

  /* sideways is clamped rather than judged, because sliding a card to the
     window's edge costs it nothing and there is nothing above or below to
     slide into. up and down is the whole question. */
  const near = (l) => Math.min(Math.max(l, edge), Math.max(edge, innerWidth - w - edge));
  const room = (p) => p.top >= edge && p.top + h <= innerHeight - edge;
  const free = (p) => !hit
    || p.left >= hit.right || p.left + w <= hit.left
    || p.top >= hit.bottom || p.top + h <= hit.top;

  const mid = r ? near(r.left + r.width / 2 - w / 2) : near((innerWidth - w) / 2);
  const tries = r
    ? [
        { left: mid, top: r.bottom + gap },
        { left: mid, top: r.top - gap - h },
        { left: near(r.right + gap), top: r.top },
        { left: near(r.left - gap - w), top: r.top },
      ]
    : [
        { left: mid, top: innerHeight - h - 40 },
        { left: mid, top: edge },
      ];

  /* the first seat with room for the whole card and no update card in it,
     then the first with room, then under and clamped, which is what the
     window is small enough to have left. */
  const seat = tries.find((p) => room(p) && free(p)) ?? tries.find(room) ?? tries[0];

  card.style.left = `${Math.round(seat.left)}px`;
  card.style.top = `${Math.round(
    Math.min(Math.max(seat.top, edge), Math.max(edge, innerHeight - h - edge)))}px`;
}

/**
 * Re-measure without re-animating.
 *
 * For a window that changed size under it, for a grid that scrolled, and for
 * the cursor: two of these steps ring the frame the keyboard is standing on,
 * and the arrows move that while the card is up. The measurement is one
 * rectangle, so running it after every keystroke costs nothing and a ring
 * left behind on the frame somebody has already walked away from costs the
 * card its meaning.
 */
function again() {
  if (!live) return;
  place(around(anchor(run[at])));
}

function go(next) {
  if (!live) return;
  if (next < 0) return;
  if (next >= run.length) return leave();

  at = next;
  const step = run[at];

  card.querySelector(".tour-n").textContent = `${at + 1} / ${run.length}`;
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
  card.querySelector(".tour-next").textContent = at === run.length - 1 ? "done" : "next";

  /* restart the entry move. reading the offset is what forces the browser to
     notice the class went away before it came back, and without it the
     second card and every card after it arrives with no motion at all. */
  card.classList.remove("in");
  void card.offsetWidth;
  card.classList.add("in");

  place(around(anchor(step)));
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

/**
 * Anything the walkthrough is standing under rather than over.
 *
 * The update card is in this list even though it is drawn underneath, and
 * that is deliberate: this is not a list of what is on top, it is a list of
 * things that answer escape. The update card does, and it is the only way it
 * can be dismissed at all once it has stopped asking and started announcing.
 * Without it in here one escape aimed at that card also ran through this
 * file and wrote the walkthrough down as answered, so somebody who had read
 * one card of it never saw the rest and had no way back except the settings
 * pane they had not been told about yet.
 */
const above = () =>
  document.querySelector(
    "#preview:not([hidden]), #keys:not([hidden]), .drop:not([hidden]), .up:not([hidden])");

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
 * Return is therefore taken off the app for the few cards this is up, and
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
  if (run[at].key?.(e)) return go(at + 1);

  /* every other key, after the app has had it. the arrows walk the cursor
     and two of these steps are ringing the frame the cursor is on, so the
     ring has to go with it. next frame rather than now, because nothing has
     moved yet at the moment this handler runs: it is on the way down. */
  requestAnimationFrame(again);
}

/* ------------------------------------------------------------------ */

/** from the settings pane, and from nowhere else */
export function startTour() {
  if (live) return;
  if (!S.items.length) return;
  /* the set is decided here and then it does not change, because the number
     in the corner of the card is a promise about how many more of these
     there are and a set that grew a card halfway through would break it. */
  run = STEPS.filter(anchor);
  if (!run.length) return;
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
 * The one card somebody who already uses keeper gets instead of the walkthrough.
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
    `<p class="tour-say">a minute over your own archive, saying what the keys ` +
    `do and what delete does not do.</p>` +
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
 * On the first launch, and it does not wait for anybody.
 *
 * An archive with nothing in it keeps the walkthrough to itself. The blank
 * page is already its own explanation and there is nothing there for a
 * letter to tag yet, so it waits for the folder that comes next: opening one
 * reloads the page and this runs again with something to walk through.
 *
 * IT USED TO PARK BEHIND THE UPDATE CARD AND THAT MEANT IT NEVER RAN. The
 * header says the whole of it. The short version is that on a first launch
 * there is always an update card, the loud one has no button that closes it,
 * and the walkthrough was waiting for it to go. Sharing the screen is the
 * lesser of the two problems, and `place()` and `above()` are what make the
 * sharing bearable.
 *
 * The one wait left is a turn of the event loop, because the line below this
 * call in app.js is the one that decides whether the wall or the bench is
 * what is on screen, and a card measured before that lands on a section that
 * is about to be hidden.
 */
export async function mountTour() {
  if (!S.items.length) return;
  if (S.toured) return;

  await new Promise((r) => setTimeout(r, 0));

  /* nothing to point at is nothing to say, and it is not an answer either:
     no card goes up, so nothing is written down and the next launch asks
     again with whatever is on screen then. */
  if (!STEPS.some(anchor)) return;

  /* the cards for a machine that has never run keeper, the offer for one
     that has. see the header. */
  if (S.returning) return offer();
  startTour();
}
