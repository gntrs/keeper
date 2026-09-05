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

   A QUESTION IS A CARD AND WORK IS A DESK, and they are two different
   shapes on purpose. The whole tab used to be one 480px card floating in the
   middle of a window that is usually 1400 wide, which is right for a
   yes or no and wrong the moment there is a download to watch: the one
   thing here with real content, the program's own output, was folded into a
   160px box while most of the screen held nothing at all.
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

/* --- reading what the programs say ------------------------------------

   yt-dlp writes every line as [something] and then the sentence, and it
   redraws its progress line dozens of times a second. Printed straight into
   a log that only appends, a thirty second download is fifty lines of which
   forty six are the same percentage counting up, and the four that matter
   are lost in it.

   So the tag is pulled off and set in its own column, and the progress line
   is not a log line at all: it drives the meter and is replaced in place. */

const TAGGED = /^\[([A-Za-z0-9_:.-]+)\]\s*([\s\S]*)$/;

/* both shapes it prints: the live one with an ETA, and the closing one that
   swaps ETA for how long it took. */
const PROGRESS = /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*[KMGTP]?i?B)(?:\s+(?:at|in)\s+(\S+))?(?:\s+(?:ETA|at)\s+(\S+))?/i;

const GOOD = /Destination:|has already been downloaded|Merging formats|Adding (?:metadata|thumbnail)/i;

/** what a line is, so the console can colour it without guessing twice */
function readLine(raw) {
  const text = String(raw ?? "");
  const hit = text.match(TAGGED);
  const tag = hit ? hit[1] : "";
  const rest = hit ? hit[2] : text;

  /* an untagged line is one of the programs printing without its usual
     prefix, and it is not attributed to keeper for lacking one. keeper tags
     its own before they ever reach here. */
  if (!hit) {
    if (/^ERROR:/i.test(text)) return { tag: "", text: text.replace(/^ERROR:\s*/i, ""), kind: "bad" };
    return { tag: "", text, kind: "plain" };
  }
  if (/^ERROR:/i.test(rest) || /error/i.test(tag)) {
    return { tag, text: rest.replace(/^ERROR:\s*/i, ""), kind: "bad" };
  }
  /* keeper tags its own, so this is the one tag that means the words are
     ours and gets marked as such rather than quoted like the rest. */
  if (tag === "keeper") return { tag, text: rest, kind: "note" };
  return { tag, text: rest, kind: GOOD.test(rest) ? "good" : "plain" };
}

/* --- the two shells ---------------------------------------------------- */

const root = make("div", "dl");

/* the card: a question, and nothing else ever goes in it */
const card = make("aside", "up dl-card");
const kicker = make("p", "label up-kicker");
const line = make("p", "up-line");
const guts = make("div", "dl-guts");
const more = make("div", "up-more");
const moreIn = make("div");
const acts = make("div", "up-acts");
more.append(moreIn);
card.append(kicker, line, guts, more, acts);

/* the desk: the form, the meter and the console, laid out down the window */
const desk = make("section", "dl-desk");
const deskHead = make("div", "dl-head");
const deskKick = make("p", "label dl-kick");
const field = make("div", "dl-field");
const urlIn = make("input", "dl-url");
const goBtn = button("get the audio", "chip up-go dl-go");
const folderRow = make("div", "dl-row");
const pickRow = make("div", "dl-pick");
const formatRow = make("span", "dl-formats");
const qualitySel = make("select", "dl-quality");
const shell = make("section", "dl-shell");
const shellHead = make("div", "dl-shellhead");
const shellKick = make("p", "label");
const detailSeg = make("nav", "seg dl-seg");
const meter = make("div", "dl-meter");
const meterFill = make("i", "dl-fill");
const stat = make("p", "dl-stat");
const consoleBox = make("div", "dl-console");
const landedBox = make("div", "dl-landed");

urlIn.type = "url";
urlIn.placeholder = "paste a youtube or spotify link";
urlIn.spellcheck = false;
urlIn.autocomplete = "off";
urlIn.setAttribute("aria-label", "a youtube or spotify link");
/* the meter, the readout and the console are all answers to a question
   nobody has asked yet, so none of them are on the screen until a download
   gives them something to say. */
meter.hidden = true;
stat.hidden = true;
shell.hidden = true;

/* the switch between the two readings, drawn as the same segmented control
   the shelf and the bench sit behind in the toolbar, because it is the same
   kind of choice: two places to be, one at a time. */
