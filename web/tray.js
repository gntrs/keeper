import { S } from "/app.js";
import { renderShelf } from "/shelf.js";
import { open as openPreview } from "/preview.js";
/* mounts itself and exports nothing. it decorates every drag that already
   carries MIME with the flavours finder and a terminal understand, so it has
   to be loaded wherever a draggable frame is, and the tray is the one module
   all three of those places already lead through. */
import "/dragout.js";

const $ = (s) => document.querySelector(s);

/**
 * The same private mime type bench.js drags with, written out again here
 * rather than imported from it. The two files are the only places a keeper
 * drag exists and neither owns the other, so a shared constant would mean a
 * module boundary invented for one string. The cost is that if this string
 * ever changes it has to change in both files, and the payoff is that a
 * frame dragged out of the shelf lands on a bench slot as readily as in the
 * tray, because both ends already speak the same flavour.
 */
export const MIME = "application/x-keeper-frame";
/* The plural flavour, set by the shelf alongside the singular one: a json
   array of every picked frame when the one you grabbed is in the selection,
   and just itself when it is not. The singular is still set and still read
   first by the bench, which places exactly one frame into one hole and has
   no use for a set. */
export const MIMES = "application/x-keeper-frames";

const T = { list: [], active: null, live: false };

/**
 * Membership of the active tray, kept as a Set beside the list. The shelf
 * asks this question once per visible frame on every repaint, and a repaint
 * happens on every arrow key, so an includes() over a few hundred ids inside
 * a loop over a few thousand tiles is the one place in this file where the
 * shape of the data would actually show up on screen.
 */
let mark = new Set();

/**
 * /api/state hands over a trays map of frameId to trayId list, and this file
 * deliberately does not read it. The panel needs names, order, and which
 * tray is active, none of which that map carries, so /api/trays has to be
 * fetched anyway. Keeping a second copy of the same truth in S.trays and
 * mutating it alongside this one would buy nothing and would drift the first
 * time one of the two writes failed.
 */
export async function mountTray() {
  const box = $("#tray");

  $("#tray-toggle").onclick = () => show(box.hidden);
  RESTING = $("#tray-clear").textContent.trim() || RESTING;
  $("#tray-clear").onclick = () => wipe();
  $("#tray-pick").onchange = (e) => pick(e.target.value);
  $("#tray-export").onclick = () => ship();
  $("#tray-folder").onkeydown = (e) => { if (e.key === "Enter") ship(); };
  buildMode();

  /* A drop target that only lights up for our own mime type. A dragover
     handler that preventDefaults everything would make the panel accept a
     file off the desktop, a link from another tab and a run of selected
     text, and all three would then be dropped on the floor by the drop
     handler below with no explanation. */
  box.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    /* A tile dragged out of the tray passes back over the tray on its way to
       finder, and lighting the panel up to say "drop it in" for a frame that
       is already in it is the panel lying about what would happen. */
    if (box.dataset.own) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    box.setAttribute("data-over", "");
  });
  box.addEventListener("dragleave", (e) => {
    if (!box.contains(e.relatedTarget)) box.removeAttribute("data-over");
  });
  box.addEventListener("drop", (e) => {
    box.removeAttribute("data-over");
    /* the plural first, the singular as the floor. a drag that came from
       anywhere older than this pass carries only the singular, and dropping
       forty frames one at a time is the failure this whole flavour exists to
       stop. */
    const many = readIds(e.dataTransfer);
    if (!many.length) return;
    e.preventDefault();
    addMany(many);
  });

  /* The own flag is cleared by more than the matching dragend on the tile,
     because the tile that set it can be repainted out of the document while
     the drag is still in flight and would take its own listener with it. A
     drag that starts anywhere else is proof the last one is over, and that
     is the case that has to be right: a shelf frame on its way in must
     never find the panel refusing to light up. */
  addEventListener("dragstart", (e) => {
    if (!box.contains(e.target)) delete box.dataset.own;
  }, true);
  addEventListener("dragend", () => delete box.dataset.own);

  /* The panel remembers whether it was open, the same way the view remembers
     which half of the app you were in. Someone who shut it to get the shelf
     back at 1280px should not have to shut it again after every reload, and
     someone who lives in it should not have to open it every time. */
  show(localStorage.getItem("keeper.tray") === "open", true);
  await refresh();
}

/* ------------------------------------------------------------------ */
/* talking to the server                                               */
/* ------------------------------------------------------------------ */

