import { mountShelf, renderShelf } from "/shelf.js";
import { mountBench, renderBench } from "/bench.js";
import { mountTray, trayView } from "/tray.js";
import { mountPreview, previewOpen } from "/preview.js";
/* mounts itself on import. it listens on the window, so it has to be here
   rather than inside a view: a folder can be dropped on the bench just as
   well as on the shelf. the one thing it exports is the wait, which the boot
   below borrows for a page that opened while a scan was already running. */
import { watch } from "/drop.js";
import { viewIn } from "/motion.js";
import { feel, mountFeel } from "/feel.js";
import { paintKeys, pick as chord } from "/host.js";
import { mountUndo } from "/undo.js";
import { mountQuit } from "/quit.js";
import { mountUpdate } from "/update.js";
import { mountTour } from "/tour.js";
import { mountSettings } from "/settings.js";

/* Every write carries the token the server put on this page, so a page on
   another origin, which cannot read this one, cannot make keeper write. One
   wrapper rather than a header in six files: two of those files are not ours
   to edit, and a fetch added next month would forget. */
const TOKEN = window.KEEPER_TOKEN ?? "";
const bare = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const method = String(init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return bare(input, init);
  const headers = new Headers(init.headers ?? {});
  headers.set("x-keeper-token", TOKEN);
  return bare(input, { ...init, headers });
};

export const S = {
  items: [], tags: {}, placements: {}, slots: [], vocab: {}, hints: {},
  byId: new Map(),
  /* The frames set aside. A set rather than the array the server sends,
     because the shelf asks "is this one binned" once per tile per render and
     an array would make that a scan of the whole list. */
  binned: new Set(),
  view: "shelf",
};

const $ = (s) => document.querySelector(s);

/* Is this keystroke going into a field?
   `e.target.matches` and not this used to be the test, which throws whenever
   the target is not an element: a keydown dispatched on window has window as
   its target, window has no matches, and the whole handler dies on the way
   past. It only showed up under a synthetic event, and a keyboard handler
   that can be killed by one is a keyboard handler with a loose wire. */
export const typed = (e) =>
  e.target instanceof Element && e.target.closest("input, textarea, select");

/**
 * Every write goes through here, so nothing is only true on screen.
 *
 * A write that could not be sent at all comes back false, like a write the
 * server refused. It used to reject, and every caller in the app reads this
 * as a boolean: one rejection took out the whole Promise.all it sat in, which
 * skipped the rollback and the undo registration underneath and left the
 * screen saying the work had landed. There is no caller anywhere that wants
 * an exception out of this.
 */
