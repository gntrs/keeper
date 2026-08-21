import { mountShelf, renderShelf } from "/shelf.js";
import { mountBench, renderBench, setPick } from "/bench.js";
import { mountTray, trayView } from "/tray.js";
import { mountPreview, previewOpen } from "/preview.js";
/* mounts itself and exports nothing. it listens on the window, so it has to
   be here rather than inside a view: a folder can be dropped on the bench
   just as well as on the shelf. */
import "/drop.js";

export const S = {
  items: [], tags: {}, placements: {}, slots: [], vocab: {}, hints: {},
  byId: new Map(),
  view: "shelf",
};

const $ = (s) => document.querySelector(s);

/** every write goes through here, so nothing is only true on screen */
export async function post(route, body, method = "POST") {
  const res = await fetch(route, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  if (!res.ok) console.error("[keepers]", route, await res.text());
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
  const kept = S.items.filter((i) => S.tags[i.id]?.star).length;
  /* Your own slots, and only the placements still pointing at one. The
     bench ships fourteen standard shapes nobody set out to fill, so
     counting against all of them read as failure the moment it said 3/14,
     and a config that has been swapped or removed leaves placements behind
     whose slot is gone: live, `hero` and `about-1` were being counted
     against a bench that has no such slot. `keepers export` counts your own
     holes for the same reason. With no slots of your own there is no
     fraction worth printing, so the segment goes. */
  const mine = S.slots.filter((s) => s.group === "yours");
  const placed = mine.filter((s) => S.placements[s.id]).length;
  $("#tally").innerHTML =
    `<span class="dim">${S.items.length} frames · ${kept} kept` +
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
  $("#shelf").hidden = v !== "shelf";
  $("#bench").hidden = v !== "bench";
  trayView(v);
  if (v === "bench") renderBench();
}
addEventListener("hashchange", () => setView(location.hash.slice(1)));
for (const b of document.querySelectorAll("header nav button")) {
  b.onclick = () => setView(b.dataset.view);
}

/**
 * The four keys that belong to the app rather than to a view, and the rule
 * they are the top of: a bare letter tags a photograph, cmd plus a key does
 * something to the app. Three of these work on the bench as well as the
 * shelf, and cmd+o has to work on an archive with nothing in it, where
 * shelf.js never mounts and its key handler does not exist. That is why they
 * are here and the rest are there.
 */
addEventListener("keydown", (e) => {
  if (e.ctrlKey) return;

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
  if (e.metaKey || e.altKey) {
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
      document.querySelector("[data-keepers-choose]")?.click();
      return e.preventDefault();
    }
    return;
  }

  if (e.target.matches("input")) return;
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
S.byId = new Map(S.items.map((i) => [i.id, i]));
$("#root").textContent = S.root;
if (!S.slots.length) document.querySelector('[data-view="bench"]').title =
  "no keepers.config.json, so there are no slots yet";

/**
 * An archive with nothing in it is not an error and should not read like
 * one. It is the first thing a new user sees, so it is the only place in
 * keepers that explains itself.
 */
if (!S.items.length) {
  $("#shelf").innerHTML = `
    <div class="blank">
      <h2>nothing here yet</h2>
      <p>drag a folder onto this window, or
         <button class="chip" type="button" data-keepers-choose>choose
         one</button>.</p>
      <p class="hint">keepers looked through <code>${S.root}</code> and found
         no photographs and no film it can read. it reads jpg, png, webp,
         avif, tif, heic and dng, and mov, mp4, m4v and mkv. raw files come in
         through their embedded preview.</p>
      <pre>keepers ~/Pictures/2026</pre>
    </div>`;
  document.querySelector("footer.keys").hidden = true;
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
await mountTray();
tally();
setView(location.hash.slice(1) || "shelf");