for (const [key, word] of [["simple", "simple"], ["full", "full"]]) {
  const b = make("button");
  b.type = "button";
  b.dataset.detail = key;
  b.textContent = word;
  b.addEventListener("click", () => choose("detail", key));
  detailSeg.append(b);
}
shellKick.textContent = "what is happening";
shellHead.append(shellKick, detailSeg);

meter.append(meterFill);
field.append(urlIn, goBtn);
pickRow.append(formatRow, qualitySel);
deskHead.append(deskKick, field, pickRow, folderRow);
shell.append(shellHead, meter, stat, consoleBox);
desk.append(deskHead, shell, landedBox);

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

/** what landed while this page has been open, newest first */
let landed = [];

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
  root.replaceChildren(card);
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
    said: "keeper can fetch what is behind a youtube or spotify link, as audio "
      + "or as video. it needs the internet and two small programs, yt-dlp and "
      + "spotDL, which it gets from their own github releases.",
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
 */
async function pick() {
  const was = deskKick.textContent;
  deskKick.textContent = "waiting for the folder dialog";
  desk.classList.add("busy");

  let picked;
  try {
    picked = await send("/api/choose", {});
  } catch {
    desk.classList.remove("busy");
    deskKick.textContent = was;
    say("the folder dialog could not be opened.", "bad");
    return;
  }
  desk.classList.remove("busy");
  deskKick.textContent = was;

  /* cancel is an answer, not an error. it goes back to the form with
     whatever was already remembered still remembered. */
  if (picked?.cancelled) return;
  const dir = picked?.path;
  if (!dir) { say(picked?.error || "the folder dialog came back with nothing.", "bad"); return; }

  let out;
  try {
    out = await send("/api/downloads/folder", { dir });
  } catch {
    say("that folder could not be written down. try again.", "bad");
    return;
  }
  if (out?.error) { say(out.error, "bad"); return; }

  feel("tick");
  state = { ...(state ?? {}), folder: out?.folder ?? out?.dir ?? dir };
  paintFolder();
}

/* --- the console ------------------------------------------------------ */

/** how many lines the console keeps before it starts dropping the oldest */
const KEEP = 400;

/* --- the same run, said two ways --------------------------------------

   THE RAW OUTPUT IS THE HONEST VIEW AND IT IS NOT THE READABLE ONE.
   Somebody who does not write software should not have to work out that
   `[info] Downloading 1 format(s): 251` was a good thing, and somebody who
   wants to know exactly what ran on their machine must not be handed a
   summary and asked to trust it. Those are two different people and this is
   the same run told twice: the steps are the plain reading, `full` is every
   line the programs printed, and the switch is right there rather than in a
   settings pane.

   The plain view is a compression, so it is built out of the raw lines and
   never instead of them: nothing is thrown away, and turning `full` on mid
   download shows the whole run from its first line. */
const PHASES = [
  {
    key: "match",
    say: "matching the track on youtube",
    /* only spotify links have this step, so it appears when it happens
       rather than sitting greyed out on every youtube download. */
    only: true,
    when: /finding the track behind|found it:/i,
  },
  { key: "read", say: "reading the link", when: /Extracting URL|Downloading webpage|player API|m3u8|API JSON/i },
  { key: "find", say: "picking the best quality", when: /format\(s\)|Downloading format/i },
  { key: "get", say: "downloading", when: /Destination:|has already been downloaded|Resuming download/i },
  { key: "make", say: "converting the file", when: /ExtractAudio|Merging formats|Not converting/i },
  { key: "tidy", say: "adding the title and artwork", when: /Metadata|Thumbnail/i },
];

/** every line this run has produced, so either view can be built from it */
let said = [];

/** which phases have been seen, and how far along the run got */
let reached = new Set();

/** whether the raw lines are on screen, or the plain reading of them */
const full = () => state?.as?.detail === "full";

function clearConsole() {
  said = [];
  reached = new Set();
  fault = "";
  consoleBox.replaceChildren();
  shell.hidden = true;
  meter.hidden = true;
  meterFill.style.width = "0%";
  stat.textContent = "";
  stat.hidden = true;
}

/** the one thing that went wrong, kept apart so both views can show it */
let fault = "";

/** a sentence of keeper's own, which counts as a line like any other */
function say(text, kind = "note") {
  said.push({ tag: "keeper", text, kind, ours: true });
  if (kind === "bad" || kind === "warn") fault = text;
  mark(text);
  draw();
}

