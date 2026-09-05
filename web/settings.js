/* ---------------------------------------------------------------------
   the settings pane, behind the same key as the shortcuts.

   NOTHING IN HERE OWNS ANY STATE. Every switch is a mirror of a control that
   already exists somewhere else: the sound is feel.js's, auto advance is the
   button in the bar that shelf.js owns and ⌥K throws, and whether keeper may
   look for a newer keeper is a line in keeper's own seat on disk. A settings
   pane that kept its own copy of any of those would be a second source of
   truth for a preference with one value, and the first time the two
   disagreed the person would be right to stop believing either.

   So the switches here click the real control and then read back what it
   says, and the pane repaints itself every time it is opened rather than
   subscribing to anything. It is four rows. Repainting four rows on a press
   of ? costs nothing and cannot go stale, and there is no listener to
   forget to remove.
   --------------------------------------------------------------------- */

import { S } from "/app.js";
import { feel } from "/feel.js";
import { startTour } from "/tour.js";

const $ = (s) => document.querySelector(s);

/** show one pane and mark its tab. the tabs are the only thing that call it */
function pane(name) {
  for (const el of document.querySelectorAll("#keys [data-pane]")) {
    const tab = el.tagName === "BUTTON";
    if (tab) el.classList.toggle("on", el.dataset.pane === name);
    else el.hidden = el.dataset.pane !== name;
  }
}

/**
 * Read the three switches back off the things that really hold them.
 *
 * Auto advance is read off the button's own aria-pressed rather than off
 * localStorage, because the button is what the rest of the app talks to and
 * the attribute is what it writes. Reading the storage instead would work
 * today and would quietly stop being true the first time that state moved.
 */
function paint() {
  const adv = $("#advance-toggle");
  const advRow = $("#set-advance-row");
  /* an archive with nothing in it never wires the toggle up, so the row
     would be a switch answering to nothing. */
  const has = adv && !adv.hidden;
  advRow.hidden = !has;
  if (has) {
    const on = adv.getAttribute("aria-pressed") === "true";
    const b = $("#set-advance");
    b.textContent = on ? "on" : "off";
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }

  /* only an installed keeper. somebody who typed a command to get here has
     a checkout, a terminal, and their own opinion about when to update. */
  const upRow = $("#set-updates-row");
  upRow.hidden = !S.app;
  if (S.app) {
    const b = $("#set-updates");
    const on = S.updates === "on";
    b.textContent = on ? "on" : S.updates === "off" ? "off" : "not asked yet";
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }

  /* downloads has nothing to do with app-vs-checkout, so it shows either
     way. this row is only how you turn it back ON after saying never: the
     downloads tab itself asks the first time and owns setup. */
  {
    const b = $("#set-downloads");
    const on = S.downloads === "on";
    b.textContent = on ? "on" : S.downloads === "off" ? "off" : "not asked yet";
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }

  /* the walkthrough walks a real wall of frames, so there is nothing for it
     to say on an archive with none. */
  const bare = !S.items.length;
  $("#set-tour-row").hidden = bare;

  /* And with nothing on the wall the sheet is the settings and only the
     settings. The shortcuts would be a page of instructions for keys that
     have nothing to act on yet, and the one thing somebody on this screen
     might actually want to decide, whether keeper may look at github, is a
     row on the other pane. Both come back with the first folder. */
  document.querySelector('.keys-tabs [data-pane="keys"]').hidden = bare;
  if (bare) pane("set");
}

export function mountSettings(onOpen) {
  for (const tab of document.querySelectorAll("#keys .keys-tabs button")) {
    tab.onclick = () => { pane(tab.dataset.pane); feel("tick"); };
  }

  $("#set-advance").onclick = () => { $("#advance-toggle")?.click(); paint(); };

  /**
   * On writes the answer and makes the request in the same call, because on
   * is what that means: the server's own route answers yes with the check
   * already in it. Off writes never and makes none.
   *
   * `not asked yet` presses on. It is the only sensible reading of a press
   * on a switch that is not on, and the third state is not a third position
   * on this switch: it is the fact that the card has not been answered, and
   * answering it here is answering it.
   */
  $("#set-updates").onclick = async () => {
    const want = S.updates !== "on";
    const b = $("#set-updates");
    b.disabled = true;
    try {
      const res = await fetch("/api/update/allow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yes: want }),
      });
      S.updates = (await res.json())?.policy ?? S.updates;
    } catch {
      /* github not answering is not a reason for the switch to lie about
         what was written, and the write happened before the request did. */
      S.updates = want ? "on" : "off";
    }
    b.disabled = false;
    feel("tick");
    paint();
  };

  /**
   * The same on/off as updates, one step simpler: the downloads tab is the
   * one that runs setup and asks the first time, so this only ever writes
   * the policy and never fetches anything itself.
   */
  $("#set-downloads").onclick = async () => {
    const want = S.downloads !== "on";
    const b = $("#set-downloads");
    b.disabled = true;
    try {
      const res = await fetch("/api/downloads/allow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yes: want }),
      });
      S.downloads = (await res.json())?.policy ?? S.downloads;
    } catch {
      S.downloads = want ? "on" : "off";
    }
    b.disabled = false;
    feel("tick");
    paint();
  };

  $("#set-tour").onclick = () => { onOpen(false); startTour(); };

  /* the pane is painted on the way in rather than watched, so it can never
     be showing yesterday's answer. */
  return paint;
}