export async function post(route, body, method = "POST") {
  let res;
  try {
    res = await fetch(route, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    console.error("[keeper]", route, e.message);
    return false;
  }
  if (!res.ok) console.error("[keeper]", route, await res.text());
  return res.ok;
}

/** macOS only. Opens Finder with the original selected. */
export function reveal(item) {
  if (!item) return;
  post("/api/reveal", { id: item.id });
}

/**
 * The two or three numbers that change while you work, and nothing else.
 * "tagged" used to be one of them and is not: the untagged chip two rows
 * below is the same fact, said in the one place you can act on it.
 */
export function tally() {
  const kept = S.items.filter((i) => S.tags[i.id]?.star && !S.binned.has(i.id)).length;
  /* Your own slots, and only the placements still pointing at one. The
     bench ships fourteen standard shapes nobody set out to fill, so
     counting against all of them read as failure the moment it said 3/14,
     and a config that has been swapped or removed leaves placements behind
     whose slot is gone: live, `hero` and `about-1` were being counted
     against a bench that has no such slot. `keeper export` counts your own
     holes for the same reason. With no slots of your own there is no
     fraction worth printing, so the segment goes. */
  const mine = S.slots.filter((s) => s.group === "yours");
  const placed = mine.filter((s) => S.placements[s.id]).length;
  const on = S.items.length - S.binned.size;
  $("#tally").innerHTML =
    `<span class="dim">${on} frames · ${kept} kept` +
    (mine.length ? ` · ${placed}/${mine.length} placed` : "") + `</span>`;
}

/**
 * The view lives in the hash, so a reload lands you back where you were.
 * That is not a nicety on a tool you leave open for an hour: losing the
 * bench because a stylesheet changed would mean finding your slot again
 * every time.
 */
export function setView(v) {
  if (v !== "shelf" && v !== "bench") v = "shelf";
  S.view = v;
  /* on the body as well, because two controls in the bar belong to the shelf
     and a stylesheet cannot read a variable in a module. */
  document.body.dataset.view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, "", `#${v}`);
  for (const b of document.querySelectorAll("header nav button")) {
    b.classList.toggle("on", b.dataset.view === v);
  }
  const was = $("#shelf").hidden ? "bench" : "shelf";
  $("#shelf").hidden = v !== "shelf";
  $("#bench").hidden = v !== "bench";
  trayView(v);
  if (v === "bench") renderBench();
  /* only when the view actually changed. setView runs on every hashchange
     and once at boot, and a section that re animates when nothing moved is
     a flicker rather than a transition. */
  if (was !== v) { viewIn($(`#${v}`)); feel("tap"); }
}
addEventListener("hashchange", () => setView(location.hash.slice(1)));
for (const b of document.querySelectorAll("header nav button")) {
  b.onclick = () => setView(b.dataset.view);
}

/**
 * The shortcuts sheet. It used to be four rows printed along the bottom of
 * every screen, which is what a cheat sheet becomes when nobody decides
 * whether it is documentation or furniture: unread after the first
 * afternoon, and holding a strip of a window whose whole job is showing
 * photographs as large as they go.
 */
/* assigned the moment the pane is mounted, three lines below. it is a
   binding rather than a direct call so showKeys can be declared above the
   mount without either of them having to move. */
let repaintSettings = null;

export function showKeys(on) {
  $("#keys").hidden = !on;
  $("#keys-toggle").setAttribute("aria-expanded", String(!!on));
  /* the settings pane is repainted on the way in rather than kept in step by
     a listener, because every switch on it is a mirror of a control that
     lives somewhere else and four rows are cheaper to redraw than to watch.
     See settings.js. */
  if (on) repaintSettings?.();
  feel("tick");
}
$("#keys-toggle").onclick = () => showKeys($("#keys").hidden);
$("#keys-shut").onclick = () => showKeys(false);
repaintSettings = mountSettings(showKeys);

/**
 * THE SIDEBAR, AND WHY ITS ANSWER IS READ BEFORE ANYTHING IS FETCHED.
 *
 * The filters are a column beside the wall now, and somebody who shut it
 * wants it shut the next morning too. The stored answer goes on the body here,
 * above the state fetch, so a column that is not wanted is never painted and
 * then taken away half a second later.
 */
const SIDE = "keeper.side";
document.body.dataset.side = localStorage.getItem(SIDE) === "shut" ? "shut" : "open";

function setSide(open) {
  document.body.dataset.side = open ? "open" : "shut";
  localStorage.setItem(SIDE, open ? "open" : "shut");
  $("#side-toggle")?.setAttribute("aria-pressed", String(open));
  feel("tick");
}

/* the toolbar is not this file's markup, so the toggle is wired when it is
   there and skipped when it is not: a missing button should be a button that
   does nothing rather than a page that stops booting. */
{
  const b = $("#side-toggle");
  if (b) {
    b.onclick = () => setSide(document.body.dataset.side !== "open");
    b.setAttribute("aria-pressed", String(document.body.dataset.side === "open"));
  }
}