/**
 * app.js's post() answers one question, did it land, because that is all any
 * other write in keeper needs to know. The tray needs the answer itself:
 * an export has to report how many files it wrote and where it put them, and
 * a freshly created tray has to be found again afterwards. So this returns
 * the parsed body, or null when the request failed, and post() is left as
 * the narrow thing it is rather than widened for one caller.
 */
async function ask(route, body, method = "POST") {
  try {
    const res = await fetch(route, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    });
    const seen = await res.json().catch(() => null);
    if (!res.ok) {
      /* A refused write says why, and the reason is worth putting on screen
         rather than only in the console: "that folder is inside the archive"
         is something the person can act on, and "it did not work" is not.
         So a rejection comes back as a body with ok false on it, and null is
         kept for the case where the request never got an answer at all. */
      console.error("[keeper]", route, seen);
      return { ok: false, error: seen?.error };
    }
    return seen;
  } catch (e) {
    console.error("[keeper]", route, e);
    return null;
  }
}

/**
 * Everything about the tray arrives in one read, so the panel can never show
 * a name from one moment and a count from another. It is a cheap call
 * against a process on this machine, and the alternative, patching a local
 * copy after every write and hoping it still matches, is how a count ends up
 * one out with no way to tell which side is lying.
 */
async function refresh() {
  const d = await ask("/api/trays", null, "GET");
  if (!Array.isArray(d?.trays)) {
    /* The server half of this feature may simply not be there yet. That is a
       missing panel, not a broken app: the shelf, the bench and the whole
       tagging keyboard still work, so it says so in the panel and stops. */
    T.live = false;
    T.list = [];
    T.active = null;
    mark = new Set();
    paint();
    return;
  }
  T.live = true;
  T.list = d.trays ?? [];
  T.active = d.active ?? T.list[0]?.id ?? null;
  remark();
  paint();
  renderShelf();
}

const cur = () => T.list.find((t) => t.id === T.active) ?? null;
const remark = () => (mark = new Set(cur()?.ids ?? []));

/** the shelf asks this to decide whether a frame wears the intray mark */
export function inTray(id) {
  return mark.has(id);
}

/* ------------------------------------------------------------------ */
/* adding and removing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Optimistic, the way tagging is. Someone cmd clicking down a wall of two
 * thousand frames gets a round trip on every one of them, and waiting for it
 * before the mark appears would make a fast hand feel like a slow tool. The
 * write still goes out, and it still says so in the console if it fails.
 */
export async function toggle(id) {
  const t = cur();
  if (!t) return;
  const had = mark.has(id);
  t.ids = had ? t.ids.filter((x) => x !== id) : [...t.ids, id];
  remark();
  paint();
  renderShelf();

  /* The first frame anyone puts in a tray opens the panel, because a picture
     that vanishes into a shut drawer reads as a picture that did nothing.
     After that the panel obeys whatever the person last chose, so this
     happens exactly once in the life of the app. */
  if (!had && !localStorage.getItem("keeper.tray")) show(true);

  await ask("/api/trays", { id: t.id, [had ? "remove" : "add"]: [id] }, "PATCH");
}

/** a drop is an add and never a remove: nobody drags a frame in to take it out */
export const add = (id) => (mark.has(id) ? null : toggle(id));

/** what a drag is carrying, plural preferred, singular accepted */
function readIds(dt) {
  try {
    const many = JSON.parse(dt.getData(MIMES) || "[]");
    if (Array.isArray(many) && many.length) return many.filter((x) => typeof x === "string");
  } catch {
    /* a malformed plural is not worth losing the drop over: the singular is
       still there and still says which frame was under the hand. */
  }
  const one = dt.getData(MIME);
  return one ? [one] : [];
}

/**
 * Forty frames in one drop, in one repaint and one request.
 *
 * `add` one at a time would repaint the panel and the whole shelf on every
 * id, which on a selection of two hundred is two hundred renders of two
 * hundred tiles, and would fire two hundred PATCHes that each rewrite the
 * same file. The optimistic write is kept: the marks appear before the
 * server has answered, exactly as a single add does.
 */
export async function addMany(ids) {
  const t = cur();
  if (!t) return;
  const fresh = ids.filter((id) => !mark.has(id));
  if (!fresh.length) return;

  t.ids = [...t.ids, ...fresh];
  remark();
  paint();
  renderShelf();
  if (!localStorage.getItem("keeper.tray")) show(true);

  await ask("/api/trays", { id: t.id, add: fresh }, "PATCH");
}

