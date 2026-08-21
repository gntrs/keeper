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
        that can hand a browser a path and mean it. it opens by itself when
        the first two come up empty, because at that point it is the only
        move left and asking permission to make it is a wasted click.

   Nothing in here says the drop failed when what actually happened is that
   the browser withheld the path. Those are two different sentences and only
   one of them is ever true.

   The module mounts itself on import and exports nothing. It has to survive
   a page with no frames on it and a page with two thousand, so it reads
   nothing out of the app and touches no markup it did not make.
   --------------------------------------------------------------------- */

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

  escapes = !!o.esc;
  if (o.esc) was = o;
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

const askFinder = () => ({ text: "choose a folder", run: chooser });
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

  b.onclick = () => open(c.path);
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
    if (!res.ok) console.error("[keepers]", route, seen);
    return { status: res.status, ...(seen ?? {}) };
  } catch (e) {
    console.error("[keepers]", route, e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* the drag layer                                                      */
/* ------------------------------------------------------------------ */

/* A drag only belongs to this file when it carries files. Every drag that
   starts inside keepers, a frame going to the tray or onto a bench slot,
   carries a private mime type instead, so this one test is what keeps the
   two systems from ever meeting. */
const carries = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/* dragenter and dragleave fire for every element the pointer crosses on the
   way in, so a boolean would flicker the overlay off the moment the cursor
   passed from the grid onto a thumbnail inside it. counting the pairs is the
   only version of this that holds still. */
let depth = 0;
let alive = 0;
let sweep = 0;
let working = false;

/* what was on screen when the drag arrived, so a drag that crosses the
   window and leaves again does not take a list of candidates with it. */
let under = null;

addEventListener("dragenter", (e) => {
  if (!carries(e)) return;
  depth++;
  alive = performance.now();
  if (working || root.dataset.mode === "drag") return;
  under = !root.hidden && escapes ? was : null;
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
     more useful question than an error about it would. */
  if (working) return;
  take(e.dataTransfer);
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
    note: "keepers opens the folder it came out of. nothing is copied and nothing moves.",
  });
}

/* ------------------------------------------------------------------ */
/* step 1 and step 2, out of one drop                                  */
/* ------------------------------------------------------------------ */

function take(dt) {
  /* Everything this drop knows has to be read now, synchronously. The
     dataTransfer is emptied the moment the handler returns, so a single
     await before these three reads leaves an empty object behind and no
     error anywhere to say what happened. */
  const url = fileUrl(dt.getData("text/uri-list")) ?? fileUrl(dt.getData("text/plain"));
  const entries = [...(dt.items ?? [])]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() ?? null : null))
    .filter(Boolean);
  const files = [...(dt.files ?? [])].map((f) => ({ name: f.name, size: f.size }));
  resolve(url, entries, files);
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
      const p = decodeURIComponent(new URL(s).pathname);
      /* finder writes a folder as a url with a trailing slash. the server
         should be handed the folder and not a path with an empty last
         segment on the end of it. */
      return p.length > 1 ? p.replace(/\/+$/, "") : p;
    } catch {
      /* a line that will not parse is not worth an error message. step 2 is
         standing right there. */
    }
  }
  return null;
}

async function resolve(url, entries, files) {
  if (url) return open(url);

  const dir = entries.find((x) => x.isDirectory);
  const name = dir ? dir.name : files[0]?.name ?? "";
  if (!dir && !files.length) {
    return withheld("", "there were no files in that drop, only something that looked like one.");
  }

  paint({
    mode: "work",
    eyebrow: "opening",
    line: dir ? `looking for ${dir.name}` : "looking for those files",
    note: "the browser is told the name and never the path, so keepers is asking spotlight where it lives.",
  });

  /* Several folders at once is one folder as far as keepers is concerned:
     it opens a single root and the first one is the one the hand was on. */
  const body = dir
    ? { name: dir.name, kind: "folder", files: await peek(dir) }
    : { name: "", kind: "files", files };

  const d = await ask("/api/locate", body);
  const list = Array.isArray(d?.candidates) ? d.candidates : [];
  if (list.length === 1) return open(list[0].path);
  if (list.length > 1) return offer(list, name);

  /* Spotlight came back empty, so step 3 happens on its own rather than
     behind a button. The card that used to sit here spent four lines
     explaining what a browser is and is not told about a dropped folder, and
     then asked for one more click to do the only thing left to do. The finder
     dialog opening is that explanation, said in the one language this person
     already speaks, and it is a click shorter. Nothing was lost: the drop did
     not fail, and nothing here says it did. */
  chooser();
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
/* the three panels a person actually reads                            */
/* ------------------------------------------------------------------ */

function offer(list, name) {
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
    line: "the path stayed in finder",
    note: name
      ? `a browser is only ever told the name, ${name}, and spotlight could not place it on the disk.`
      : "a browser is never told where a dropped thing lives on the disk.",
    hint: why || "point at the folder once and keepers has it from there.",
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/** something really did go wrong, and it says which thing */
function failed(msg) {
  stop();
  working = false;
  paint({
    mode: "fail",
    eyebrow: "not opened",
    line: "that did not open",
    note: msg,
    acts: [askFinder(), dismiss()],
    esc: true,
  });
}

/* ------------------------------------------------------------------ */
/* step 3, the native chooser                                          */
/* ------------------------------------------------------------------ */

/**
 * The request stays open for as long as the dialog is on screen, which can
 * be a minute if someone goes hunting through their disk. A spinner with no
 * words on it would read as a hang, so the card says where the dialog is,
 * once, quietly, and then waits as long as it takes.
 */
async function chooser() {
  stop();
  paint({
    mode: "work",
    eyebrow: "finder",
    line: "pick the folder",
    note: "the dialog is open in front of this window. keepers is waiting for it.",
  });

  const d = await ask("/api/choose", {});
  /* cancel is an answer, not an error. it goes back to whatever was on
     screen before the dialog went up. */
  if (d?.cancelled) return resume();
  if (d?.path) return open(d.path);
  failed(d?.error || "the folder dialog came back with nothing.");
}

/* the empty state on a fresh archive belongs to app.js and this module
   exports nothing, so the way in from there is a click on anything wearing
   this attribute. no import to order, and nothing to break on a page that
   has none. */
addEventListener("click", (e) => {
  if (!e.target.closest?.("[data-keepers-choose]")) return;
  e.preventDefault();
  chooser();
});

/* ------------------------------------------------------------------ */
/* opening, and the wait that follows it                               */
/* ------------------------------------------------------------------ */

async function open(path) {
  stop();
  working = true;
  paint({ mode: "work", eyebrow: "opening", line: tail(path), note: path });

  const r = await ask("/api/open", { path });
  if (r?.ok) return watch(r.root ?? path);

  if (!r) return failed("the open route did not answer.");

  /* 409 is the server saying it already has one of these in flight. what it
     is doing is a better answer than what it just refused, so the progress
     is asked before anything is called an error. */
  if (r.status === 409) {
    const d = await ask("/api/progress", null, "GET");
    if (d?.phase === "scanning" || d?.phase === "thumbnailing") return watch(d.root ?? path);
  }
  working = false;
  failed(r.error || "that path did not open.");
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

function watch(where) {
  stop();
  working = true;
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