/* The nine checks, from inside the app. The mac build puts nothing on PATH,
   so `keeper doctor` is a command a tester on that build cannot run, and the
   settings pane is the only place they can reach the same answer. It prints
   the rows as they come, because the whole point of them is being pasted into
   a message asking for help. */
{
  const b = $("#set-doctor");
  const out = $("#set-doctor-out");
  if (b && out) {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = "checking";
      const d = await fetch("/api/doctor", { method: "POST" }).then((r) => r.json()).catch(() => null);
      b.disabled = false;
      b.textContent = "check again";
      out.hidden = false;
      out.textContent = d?.rows
        ? d.rows.map((r) => `${r.state.padEnd(4)} ${r.what.padEnd(9)} ${r.said}`).join("\n")
        : "the check did not answer.";
    };
  }
}

/**
 * The keys that belong to the app rather than to a view, and the rule they
 * are the top of: a bare letter tags a photograph, cmd plus a key does
 * something to the app. Three of these work on the bench as well as the
 * shelf, and cmd+o has to work on an archive with nothing in it, where
 * shelf.js never mounts and its key handler does not exist. That is why they
 * are here and the rest are there.
 */
addEventListener("keydown", (e) => {
  /* the pc picks with control, so a control chord passes here and bare
     control still guards nothing on a mac. */
  if (e.ctrlKey && !chord(e)) return;

  /**
   * Chrome owns cmd+r, cmd+o and cmd+1 through cmd+9 at the browser level.
   * preventDefault runs, and the tab reloads or switches anyway, because
   * those are accelerators resolved above the page. That is not something to
   * be clever about, so everything the browser has claimed moved to option,
   * which on a mac is an ordinary application modifier and which chrome
   * claims almost nothing of. cmd keeps the ones that genuinely work: select
   * all, return, click and drag.
   *
   * Option is read off `e.code` and never `e.key`, because holding option on
   * a mac keyboard rewrites the character: option+o arrives as "ø",
   * option+f as "ƒ", option+r as "®". The physical key is the only stable
   * thing in the event.
   */
  if (chord(e) || e.altKey) {
    const k = e.code;

    /* The views on the numbers they already answer to, and these two work
       with a card up while the bare ones do not. A bare 1 during a tagging
       run is a slip of the hand, and switching the whole app out from under
       an open photograph is not what it meant. A chord is never a slip. */
    if (k === "Digit1") { setView("shelf"); return e.preventDefault(); }
    if (k === "Digit2") { setView("bench"); return e.preventDefault(); }

    /* Find, which is the letter this app never had room for until tagging
       moved off the bare letters. It goes to whichever search field the view
       you are in actually has, and selects what is in it, so a second one is
       a new search rather than an append. */
    if (k === "KeyF") {
      const q = $(S.view === "bench" ? "#p-q" : "#f-q");
      if (!q) return;
      q.focus();
      q.select();
      return e.preventDefault();
    }

    /* Open a folder, through the same click drop.js is already listening
       for, so the finder dialog keeps exactly one way in no matter who asks.
       The header button is first in the document, and on an empty archive
       the one in the blank state answers instead. */
    if (k === "KeyO") {
      document.querySelector("[data-keeper-choose]")?.click();
      return e.preventDefault();
    }

    /* The sidebar. Finder hides its own on option command s, and option s is
       the chord this app has free on the same physical key. It goes through
       the button's own click so the paint, the stored answer and the sound
       happen in one place. */
    if (k === "KeyS" && e.altKey && !chord(e)) {
      $("#side-toggle")?.click();
      return e.preventDefault();
    }

    /* Auto advance, on the letter it governs. shelf.js owns the toggle and
       its state, so the chord goes through the button's own click: one
       paint, one persisted bit, one sound, no matter who asks. It is here
       rather than in the shelf's handler because it has to answer with a
       photograph open, where the shelf hands the bare k to the card, and
       the preventDefault is what keeps the same press from reaching that
       handler at all: it checks defaultPrevented on the way in. */
    if (k === "KeyK") {
      $("#advance-toggle")?.click();
      return e.preventDefault();
    }
    return;
  }

  if (typed(e)) return;

  /* Both keys, because ? is shift and / is the key the hand is already on,
     and every tool that has ever had a cheat sheet answers to one of them.
     It works with a photograph open, which is where a question about a key
     is most likely to come up. */
  if (e.key === "?" || e.key === "/") {
    showKeys($("#keys").hidden);
    return e.preventDefault();
  }
  /* Escape shuts the sheet and stops there. stopImmediatePropagation is what
     keeps the same press from also throwing away the pick underneath it:
     this listener is registered before the shelf's, so it gets the say. */
  if (e.key === "Escape" && !$("#keys").hidden) {
    showKeys(false);
    e.stopImmediatePropagation();
    return e.preventDefault();
  }

  /* The preview handles its own escape and its own arrows. While it is up it
     also has the bare number keys, for the reason above. */
  if (previewOpen()) return;
  /* The bare digits used to switch views. They tag now: the shelf's legend
     row numbers the first nine codes and a hand running a pile reaches for
     a digit long before it remembers that celebrating is v. The views keep
     option+1 and option+2, which is a chord and therefore never a slip
     halfway down a wall of photographs. */
});