/* ------------------------------------------------------------------ */
/* emptying, which is the one destructive thing in here                */
/* ------------------------------------------------------------------ */

/**
 * How long "sure?" stands there. Long enough to move a hand across the panel
 * and read the word, short enough that a red button is never what somebody
 * comes back to after a phone call and presses to find out what it does.
 */
const SURE = 3000;

/**
 * The resting word, read out of the markup once rather than written down a
 * second time in here. Two copies of a sentence a person reads is two places
 * to change it and one of them will be missed.
 */
let RESTING = "empty the tray";
let armed = 0;

/**
 * Nothing in keeper undoes anything. Forty frames picked one at a time for a
 * client are gone the moment this fires, and the difference between meaning
 * it and brushing past it is one pixel of travel, so the button asks. This is
 * the only place in the app where the accent means "you have to deal with
 * this" rather than "you chose this", and it earns that because it is the
 * only click here that destroys work.
 *
 * It disarms itself on a timer rather than waiting to be dismissed, because a
 * confirmation that sits there forever stops being a question and becomes
 * part of the furniture.
 */
async function wipe() {
  const t = cur();
  if (!t || !t.ids.length) return;
  if (!armed) return arm();
  disarm();
  t.ids = [];
  remark();
  paint();
  renderShelf();
  await ask("/api/trays", { id: t.id, clear: true }, "PATCH");
}

/* The colour is set from here rather than through a class because armed is a
   state this file owns and holds for three seconds: it is behaviour wearing a
   colour, not a look the panel has. The word replaces the label instead of
   sitting beside it so the button stays exactly one thing to click. */
function arm() {
  const b = $("#tray-clear");
  /* "sure?" is half the width of the word it replaces, and the count beside
     it is pushed out by an auto margin, so without this the number of frames
     you are about to lose slides across the header at the exact moment you
     are reading it. The width is measured rather than named because the word
     on the button belongs to the markup. */
  b.style.minWidth = `${b.offsetWidth}px`;
  b.textContent = "sure?";
  b.style.color = "var(--hot)";
  armed = setTimeout(disarm, SURE);
}

/* Called on every repaint as well as by the timer. A repaint means the pile
   underneath the question has changed, and a "sure?" left standing over a
   different tray, or over a tray that just gained a frame, is a question
   about something that is no longer on screen. */
function disarm() {
  clearTimeout(armed);
  armed = 0;
  const b = $("#tray-clear");
  if (b.textContent !== RESTING) b.textContent = RESTING;
  b.style.color = "";
  b.style.minWidth = "";
}

/* ------------------------------------------------------------------ */
/* the picker                                                          */
/* ------------------------------------------------------------------ */

/* A value no real tray id can collide with. Ids are slugs, so they never
   contain a space, and a tray a person actually calls "new tray" gets the id
   new-tray and still picks cleanly. */
const NEW = "new tray";

/**
 * A prompt() rather than a field that unfolds, and that is a deliberate
 * cheapness. Naming a tray happens once and then not again for the rest of
 * the afternoon, and an inline form for it would sit in the header taking up
 * width the thumbnails want, in a panel that already has to survive a 1280px
 * window with the whole shelf beside it.
 */
