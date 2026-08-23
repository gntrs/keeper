import { S, post, tally } from "/app.js";
import { inTray } from "/tray.js";
import { CENTERED, clamp, coverWidth, isAtCover, resolve, toObjectPosition } from "/geometry.mjs";

import { nope } from "/motion.js";
import { feel } from "/feel.js";
import { did } from "/undo.js";

const $ = (s) => document.querySelector(s);
const els = new Map();          // slotId -> { root, box, img, empty, nums }
let active = null;              // the slot a picked frame lands in
const P = { star: false, q: "", tray: false };

/**
 * The frame being tried on, or null. One id, held here and nowhere else.
 *
 * It is deliberately not written into S.placements even for a moment. Half
 * of what makes a trial a trial is that closing the tab loses it, and a
 * trial that lived in the same map as a placement would be one forgotten
 * guard away from being posted to disk.
 */
let trial = null;

/** the order the racks come out in. anything else lands after them. */
const GROUPS = ["yours", "social", "web"];
const groupOf = (slot) => slot.group || "yours";

export function mountBench() {
  $("#p-star").onclick = (e) => { P.star = !P.star; e.currentTarget.classList.toggle("on"); strip(); };

  /* The tray, in the one place the bench had no way to see it. The pile you
     built on the shelf is exactly the pile you came here to place, and
     before this the only route from one to the other was remembering a
     filename. It sits before "kept only" because it is the narrower claim:
     kept is everything you liked, the tray is what you chose. */
  $("#p-tray").onclick = (e) => { P.tray = !P.tray; e.currentTarget.classList.toggle("on"); strip(); };

  /* The tray is edited from the panel and from the shelf, both of which can
     be on screen while the bench holds a filtered strip underneath. An event
     rather than an import because tray.js already reaches into the shelf,
     and a second module reaching back would be a cycle for one call. */
  addEventListener("keeper:tray", () => { if (P.tray) strip(); });
  $("#p-q").oninput = (e) => { P.q = e.target.value.trim().toLowerCase(); strip(); };

  /* Land on the pile he made. The shelf is where frames get kept and the
     bench is what you do with the kept ones, so arriving at all 1,768 again
     throws that sequence away and the strip becomes a second shelf. The
     default teaches shelf then bench without a word of copy.

     Off when nothing is kept, because a filter that hides everything is not
     an argument for the shelf, it is an empty panel. */
  P.star = S.items.some((i) => S.tags[i.id]?.star);
  $("#p-star").classList.toggle("on", P.star);

  buildExport();

  addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", () => (drag = null));
  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("keydown", onKey);
  addEventListener("resize", () => paintAll());
}

export function renderBench() {
  /* An archive with nothing in it is what a person sees on the very first
     run, and fourteen empty holes are fourteen ways to ask a question they
     cannot answer yet. The shelf already says the one thing worth saying at
     that moment, so this says it too: both tabs of a fresh run give the same
     instruction rather than two different explanations of the same nothing. */
  if (!S.items.length) {
    $("#slots").innerHTML = `
      <div class="blank">
        <h2>nothing here yet</h2>
        <p>drag a folder onto this window, or
           <button class="chip" type="button" data-keeper-choose>choose
           one</button>.</p>
        <p class="hint">the slots come back the moment there are frames to
           put in them.</p>
      </div>`;
    $("#picker").hidden = true;
    return;
  }
  if (!S.slots.length) {
    $("#slots").innerHTML = `
      <div class="blank">
        <h2>no slots to fill</h2>
        <p>the bench needs to know what shape the holes are. that lives in
           <code>keeper.config.json</code>, in the folder you ran keeper
           from, because only you know what your layout wants.</p>
        <pre>keeper init</pre>
        <p class="hint">that writes a starting file. edit the slots, reload
           this page, and they appear here at their real proportions.</p>
      </div>`;
    $("#picker").hidden = true;
    return;
  }
  $("#picker").hidden = false;
  els.clear();

  /* The groups in a fixed order, then anything carrying a group nobody here
     planned for, under a heading of its own. Nothing is allowed to fall out
     of this list: a slot that fails to render is a hole that never gets
     filled, and the person would never know it was missing. */
  const present = [...new Set(S.slots.map(groupOf))];
  const order = [...GROUPS.filter((g) => present.includes(g)),
                 ...present.filter((g) => !GROUPS.includes(g))];
  const racks = order.map((g) => rackEl(g, S.slots.filter((s) => groupOf(s) === g)));

  /* No group of your own means no keeper.config.json. That file used to be
     the whole of the bench, so its absence explained itself by leaving the
     page empty; now the built ins fill the page and it explains nothing. */
  if (!order.includes("yours")) {
    const foot = document.createElement("p");
    foot.className = "rack-foot";
    foot.innerHTML = `these are the shapes the world cuts to. the holes in
      your own layout go in <code>keeper.config.json</code>, in the folder
      you ran keeper from, and they land above these.`;
    racks.push(foot);
  }

  $("#slots").replaceChildren(...racks);
  strip();
  paintAll();
}

