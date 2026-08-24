/* ---------------------------------------------------------------------
   the one place keeper reaches off the machine, and it asks first.

   THE QUESTION IS ASKED ONCE AND THE DEFAULT IS NO REQUEST AT ALL. Until it
   is answered the server makes no call, so a keeper that has never been
   asked has never spoken to anything. Answer no and this panel is gone for
   good and the check never runs again.

   IT SHOWS THE REQUEST RATHER THAN DESCRIBING IT. The address comes from the
   server, out of the same constant the fetch uses, so what is on screen
   cannot drift from what is sent. A sentence saying a request is harmless is
   worth less than the request, and somebody deciding whether to let a program
   talk to the internet is owed the second one.
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

const root = make("aside", "up");
const kicker = make("p", "label up-kicker");
const line = make("p", "up-line");
const more = make("div", "up-more");
const moreIn = make("div");
const acts = make("div", "up-acts");
root.hidden = true;
more.append(moreIn);
root.append(kicker, line, more, acts);

const button = (text, cls = "chip") => {
  const b = make("button", cls);
  b.type = "button";
  b.textContent = text;
  return b;
};

/**
 * Put the card in a state.
 *
 * The whole inside is replaced at once and the card is asked to re-run its
 * entry, because a card whose words changed underneath a person who was
 * reading them has told them nothing about the fact that anything happened.
 * One short move says it.
 */
function show({ label, said, detail = null, buttons = [], loud = false }) {
  kicker.textContent = label;
  line.textContent = said;

  moreIn.replaceChildren(...(detail ? [detail] : []));
  more.hidden = !detail;
  more.dataset.open = "no";

  acts.replaceChildren(...buttons);
  acts.hidden = !buttons.length;

  root.classList.toggle("loud", loud);
  root.hidden = false;
  /* restart the entry animation. reading the offset is what forces the
     browser to notice the class went away before it comes back, and without
     that line the second state change does not animate at all. */
  root.classList.remove("in");
  void root.offsetWidth;
  root.classList.add("in");
}

/**
 * A fold that opens on click, animated by grid rows rather than by height.
 *
 * A height transition needs a number, and the number is whatever the text
 * turns out to be, so it gets guessed as a max-height that is too big and
 * the fold moves at the wrong speed. Zero to one fraction of a grid row is
 * the same effect measured by the browser instead of by me.
 */
function fold(summary, body) {
  const wrap = make("div", "up-fold");
  const head = make("button", "up-fold-head");
  head.type = "button";
  head.append(make("i"), document.createTextNode(summary));
  const inner = make("div", "up-fold-body");
  inner.append(body);
  const cage = make("div", "up-fold-cage");
  cage.append(inner);
  wrap.append(head, cage);
  head.addEventListener("click", () => {
    const open = wrap.dataset.open === "yes";
    wrap.dataset.open = open ? "no" : "yes";
    head.setAttribute("aria-expanded", String(!open));
    feel("tap");
  });
  wrap.dataset.open = "no";
  head.setAttribute("aria-expanded", "false");
  return wrap;
}

/** what the check actually is, in the words of the wire */
function whatItSends(where) {
  const box = make("div");
  const req = make("code", "up-req");
  req.textContent = `GET ${where.replace(/^https?:\/\//, "")}`;
  /* One sentence, because the fold is the glance and the link is the read.
     It used to carry a second paragraph about loopback, which is true and is
     also already written out at the other end of the link, and a fold long
     enough to need scrolling has stopped being a glance. */
  const p = make("p");
  p.textContent =
    "that is the whole request. no name, no machine id, no cookie, nothing about "
    + "your archive. keeper reads the version out of the answer and closes it.";

  /* The link says where it goes. `the long version` said what was at the far
     end and not which end it was, and a link out of an app that has just
     finished promising it talks to nothing owes somebody the domain before
     they click it rather than after. */
  const a = make("a", "up-link");
  a.href = "https://github.com/gntrs/keeper#local-and-what-that-actually-means";
  a.target = "_blank";
  a.rel = "noopener";
  a.append(document.createTextNode("github.com/gntrs/keeper"), make("i"));
  box.append(req, p, a);
  return box;
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
  show({ label: "update", said: "keeper has not come back on its own. open it again from the icon." });
}

/** the only state in here that is a wait, so it is the only one that moves */
const working = (said) => {
  show({ label: "updates", said });
  root.classList.add("busy");
};

function ready(state) {
  root.classList.remove("busy");
  if (state.error || !state.ready) { root.hidden = true; return; }

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
    show({
      label: "update",
      said: `${state.latest} is out, and needs a full download because what keeper depends on changed.`,
      buttons, loud: true,
    });
    return;
  }

  const go = button("update now", "chip up-go");
  go.addEventListener("click", async () => {
    working(`getting ${state.latest}.`);
    let out;
    try {
      out = await (await fetch("/api/update/apply", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      })).json();
    } catch {
      show({ label: "update", said: "that did not finish, and nothing changed. try again." });
      return;
    }
    root.classList.remove("busy");
    if (out?.error) { show({ label: "update", said: out.error }); return; }

    feel("tap");
    if (out.restarts) {
      working(`${out.version} is in. restarting, and this page comes back on its own.`);
      waitAndReload();
    } else {
      show({ label: "update", said: `${out.version} is in. stop keeper and start it again.` });
    }
  });
  buttons.push(go);

  show({
    label: "update",
    said: `keeper ${state.latest} is out. you are on ${state.current}.`,
    buttons, loud: true,
  });
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
    const yes = button("check", "chip up-go");
    no.addEventListener("click", async () => {
      root.classList.add("going");
      await post("/api/update/allow", { yes: false });
      setTimeout(() => { root.hidden = true; root.classList.remove("going"); }, 200);
    });
    yes.addEventListener("click", async () => {
      working("asking github.");
      let out;
      try {
        out = await (await fetch("/api/update/allow", {
          method: "POST", headers: { "content-type": "application/json" }, body: '{"yes":true}',
        })).json();
      } catch {
        show({ label: "updates", said: "could not reach github. it will ask again next time." });
        return;
      }
      ready(out);
    });
    show({
      label: "updates",
      said: "can keeper check github for a newer update?",
      detail: fold("what it sends", whatItSends(state.where ?? "")),
      buttons: [no, yes],
    });
    return;
  }

  if (state.policy !== "on") return;
  ready(state);
}

export function mountUpdate() {
  /* Only the installed kind. Somebody who typed a command to get here has a
     terminal, a checkout, and their own opinion about when to update. */
  if (!S.app) return;
  document.body.append(root);
  look();
}