const state = await (await fetch("/api/state")).json();
Object.assign(S, state);
S.binned = new Set(state.binned ?? []);
S.byId = new Map(S.items.map((i) => [i.id, i]));
/* On a data attribute rather than as text, because the button is an icon and
   a path now, and only the path half is allowed to truncate.
   
   Wrapped in a left to right embedding. The path is truncated from its left
   end, which css does by setting the box to rtl, and rtl then moves the
   leading slash of an absolute path around to the far end: `/Volumes/disk/`
   rendered as `Volumes/disk/` with the root slash quietly walked to the
   back. U+202A holds the string itself ltr inside an rtl box. */
$("#root").dataset.path = `\u202A${S.root}\u202C`;
/* The same path, plainly, on the button beside it. drop.js reads it from
   there rather than importing anything or asking the server, and it wants the
   real string: the marks above are for the css that draws the path backwards,
   and a folder name with two invisible characters glued to it is not a folder
   any operating system has. */
{
  const again = $("#again");
  if (again) {
    if (S.root) again.dataset.path = S.root;
    /* Nothing to look again at until there is a folder. */
    else again.disabled = true;
  }
}

/**
 * A PAGE THAT OPENED WHILE THE SCAN WAS STILL RUNNING.
 *
 * The state above is answered before the index exists, so an icon launch, the
 * one every person starts with, used to land on "nothing here yet" and stay
 * there for good: nothing at boot ever asked what the server was doing. So an
 * empty shelf asks, and a scan in flight goes to the same wait the drop panel
 * already uses, which shows the phase and reloads when it is done.
 *
 * The session flag is what stops a state that never fills from reloading for
 * ever: the ready branch gets one reload per tab and then leaves it alone.
 */
/* Whether a scan is actually running, which the blank state below has to
   know about. Both branches trigger on an empty archive, so without this they
   both painted: the progress panel counting 1,240 of 2,200 with "keeper looked
   through this folder and found no photographs" legible through the scrim
   behind it. One of those two sentences is false at that moment, and it is
   the one that reads as a failure. */
let scanning = false;
if (!S.items.length) {
  const d = await fetch("/api/progress").then((r) => r.json()).catch(() => null);
  if (d?.phase === "scanning" || d?.phase === "thumbnailing") { scanning = true; watch(d.root); }
  else if (d?.phase === "ready" && d.frames > 0 && d.root === S.root
           && !sessionStorage.getItem("keeper.reloaded")) {
    sessionStorage.setItem("keeper.reloaded", "1");
    location.reload();
  }
}
if (S.items.length) sessionStorage.removeItem("keeper.reloaded");

/**
 * An archive with nothing in it is not an error and should not read like
 * one. It is the first thing a new user sees, so it is the only place in
 * keeper that explains itself.
 */
/* The folder is not there any more.
 *
 * This outranks everything below it, including having frames in the index,
 * because every one of those frames is a path that no longer resolves. Left
 * alone the shelf drew nine hundred broken image icons under a header still
 * counting nine hundred frames, which is the app insisting nothing is wrong
 * while none of it works. */