function rackEl(group, list) {
  const sec = document.createElement("section");
  sec.className = "rack";
  const name = document.createElement("h2");
  name.className = "label rack-name";
  name.textContent = group;
  const grid = document.createElement("div");
  grid.className = "rack-grid";
  grid.append(...list.map(slotEl));
  sec.append(name, grid);
  return sec;
}

function slotEl(slot) {
  const root = document.createElement("div");
  root.className = "slot" + (active === slot.id ? " on" : "");
  root.dataset.slot = slot.id;
  // the stylesheet caps how tall a box may get, and it has to do it by
  // capping the width instead, so it needs the ratio as a number.
  root.style.setProperty("--ar", String(slot.aspect));

  const head = document.createElement("header");
  head.className = "head";
  /* The zoom used to be option plus a scroll wheel and nothing else: no
     control, no number, one line in a footer. Across three archives and
     3,697 frames it had been used exactly zero times, which is what an
     invisible gesture is worth. The keyboard and the pinch are still the
     fast paths; this is the one that can be found. */
  head.innerHTML = `<strong>${slot.label}</strong><em>${slot.aspectText}</em>
    <span class="grow"></span>
    <span class="zoom" hidden><button type="button" data-z="out" title="wider"
      >&minus;</button><em class="pct">100%</em><button type="button" data-z="in"
      title="punch in">+</button></span>
    <em>${slot.width || "?"}px</em>`;
  head.querySelector('[data-z="in"]').onclick = () => nudge(slot.id, 1 / 1.12);
  head.querySelector('[data-z="out"]').onclick = () => nudge(slot.id, 1.12);

  const box = document.createElement("div");
  box.className = "box";
  box.style.aspectRatio = String(slot.aspect);
  box.dataset.slot = slot.id;

  const img = new Image();
  img.alt = "";
  img.hidden = true;
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "drag a frame here";
  box.append(img, empty);

  const nums = document.createElement("div");
  nums.className = "nums";

  /* The export, under the picture it exports.
     There was one button for the whole bench and it wrote every placed slot
     at once, which is the right thing to have and the wrong thing to have
     only. Most of the time the question is about this picture: it is framed,
     it is right, give me the file. Firing off nineteen crops to get at one
     is a folder to sort through afterwards.
     It is here only while the slot holds something, so an empty bench is not
     nineteen buttons offering to export nothing. */
  const foot = document.createElement("div");
  foot.className = "slot-foot";
  foot.hidden = true;
  const shot = document.createElement("button");
  shot.className = "chip";
  shot.type = "button";
  shot.dataset.icon = "";
  shot.textContent = "export this one";
  const said = document.createElement("span");
  said.className = "said";
  foot.append(shot, said);
  shot.onclick = (e) => { e.stopPropagation(); ship(slot.id, shot, said); };

  root.append(head, box);
  if (slot.note) {
    const n = document.createElement("div");
    n.className = "note";
    n.textContent = slot.note;
    // the stylesheet clamps this to two lines so nineteen captions cannot
    // turn the bench into an essay. the title is where the rest of it goes.
    n.title = slot.note;
    root.append(n);
  }
  root.append(nums, foot);

  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!root.hasAttribute("data-over")) { clearOver(); root.setAttribute("data-over", ""); }
  });
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) root.removeAttribute("data-over");
  });
  root.addEventListener("drop", (e) => {
    const id = e.dataTransfer.getData(MIME);
    if (!id) return;
    e.preventDefault();
    clearOver();
    const item = S.byId.get(id);
    if (item) assign(item, slot.id);
  });

  els.set(slot.id, { root, box, img, empty, nums, foot, said,
                     zoom: head.querySelector(".zoom"), pct: head.querySelector(".pct") });

  /* With a trial up, the whole bench is already showing this frame and the
     only thing left to settle is which hole it belongs in, so a click on the
     hole is the commit. That is the same two clicks filling a slot has always
     taken, in the order that shows you the answer before you agree to it.

     A slot that already holds something is never taken this way. The click on
     a placed slot is the one you make before nudging it with the arrows, and
     a trial quietly eating a crop somebody spent a minute on would be the
     worst thing this file could do. */
  root.onclick = () => {
    const item = trial && !S.placements[slot.id] && S.byId.get(trial);
    if (item) assign(item, slot.id);
    else setActive(slot.id);
  };
  return root;
}

