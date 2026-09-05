/* ---------------------------------------------------------------------
   the downloads tab, and the second place keeper reaches off the machine.

   IT ASKS IN THE SAME WORDS THE UPDATER DOES, and for the same reason.
   Until the question is answered the server fetches nothing, so a keeper
   that has never been asked has never spoken to github about this either.
   Answer never and the policy is written off. Answer not now and nothing is
   written at all, so the question is back next launch: dismissing a question
   is not answering it.

   IT SHOWS THE REQUESTS RATHER THAN DESCRIBING THEM. Two addresses, written
   out, because the thing being consented to here is bigger than a version
   check: saying yes fetches two programs off the internet and then runs
   them. Somebody deciding that is owed the addresses, not a sentence about
   how ordinary they are.

   THE CARD IS THE WHOLE TAB. Every state below paints into one box rather
   than into a page of sections that appear and disappear, because there is
   only ever one thing to do here: answer the question, wait for the two
   programs, or paste a link. A layout with room for all three at once would
   be mostly empty in every state it has.
   --------------------------------------------------------------------- */

import { post } from "/app.js";
import { feel } from "/feel.js";

/* How often a running job is asked what it has said. Fast enough that
   yt-dlp's own percentage line reads as live, slow enough that a long
   download is a few hundred requests to a server on this machine. */
const BEAT = 700;

/* Consecutive polls that could not reach the server before the job is
   called lost. One dropped request while a download is running is not a
   failed download, and treating it as one would throw away work that is
   still going on underneath. */
const MISSES = 20;

/* the two requests saying yes turns on, written the way the wire writes
   them. they live here rather than coming from the server the way the
   updater's does, because these are the addresses of somebody else's
   releases, not of a keeper constant that could move. */
const WHERE = [
  "GET api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
  "GET api.github.com/repos/spotDL/spotify-downloader/releases/latest",
];

const make = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

