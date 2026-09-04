/* ---------------------------------------------------------------------
   dragging a folder out of finder and onto the window.

   The whole feature is built around one thing the drag and drop api will
   not do: a browser is never told the absolute path of anything dragged in
   from outside. It is told the name, and for a folder it is allowed to list
   what sits directly inside, and that is the end of it. So the path is
   recovered in three steps, and each of them is a real way in rather than a
   fallback that exists to look thorough:

     1. the drag's own url flavour. some sources write a file:// url into
        text/uri-list and some write nothing at all, so it is always worth
        asking and never worth relying on. when it is there it is an
        absolute path and the job is done in one round trip.
     2. spotlight, through the server. the name of the folder plus a couple
        of dozen of the names inside it is enough to tell one folder called
        2026 from the other four on the disk.
     3. the native folder dialog, which is the only thing on this machine
        that can hand a browser a path and mean it. for a folder it opens by
        itself when the first two come up empty, because at that point it is
        the only move left and asking permission to make it is a wasted
        click. for anything that was never a folder it stays behind a button,
        because a system dialog nobody asked for, over an app that cannot be
        touched until it is found and dismissed, is a worse answer than one
        sentence saying keeper opens folders.

   Nothing in here says the drop failed when what actually happened is that
   the browser withheld the path. Those are two different sentences and only
   one of them is ever true.

   And nothing a person can drag onto this window may leave it needing a
   reload. Every panel that waits on somebody carries a way out, every one of
   them puts the busy flag down on its way past, and the work that starts in
   a drop or a click goes out through attempt(), so a throw ends on a card
   with a sentence and a button rather than on a scrim with neither.

   The module mounts itself on import and exports one thing, the wait, for
   the page that loads while a scan is already under way. It has to survive a
   page with no frames on it and a page with two thousand, so it reads nothing
   out of the app and touches no markup it did not make.
   --------------------------------------------------------------------- */

import { files } from "/host.js";

/* about two and a half polls a second. fast enough that a percentage moves
   while you watch it, slow enough that a thumbnail pass is not answering
   http requests instead of resizing pictures. */
const POLL = 400;

/* how much of a dropped folder is worth sending to spotlight. the names are
   there to tell two folders of the same name apart, and a couple of dozen
   does that as well as a thousand would while keeping the body small. */
const KIDS = 24;

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

const make = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

/* a module script is deferred, so the body is already here. */
const root = make("div", "drop");
const card = make("div", "drop-card");
const eyebrow = make("p", "label drop-eyebrow");
const line = make("h2", "drop-line");
const note = make("p", "drop-note");
const hint = make("p", "drop-hint");
const meter = make("div", "drop-meter");
const bar = make("i");
const picks = make("ul", "drop-picks");
const acts = make("div", "drop-acts");

root.hidden = true;
meter.append(bar);
card.append(eyebrow, line, note, hint, meter, picks, acts);
root.append(card);
document.body.append(root);

/* the last panel a person could have been reading when they sent the finder
   dialog up, so cancelling it puts them back where they were rather than on
   a blank screen that has forgotten the question. */
let was = null;
/* and whatever is on the card right now, which is not always the same thing:
   the card that says a dialog is open is worth putting back after a drag
   crosses the window and leaves again, and is not worth going back to when
   that dialog is answered. */
let showing = null;
let escapes = false;