export function setActive(id) {
  active = id;
  for (const el of document.querySelectorAll(".slot")) {
    el.classList.toggle("on", el.dataset.slot === id);
  }
}
export const setPick = setActive;

/**
 * One line and two states, both of them true.
 *
 * There used to be a third, `filling instagram post`, set whenever a slot was
 * clicked. Nothing anywhere kept that promise: both callers of assign name
 * their slot outright, so no path in the app ever filled the active one, and
 * clicking a frame in the strip tried it in all fourteen shapes instead. The
 * trial is the better gesture, so the line lost the sentence rather than the
 * gesture losing the argument.
 */
function label() {
  $("#picker-label").textContent = trial ? "trying it on · esc" : "drag onto a slot";
}

/** click the frame you are already trying to stop trying it */
function setTrial(id) {
  trial = trial === id ? null : id;
  for (const fig of document.querySelectorAll("#strip figure")) {
    fig.classList.toggle("trying", fig.dataset.id === trial);
  }
  label();
  paintAll();
}

function strip() {
  const hits = S.items.filter((i) => {
    const t = S.tags[i.id] ?? {};
    return (!P.star || t.star)
      && (!P.tray || inTray(i.id))
      && (!P.q || i.path.toLowerCase().includes(P.q));
  }).slice(0, 400);

  if (!hits.length) {
    /* Three reasons a strip comes back empty and they are not
       interchangeable. The archive being empty is first because it is the one
       a person hits on their very first run, and it used to fall through to
       "nothing matches that search" under a search box they had not typed in. */
    $("#strip").innerHTML = `<p class="dim" style="grid-column:1/-1">${
      !S.items.length ? "no frames in this folder yet."
      : P.tray ? "the tray is empty. fill it in the shelf, or drag frames into the panel."
      : P.star ? "nothing is kept yet. keep a few in the shelf first."
      : "nothing matches that search."
    }</p>`;
    return;
  }

  $("#strip").replaceChildren(...hits.map((item) => {
    const fig = document.createElement("figure");
    fig.className = [S.tags[item.id]?.star && "star", trial === item.id && "trying"]
      .filter(Boolean).join(" ");
    fig.dataset.id = item.id;
    const img = new Image();
    img.loading = "lazy"; img.src = `/thumb/${item.id}`; img.alt = "";
    fig.append(img);

    /* Drag is the way a frame gets committed to one slot. Click is the other
       question entirely: it tries the frame on in every slot at once, which
       is what you actually want before you know which shape it wants to be.
       A trackpad drag across a scrolling strip is a fiddly thing to ask of
       someone doing it two hundred times, and clicking is still the cheap
       path to a placement, it just goes through the bench to get there. */
    fig.draggable = true;
    fig.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(MIME, item.id);
      e.dataTransfer.setData("text/plain", item.path);
      e.dataTransfer.effectAllowed = "copy";
      // the browser's default drag image is the whole figure including its
      // outline; the bare thumbnail reads as the photograph being carried.
      if (img.complete && img.naturalWidth) {
        e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
      }
      document.body.dataset.dragging = "1";
    });
    fig.addEventListener("dragend", () => {
      delete document.body.dataset.dragging;
      clearOver();
    });

    fig.onclick = () => setTrial(item.id);
    return fig;
  }));
}

