/* ---------------------------------------------------------------------
   the one place keeper reaches off the machine, and it asks first.

   THE QUESTION IS ASKED ONCE AND THE DEFAULT IS NO REQUEST AT ALL. Until it
   is answered the server makes no call, so a keeper that has never been
   asked has never spoken to anything. Answer no and this panel is gone for
   good and the check never runs again.

   What it says when there is an update is the version and a link to what
   changed, and then one button. Everything after that button is the server's
   work: it downloads, it checks the checksum against what the release
   published, it swaps the files, and it starts the new keeper. This page's
   last job is to wait for the port to answer again and reload itself, so an
   update looks like the page blinking rather than like the app dying.
   --------------------------------------------------------------------- */

import { S, post } from "/app.js";
import { feel } from "/feel.js";

/* Every second, for two minutes. The swap itself is instant; what takes time
   is a machine that was busy making thumbnails when the process went. */
const BEAT = 1000;
const PATIENCE = 120;

const make = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

const root = make("div", "up");
const kicker = make("p", "label up-kicker");
const line = make("p", "up-line");
const acts = make("div", "up-acts");
root.hidden = true;
root.append(kicker, line, acts);

const button = (text, cls = "chip") => {
  const b = make("button", cls);
  b.type = "button";
  b.textContent = text;
  return b;
};

function show(label, said, buttons = []) {
  kicker.textContent = label;
  line.textContent = said;
  acts.replaceChildren(...buttons);
  acts.hidden = !buttons.length;
  root.hidden = false;
}

/**
 * Wait for the new keeper on the same port, then reload.
 *
 * The old process releases the port before starting the new one, so the new
 * one takes the same number back and this page's own address stays correct.
 * If it never comes back, say so plainly rather than spinning: an update that
 * failed and a machine that is slow look identical from here, and the useful
 * sentence covers both.
 */
async function waitAndReload() {
  for (let i = 0; i < PATIENCE; i++) {
    await new Promise((r) => setTimeout(r, BEAT));
    try {
      const res = await fetch("/api/ping", { cache: "no-store" });
      if ((await res.json())?.keeper) { location.reload(); return; }
    } catch {
      /* the port is down, which is the middle of the restart, not a failure */
    }
  }
  show("update", "keeper has not come back on its own. open it again from the icon.");
}

async function look() {
  let state;
  try {
    state = await (await fetch("/api/update")).json();
  } catch {
    return;
  }

  /* a checkout updates with git and is told nothing here */
  if (state.clone) return;

  if (state.policy === "ask") {
    const no = button("not now");
    const yes = button("check for updates", "chip up-go");
    no.addEventListener("click", async () => { await post("/api/update/allow", { yes: false }); root.hidden = true; });
    yes.addEventListener("click", async () => {
      await post("/api/update/allow", { yes: true });
      show("updates", "checking.");
      look();
    });
    show("updates", "keeper can ask github whether there is a newer keeper. it sends nothing about you, your machine or your archive.", [no, yes]);
    return;
  }

  if (state.policy !== "on") return;
  if (state.error) return;            /* offline is not news */
  if (!state.ready) return;           /* already the newest one */

  const buttons = [];
  if (state.notes) {
    const what = button("what changed");
    what.addEventListener("click", () => window.open(state.notes, "_blank", "noopener"));
    buttons.push(what);
  }

  if (state.full) {
    const get = button("open the downloads", "chip up-go");
    get.addEventListener("click", () =>
      window.open("https://github.com/gntrs/keeper/releases/latest", "_blank", "noopener"));
    buttons.push(get);
    show("update", `keeper ${state.latest} is out, and it needs a full download because what keeper depends on changed.`, buttons);
    return;
  }

  const go = button("update now", "chip up-go");
  go.addEventListener("click", async () => {
    show("update", `getting keeper ${state.latest}.`);
    let out;
    try {
      out = await (await fetch("/api/update/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })).json();
    } catch {
      show("update", "that did not finish, and nothing was changed. try again.");
      return;
    }
    if (out?.error) { show("update", out.error); return; }

    feel("tap");
    if (out.restarts) {
      show("update", `keeper ${out.version} is in. it is restarting, and this page will come back on its own.`);
      waitAndReload();
    } else {
      show("update", `keeper ${out.version} is in. stop keeper and start it again to run it.`);
    }
  });
  buttons.push(go);

  show("update", `keeper ${state.latest} is out. you are on ${state.current}.`, buttons);
}

export function mountUpdate() {
  /* Only the installed kind. Somebody who typed a command to get here has a
     terminal, a checkout, and their own opinion about when to update. */
  if (!S.app) return;
  document.body.append(root);
  look();
}
