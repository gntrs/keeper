/* ---------------------------------------------------------------------
   the one place keeper reaches off the machine, and it asks first.

   THE DEFAULT IS NO REQUEST AT ALL. Until the question is answered the
   server makes no call, so a keeper that has never been asked has never
   spoken to anything. Answer never and this panel is gone for good and
   keeper never checks on its own again. Answer not now and nothing is
   written, so it asks again next launch: dismissing a question is not
   answering it.

   NEVER IS ABOUT THIS PANEL, NOT ABOUT THE VERSION IN THE CORNER. Pressing
   that asks once and writes nothing, whatever was answered here, and the
   card it opens can install what it found. Anything else made never into a
   door that locked from the inside: the check would run, say a newer keeper
   was out, and then refuse to fetch it with no way left to consent.

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
  /* every failure path lands here, so the pulse of whatever wait came
     before dies with the state that started it, and an error never breathes
     like work still being done. */
  root.classList.remove("busy");
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
    /* three buttons and only two of them are answers. never writes the
       policy off and the question is settled. not now writes nothing at
       all: the card leaves the same way, the policy stays ask, and the
       question comes back next launch. */
    const never = button("never");
    const no = button("not now");
    const yes = button("check", "chip up-go");
    never.addEventListener("click", async () => {
      root.classList.add("going");
      await post("/api/update/allow", { yes: false });
      setTimeout(() => { root.hidden = true; root.classList.remove("going"); }, 200);
    });
    no.addEventListener("click", () => {
      root.classList.add("going");
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
      buttons: [never, no, yes],
    });
    return;
  }

  if (state.policy !== "on") return;
  ready(state);
}

/**
 * THE VERSION IN THE CORNER, AND THE WAY TO ASK FOR A NEWER ONE.
 *
 * The card is honest and quiet: it says nothing at all when there is nothing
 * to say, which is right, and leaves somebody who wants to know with nowhere
 * to press. On a mac that person shrugs. On windows they went looking for a
 * json file in a hidden folder, which is what this exists to never happen
 * again.
 *
 * Pressing it makes the one request whatever the policy says, because a
 * person asking is not keeper deciding to look, and it writes nothing down:
 * an answer of never survives being curious once.
 */
function mountVersion() {
  const el = document.querySelector("#ver");
  if (!el) return;

  const paint = (text, busy = false) => {
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("busy", busy);
  };

  fetch("/api/update")
    .then((r) => r.json())
    .then((s) => { if (!s.clone && s.current) paint(s.current); })
    .catch(() => {});

  el.addEventListener("click", async () => {
    paint("looking", true);
    let s;
    try {
      s = await (await fetch("/api/update?once=1")).json();
    } catch {
      paint("no answer");
      setTimeout(() => fetch("/api/update").then((r) => r.json()).then((x) => paint(x.current ?? "")), 2400);
      return;
    }
    if (s.ready) {
      /* hand it to the card, which already knows how to offer an install and
         is the only thing that should ever start one. */
      root.hidden = false;
      ready(s);
      paint(s.current ?? "");
      return;
    }
    paint(s.error ? "no answer" : "newest");
    setTimeout(() => paint(s.current ?? ""), 2400);
  });
}

export function mountUpdate() {
  /* Only the installed kind. Somebody who typed a command to get here has a
     terminal, a checkout, and their own opinion about when to update. */
  if (!S.app) return;
  document.body.append(root);
  /* escape is not now without the mouse: it hides the card and writes
     nothing, so the question is back next launch. not while busy, because
     hiding a card mid apply would hide the only report of a restart in
     flight. */
  window.addEventListener("keydown", (e) => {
    /* defaultPrevented, because the preview card and the folder panel both
       stand over this one and both mark the escape they answer: a keystroke
       spent closing what the person was actually looking at must not also
       take the question with it. */
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (root.hidden || root.classList.contains("busy")) return;
    root.hidden = true;
  });
  look();
  mountVersion();
}