/**
 * Put one slot back to exactly what it held, including holding nothing.
 *
 * The empty case is a delete rather than a write of null, because that is
 * what the route has and because a slot with a null in it is a different
 * thing from a slot with nothing in it the next time this file reads one.
 */
async function restoreSlot(slotId, was) {
  if (was) {
    S.placements[slotId] = was;
    await post("/api/place", { slot: slotId, id: was.id, place: was.place });
  } else {
    delete S.placements[slotId];
    await post(`/api/place?slot=${encodeURIComponent(slotId)}`, null, "DELETE");
  }
  /* The crop write is on a timer, so an undo arriving inside that window
     would be followed a fifth of a second later by the very write it just
     took back, landing on the server after the restore and silently undoing
     the undo. Whatever was queued for this slot describes a crop that no
     longer exists, so it is dropped rather than raced. */
  clearTimeout(saveTimer[slotId]);
  paint(slotId);
  tally();
}

/** the slot is always named. there is no path that fills whichever one is on. */
async function assign(item, slotId) {
  const was = S.placements[slotId];
  const now = { id: item.id, place: { ...CENTERED } };
  S.placements[slotId] = now;
  setActive(slotId);
  did(`placing a frame in ${slotId}`,
      () => restoreSlot(slotId, was), () => restoreSlot(slotId, now));
  await post("/api/place", { slot: slotId, id: item.id, place: CENTERED });
  paint(slotId);
  tally();
}

/**
 * A private mime type, not "text/plain". A drag carrying only text would be
 * accepted by every text input on the page and, worse, this drop handler
 * would accept a drag that started somewhere else entirely. The plain text
 * flavour is still set, so dragging a frame out of keeper and into an
 * editor pastes its path.
 */
const MIME = "application/x-keeper-frame";

function clearOver() {
  for (const el of document.querySelectorAll(".slot[data-over]")) {
    el.removeAttribute("data-over");
  }
}

/* ------------------------------------------------------------------ */
/* getting them out                                                    */
/* ------------------------------------------------------------------ */

/**
 * The end of the main flow used to be a dead end: twenty minutes of fitting
 * frames into shapes, and the only way to get a file was a command mentioned
 * once in `keeper help`, in a terminal the person had already left.
 *
 * The control lives in index.html now, in a row of its own across the foot
 * of the bench, so this only has to wire it.
 *
 * IT WAS BUILT HERE AND PUT UNDER #picker-head, AND THAT WAS A BUG WITH A
 * GOOD REASON BEHIND IT. The head is one nowrap flex row in a four hundred
 * pixel column already carrying a label, two chips and a search field:
 * measured with the button inside it, 513px of content in 399px of room,
 * which pushed the search box clean off the right edge. So it went on the
 * line underneath, which was right about the width and wrong about the
 * column. Below 1600px with the tray open the stylesheet drops the whole
 * picker, because two pickers is what does not fit, and that took the only
 * way to export off the screen with it: at that window size the bench
 * simply had no export button.
 *
 * A row across the foot answers both. It is never inside the panel that
 * goes away, and the full path it reports has the width of the window to
 * print itself in rather than a share of a narrow column.
 */
function buildExport() {
  $("#bench-export").onclick = () => ship();
  /* Where a crop lands, said before one exists. It is the only thing about
     this button nobody can guess, and the answer used to arrive in the
     sentence after the files were already written. Home is a tilde because
     the whole point is that a person reads it, and /Users/gince is eleven
     characters of nothing. */
  $("#bench-out").textContent = S.out ? `into ${nice(S.out)}` : "";
}