/** how far the run has got, read off whatever was just printed */
function mark(text) {
  for (const phase of PHASES) if (phase.when.test(text)) reached.add(phase.key);
}

/**
 * A progress redraw, which is not a line in either view.
 *
 * yt-dlp reprints its percentage dozens of times a second. Kept, that is a
 * thirty second download becoming fifty lines of which forty six say the same
 * thing, with the four that matter lost among them. So it is never stored at
 * all: it moves the meter and rewrites the readout above it.
 */
function progress(hit) {
  const [, pct, size, a, b] = hit;
  const percent = Math.min(100, Number(pct) || 0);
  shell.hidden = false;
  meter.hidden = false;
  meterFill.style.width = `${percent}%`;

  const rate = a && /\/s$/i.test(a) ? a : (b && /\/s$/i.test(b) ? b : "");
  const eta = b && !/\/s$/i.test(b) ? b : "";
  stat.hidden = false;
  stat.textContent = [
    `${percent.toFixed(percent < 100 ? 1 : 0)}%`,
    size,
    rate,
    eta && eta !== "Unknown" ? `eta ${eta}` : "",
  ].filter(Boolean).join("  ·  ");
}

/** everything the server has said about this job that has not been kept yet */
function pour(lines, from) {
  let fresh = false;
  for (const raw of lines.slice(from)) {
    const text = String(raw ?? "");
    const hit = text.match(PROGRESS);
    if (hit) { progress(hit); continue; }
    const read = readLine(text);
    said.push({ ...read, raw: text });
    if (read.kind === "bad") fault = read.text;
    mark(text);
    fresh = true;
  }
  if (fresh) draw();
}

/* --- drawing whichever view is on -------------------------------------- */

/** the plain reading: a handful of steps, ticking off */
function drawSteps() {
  const list = make("div", "dl-steps-run");

  /* a step nobody reached on a run that never had it, like the spotify
     match on a youtube link, is not a step that is still to come. */
  const shown = PHASES.filter((p) => !p.only || reached.has(p.key));
  const last = shown.map((p) => p.key).filter((k) => reached.has(k)).pop();
  const done = !running && !fault;

  for (const phase of shown) {
    const row = make("div", "dl-stepr");
    const at = done || (reached.has(phase.key) && phase.key !== last) ? "done"
      : phase.key === last ? (running ? "doing" : "done")
        : "wait";
    row.dataset.state = at;
    const dot = make("i");
    const word = make("span");
    word.textContent = phase.say;
    row.append(dot, word);
    list.append(row);
  }

  consoleBox.replaceChildren(list);

  if (fault) {
    const bad = make("p", "dl-fault");
    bad.textContent = fault;
    consoleBox.append(bad);
  }
}