const button = (text, cls = "chip") => {
  const b = make("button", cls);
  b.type = "button";
  b.textContent = text;
  return b;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (route, body) =>
  fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

/* the last segment of a path from either machine, for a row that has to say
   which file landed and has no room for the folder it landed in. */
const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? String(p);

/* the card, built once. every state replaces its inside. */
const root = make("div", "dl");
const card = make("aside", "up dl-card");
const kicker = make("p", "label up-kicker");
const line = make("p", "up-line");
const guts = make("div", "dl-guts");
const more = make("div", "up-more");
const moreIn = make("div");
const acts = make("div", "up-acts");
more.append(moreIn);
card.append(kicker, line, guts, more, acts);
root.append(card);

/** the section app.js shows and hides. mountDownloads finds it. */
let view = null;

/** the last answer from GET /api/downloads, which is all the state there is */
let state = null;

/** not now, for this run of the page only. nothing about it is written down */
let dismissed = false;

/** a setup post is in flight, so a second one must not be started over it */
let setting = false;

/** a download is running, so a repaint from anywhere else must leave it alone */
let running = false;

/** bumped by every paint. a poll loop whose number has moved on stops. */
let job = 0;

/** what was typed, kept across the repaint the folder picker causes */
let link = "";

const showing = () => !!view && !view.hidden;

/**
 * Put the card in a state.
 *
 * The whole inside is replaced at once and the entry animation is re-run,
 * because a card whose words changed underneath somebody who was reading
 * them has told them nothing about the fact that anything happened.
 */
function show({ label, said, body = null, detail = null, buttons = [], loud = false }) {
  /* every failure path lands here, so the pulse of whatever wait came before
     dies with the state that started it and an error never breathes like
     work still being done. */
  card.classList.remove("busy");
  kicker.textContent = label;
  line.textContent = said;

  guts.replaceChildren(...(body ? [body] : []));
  guts.hidden = !body;

  moreIn.replaceChildren(...(detail ? [detail] : []));
  more.hidden = !detail;
  more.dataset.open = "no";

  acts.replaceChildren(...buttons);
  acts.hidden = !buttons.length;

  card.classList.toggle("loud", loud);
  card.hidden = false;
  /* restart the entry animation. reading the offset is what forces the
     browser to notice the class went away before it comes back, and without
     that line the second state change does not animate at all. */
  card.classList.remove("in");
  void card.offsetWidth;
  card.classList.add("in");
}

/** the states that are a wait, and the only ones that move */
const working = (said) => {
  show({ label: "downloads", said });
  card.classList.add("busy");
};

/**
 * A fold that opens on click, animated by grid rows rather than by height.
 *
 * A height transition needs a number and the number is whatever the text
 * turns out to be, so it gets guessed at as a max-height that is too big and
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

/** what saying yes turns on, in the words of the wire */
function whatItSends() {
  const box = make("div");
  for (const req of WHERE) {
    const el = make("code", "up-req");
    el.textContent = req;
    box.append(el);
  }
  const p = make("p");
  p.textContent =
    "two requests, both to github's public release list, no account and no key. "
    + "keeper reads the file names out of the answers, fetches those two programs "
    + "into its own folder, and runs them on the links you paste. it sends nothing "
    + "about you and nothing about your archive.";
  box.append(p);
  return box;
}

/**
 * Which of the two programs a link is for.
 *
 * A guess, and only the default. It is sent when it is confident and left
 * out when it is not, so the server's own reading of the link is what
 * decides rather than a hostname list in a browser that can go stale.
 */
function kindOf(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (host === "youtube.com" || host === "m.youtube.com"
    || host === "music.youtube.com" || host === "youtu.be") return "youtube";
  if (host === "open.spotify.com") return "spotify";
  return null;
}

/* --- the question ---------------------------------------------------- */

/**
 * Three buttons and only two of them are answers.
 *
 * Never writes the policy off and the question is settled. Not now writes
 * nothing at all: the card steps aside, the policy stays ask, and the
 * question comes back next launch.
 */
function ask() {
  const never = button("never");
  const no = button("not now");
  const yes = button("set it up", "chip up-go");

  never.addEventListener("click", async () => {
    card.classList.add("going");
    const wrote = await post("/api/downloads/allow", { yes: false });
    await sleep(200);
    card.classList.remove("going");
    state = { ...(state ?? {}), policy: wrote ? "off" : "ask" };
    paint();
  });

  no.addEventListener("click", async () => {
    card.classList.add("going");
    await sleep(200);
    card.classList.remove("going");
    dismissed = true;
    asked();
  });

  yes.addEventListener("click", async () => {
    working("writing that down.");
    try {
      await send("/api/downloads/allow", { yes: true });
    } catch {
      show({ label: "downloads", said: "that did not get written. try again." });
      return;
    }
    feel("tap");
    /* read the whole state back rather than trusting the shape of one
       route's answer. the next thing this does is fetch two programs, and it
       should do that off what the server says is true now. */
    look();
  });

  show({
    label: "downloads",
    said: "keeper can fetch the audio behind a youtube or spotify link. "
      + "it needs the internet and two small programs, yt-dlp and spotDL, "
      + "which it gets from their own github releases.",
    detail: fold("what it sends", whatItSends()),
    buttons: [never, no, yes],
  });
}

/** after not now. nothing was written, so there is a way back in the same breath */
function asked() {
  const again = button("ask me");
  again.addEventListener("click", () => { dismissed = false; ask(); });
  show({
    label: "downloads",
    said: "not now. nothing was written, so this asks again next time keeper opens.",
    buttons: [again],
  });
}

/** after never, and whenever the switch in settings is off */
function off() {
  show({
    label: "downloads",
    said: "downloads are off. the switch is in settings, under ?.",
  });
}

/* --- fetching the two programs --------------------------------------- */

/** one line per program, with the word that says where it has got to */
function step(name) {
  const row = make("div", "dl-step");
  const who = make("span");
  who.textContent = name;
  const say = make("span", "dl-say");
  row.append(who, say);
  row.dataset.state = "wait";
  return {
    row,
    at(word, at) { say.textContent = word; row.dataset.state = at; },
  };
}

/**
 * The one blocking call in here.
 *
 * There is no progress stream behind it, so this says what it is doing and
 * how far it has got only in the crude sense of which of the two are done.
 * Both lines go amber together and both are answered together, which is
 * honest about a single request and better than a bar that moves without
 * being told anything.
 */
function gear() {
  const yt = step("yt-dlp");
  const sp = step("spotDL");
  const steps = make("div", "dl-steps");
  steps.append(yt.row, sp.row);

  const settle = (out) => {
    yt.at(out?.ytdlp ? "ready" : "did not arrive", out?.ytdlp ? "ok" : "no");
    sp.at(out?.spotdl ? "ready" : "did not arrive", out?.spotdl ? "ok" : "no");
  };

  const run = async () => {
    if (setting) return;
    setting = true;
    yt.at("fetching", "doing");
    sp.at("fetching", "doing");
    show({ label: "downloads", said: "getting the two programs. this is once, not every time.", body: steps });
    card.classList.add("busy");

    let out;
    try {
      out = await send("/api/downloads/setup", {});
    } catch {
      setting = false;
      settle(null);
      const retry = button("try again", "chip up-go");
      retry.addEventListener("click", run);
      show({
        label: "downloads",
        said: "that did not finish, and nothing was installed. it is usually the internet.",
        body: steps,
        buttons: [retry],
      });
      return;
    }
    setting = false;
    settle(out);

    if (out?.ok && out?.ytdlp && out?.spotdl) {
      feel("tap");
      state = { ...(state ?? {}), ready: { ytdlp: true, spotdl: true } };
      paint();
      return;
    }

    /* a half finished setup is still a state worth keeping, so what did
       arrive is remembered and only the missing half is fetched again. */
    state = { ...(state ?? {}), ready: { ytdlp: !!out?.ytdlp, spotdl: !!out?.spotdl } };
    const retry = button("try again", "chip up-go");
    retry.addEventListener("click", run);
    show({
      label: "downloads",
      said: out?.error || "one of them did not arrive.",
      body: steps,
      buttons: [retry],
    });
  };

  const have = state?.ready ?? {};
  yt.at(have.ytdlp ? "ready" : "not here yet", have.ytdlp ? "ok" : "wait");
  sp.at(have.spotdl ? "ready" : "not here yet", have.spotdl ? "ok" : "wait");

  /* fetching two programs the moment the page loads, for a tab nobody has
     opened, is not what saying yes meant. it waits until the tab is in
     front of somebody, and until then it offers the button instead. */
  if (showing()) { run(); return; }

  const go = button("get them", "chip up-go");
  go.addEventListener("click", run);
  show({
    label: "downloads",
    said: "keeper needs its two helper programs before it can fetch anything.",
    body: steps,
    buttons: [go],
  });
}

/* --- the folder ------------------------------------------------------- */

/**
 * The machine's own folder dialog, then the write that remembers the answer.
 *
 * Two calls rather than one, because /api/choose is the chooser the rest of
 * keeper already uses and the answer it gives is a real path off the
 * machine rather than a guess. The second call is only the remembering.
 *
 * The request stays open for as long as the dialog is up, which can be a
 * minute if somebody goes hunting through a disk, so the card says where
 * the dialog is rather than sitting silent and reading as a hang.
 */
async function pick() {
  working("the folder dialog is open in front of this window. keeper is waiting for it.");

  let picked;
  try {
    picked = await send("/api/choose", {});
  } catch {
    show({ label: "downloads", said: "the folder dialog could not be opened." });
    return;
  }

  /* cancel is an answer, not an error. it goes back to the form with
     whatever was already remembered still remembered. */
  if (picked?.cancelled) { paint(); return; }
  const dir = picked?.path;
  if (!dir) {
    const back = button("back");
    back.addEventListener("click", paint);
    show({ label: "downloads", said: picked?.error || "the folder dialog came back with nothing.", buttons: [back] });
    return;
  }

  let out;
  try {
    out = await send("/api/downloads/folder", { dir });
  } catch {
    show({ label: "downloads", said: "that folder could not be written down. try again." });
    return;
  }
  if (out?.error) {
    const back = button("back");
    back.addEventListener("click", paint);
    show({ label: "downloads", said: out.error, buttons: [back] });
    return;
  }

  feel("tick");
  state = { ...(state ?? {}), folder: out?.folder ?? out?.dir ?? dir };
  paint();
}

/* --- the form --------------------------------------------------------- */

function form() {
  const box = make("div", "dl-form");

  const url = make("input", "dl-url");
  url.type = "url";
  url.placeholder = "paste a youtube or spotify link";
  url.spellcheck = false;
  url.autocomplete = "off";
  url.value = link;

  const row = make("div", "dl-row");
  const into = make("span", "label");
  into.textContent = "into";
  const where = make("code", "dl-path");
  where.textContent = state?.folder ?? "no folder chosen yet";
  const change = button(state?.folder ? "change" : "choose");
  change.addEventListener("click", pick);
  row.append(into, where, change);

  const note = make("p", "dl-note");
  note.textContent =
    "one track at a time. a youtube link that sits inside a playlist gets that one "
    + "video and not the playlist. a spotify album or playlist link is turned down "
    + "rather than guessed at, so nothing here can start two hundred downloads.";

  box.append(url, row, note);

  /* ffmpeg is not one of the two keeper fetches. it has to be on the machine
     already, and without it a download comes back as the video container it
     arrived in rather than an mp3, so this is said before a link is pasted
     rather than after ten megabytes have come down. */
  if (state?.ffmpeg === false) {
    const warn = make("p", "dl-warn");
    warn.textContent =
      "ffmpeg is missing, and keeper needs it to make an mp3. install it from "
      + "ffmpeg.org and open keeper again. nothing here works until then.";
    box.append(warn);
  }

  const go = button("get the audio", "chip up-go");

  const armed = () => {
    go.disabled = !url.value.trim() || !state?.folder;
  };
  url.addEventListener("input", () => { link = url.value; armed(); });
  url.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!go.disabled) begin(url.value.trim());
  });
  go.addEventListener("click", () => begin(url.value.trim()));

  show({
    label: "downloads",
    said: "paste a link and keeper fetches the audio as an mp3.",
    body: box,
    buttons: [go],
  });
  armed();
  if (showing()) url.focus();
}