/** the path a person would write, rather than the one the server holds */
const nice = (p) => p.replace(/^\/Users\/[^/]+\//, "~/");

/**
 * Cut and write. One slot when the button under a picture asks, everything
 * placed when the row at the foot does.
 */
async function ship(only = null, btn = $("#bench-export"), out = $("#bench-export-result")) {
  /* An export of nothing would still make the folder and then report that it
     wrote zero crops to it, which reads as a failure of the tool rather than
     of the afternoon.

     Counted against the slots on the bench and not against the placements
     themselves. A config that has been edited or removed leaves placements
     behind whose slot is gone, and those are exactly what the exporter walks
     past: `hero` and `about-1` sat in this archive's file pointing at holes
     that no longer exist. */
  const has = only ? !!S.placements[only] : S.slots.some((sl) => S.placements[sl.id]);
  if (!has) {
    feel("no");
    nope(btn);
    out.textContent = only
      ? "nothing in this slot yet."
      : "nothing is placed yet. drag a frame onto a slot first.";
    return;
  }

  const was = btn.textContent;
  btn.disabled = true;
  btn.classList.add("busy");
  out.textContent = "cutting...";
  let d = null;
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(only ? { slot: only } : {}),
    });
    d = await res.json();
  } catch (e) {
    console.error("[keeper] /api/export", e);
  }
  btn.disabled = false;
  btn.classList.remove("busy");
  btn.textContent = was;

  if (!d?.ok) {
    feel("no");
    nope(btn);
    out.textContent = d?.error
      ? `that export stopped: ${d.error}`
      : "that export did not finish. the console has the reason.";
    return;
  }

  /* One slot says which file it just made, because that is the whole answer
     and the folder is already printed beside the button at the foot. The
     whole bench says how many, because nineteen filenames is not a sentence
     anybody reads. */
  const soft = d.soft ? `, ${d.soft} narrower than the slot wants` : "";
  const lost = d.lost ? `, ${d.lost} skipped: the frame is gone from the index` : "";
  const bad = d.failed ? `, ${d.failed} refused: the terminal has the reason` : "";
  const file = only ? d.files?.[0] : null;

  if (only && !file) {
    feel("no");
    nope(btn);
    out.textContent = `nothing came out${lost}${bad}`;
    return;
  }

  /* the one place in the app that gets two notes rather than one click. a
     job that wrote files to a disk is the only thing here with an end. */
  feel("done");

  /* "wrote yt-thumb.jpg" is a claim, and a claim is not the same thing as a
     file. So the answer is the finder: press it, the folder opens with the
     crop already selected, and the question of whether the export actually
     happened stops being a question. The word is `done` rather than `wrote`
     for the same reason a receipt does not say "attempted": this is the end
     of the job, and it should read like it. */
  out.replaceChildren();
  const seen = document.createElement("button");
  seen.type = "button";
  seen.className = "said-go";
  seen.textContent = file
    ? `done · ${file}`
    : `done · ${d.written} ${d.written === 1 ? "crop" : "crops"}`;
  seen.title = file ? "show it in finder" : "open the folder in finder";
  seen.onclick = (e) => {
    e.stopPropagation();
    post("/api/reveal-export", file ? { file } : {});
  };
  out.append(seen);

  const rest = soft + lost + bad;
  if (rest) {
    const note = document.createElement("span");
    note.textContent = rest;
    out.append(note);
  }
}

/* ------------------------------------------------------------------ */
/* painting                                                            */
/* ------------------------------------------------------------------ */