/** the honest view: every line, exactly as it was printed */
function drawFull() {
  const frag = document.createDocumentFragment();
  for (const l of said.slice(-KEEP)) {
    const row = make("div", `dl-l dl-is-${l.kind}`);
    const t = make("span", "dl-t");
    t.textContent = l.tag ? `[${l.tag}]` : "";
    const m = make("span", "dl-m");
    m.textContent = l.text;
    row.append(t, m);
    frag.append(row);
  }
  consoleBox.replaceChildren(frag);
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function draw() {
  if (!said.length) { shell.hidden = true; return; }
  shell.hidden = false;
  /* the two readings are not the same shape. a console earns its box and its
     mono; five short sentences do not, and putting them in one would be a
     border doing the work whitespace should do. */
  consoleBox.dataset.mode = full() ? "full" : "simple";
  if (full()) drawFull(); else drawSteps();
}

/* --- the desk --------------------------------------------------------- */

function paintFolder() {
  folderRow.replaceChildren();
  const into = make("span", "label");
  into.textContent = "into";
  const where = make("code", "dl-path");
  where.textContent = state?.folder ?? "no folder chosen yet";
  if (!state?.folder) where.classList.add("dl-none");
  const change = button(state?.folder ? "change" : "choose");
  change.addEventListener("click", pick);
  folderRow.append(into, where, change);
  armed();
}

/** audio or video, for the handful of strings that have to say which */
const grabbing = () =>
  (state?.formats?.[state?.as?.format]?.what === "video") ? "video" : "audio";

function armed() {
  goBtn.disabled = running || !urlIn.value.trim() || !state?.folder;
  goBtn.textContent = `get the ${grabbing()}`;
}

/**
 * What it gets saved as: one row, no headings.
 *
 * It was two labelled rows of chips with a sentence underneath explaining
 * the pair, which is a lot of furniture for a question whose whole answer is
 * four words wide. The chips say what they are, so the label above them was
 * only telling somebody that "mp3" is a format.
 *
 * The list is not written twice either. keeper answers /api/downloads with
 * its own tables, so a format added on the server turns up here without this
 * file being touched, and a browser cannot offer a choice the server would
 * refuse.
 */
function paintAs() {
  const formats = state?.formats ?? {};
  const qualities = state?.qualities ?? {};
  const as = state?.as ?? {};

  formatRow.replaceChildren();
  for (const [key, entry] of Object.entries(formats)) {
    const b = button(entry.label ?? key, "chip dl-chip");
    const on = as.format === key;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.disabled = running;
    /* the sentence the server keeps for each one, where somebody looking for
       it will find it and nobody else has to read it. */
    if (entry.say) b.title = entry.say;
    b.addEventListener("click", () => choose("format", key));
    formatRow.append(b);
  }

  /* a menu rather than three more chips: quality is the answer almost
     nobody changes, and it should not take the same room as the one they do. */
  qualitySel.replaceChildren();
  for (const [key, entry] of Object.entries(qualities)) {
    const o = make("option");
    o.value = key;
    o.textContent = entry.label ?? key;
    if (entry.say) o.title = entry.say;
    qualitySel.append(o);
  }
  qualitySel.value = as.quality ?? "max";
  qualitySel.disabled = running;
  qualitySel.hidden = !Object.keys(qualities).length;

  for (const b of detailSeg.children) {
    b.classList.toggle("on", b.dataset.detail === (as.detail ?? "simple"));
  }
}

/** one press on one of the chips, remembered on the machine straight away */
async function choose(which, key) {
  /* the format and the quality are locked while a download runs, because
     changing what it is being saved as halfway through would be a lie either
     way round. which view you are reading is not: somebody watching a
     download is exactly the person who may want to see the whole of it. */
  if (running && which !== "detail") return;

  const as = { ...(state?.as ?? {}), [which]: key };
  state = { ...(state ?? {}), as };
  feel("tick");
  paintAs();
  if (which === "detail") draw();
  try {
    const out = await send("/api/downloads/as", as);
    if (out?.as) { state = { ...(state ?? {}), as: out.as }; paintAs(); }
  } catch {
    /* it is still the choice for this run either way. the write is a
       convenience for the next launch, not the thing that makes it true. */
  }
}

/** what landed while this page has been open, so the desk is never a void */
function paintLanded() {
  landedBox.replaceChildren();
  if (!landed.length) { landedBox.hidden = true; return; }
  landedBox.hidden = false;

  const head = make("p", "label dl-kick");
  head.textContent = landed.length === 1 ? "1 file" : `${landed.length} files`;
  landedBox.append(head);

  for (const file of landed) {
    const row = make("div", "dl-file");
    const name = make("code", "dl-path");
    name.textContent = base(file);
    const rev = button("reveal");
    rev.addEventListener("click", () => { feel("tick"); post("/api/downloads/reveal", { file }); });
    row.append(name, rev);
    landedBox.append(row);
  }
}

/**
 * The working state, which is the same layout whether or not anything is
 * running. The form does not move when a download starts, because a control
 * that jumps under the hand that just used it is the thing that makes an app
 * feel unfinished.
 */
function deskView() {
  deskKick.textContent = "downloads";
  urlIn.value = link;
  urlIn.disabled = running;

  /* what a playlist link does used to be explained in three lines above the
     field, before anybody had pasted one. it is said now at the only moment
     it matters, which is when somebody actually pastes one and keeper turns
     it down in a sentence. */

  /* ffmpeg is not one of the two keeper fetches. it has to be on the machine
     already, and without it a download comes back as the container it arrived
     in rather than the file that was asked for, so this is said before a link
     is pasted rather than after ten megabytes have come down. */
  const already = deskHead.querySelector(".dl-warn");
  if (already) already.remove();
  if (state?.ffmpeg === false) {
    const warn = make("p", "dl-warn");
    warn.textContent =
      "ffmpeg is missing, and keeper needs it to make the file. install it from "
      + "ffmpeg.org and open keeper again.";
    deskHead.append(warn);
  }

  paintFolder();
  paintAs();
  paintLanded();
  /* an empty bordered box is a border doing whitespace's job. the readout
     arrives with the first line it has to show. */
  draw();
  root.replaceChildren(desk);
  if (showing() && !running) urlIn.focus();
}

/**
 * Hand the link to the server and then follow what it says about it.
 *
 * The kind is sent only when the hostname is one of the two this is sure
 * about, and left out otherwise so the server's own reading decides. A
 * browser guessing wrong and saying so with confidence is worse than a
 * browser saying nothing.
 */
async function begin() {
  const url = urlIn.value.trim();
  if (!url || running) return;
  if (!state?.folder) { pick(); return; }

  link = url;
  running = true;
  armed();
  paintAs();
  urlIn.disabled = true;
  desk.classList.add("busy");
  clearConsole();
  say("asking for it.");

  const kind = kindOf(url);
  let out;
  try {
    out = await send("/api/downloads/start", {
      url,
      ...(kind ? { kind } : {}),
      folder: state.folder,
      ...(state.as ?? {}),
    });
  } catch {
    return stop("that did not get sent, and nothing was downloaded.");
  }

  if (!out?.id) return stop(out?.error || "keeper could not make sense of that link.");
  follow(out.id);
}

/** the end of a run, however it ended */
function stop(error) {
  running = false;
  desk.classList.remove("busy");
  urlIn.disabled = false;
  paintAs();
  armed();
  if (error) { say(error, "bad"); deskKick.textContent = "that did not work"; }
  meter.hidden = true;
  /* the steps redraw as finished rather than as halfway, whichever way it
     ended, so a run never sits there looking like it is still going. */
  draw();
}

/**
 * The running job, said in its own words.
 *
 * yt-dlp and spotDL both narrate what they are doing, and a person watching
 * a file arrive would rather read that than watch a spinner: it is the
 * difference between a wait and a hang. Only the lines not shown yet are
 * poured in, because every poll answers with the whole buffer.
 */
async function follow(id) {
  const mine = ++job;
  deskKick.textContent = `getting the ${grabbing()}`;

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
    if (lines.length > shown) { pour(lines, shown); shown = lines.length; }

    if (!out?.done) {
      /* the job is gone from the server's map, which after a restart or a
         second read of a finished job is every bit as final as done. */
      if (out?.error) return stop(out.error);
      continue;
    }

    if (out.ok) {
      const files = out.files ?? [];
      landed = [...files, ...landed];
      feel("tap");
      stop(null);
      meterFill.style.width = "100%";
      deskKick.textContent = files.length === 1 ? "one file, in your folder" : "in your folder";
      link = "";
      urlIn.value = "";
      armed();
      paintLanded();
      return;
    }

    /* a failed run can still have put something in the folder, and leaving
       that unsaid means somebody finds a file later with no idea what left
       it there. */
    for (const file of out.files ?? []) say(`left behind: ${base(file)}`, "warn");
    return stop(out.error || "that did not finish.");
  }

  if (mine === job) stop("the download stopped answering. nothing else was changed.");
}