async function pick(value) {
  if (value !== NEW) {
    T.active = value;
    remark();
    paint();
    renderShelf();
    await ask("/api/trays", { id: value, active: true }, "PATCH");
    return;
  }

  const name = (prompt("name this tray") ?? "").trim();
  paint();                         // puts the select back on the real tray
  if (!name) return;
  const made = await ask("/api/trays", { name });
  if (!made?.ok) return;

  /* Re-read rather than paint from what the create handed back. The id is
     minted on the server side, and a create that also switches the active
     tray, which this one does, means the whole document has moved and not
     just one row of it. One read costs nothing and cannot be half right. */
  await refresh();
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

/**
 * The default destination, and it is shown as the placeholder rather than
 * filled in, so the field stays empty and obvious while still telling you
 * exactly where the files are about to appear. The Desktop because the export
 * refuses to write inside the archive and a bare folder name would resolve
 * against whatever directory keeper happened to be started from, which is
 * the one place a person will not think to look. The tray's own id is the
 * folder name because that id is already a slug and is the same string the
 * command line uses for the tray.
 */
const where = (t) => `~/Desktop/${t.id}`;

/**
 * The three modes, and the plain sentence each one is. "symlink" is a word
 * from an operating systems course and means nothing to somebody who shoots
 * for a living, so the control says link and the line underneath says what
 * that costs you. The value is still symlink, because that is what the
 * server and the command line call it and one name per thing is worth more
 * than a nicer wire format.
 *
 * The difference that actually matters is in the second half of each line:
 * a copy is a file you can send to someone and the other two are not, and
 * finding that out by emailing a folder of 4KB links is a bad afternoon.
 */
const MODES = [
  ["copy", "copy", "real files, yours to hand to anyone. the archive is untouched."],
  ["symlink", "link", "pointers to the originals. nothing is copied, and they break if you move the originals."],
  ["alias", "alias", "finder aliases. nothing is copied, and finder follows the originals if they move."],
];

/* what the button says while it works, and what the result line says after */
const VERB = {
  copy: ["copying...", "wrote"],
  symlink: ["linking...", "linked"],
  alias: ["making aliases...", "aliased"],
};

/**
 * Built here rather than sitting in index.html, because everything else in
 * the footer was already there before this feature existed and the markup
 * belongs to whoever needs it changed. It is appended once, on mount.
 */
function buildMode() {
  const sel = document.createElement("select");
  sel.id = "tray-mode";
  sel.className = "tray-mode";
  sel.title = "how the frames leave the archive";
  sel.append(...MODES.map(([value, label]) => new Option(label, value)));
  sel.onchange = () => setMode(sel.value);
  $("#tray-folder").after(sel);

  const note = document.createElement("p");
  note.id = "tray-mode-note";
  note.className = "tray-mode-note";
  $("#tray-result").before(note);
}

const meansOf = (mode) => MODES.find(([v]) => v === mode)?.[2] ?? "";

/**
 * Remembered on the tray and not in localStorage. A mode belongs to the job
 * the tray is: a folder of stills going to a client wants copies and a
 * scratch tray feeding a video edit wants links, and a single browser wide
 * setting would have the second one quietly overwrite the first.
 */
async function setMode(mode) {
  const t = cur();
  $("#tray-mode-note").textContent = meansOf(mode);
  if (!t) return;
  t.mode = mode;
  await ask("/api/trays", { id: t.id, mode }, "PATCH");
}

async function ship() {
  const t = cur();
  if (!t || !t.ids.length) return;
  const folder = $("#tray-folder").value.trim() || where(t);
  const mode = $("#tray-mode").value;
  const out = $("#tray-result");

  $("#tray-export").disabled = true;
  $("#tray-mode").disabled = true;
  out.textContent = VERB[mode][0];
  const d = await ask("/api/trays/export", { id: t.id, folder, mode });
  $("#tray-export").disabled = false;
  $("#tray-mode").disabled = false;

  if (!d?.ok) {
    out.textContent = d?.error
      ? `that export stopped: ${d.error}`
      : "that export did not finish. the console has the reason.";
    return;
  }
  /* What happened, in files, in the place it happened. "done" would leave
     someone opening a Finder window to find out whether it worked, and the
     skipped count is the number that earns its place: it is how you learn
     that a frame in the tray is no longer on the disk.
     The verb carries the mode, because a folder of links and a folder of
     copies look identical in finder and weigh nothing alike. */
  out.textContent =
    `${VERB[d.mode ?? mode][1]} ${d.written} ${d.written === 1 ? "file" : "files"} to ${d.dest}` +
    (d.skipped ? `, skipped ${d.skipped}` : "") +
    ((d.mode ?? mode) === "copy" ? "" : ", nothing was copied");

  /* the server has just remembered the folder on the tray, so the next read
     prefills it. re-reading is how the panel finds that out rather than
     assuming it. */
  await refresh();
}

/* ------------------------------------------------------------------ */
/* painting                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which tray the folder field was last filled for, and with what. The field
 * is prefilled from the tray's remembered destination, and the whole trick
 * is not stomping on a path somebody is halfway through typing: paint() runs
 * on every add, every remove and every arrow key. So it only writes when the
 * tray underneath has changed, or when the stored destination itself has,
 * which is exactly the moment an export just succeeded and the field is
 * holding a shorthand the server has since resolved.
 */
let filled = { id: null, dest: null };

function paint() {
  const sel = $("#tray-pick");
  const grid = $("#tray-grid");
  const t = cur();
  disarm();

  if (!T.live) {
    sel.replaceChildren(new Option("no trays", "", true, true));
    sel.disabled = true;
    $("#tray-count").textContent = "0";
    $("#tray-clear").disabled = true;
    $("#tray-export").disabled = true;
    grid.replaceChildren();
    $("#tray-mode").disabled = true;
    $("#tray-mode-note").textContent = "";
    $("#tray-result").textContent = "trays are not answering on this server.";
    return;
  }

  sel.disabled = false;
  sel.replaceChildren(
    ...T.list.map((x) => new Option(x.name, x.id, x.id === T.active, x.id === T.active)),
    new Option("new tray...", NEW),
  );

  /* A tray can hold an id the index no longer has, because the archive is a
     folder on a disk and folders lose files. Those are dropped from the
     panel rather than drawn as broken thumbnails, and the export route is
     the one that gets to report them as skipped. */
  const ids = (t?.ids ?? []).filter((id) => S.byId.has(id));
  $("#tray-count").textContent = String(ids.length);
  $("#tray-clear").disabled = !ids.length;
  $("#tray-export").disabled = !ids.length;
  $("#tray-folder").placeholder = t ? where(t) : "folder to write to";

  /* copy for a tray that has never been exported, because it is the only
     mode whose result is still a photograph when the folder is emailed on. */
  const mode = t?.mode ?? "copy";
  $("#tray-mode").disabled = false;
  $("#tray-mode").value = mode;
  $("#tray-mode-note").textContent = meansOf(mode);
  if (t && (filled.id !== t.id || (t.dest ?? null) !== filled.dest)) {
    filled = { id: t.id, dest: t.dest ?? null };
    $("#tray-folder").value = t.dest ?? "";
  }

  if (!ids.length) {
    const p = document.createElement("p");
    p.className = "dim";
    p.textContent = t
      ? "empty. drag frames in here, or press cmd return with some picked."
      : "make a tray first.";
    grid.replaceChildren(p);
    return;
  }

  grid.replaceChildren(...ids.map(tile));
}

function tile(id) {
  const frame = S.byId.get(id);
  const fig = document.createElement("figure");
  fig.className = "tray-item";
  fig.dataset.id = id;

  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.src = `/thumb/${id}`;
  img.alt = "";
  fig.append(img);

  /* Draggable for the same reason a shelf frame is, and it matters more
     here: the tray is the pile you already decided on, so it is the pile you
     drag one out of when a single frame has to go somewhere now rather than
     the whole folder later. The private mime is what dragout.js watches for,
     and it is also what lets a tray frame land on a bench slot. */
  fig.draggable = true;
  fig.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(MIME, id);
    e.dataTransfer.setData("text/plain", frame.path);
    e.dataTransfer.effectAllowed = "copy";
    if (img.complete && img.naturalWidth) {
      e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    }
    document.body.dataset.dragging = "1";
    $("#tray").dataset.own = "1";
  });
  fig.addEventListener("dragend", () => {
    delete document.body.dataset.dragging;
    delete $("#tray").dataset.own;
    $("#tray").removeAttribute("data-over");
  });

  const kill = document.createElement("button");
  kill.className = "tray-remove";
  kill.type = "button";
  /* Left empty on purpose. The button covers the whole thumbnail and the
     stylesheet fills it with the word "remove" through :empty::before, which
     it can only do while nothing is written in here. A cross floating over
     the middle of a photograph asks whether the file is about to be deleted,
     and that is the one question this button must never raise. */
  kill.title = "take it out of the tray";
  kill.onclick = (e) => { e.stopPropagation(); toggle(id); };
  fig.append(kill);

  /* The tray is where you go to check a choice, so a frame in it opens the
     same preview a frame in the shelf does. It is the only way to answer
     "was that the sharp one" without going back to hunt for it in the grid. */
  fig.title = frame.path.split("/").pop();
  fig.onclick = () => openPreview(frame);
  return fig;
}

/* ------------------------------------------------------------------ */
/* showing and hiding                                                  */
/* ------------------------------------------------------------------ */

function show(on, quiet = false) {
  $("#tray").hidden = !on;
  $("#tray-toggle").setAttribute("aria-expanded", String(!!on));
  if (!quiet) localStorage.setItem("keeper.tray", on ? "open" : "shut");
}

/**
 * The bench already spends 360px of the right hand side on its own picker.
 * Standing the tray beside that at 1280px leaves a slot around 500px wide,
 * which is too small to judge a crop in, and judging a crop is the entire
 * job of that screen. So the panel belongs to the shelf and steps aside on
 * the bench, without forgetting that the person had left it open.
 */
export function trayView(view) {
  const wanted = localStorage.getItem("keeper.tray") === "open";
  const allowed = view === "shelf";
  $("#tray").hidden = !(wanted && allowed);
  $("#tray-toggle").hidden = !allowed;
}