function paint(slotId) {
  const hit = els.get(slotId);
  const slot = S.slots.find((s) => s.id === slotId);
  if (!hit || !slot) return;

  const saved = S.placements[slotId];
  /* An empty slot wears the trial instead of showing nothing, at cover,
     which is what a browser would do with object-fit and no opinion. That is
     the honest starting point: it is the crop the frame gets by default in
     the real place, before anyone has touched it. */
  const p = saved ?? (trial ? { id: trial, place: CENTERED } : null);
  const fitting = !!p && !saved;
  hit.root.classList.toggle("trying", fitting);

  /* Only a committed placement gets an export button. A trial is the bench
     showing you what a frame would look like in a hole, and there is nothing
     to write out of a question. */
  hit.foot.hidden = !saved;
  if (!saved) hit.said.textContent = "";

  if (!p) {
    hit.img.hidden = true;
    hit.empty.hidden = false;
    hit.nums.textContent = "";
    hit.zoom.hidden = true;
    return;
  }
  const item = S.byId.get(p.id);
  if (!item || !item.w) {
    hit.nums.textContent = "that frame is no longer in the index";
    hit.zoom.hidden = true;
    return;
  }

  hit.empty.hidden = true;
  hit.img.hidden = false;
  const want = `/full/${item.id}`;
  // a trial points fourteen of these at one url in the same tick, and the
  // browser coalesces them into a single request for the negative. measured,
  // not assumed, because fourteen copies of a 20MB file off a spinning drive
  // would have made the feature unusable on the archive it is for.
  if (!hit.img.src.endsWith(want)) hit.img.src = want;

  const bw = hit.box.clientWidth;
  const bh = hit.box.clientHeight;
  if (!bw || !bh) return;

  const rect = resolve(p.place, item.w, item.h, slot.aspect);
  const ds = bw / rect.w;
  hit.img.style.width = `${item.w * ds}px`;
  hit.img.style.height = `${item.h * ds}px`;
  hit.img.style.transform = `translate3d(${-rect.x * ds}px, ${-rect.y * ds}px, 0)`;
  hit.img.style.transformOrigin = "0 0";

  const cover = isAtCover(p.place, item.w, item.h, slot.aspect);
  const soft = slot.width && rect.w < slot.width;
  const size = `${Math.round(rect.w)}x${Math.round(rect.h)} of ${item.w}x${item.h}`;
  const thin = soft ? ` · <span class="warn">soft, under ${slot.width}px</span>` : "";
  /* The measurements always, because whether the negative even has the pixels
     for a 2400px banner is most of what is being asked, and the soft warning
     always, because it is the one thing here anyone has to act on.

     The object-position line is css to paste into a stylesheet, so it appears
     only for someone who wrote a keeper.config.json: that file is the exact
     test for a person who has holes of their own and a stylesheet to put them
     in. Everybody else was reading a declaration for a page they do not have.
     A trial never shows it either, because nothing has been decided yet.

     `a baked crop` is gone. It was the negative of the line beside it, which
     made it look like a fault, in the accent, on a crop somebody chose. */
  const css = S.configured && !fitting && cover
    ? ` · <code>object-position: ${toObjectPosition(rect, item.w, item.h)}</code>`
    : "";
  hit.nums.innerHTML = (fitting ? `<span class="prov">trying</span> · ` : "") + size + css + thin;

  /* 100% is cover, the whole frame filling the hole with nothing thrown away
     that the shape did not demand. Past that you are punching in, and the
     number says how far. A trial has not been committed to anything, so it
     gets no control: there is nothing to save yet. */
  hit.zoom.hidden = fitting;
  if (!fitting) {
    const max = coverWidth(item.w, item.h, slot.aspect);
    hit.pct.textContent = `${Math.round((max / p.place.cw) * 100)}%`;
  }
}

function paintAll() { for (const id of els.keys()) paint(id); }

/* ------------------------------------------------------------------ */
/* pointer                                                             */
/* ------------------------------------------------------------------ */

let drag = null;

const slotAt = (t) => (t instanceof Element ? t.closest(".box")?.dataset.slot ?? null : null);

function ctx(slotId) {
  const slot = S.slots.find((s) => s.id === slotId);
  const p = S.placements[slotId];
  const hit = els.get(slotId);
  if (!slot || !p || !hit) return null;
  const item = S.byId.get(p.id);
  if (!item?.w) return null;
  const bw = hit.box.clientWidth, bh = hit.box.clientHeight;
  return { slot, p, hit, item, bw, bh, aspect: bw / bh };
}

function onDown(e) {
  const id = slotAt(e.target);
  if (!id || S.view !== "bench") return;
  setActive(id);
  if (!ctx(id)) return;
  e.preventDefault();
  drag = { id, x: e.clientX, y: e.clientY };
}

function onMove(e) {
  if (!drag) return;
  const c = ctx(drag.id);
  if (!c) return;
  const rect = resolve(c.p.place, c.item.w, c.item.h, c.aspect);
  const ds = c.bw / rect.w;
  // a pixel of pointer travel is a pixel of screen, so the source moves by
  // that over the display scale. dragging the picture right moves the crop
  // left, which is why these are minus.
  set(drag.id, {
    ...c.p.place,
    cx: c.p.place.cx - (e.clientX - drag.x) / ds / c.item.w,
    cy: c.p.place.cy - (e.clientY - drag.y) / ds / c.item.h,
  });
  drag = { id: drag.id, x: e.clientX, y: e.clientY };
}

/**
 * ALT HELD, AND THAT IS NOT FUSSINESS. A bare wheel over a slot would have to
 * preventDefault to zoom, and the slots are most of the height of this page:
 * the wheel would stop scrolling the moment the pointer crossed a
 * photograph, which is exactly where the pointer lives while this is in use.
 */
