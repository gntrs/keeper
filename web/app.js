import { mountShelf, renderShelf } from "/shelf.js";
import { mountBench, renderBench } from "/bench.js";
import { mountTray, trayView } from "/tray.js";
import { mountPreview, previewOpen } from "/preview.js";
/* mounts itself and exports nothing. it listens on the window, so it has to
   be here rather than inside a view: a folder can be dropped on the bench
   just as well as on the shelf. */
import "/drop.js";
import { viewIn } from "/motion.js";
import { feel, mountFeel } from "/feel.js";
import { paintKeys, pick as chord } from "/host.js";
import { mountUndo } from "/undo.js";
import { mountQuit } from "/quit.js";
import { mountUpdate } from "/update.js";
import { mountTour } from "/tour.js";
import { mountSettings } from "/settings.js";

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

/** every write goes through here, so nothing is only true on screen */
export async function post(route, body, method = "POST") {
  const res = await fetch(route, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
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
 * The four keys that belong to the app rather than to a view, and the rule
 * they are the top of: a bare letter tags a photograph, cmd plus a key does
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

/**
 * An archive with nothing in it is not an error and should not read like
 * one. It is the first thing a new user sees, so it is the only place in
 * keeper that explains itself.
 */
if (!S.items.length) {
  $("#shelf").innerHTML = `
    <div class="blank">
      <h2>nothing here yet</h2>
      <p>drag a folder onto this window, or
         <button class="chip" type="button" data-keeper-choose>choose
         one</button>.</p>
      <p class="hint">keeper looked through <code>${S.root}</code> and found
         no photographs and no film it can read. it reads jpg, png, webp,
         avif, tif, heic and dng, and mov, mp4, m4v and mkv. raw files come in
         through their embedded preview.</p>
      <pre>keeper ~/Pictures/2026</pre>
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
  $("#advance-toggle").hidden = true;
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
/* last, and not awaited. it waits out the update card on a first icon
   launch, and nothing below it should wait on a question somebody may take a
   minute to answer. */
mountTour();
setView(location.hash.slice(1) || "shelf");