function paint(o) {
  root.hidden = false;
  root.dataset.mode = o.mode;

  eyebrow.textContent = o.eyebrow ?? "";
  line.textContent = o.line ?? "";
  note.textContent = o.note ?? "";
  hint.textContent = o.hint ?? "";
  note.hidden = !o.note;
  hint.hidden = !o.hint;

  meter.hidden = o.pct == null;
  bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (o.pct ?? 0) / 100))})`;

  picks.replaceChildren(...(o.picks ?? []).map(row));
  picks.hidden = !o.picks?.length;
  acts.replaceChildren(...(o.acts ?? []).map(act));
  acts.hidden = !o.acts?.length;

  showing = o;
  escapes = !!o.esc;
  /* a panel that asks a question is the one to come back to when the dialog
     on top of it is cancelled. the panel that is itself the wait for that
     dialog is not: painting it again would say the dialog is open a moment
     after it was closed. */
  if (o.esc && o.back !== false) was = o;
}

function hide() {
  stop();
  clearInterval(sweep);
  working = false;
  root.hidden = true;
  root.dataset.mode = "";
  escapes = false;
}

const resume = () => (was ? paint(was) : hide());

function act({ text, run, quiet }) {
  const b = make("button", quiet ? "drop-quit" : "drop-go");
  b.type = "button";
  b.textContent = text;
  b.onclick = run;
  return b;
}

const askFinder = () => ({ text: "choose a folder", run: () => dialog() });
const dismiss = () => ({ text: "not now", run: hide, quiet: true });

function row(c) {
  const li = make("li");
  const b = make("button", "drop-pick");
  b.type = "button";

  const p = make("span", "drop-path");
  p.textContent = c.path;
  b.append(p);

  /* the count is the whole reason this list is readable. two folders called
     2026 look identical as paths on a machine that has been backing itself
     up for years, and the one with 1,768 frames in it is obviously the one
     you meant. */
  if (c.frames != null) {
    const n = make("span", "drop-count");
    n.textContent = c.frames ? frames(c.frames) : "no frames";
    b.append(n);
  }

  b.onclick = () => attempt(open(c.path), "that path did not open.");
  li.append(b);
  return li;
}

const num = (x) => Number(x ?? 0).toLocaleString();
const frames = (x) => `${num(x)} ${Number(x) === 1 ? "frame" : "frames"}`;
const tail = (p) => p.split("/").filter(Boolean).pop() || p;

/* ------------------------------------------------------------------ */
/* talking to the server                                               */
/* ------------------------------------------------------------------ */

/**
 * The status comes back alongside the body because 409 is a different
 * situation from 400 and the panel treats it differently. Null is kept for
 * the case where the request never got an answer at all, which on a local
 * server means the route is not there yet, and that is a thing to say out
 * loud rather than a thing to render as a failed open.
 */
async function ask(route, body, method = "POST") {
  try {
    const res = await fetch(route, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const seen = await res.json().catch(() => null);
    if (!res.ok) console.error("[keeper]", route, seen);
    return { status: res.status, ...(seen ?? {}) };
  } catch (e) {
    console.error("[keeper]", route, e);
    return null;
  }
}

/**
 * WHAT THE SERVER SAID, IN A SENTENCE SOMEBODY CAN ACT ON.
 *
 * A folder nobody may write to came back onto the card as "EACCES: permission
 * denied, mkdir", which names a syscall and asks the reader to know what one
 * is. These are the handful a person actually hits: a read only folder or
 * drive, a full disk, a folder that has been moved or unplugged, and a file
 * dropped where a folder was meant. Anything else goes through untouched,
 * because a message that was written for a person is already better than
 * whatever a table would do to it, and the raw line stays on the card under
 * the sentence: the person who wants it is usually the person being asked for
 * it by somebody helping them.
 */
const ERRNO = [
  [/\bEACCES\b|\bEPERM\b|\bEROFS\b/, "keeper cannot write into that folder. it keeps its index in a .keeper folder beside the photographs, so the folder has to be writable. a read only drive or a locked folder looks like this."],
  [/\bENOSPC\b/, "the disk is full, so keeper cannot write its index. free some space and open the folder again."],
  [/\bENOENT\b/, "that folder is not there any more. an unplugged drive looks like this."],
  [/\bENOTDIR\b/, "that is a file rather than a folder. keeper opens the folder the photographs are in."],
];

const sentence = (msg) => {
  const raw = String(msg ?? "").trim();
  for (const [errno, said] of ERRNO) if (errno.test(raw)) return said;
  return raw;
};

/* ------------------------------------------------------------------ */
/* the drag layer                                                      */
/* ------------------------------------------------------------------ */

/* The two private types every drag that starts inside keeper carries: one
   frame, or a pick of them. */
const OURS = ["application/x-keeper-frame", "application/x-keeper-frames"];
const ours = (dt) => !!dt && OURS.some((m) => [...dt.types].includes(m));

/**
 * WHOSE DRAG THIS IS, AND WHY "DOES IT CARRY FILES" WAS THE WRONG QUESTION.
 *
 * A drag belongs to this file when somebody dragged a folder in from their
 * file manager. It does not belong here when keeper started it, and the test
 * for that used to be that keeper's own drags carry a private mime type and
 * a real folder carries "Files", so looking for "Files" told the two apart.
 *
 * On windows it does not. Dragging a frame OUT of keeper has to hand the
 * other application a real file, so dragout.js puts a DownloadURL on the
 * drag, and chrome on windows answers that by synthesising a virtual file
 * and listing "Files" in the types. The drag then matched, and the full
 * screen "drop it here" panel slammed up over the app the instant somebody
 * started dragging a photograph out of it. It has never been seen on a mac,
 * where the same code has been dragged out of daily, so the two platforms
 * disagree about what a DownloadURL drag is carrying.
 *
 * So the question is asked the right way round now: a drag that carries one
 * of our own types is ours whatever else is on it. The flag underneath is
 * the second answer, for the case where windows hands the page a types list
 * with the custom entries stripped out. It is time bounded rather than
 * trusted, because a drag released over another application does not
 * reliably fire dragend, and a flag stuck on would leave keeper unable to
 * accept a folder at all, which is worse than the bug it is guarding.
 */
let mine = false;
let mineAt = 0;

document.addEventListener("dragstart", (e) => {
  if (ours(e.dataTransfer)) { mine = true; mineAt = performance.now(); }
}, true);
document.addEventListener("dragend", () => { mine = false; }, true);
/* refreshed for as long as the drag is really in flight, so the expiry below
   only ever fires on a drag that has genuinely finished somewhere else. */
document.addEventListener("dragover", () => { if (mine) mineAt = performance.now(); }, true);

const carries = (e) => {
  const dt = e.dataTransfer;
  if (!dt) return false;
  const types = [...dt.types];
  if (OURS.some((m) => types.includes(m))) return false;
  if (mine) {
    if (performance.now() - mineAt < 1500) return false;
    /* nothing has moved for a second and a half, so whatever keeper started
       is over and this is somebody else's drag. */
    mine = false;
  }
  return types.includes("Files");
};

/* dragenter and dragleave fire for every element the pointer crosses on the
   way in, so a boolean would flicker the overlay off the moment the cursor
   passed from the grid onto a thumbnail inside it. counting the pairs is the
   only version of this that holds still. */
let depth = 0;
let alive = 0;
let sweep = 0;

/* THE FLAG IS UP WHILE THE MACHINE IS BUSY AND DOWN WHILE A PERSON IS.
   It used to go up inside open(), which left the locate round trip and the
   whole time a folder dialog was on screen counted as idle, so a second drop
   in either of those windows went all the way through and sent a second of
   everything. It goes up the moment a drop is accepted now, and every panel
   that ends up waiting on somebody puts it back down, because a card with a
   button on it is a question and not work in flight. */
let working = false;

/* WHICH JOB THE WINDOW BELONGS TO.
   A folder dialog stays open for as long as somebody takes to find a folder,
   and in that minute they can give up on it, come back to the window and drag
   the folder in by hand instead. The answer that arrives from the abandoned
   dialog is then an answer to a question nobody is asking, and acting on it
   stopped the poll of the archive that was already opening and left it
   opening behind a hidden card, with nothing on screen and no error anywhere.
   So a job takes the seat when it starts, and an answer that comes back to
   find the seat taken says nothing. The seat moves only when a new job
   starts, never when a card is simply put away: somebody who dismissed the
   card and then picked a folder in the dialog still gets that folder. */
let seat = 0;
const claim = () => ++seat;

/* what was on screen when the drag arrived, so a drag that crosses the
   window and leaves again does not take a list of candidates with it. */
let under = null;

addEventListener("dragenter", (e) => {
  if (!carries(e)) return;
  depth++;
  alive = performance.now();
  if (working || root.dataset.mode === "drag") return;
  under = !root.hidden && escapes ? showing : null;
  invite(e.dataTransfer.items?.length ?? 0);
  /* a drop released over another window fires no leave and no end, and the
     overlay would then sit over the app until the next reload. dragover
     never stops firing while a drag really is in flight, so its silence is
     the signal that the drag is gone. */
  sweep = setInterval(() => {
    if (root.dataset.mode === "drag" && performance.now() - alive > 400) {
      depth = 0;
      gone();
    }
  }, 200);
});

addEventListener("dragover", (e) => {
  if (!carries(e)) return;
  /* without this the browser takes the drop as navigation, leaves the app
     and shows the file on its own. the overlay would be pointless and the
     tagging session would be gone. */
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  alive = performance.now();
});

addEventListener("dragleave", (e) => {
  if (!carries(e)) return;
  depth = Math.max(0, depth - 1);
  if (!depth && root.dataset.mode === "drag") gone();
});

addEventListener("drop", (e) => {
  if (!carries(e)) return;
  e.preventDefault();
  depth = 0;
  clearInterval(sweep);
  /* an archive is already opening. a second one landing on top of it is two
     scans fighting over one index, and the card that is up is answering a
     more useful question than an error about it would. a card that is waiting
     on a person is not that, so a folder dropped while one of those is up is
     taken: it is a better answer to the question on the card than the card
     was going to get any other way. */
  if (working) return;
  working = true;
  attempt(take(e.dataTransfer), "that drop could not be read.");
});

/** the drag left without dropping, so the panel goes back to whatever it was */
function gone() {
  clearInterval(sweep);
  if (under) paint(under);
  else hide();
}

function invite(n) {
  paint({
    mode: "drag",
    eyebrow: "open an archive",
    line: n > 1 ? `drop these ${n} here` : "drop it here",
    note: "keeper opens the folder it came out of. nothing is copied and nothing moves.",
  });
}

/* ------------------------------------------------------------------ */
/* step 1 and step 2, out of one drop                                  */
/* ------------------------------------------------------------------ */

async function take(dt) {
  /* Everything this drop knows has to be read now, synchronously. The
     dataTransfer is emptied the moment the handler returns, so a single
     await before these three reads leaves an empty object behind and no
     error anywhere to say what happened. The async here does not change that:
     the body of one runs to its first await in the same tick as the call, and
     there is no await above these lines. It is here so that a throw anywhere
     below becomes a rejection the drop handler can answer, rather than an
     exception nobody catches with the guard left up behind it. */
  const url = fileUrl(dt.getData("text/uri-list")) ?? fileUrl(dt.getData("text/plain"));
  const entries = [...(dt.items ?? [])]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() ?? null : null))
    .filter(Boolean);
  const files = [...(dt.files ?? [])].map((f) => ({ name: f.name, size: f.size }));
  return resolve(url, entries, files);
}

/**
 * text/uri-list is a list and it has a comment syntax, so it is read as one
 * rather than trusted whole. Anything that is not a file url is somebody
 * else's drag: a link out of another tab arrives here as https and is worth
 * nothing to a tool that reads a disk.
 */
function fileUrl(text) {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith("#") || !s.toLowerCase().startsWith("file://")) continue;
    try {
      const u = new URL(s);
      return onDisk(decodeURIComponent(u.pathname), u.host);
    } catch {
      /* a line that will not parse is not worth an error message. step 2 is
         standing right there. */
    }
  }
  return null;
}

/**
 * A URL PATHNAME IS NOT A PATH, AND ON WINDOWS IT IS NOT EVEN CLOSE.
 *
 * Finder writes file:///Volumes/disk/2026, whose pathname is the path. Explorer
 * writes file:///C:/photos/2026, whose pathname is /C:/photos/2026, with a
 * slash in front of the drive letter and the separators the wrong way round. That went to the server exactly as it came, the server could not
 * resolve it, and the panel then told somebody their drop had failed while the
 * folder sat where it had always been. A share is the same story one level up:
 * file://nas/photos is \\nas\photos, and the host is where the machine name is.
 */
function onDisk(pathname, host) {
  if (/^\/[A-Za-z]:(\/|$)/.test(pathname)) return tidy(pathname.slice(1).replace(/\//g, "\\"), "\\");
  if (host && host.toLowerCase() !== "localhost") return tidy(`\\\\${host}${pathname.replace(/\//g, "\\")}`, "\\");
  return tidy(pathname, "/");
}

/* finder writes a folder as a url with a trailing slash, and the server should
   be handed the folder rather than a path with an empty last segment on the end
   of it. the root of a disk is the one that keeps its separator: C: on its own
   means whatever folder that drive was last looked at in, which is not a place
   anybody dropped. */
function tidy(p, sep) {
  const cut = p.replace(sep === "/" ? /\/+$/ : /\\+$/, "");
  return !cut || cut.endsWith(":") ? p : cut;
}

async function resolve(url, entries, files) {
  /* the url flavour is the fast way in and it is not always the right one: on
     windows this page rebuilds the path itself, and a rebuilt path the server
     will not take is a step that did not come off rather than a failed drop.
     the next step is standing right there, so it is taken. */
  if (url) {
    return open(url, () =>
      (entries.length || files.length ? resolve(null, entries, files) : chooser()));
  }

  const dir = entries.find((x) => x.isDirectory);
  const name = dir ? dir.name : files[0]?.name ?? "";
  if (!dir && !files.length) {
    return withheld("", "there were no files in that drop, only something that looked like one.");
  }

  paint({
    mode: "work",
    eyebrow: "opening",
    line: dir ? `looking for ${dir.name}` : "looking for those files",
    note: "the browser is told the name and never the path, so keeper is asking spotlight where it lives.",
  });

  /* Several folders at once is one folder as far as keeper is concerned:
     it opens a single root and the first one is the one the hand was on. */
  const body = dir
    ? { name: dir.name, kind: "folder", files: await peek(dir) }
    : { name: "", kind: "files", files };

  const d = await ask("/api/locate", body);
  const list = Array.isArray(d?.candidates) ? d.candidates : [];
  if (list.length === 1) return open(list[0].path);
  if (list.length > 1) return offer(list, name);

  /* Spotlight came back empty. For a folder, step 3 happens on its own rather
     than behind a button. The card that used to sit here spent four lines
     explaining what a browser is and is not told about a dropped folder, and
     then asked for one more click to do the only thing left to do. The finder
     dialog opening is that explanation, said in the one language this person
     already speaks, and it is a click shorter. Nothing was lost: the drop did
     not fail, and nothing here says it did. */
  if (dir) return chooser();

  /* A drop that was never a folder is a different sentence, and it used to
     get the same dialog: a photograph, a pdf or a text file put a system
     modal on screen that nobody asked for, in front of a card with no button
     on it, and the only way back to the app was to find that dialog behind
     the window and dismiss it. A drop of loose files is worth the search
     above, because the folder they came out of is the folder somebody meant.
     It is not worth a dialog nobody asked for when the search comes up empty. */
  notFolder(name, files.length);
}

/** the names and sizes of what is directly inside, which is all spotlight needs */
async function peek(dir) {
  const kids = await readAll(dir.createReader(), KIDS);
  return Promise.all(kids.map(async (k) => ({ name: k.name, size: await sizeOf(k) })));
}

/**
 * readEntries hands back a batch at a time and signals the end with an empty
 * batch rather than with a count, so the version of this that calls it once
 * reads the first hundred children of a two thousand child folder and gets
 * no error to say it stopped early.
 */
function readAll(reader, limit) {
  return new Promise((done) => {
    const out = [];
    const pull = () =>
      reader.readEntries((batch) => {
        if (!batch.length || out.length >= limit) return done(out.slice(0, limit));
        out.push(...batch);
        pull();
      }, () => done(out.slice(0, limit)));
    pull();
  });
}

/* a size is only readable by asking for the whole File object, and a folder
   inside a folder has none. those go out at zero and are matched on the name,
   which is still worth sending: a subfolder called raw is as good a
   fingerprint as any photograph in there. */
const sizeOf = (entry) =>
  new Promise((done) => {
    if (!entry.isFile) return done(0);
    entry.file((f) => done(f.size), () => done(0));
  });

/* ------------------------------------------------------------------ */
/* the panels a person actually reads                                  */
/* ------------------------------------------------------------------ */

/* Every one of these is the end of a drop, and every one of them puts the
   guard down on its way past: what is on screen after this is a question
   waiting on somebody, and a folder dropped onto it is a fine answer. */

function offer(list, name) {
  working = false;
  paint({
    mode: "pick",
    eyebrow: "which one",
    line: name ? `more than one folder called ${name}` : "more than one match",
    note: "spotlight found these. the frame count is the fastest way to tell them apart.",
    picks: list,
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/** the drop worked and the path did not come with it, which is not a failure */
function withheld(name, why) {
  stop();
  working = false;
  paint({
    mode: "pick",
    eyebrow: "one more step",
    line: `the path stayed in ${files()}`,
    note: name
      ? `a browser is only ever told the name, ${name}, and the search index could not place it on the disk.`
      : "a browser is never told where a dropped thing lives on the disk.",
    hint: why || "point at the folder once and keeper has it from there.",
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/** the drop was read and there is no folder anywhere in it */
function notFolder(name, n) {
  stop();
  working = false;
  paint({
    mode: "pick",
    eyebrow: "one more step",
    line: n > 1 ? "those are files, not a folder"
      : name ? `${name} is a file, not a folder`
      : "that is a file, not a folder",
    note: "keeper opens the folder the photographs are in, and a browser is never told which folder a dropped file came out of.",
    hint: "point at the folder once and keeper has it from there.",
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/** something really did go wrong, and it says which thing */
function failed(msg) {
  stop();
  working = false;
  const raw = String(msg ?? "").trim();
  const said = sentence(raw);
  paint({
    mode: "fail",
    eyebrow: "not opened",
    line: "that did not open",
    note: said || "that path did not open.",
    hint: said === raw ? "" : raw,
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/**
 * WORK THAT STARTS IN AN EVENT HANDLER HAS NOBODY WAITING ON IT.
 *
 * A drop, a click on a candidate, a click on the button that opens the
 * dialog: none of them is awaited by anything, so a throw inside one is an
 * unhandled rejection. Nothing on screen would change, the scrim would stay
 * over the window with no button on it, and the guard that turns the next
 * drop away would stay up for the rest of the session. Going out through here
 * means the last thing any of them can do is put a sentence and a way out on
 * the card.
 */
const attempt = (p, said) =>
  p.catch((e) => {
    console.error("[keeper]", e);
    failed(said);
  });

/* ------------------------------------------------------------------ */
/* step 3, the native chooser                                          */
/* ------------------------------------------------------------------ */

/* the dialog that is already on screen. a second call while one is open must
   not raise a second one: there is one dialog in front of somebody and
   answering it once is the whole of what they agreed to do. both callers wait
   on the one request and the answer lands on whichever of them holds the seat
   by the time it comes back. */
let pending = null;

/**
 * The request stays open for as long as the dialog is on screen, which can
 * be a minute if someone goes hunting through their disk. A spinner with no
 * words on it would read as a hang, so the card says where the dialog is,
 * once, quietly, and then waits as long as it takes.
 *
 * It waits with a way out. The card carried no button and no escape, and a
 * dialog that opens behind the window rather than in front of it is common
 * enough that this was a full screen scrim over the app with nothing to press
 * and no way to know why. Putting the card away does not cancel the dialog
 * and does not throw the answer away: the seat has not moved, so a folder
 * picked afterwards still opens.
 */
async function chooser() {
  stop();
  /* the machine is not busy here, a person is, so a folder dragged in while
     the dialog sits there is taken as the answer it plainly is. */
  working = false;
  const mine = claim();
  paint({
    mode: "work",
    eyebrow: files(),
    line: "pick the folder",
    note: "the dialog is open in front of this window. keeper is waiting for it.",
    hint: "it can end up behind this window. not now puts this card away and leaves the dialog open.",
    acts: [dismiss()],
    esc: true,
    back: false,
  });

  let d;
  try {
    d = await (pending ??= ask("/api/choose", {}));
  } finally {
    /* whatever came back, the dialog is closed and the next call is entitled
       to open a new one. */
    pending = null;
  }

  /* SOMEBODY WENT BACK TO THE WINDOW AND DROPPED THE FOLDER IN INSTEAD.
     This dialog is then answering a question nobody is asking any more, and
     all three answers below reach into whatever is running: a cancel put the
     card away and stopped the poll of the archive that was opening, which
     left it opening behind a hidden panel with nothing on screen and no error
     anywhere. Two things say it is stale, and both have to be asked. The seat
     covers a job that has started. The flag covers the seconds before that,
     while the drop is still being worked out and has not opened anything yet,
     which is a narrow window and is exactly the one this was measured going
     wrong in. */
  if (mine !== seat || working) return;

  /* cancel is an answer, not an error. it goes back to whatever was on
     screen before the dialog went up. */
  if (d?.cancelled) return resume();
  if (d?.path) return open(d.path);
  failed(d?.error || "the folder dialog came back with nothing.");
}

/* the way in from a button or a click, where nothing is awaiting the answer */
const dialog = () => attempt(chooser(), "the folder dialog could not be opened.");

/* the empty state on a fresh archive belongs to app.js and this module
   exports nothing, so the way in from there is a click on anything wearing
   this attribute. no import to order, and nothing to break on a page that
   has none. */
addEventListener("click", (e) => {
  if (!e.target.closest?.("[data-keeper-choose]")) return;
  e.preventDefault();
  dialog();
});

/**
 * LOOK AGAIN AT THE FOLDER ALREADY OPEN.
 *
 * Same attribute trick as the chooser above, for the same reason: this module
 * exports nothing and imports nothing from the page, so the way in is a class
 * of element rather than a function somebody has to import in the right
 * order. The path rides on the button because asking the server for it would
 * be a second request for something the page already has written down.
 *
 * Without this there was no rescan anywhere in the window at all. The scan
 * short circuits on an index that is already there, so a photograph added to
 * an open folder never appeared, a folder renamed inside the archive left
 * every star under it stranded, and a frame deleted behind keeper's back sat
 * on the wall until somebody found the command line.
 */
addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-keeper-again]");
  if (!b) return;
  e.preventDefault();
  const where = b.dataset.path;
  if (!where || working) return;
  attempt(open(where, null, true), "that folder did not open again.");
});

/* ------------------------------------------------------------------ */
/* opening, and the wait that follows it                               */
/* ------------------------------------------------------------------ */

async function open(path, next = null, rescan = false) {
  stop();
  working = true;
  claim();
  paint({
    mode: "work",
    /* A rescan is the same route and the same wait, and it is not the same
       sentence. Somebody who pressed look again is watching a folder they
       already have open, and being told it is opening reads as keeper having
       forgotten where it was. */
    eyebrow: rescan ? "looking again" : "opening",
    line: tail(path),
    note: path,
  });

  const r = await ask("/api/open", { path, rescan });
  if (r?.ok) return watch(r.root ?? path);

  /* 409 is the server saying it already has one of these in flight. what it
     is doing is a better answer than what it just refused, so the progress
     is asked before anything is called an error. */
  if (r?.status === 409) {
    const d = await ask("/api/progress", null, "GET");
    if (d?.phase === "scanning" || d?.phase === "thumbnailing") return watch(d.root ?? path);
  }
  /* the guard stays up across a handoff. the step that follows is the same
     drop still being worked out, and dropping it here for the length of one
     call is a window in which a second drop gets in underneath. whatever the
     next step ends on puts it down. */
  if (next) return next();
  failed(r ? r.error || "that path did not open." : "the open route did not answer.");
}

/* which poll is the live one. a candidate clicked while a previous poll is
   mid flight would otherwise leave two of them painting the same card with
   two different archives. */
let run = 0;
let timer = 0;
let idles = 0;
let misses = 0;

function stop() {
  clearTimeout(timer);
  run++;
}

export function watch(where) {
  stop();
  working = true;
  claim();
  idles = 0;
  misses = 0;
  tick(run, where);
}

/**
 * Thumbnailing a few thousand frames takes real minutes, and a window that
 * sits there saying nothing for three of them is a window a person reloads.
 * So the phase is on screen the whole way through, and the percentage with
 * it, because a bar that moves is the difference between waiting and
 * wondering.
 *
 * setTimeout after each answer rather than setInterval: a server busy
 * resizing pictures can take longer than the interval to reply, and an
 * interval would stack requests behind it and make the slow case slower.
 */
async function tick(mine, where) {
  const d = await ask("/api/progress", null, "GET");
  if (mine !== run) return;

  if (!d) {
    /* one dropped answer is a busy server, five in a row is a server that
       has gone. */
    if (++misses > 5) {
      working = false;
      return failed("the server stopped answering while it was working.");
    }
  } else {
    misses = 0;
  }

  const phase = d?.phase ?? "idle";
  const root2 = d?.root ?? where;

  if (phase === "ready") {
    /* every list on this page was built from /api/state at boot and belongs
       to a different archive now. a reload is the honest way to change all
       of it at once, and it costs a fraction of what swapping two thousand
       tiles under a running app would. */
    location.reload();
    return;
  }

  if (phase === "failed") {
    working = false;
    return failed(d.error || "that archive could not be read.");
  }

  if (phase === "idle") {
    /* the open said yes, so idle is the gap before the work starts. a gap
       this long is the work never having started. */
    if (++idles > 30) {
      working = false;
      return failed("the server took the folder and then did nothing with it.");
    }
    paint({ mode: "work", eyebrow: "opening", line: tail(root2), note: "getting ready" });
  } else if (phase === "scanning") {
    idles = 0;
    paint({
      mode: "work",
      eyebrow: "scanning",
      line: tail(root2),
      note: d.frames ? `${frames(d.frames)} so far` : "reading the folder",
    });
  } else {
    idles = 0;
    const total = Number(d.total ?? 0);
    const done = Number(d.done ?? 0);
    const pct = total ? Math.round((done / total) * 100) : null;
    paint({
      mode: "work",
      eyebrow: "thumbnailing",
      line: tail(root2),
      note: total ? `${num(done)} of ${num(total)} · ${pct}%` : "starting",
      hint: "every frame gets one, once. after this the shelf opens instantly.",
      pct: pct ?? 0,
    });
  }

  timer = setTimeout(() => tick(mine, where), POLL);
}

/* ------------------------------------------------------------------ */
/* getting out                                                         */
/* ------------------------------------------------------------------ */

/* the backdrop dismisses and the card does not, which is why the card is a
   separate element: without the closest() test, reaching for a candidate
   path and missing it by two pixels would throw the list away. */
root.addEventListener("click", (e) => {
  if (escapes && !e.target.closest(".drop-card")) hide();
});

addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || root.hidden || !escapes) return;
  /* nothing else on the page acts on escape while this panel is up: it
     covers the preview and the lightbox, and neither of them can be open
     underneath it. the default is stopped because a browser in full screen
     treats this key as its own. */
  e.preventDefault();
  hide();
});