/**
 * Punch in or out by a factor, clamped at cover. Cover is the widest a crop
 * may be: past it the slot would be showing something the negative does not
 * have. Everything that zooms comes through here.
 */
function nudge(slotId, factor) {
  const c = ctx(slotId);
  if (!c) return;
  const max = coverWidth(c.item.w, c.item.h, c.aspect);
  set(slotId, { ...c.p.place, cw: Math.min(c.p.place.cw * factor, max) });
}

/**
 * Option plus a scroll, and a trackpad pinch. A pinch arrives as a wheel
 * event with ctrl held, whether or not a ctrl key was anywhere near it, and
 * that is the gesture a person already has in their hands for making a
 * picture bigger. Leaving it out meant the only way to punch in was a
 * modifier nobody had been told about.
 */
function onWheel(e) {
  if ((!e.altKey && !e.ctrlKey) || S.view !== "bench") return;
  const id = slotAt(e.target);
  const c = id && ctx(id);
  if (!c) return;
  e.preventDefault();
  const max = coverWidth(c.item.w, c.item.h, c.aspect);
  set(id, { ...c.p.place, cw: Math.min(c.p.place.cw * (1 + e.deltaY * 0.0015), max) });
}

function onKey(e) {
  /* `instanceof Element` first, because a keydown dispatched on window has
     window as its target and window has no `matches`: the handler would die
     on the way past. Same loose wire the shelf and the app had. */
  if (S.view !== "bench") return;
  if (e.target instanceof Element && e.target.matches("input")) return;

  if (e.key === "Escape") {
    /* The preview card is a window standing over this one and it owns escape
       while it is up. Without this, closing it from the bench would throw
       away the trial underneath it in the same keystroke, and the frame you
       opened to look at closely is exactly the frame you were trying on. */
    if (trial && $("#preview")?.hidden !== false) setTrial(null);
    return;
  }
  if (!active) return;
  const c = ctx(active);
  if (!c) return;
  const step = e.shiftKey ? 0.02 : 0.004;
  const max = coverWidth(c.item.w, c.item.h, c.aspect);
  const pl = c.p.place;
  const moves = {
    ArrowLeft: { ...pl, cx: pl.cx - step },
    ArrowRight: { ...pl, cx: pl.cx + step },
    ArrowUp: { ...pl, cy: pl.cy - step },
    ArrowDown: { ...pl, cy: pl.cy + step },
    "=": { ...pl, cw: pl.cw * 0.94 },
    "+": { ...pl, cw: pl.cw * 0.94 },
    "-": { ...pl, cw: Math.min(pl.cw / 0.94, max) },
    0: { cx: 0.5, cy: 0.5, cw: max },
  };
  if (e.key === "Backspace" || e.key === "Delete") {
    const was = S.placements[active];
    delete S.placements[active];
    if (was) {
      did(`emptying ${active}`,
          () => restoreSlot(active, was), () => restoreSlot(active, null));
    }
    post(`/api/place?slot=${encodeURIComponent(active)}`, null, "DELETE");
    paint(active); tally();
    return e.preventDefault();
  }
  if (!moves[e.key]) return;
  set(active, moves[e.key]);
  e.preventDefault();
}

let saveTimer = {};
function set(slotId, raw) {
  const c = ctx(slotId);
  if (!c) return;
  const place = clamp(raw, c.item.w, c.item.h, c.aspect);
  /* One run of arrows is one thing you did, so the whole burst folds into a
     single step keyed on the slot, and the closure it keeps is the one made
     by the first press: the crop as it stood before the nudging started. A
     step per keypress would mean forty presses of cmd z to get back to a
     crop you could see two seconds ago. */
  const next = { ...c.p, place };
  did(`nudging the crop in ${slotId}`,
      () => restoreSlot(slotId, c.p), () => restoreSlot(slotId, next), `crop:${slotId}`);
  S.placements[slotId] = next;
  paint(slotId);
  clearTimeout(saveTimer[slotId]);
  saveTimer[slotId] = setTimeout(
    () => post("/api/place", { slot: slotId, id: c.p.id, place }), 220);
}