/**
 * Hand the link to the server and then follow what it says about it.
 *
 * The kind is sent only when the hostname is one of the two this is sure
 * about, and left out otherwise so the server's own reading decides. A
 * browser guessing wrong and saying so with confidence is worse than a
 * browser saying nothing.
 */
async function begin(url) {
  if (!url) return;
  if (!state?.folder) { pick(); return; }

  link = url;
  const kind = kindOf(url);
  working("asking for it.");

  let out;
  try {
    out = await send("/api/downloads/start", {
      url,
      ...(kind ? { kind } : {}),
      folder: state.folder,
    });
  } catch {
    const back = button("back");
    back.addEventListener("click", paint);
    show({ label: "downloads", said: "that did not get sent, and nothing was downloaded.", buttons: [back] });
    return;
  }

  if (!out?.id) {
    const back = button("back");
    back.addEventListener("click", paint);
    show({ label: "downloads", said: out?.error || "keeper could not make sense of that link.", buttons: [back] });
    return;
  }

  follow(out.id);
}

/**
 * The running job, said in its own words.
 *
 * yt-dlp and spotDL both narrate what they are doing, and a person watching
 * a file arrive would rather read that than watch a spinner: it is the
 * difference between a wait and a hang. Only the lines not shown yet are
 * appended, because every poll answers with the whole buffer.
 */
