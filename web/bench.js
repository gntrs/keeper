import { S, post, tally } from "/app.js";
import { CENTERED, clamp, coverWidth, isAtCover, resolve, toObjectPosition } from "/geometry.mjs";

const $ = (s) => document.querySelector(s);
const els = new Map();          // slotId -> { root, box, img, empty, nums }
let active = null;              // the slot a picked frame lands in
const P = { star: false, q: "" };

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
  head.innerHTML = `<strong>${slot.label}</strong><em>${slot.aspectText}</em>
    <span class="grow"></span><em>${slot.width || "?"}px</em>`;

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
  root.append(nums);

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

  els.set(slot.id, { root, box, img, empty, nums });

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
    return (!P.star || t.star) && (!P.q || i.path.toLowerCase().includes(P.q));
  }).slice(0, 400);

  if (!hits.length) {
    /* Three reasons a strip comes back empty and they are not
       interchangeable. The archive being empty is first because it is the one
       a person hits on their very first run, and it used to fall through to
       "nothing matches that search" under a search box they had not typed in. */
    $("#strip").innerHTML = `<p class="dim" style="grid-column:1/-1">${
      !S.items.length ? "no frames in this folder yet."
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

/** the slot is always named. there is no path that fills whichever one is on. */
async function assign(item, slotId) {
  S.placements[slotId] = { id: item.id, place: { ...CENTERED } };
  setActive(slotId);
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
 * Built here rather than in index.html because the button is useless without
 * the code under it, and the head it goes into belongs to this view alone.
 *
 * ITS OWN ROW, AND NOT INSIDE #picker-head, WHICH IS WHERE IT LOOKS LIKE IT
 * BELONGS. That head is one nowrap flex row in a four hundred pixel column
 * and it is already carrying a label, a chip and a search field. Measured
 * with the button in it: 513px of content in 399px of room, which pushed the
 * kept only chip and the search box clean off the right edge. The result is
 * a full path as well, and a path is the half of the sentence nobody can
 * afford to have squeezed. So the export gets the line under the label
 * rather than a share of it.
 */
function buildExport() {
  const row = document.createElement("div");
  row.id = "bench-export-row";

  const btn = document.createElement("button");
  btn.id = "bench-export";
  btn.type = "button";
  btn.className = "chip";
  btn.textContent = "export the placed ones";
  btn.onclick = ship;

  const out = document.createElement("p");
  out.id = "bench-export-result";
  out.className = "dim";

  row.append(btn, out);
  $("#picker-head").after(row);
}

async function ship() {
  const btn = $("#bench-export");
  const out = $("#bench-export-result");

  /* An export of nothing would still make the folder and then report that it
     wrote zero crops to it, which reads as a failure of the tool rather than
     of the afternoon.

     Counted against the slots on the bench and not against the placements
     themselves. A config that has been edited or removed leaves placements
     behind whose slot is gone, and those are exactly what the exporter walks
     past: `hero` and `about-1` sat in this archive's file pointing at holes
     that no longer exist. */
  if (!S.slots.some((s) => S.placements[s.id])) {
    out.textContent = "nothing is placed yet. drag a frame onto a slot first.";
    return;
  }

  btn.disabled = true;
  out.textContent = "cutting...";
  let d = null;
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    d = await res.json();
  } catch (e) {
    console.error("[keeper] /api/export", e);
  }
  btn.disabled = false;

  if (!d?.ok) {
    out.textContent = d?.error
      ? `that export stopped: ${d.error}`
      : "that export did not finish. the console has the reason.";
    return;
  }
  /* The path is the whole answer, so it is said in full and not shortened to
     a folder name. The counts after it are the ones worth reading: soft is a
     crop somebody else's server will upscale, lost is a slot whose frame has
     left the index, which is how you learn a file moved, and refused is a
     negative this machine could not read. Each of them is silent at zero. */
  out.textContent =
    `wrote ${d.written} ${d.written === 1 ? "crop" : "crops"} to ${d.dir}` +
    (d.soft ? `, ${d.soft} narrower than the slot wants` : "") +
    (d.lost ? `, ${d.lost} skipped: the frame is gone from the index` : "") +
    (d.failed ? `, ${d.failed} refused: the terminal has the reason` : "");
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

  if (!p) {
    hit.img.hidden = true;
    hit.empty.hidden = false;
    hit.nums.textContent = "";
    return;
  }
  const item = S.byId.get(p.id);
  if (!item || !item.w) { hit.nums.textContent = "that frame is no longer in the index"; return; }

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
function onWheel(e) {
  if (!e.altKey || S.view !== "bench") return;
  const id = slotAt(e.target);
  const c = id && ctx(id);
  if (!c) return;
  e.preventDefault();
  const max = coverWidth(c.item.w, c.item.h, c.aspect);
  set(id, { ...c.p.place, cw: Math.min(c.p.place.cw * (1 + e.deltaY * 0.0015), max) });
}

function onKey(e) {
  if (S.view !== "bench" || e.target.matches("input")) return;

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
    delete S.placements[active];
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
  S.placements[slotId] = { ...c.p, place };
  paint(slotId);
  clearTimeout(saveTimer[slotId]);
  saveTimer[slotId] = setTimeout(
    () => post("/api/place", { slot: slotId, id: c.p.id, place }), 220);
}
