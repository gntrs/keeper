import { S, post, tally } from "/app.js";
import { CENTERED, clamp, coverWidth, isAtCover, resolve, toObjectPosition } from "/geometry.mjs";

const $ = (s) => document.querySelector(s);
const els = new Map();          // slotId -> { box, img, nums }
let active = null;              // the slot a picked frame lands in
const P = { star: false, q: "" };

export function mountBench() {
  $("#p-star").onclick = (e) => { P.star = !P.star; e.currentTarget.classList.toggle("on"); strip(); };
  $("#p-q").oninput = (e) => { P.q = e.target.value.trim().toLowerCase(); strip(); };

  addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", () => (drag = null));
  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("keydown", onKey);
  addEventListener("resize", () => paintAll());
}

export function renderBench() {
  if (!S.slots.length) {
    $("#slots").innerHTML =
      `<p class="dim">no keepers.config.json in the folder you ran keepers from,
       so there are no slots to fill. run <code>keepers init</code>, edit the
       slots, and reload.</p>`;
    return;
  }
  els.clear();
  $("#slots").replaceChildren(...S.slots.map(slotEl));
  strip();
  paintAll();
}

function slotEl(slot) {
  const root = document.createElement("div");
  root.className = "slot" + (active === slot.id ? " on" : "");
  root.dataset.slot = slot.id;

  const head = document.createElement("header");
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

  els.set(slot.id, { box, img, empty, nums });
  root.onclick = () => setActive(slot.id);
  return root;
}

export function setActive(id) {
  active = id;
  for (const el of document.querySelectorAll(".slot")) {
    el.classList.toggle("on", el.dataset.slot === id);
  }
  const slot = S.slots.find((s) => s.id === id);
  $("#picker-label").textContent = slot ? `filling ${slot.label}` : "drag onto a slot";
}
export const setPick = setActive;

function strip() {
  const hits = S.items.filter((i) => {
    const t = S.tags[i.id] ?? {};
    return (!P.star || t.star) && (!P.q || i.path.toLowerCase().includes(P.q));
  }).slice(0, 400);

  $("#strip").replaceChildren(...hits.map((item) => {
    const fig = document.createElement("figure");
    if (S.tags[item.id]?.star) fig.className = "star";
    const img = new Image();
    img.loading = "lazy"; img.src = `/thumb/${item.id}`; img.alt = "";
    fig.append(img);

    /* Drag is the way this is meant to be used, and clicking still works
       because a trackpad drag across a scrolling strip is a fiddly thing to
       ask of someone doing it two hundred times. Both land in the same
       place. */
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

    fig.onclick = () => assign(item);
    return fig;
  }));
}

async function assign(item, slotId = active) {
  if (!slotId) { $("#picker-label").textContent = "drag it onto a slot"; return; }
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
 * flavour is still set, so dragging a frame out of keepers and into an
 * editor pastes its path.
 */
const MIME = "application/x-keepers-frame";

function clearOver() {
  for (const el of document.querySelectorAll(".slot[data-over]")) {
    el.removeAttribute("data-over");
  }
}

/* ------------------------------------------------------------------ */
/* painting                                                            */
/* ------------------------------------------------------------------ */

function paint(slotId) {
  const hit = els.get(slotId);
  const slot = S.slots.find((s) => s.id === slotId);
  const p = S.placements[slotId];
  if (!hit || !slot) return;

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
  hit.nums.innerHTML =
    `${Math.round(rect.w)}x${Math.round(rect.h)} of ${item.w}x${item.h} · ` +
    (cover
      ? `<code>object-position: ${toObjectPosition(rect, item.w, item.h)}</code>`
      : `<span class="warn">a baked crop</span>`) +
    (soft ? ` · <span class="warn">soft, under ${slot.width}px</span>` : "");
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
  if (S.view !== "bench" || e.target.matches("input") || !active) return;
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