if (S.gone) {
  $("#shelf").innerHTML = `
    <div class="blank">
      <h2>that folder is not there any more</h2>
      <p>keeper was reading <span class="num" id="gone-root"></span> and it has been
         moved, renamed, or it was on a drive that is no longer plugged in.
         nothing has been lost: the tags and the crops live in that folder and
         come back with it.</p>
      <p>plug it back in or put it back where it was and reload, or
         <button class="chip" type="button" data-keeper-choose>choose another folder</button></p>
    </div>`;
  /* textContent and not interpolation: a folder name is somebody else's text
     and it can hold anything a filesystem allows, angle brackets included. */
  const where = $("#gone-root");
  if (where) where.textContent = S.root;
} else if (!S.items.length && !scanning) {
  $("#shelf").innerHTML = `
    <div class="blank">
      <h2>nothing here yet</h2>
      <p>drag a folder onto this window, or
         <button class="chip" type="button" data-keeper-choose>choose
         one</button>.</p>
      <p class="hint">${S.blank ? "" : `keeper looked through <code>${S.root}</code>
         and found no photographs and no film it can read. `}keeper reads jpg,
         png, webp, avif, tif, heic and dng, and mov, mp4, m4v and mkv. raw
         files come in through their embedded preview.</p>
    </div>`;
  /* The question mark stays. It used to go with the rest of the furniture,
     and that was right while the only thing behind it was a list of keys for
     a wall that is not there. It now also holds the settings, and an empty
     archive is exactly where a fresh install lands: hiding it would put the
     only switch for whether keeper may talk to the internet behind opening a
     folder first. settings.js drops the shortcuts tab instead, so what is
     behind it here is the settings and nothing else.
     
     The advance toggle does go. It governs a run that cannot happen with
     nothing to run through, and mountAdvance never wires it on an empty
     archive, so a visible button here would answer to nothing. */
  /* Optional, because the blank state has just replaced the shelf's markup
     wholesale and whether this button survived that depends on where it sits
     in the tree. It sat inside the shelf once, and this line threw there, and
     an uncaught throw here kills the rest of the boot: the bench, the tray
     and the view are all wired after it, so an empty archive came up dark
     with nothing on screen to say why. */
  const advance = $("#advance-toggle");
  if (advance) advance.hidden = true;
}

/* The blank state above throws the filter row away along with the grid, so
   there is nothing left for the shelf to wire itself to. It is skipped
   rather than guarded field by field, because a screen with no frames on it
   has no filtering, no cursor and no tray to fill. */
if (S.items.length) {
  mountShelf();
  renderShelf();
}
mountBench();
mountPreview();
mountFeel();
mountUndo();

/* the key legend is written in the mac spelling, so a pc reads it back */
paintKeys();

/* The empty state's keycap line. shelf.js owns the sentence in #none and
   writes it with textContent, the right tool for a sentence and the wrong
   one for the markup under it: the write throws the keycap line away. The
   line is static in index.html, so the fix is the watch the tally already
   keeps over its own chips: when a write has removed it, put it back.
   isConnected keeps our own append from waking the watcher into a loop,
   and on an empty archive the blank state above may have taken #none with
   it, in which case there is nothing to guard. */
{
  const none = $("#none");
  const keyline = none?.querySelector(".none-keys");
  if (keyline) {
    const br = keyline.previousElementSibling;
    new MutationObserver(() => {
      if (!keyline.isConnected) none.append(br, keyline);
    }).observe(none, { childList: true });
  }
}
await mountTray();
/* after the state, because whether there is a quit at all is something
   only the server knows. */
mountQuit();
mountUpdate();
tally();
/* last, and not awaited. it shares the screen with the update card rather
   than waiting behind it, because the loud card has no dismiss button and a
   walkthrough parked behind one was never seen, and nothing below it should
   wait on cards somebody may take a minute to read. */
mountTour();
setView(location.hash.slice(1) || "shelf");