async function follow(id) {
  const mine = ++job;
  running = true;

  const log = make("div", "dl-log");
  show({ label: "downloads", said: "getting the audio.", body: log });
  card.classList.add("busy");

  let shown = 0;
  let missed = 0;

  while (mine === job) {
    await sleep(BEAT);
    if (mine !== job) return;

    let out;
    try {
      out = await (await fetch(`/api/downloads/jobs/${encodeURIComponent(id)}`, { cache: "no-store" })).json();
    } catch {
      /* one poll that could not reach a server on this machine is a dropped
         request, not a dead download, and giving up on the first would throw
         away work that is still going on. */
      if (++missed >= MISSES) break;
      continue;
    }
    missed = 0;

    const lines = out?.lines ?? [];
    if (lines.length > shown) {
      for (const text of lines.slice(shown)) {
        const l = make("p", "dl-line");
        l.textContent = text;
        log.append(l);
      }
      shown = lines.length;
      log.scrollTop = log.scrollHeight;
    }

    if (!out?.done) {
      /* the job is gone from the server's map, which after a restart or a
         second read of a finished job is every bit as final as done. without
         this the loop asks a dead id every beat until the tab closes. */
      if (out?.error) { running = false; return failed(out.error, log); }
      continue;
    }
    running = false;
    if (out.ok) return landed(out.files ?? [], log);
    return failed(out.error || "that did not finish.", log, out.files ?? []);
  }

  running = false;
  if (mine === job) failed("the download stopped answering. nothing else was changed.", log);
}

