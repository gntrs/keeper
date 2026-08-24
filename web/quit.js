/* ---------------------------------------------------------------------
   stopping keeper, for the person who has no terminal to stop it in.

   Run from a command line there is a ctrl-c and this file draws nothing.
   Run from its icon there is no window of keeper's own to close, because
   the app is a server and a browser tab: closing the tab leaves the server
   running and quitting the browser leaves it running harder. So the only
   quit that exists has to live on the page, and it has to be honest about
   being a quit rather than a close.

   It arms rather than asking. A dialog would be the obvious thing and it is
   the wrong thing twice over: it is the same weight of interruption as the
   one this app puts in front of moving an original file to the trash, which
   would say the two are comparable, and it is a second click either way. So
   the button says what it is about to do and waits, exactly like every other
   armed control in here.
   --------------------------------------------------------------------- */

import { S, post } from "/app.js";
import { feel } from "/feel.js";

/* long enough to move a hand back to the mouse, short enough that a button
   left saying "sure?" across a coffee break has forgotten by the time
   anybody leans on it again. */
const ARMED = 3000;

export function mountQuit() {
  /* Nothing to draw for a terminal launch, and nothing to hide either: the
     button is never made, so there is no disabled control sitting in the bar
     explaining why it does not apply. */
  if (!S.app) return;

  const bar = document.querySelector("header.bar");
  if (!bar) return;

  const b = document.createElement("button");
  b.id = "quit";
  b.type = "button";
  b.textContent = "quit";
  b.title = "stop keeper. the archive is already saved.";
  bar.append(b);

  let armed = 0;
  let timer = 0;

  const rest = () => {
    clearTimeout(timer);
    armed = 0;
    b.classList.remove("armed");
    b.textContent = "quit";
  };

  b.addEventListener("click", async () => {
    if (!armed) {
      armed = 1;
      b.classList.add("armed");
      b.textContent = "sure?";
      feel("tap");
      timer = setTimeout(rest, ARMED);
      return;
    }

    clearTimeout(timer);
    b.disabled = true;
    b.textContent = "stopping";

    /* The reply is sent before the process goes, so an error here is a real
       refusal and worth reading. A fetch that simply dies as the socket
       closes is the success case and must not be reported as a failure. */
    try {
      await post("/api/quit");
    } catch {
      /* the process went before the answer landed, which is the point */
    }

    /* What is left on screen once there is nothing behind it. The page is
       still a page and every button on it now points at a port that is not
       answering, so it is replaced rather than left to fail one control at a
       time. */
    document.body.innerHTML = `
      <div class="blank">
        <h2>keeper is closed</h2>
        <p>everything is written. this tab can go.</p>
        <p class="hint">open it again from the keeper icon.</p>
      </div>`;
  });

  /* Escape disarms, because it is the key that means no everywhere else in
     this app and a person who armed this by accident should not have to find
     somewhere safe to click. */
  addEventListener("keydown", (e) => { if (e.key === "Escape" && armed) rest(); });
}
