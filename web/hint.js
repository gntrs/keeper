import { S } from "/app.js";

/**
 * ONE SENTENCE ON THE WALL, ONCE, AND THEN NEVER AGAIN.
 *
 * The keyboard is the whole point of keeper and nothing on the screen says
 * so. A person who has never read the source sits down, sees tiles, and
 * clicks, because clicking is what an unlabelled page teaches. This is the
 * one moment the app speaks first: letters tag, k keeps, and ? has the rest.
 *
 * It says it exactly once. A hint that comes back on every load stops being
 * a hint and becomes furniture, the dialog everybody dismisses without
 * reading, and then it is worse than silence because it has taught the
 * habit of dismissing things this app says. So the first dismissal is
 * remembered and the node is never built again. Pressing ? or / counts as
 * a dismissal too, and so does opening the sheet by its button: the sheet
 * is the hint's whole message, and once it is open the messenger has
 * nothing left to do.
 *
 * An empty archive keeps the hint to itself. The empty page is already its
 * own explanation, and there is nothing there for a letter to tag yet.
 */
export function mountHint() {
  if (!S.items.length) return;
  /* Private windows and locked down browsers throw on touching storage.
     A hint is not worth an error, so in that world it simply shows every
     time, which is the least wrong of the available behaviours. */
  try { if (localStorage.getItem("keeper.hinted")) return; } catch {}

  const el = document.createElement("div");
  el.id = "hint";
  el.innerHTML =
    `<p>letters tag. k keeps. press ? for all the keys.</p>` +
    `<button class="chip" type="button">got it</button>`;
  document.body.append(el);

  const toggle = document.querySelector("#keys-toggle");

  const done = () => {
    try { localStorage.setItem("keeper.hinted", "1"); } catch {}
    el.classList.add("going");
    /* the node waits out its own fade before it goes. 340ms is a shade
       over --mid so the removal never cuts the fade short. */
    setTimeout(() => el.remove(), 340);
    window.removeEventListener("keydown", onKey);
    toggle?.removeEventListener("click", done);
  };

  /* "/" is here because it is the same physical key as "?" without the
     shift, and the sheet answers to both. either way the sheet is opening,
     so the hint has done its job. */
  const onKey = (e) => { if (e.key === "?" || e.key === "/") done(); };

  el.querySelector("button").addEventListener("click", done);
  window.addEventListener("keydown", onKey);
  toggle?.addEventListener("click", done);
}