/** what arrived, and the way to go and look at it */
function landed(files, log) {
  feel("tap");
  const box = make("div");

  if (files.length) {
    const list = make("div", "dl-files");
    for (const file of files) {
      const r = make("div", "dl-file");
      const n = make("code", "dl-path");
      n.textContent = base(file);
      const rev = button("reveal");
      rev.addEventListener("click", () => { feel("tick"); post("/api/downloads/reveal", { file }); });
      r.append(n, rev);
      list.append(r);
    }
    box.append(list);
  }
  box.append(log);

  const again = button("another", "chip up-go");
  again.addEventListener("click", () => { link = ""; paint(); });

  show({
    label: "downloads",
    said: files.length === 1 ? "one file, in your folder."
      : files.length ? `${files.length} files, in your folder.`
        : "it finished and named no file. what it said is below.",
    body: box,
    buttons: [again],
    loud: !!files.length,
  });
  /* moving a scrollable element to a new parent puts it back at the top, so
     the log that was following the download ends up showing its first line
     rather than its last. put it back at the end after the move. */
  log.scrollTop = log.scrollHeight;
}

/** what went wrong, with what it said still on screen underneath */
function failed(error, log, files = []) {
  const box = make("div");

  /* a download that failed halfway can still have put something in the
     folder, and leaving that unsaid means somebody finds a file later with
     no idea what left it there. it is not offered as a result, only named. */
  if (files.length) {
    const left = make("p", "dl-note");
    left.textContent = files.length === 1
      ? `it left one file behind in your folder: ${base(files[0])}`
      : `it left ${files.length} files behind in your folder.`;
    box.append(left);
  }

  box.append(log);
  const again = button("try again", "chip up-go");
  again.addEventListener("click", paint);
  show({ label: "downloads", said: error, body: box, buttons: [again] });
  /* the same re-parent that resets the scroll on a good run, and the line
     that says what went wrong is the last one. */
  log.scrollTop = log.scrollHeight;
}

/* --- which of those it is -------------------------------------------- */

/**
 * Painted fresh every time rather than diffed.
 *
 * Five states, one box, and no two of them share a control. Working out
 * which parts of the last state can stay would cost more than building the
 * next one, and it is the kind of arithmetic that goes wrong quietly.
 */
function paint() {
  /* whatever was being polled belongs to the state being replaced */
  job++;
  running = false;

  const s = state ?? {};
  if (s.policy === "off") return off();
  if (s.policy !== "on") return dismissed ? asked() : ask();
  if (!s.ready?.ytdlp || !s.ready?.spotdl) return gear();
  return form();
}

/**
 * One in flight at a time, and never two.
 *
 * mountDownloads asks at page load and the observer asks again the first time
 * the tab is opened, so two of these were routinely in the air together. That
 * was harmless when the answer was a disk check and expensive when it was not:
 * the server used to prove each helper program by running it, and four
 * concurrent unpacks of a 40 mb bundle took over a minute between them and
 * timed out into a state that said the programs were missing.
 *
 * The server does not do that any more. This stays because two callers asking
 * the same question at the same moment should still only ask once.
 */
let looking = null;

function look() {
  if (looking) return looking;
  looking = (async () => {
    try {
      state = await (await fetch("/api/downloads", { cache: "no-store" })).json();
      paint();
    } catch {
      show({ label: "downloads", said: "keeper is not answering about this. reload the page." });
    } finally {
      looking = null;
    }
  })();
  return looking;
}

export function mountDownloads() {
  view = document.querySelector("#downloads");
  if (!view) return;
  view.append(root);

  /* something written in the card before the first answer comes back. it
     used to paint nothing at all until then, so a tab opened before the
     server had replied was an empty box of no explained size, which read as
     a broken page rather than as a wait. */
  working("looking at what is set up here.");

  /* app.js shows the tab by flipping the hidden attribute on the section,
     and there is nothing else to listen to for that. coming back to the tab
     re-reads the state, so a switch thrown in settings while the shelf was
     up is not still wrong here. */
  new MutationObserver(() => {
    if (!showing() || running || setting) return;
    look();
  }).observe(view, { attributes: true, attributeFilter: ["hidden"] });

  /* escape is not now without the mouse. not while busy, because a card
     mid setup or mid download is the only report of work in flight. */
  window.addEventListener("keydown", (e) => {
    /* defaultPrevented, because the preview card and the folder panel both
       stand over this tab and both mark the escape they answer: a keystroke
       spent closing what somebody was actually looking at must not also
       take the question with it. */
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!showing()) return;

    /* a field takes its own escape first. giving the keys back to the page
       is the whole of what that press means while a link is being typed. */
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && root.contains(el)) {
      el.blur();
      e.preventDefault();
      return;
    }

    if (card.classList.contains("busy")) return;
    if (state?.policy !== "ask" || dismissed) return;
    dismissed = true;
    card.classList.add("going");
    setTimeout(() => { card.classList.remove("going"); asked(); }, 200);
  });

  look();
}