/* --- which of those it is -------------------------------------------- */

/**
 * Painted fresh every time rather than diffed.
 *
 * The question states share one card and the working state is the desk, and
 * no two of them share a control, so working out which parts of the last one
 * could stay would cost more than building the next.
 */
function paint() {
  /* whatever was being polled belongs to the state being replaced */
  job++;
  running = false;

  const s = state ?? {};
  if (s.policy === "off") return off();
  if (s.policy !== "on") return dismissed ? asked() : ask();
  if (!s.ready?.ytdlp || !s.ready?.spotdl) return gear();
  return deskView();
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

  urlIn.addEventListener("input", () => { link = urlIn.value; armed(); });
  qualitySel.addEventListener("change", () => choose("quality", qualitySel.value));
  urlIn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    begin();
  });
  goBtn.addEventListener("click", begin);

  /* something written before the first answer comes back. it used to paint
     nothing at all until then, so a tab opened before the server had replied
     was an empty box of no explained size, which read as a broken page
     rather than as a wait. */
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
       stand over this tab and both mark the escape they answer. */
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

    if (card.classList.contains("busy") || running) return;
    if (state?.policy !== "ask" || dismissed) return;
    dismissed = true;
    card.classList.add("going");
    setTimeout(() => { card.classList.remove("going"); asked(); }, 200);
  });

  look();
}
