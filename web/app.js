import { mountShelf, renderShelf } from "/shelf.js";
import { mountBench, renderBench, setPick } from "/bench.js";

export const S = {
  items: [], tags: {}, placements: {}, slots: [], vocab: {}, hints: {},
  byId: new Map(),
  view: "shelf",
};

const $ = (s) => document.querySelector(s);

/** every write goes through here, so nothing is only true on screen */
export async function post(route, body, method = "POST") {
  const res = await fetch(route, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  if (!res.ok) console.error("[keepers]", route, await res.text());
  return res.ok;
}

export function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "." : p.slice(0, i);
}

export function tally() {
  const tagged = S.items.filter((i) => S.tags[i.id]?.tag).length;
  const star = S.items.filter((i) => S.tags[i.id]?.star).length;
  const placed = Object.keys(S.placements).length;
  $("#tally").innerHTML =
    `<span class="dim">${S.items.length} frames · ${tagged} tagged · ${star} keepers` +
    (S.slots.length ? ` · ${placed}/${S.slots.length} placed` : "") + `</span>`;
}

export function open(item) {
  $("#lb img").src = `/full/${item.id}`;
  const t = S.tags[item.id]?.tag;
  $("#lbmeta").innerHTML =
    `${t ? S.vocab[t] + " · " : ""}${item.w}x${item.h}<br><code>${item.path}</code>`;
  $("#lb").hidden = false;
}
$("#lb").onclick = () => { $("#lb").hidden = true; $("#lb img").src = ""; };

/**
 * The view lives in the hash, so a reload lands you back where you were.
 * That is not a nicety on a tool you leave open for an hour: losing the
 * bench because a stylesheet changed would mean finding your slot again
 * every time.
 */
export function setView(v) {
  if (v !== "shelf" && v !== "bench") v = "shelf";
  S.view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, "", `#${v}`);
  for (const b of document.querySelectorAll("header nav button")) {
    b.classList.toggle("on", b.dataset.view === v);
  }
  $("#shelf").hidden = v !== "shelf";
  $("#bench").hidden = v !== "bench";
  if (v === "bench") renderBench();
}
addEventListener("hashchange", () => setView(location.hash.slice(1)));
for (const b of document.querySelectorAll("header nav button")) {
  b.onclick = () => setView(b.dataset.view);
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("#lb").hidden = true; return; }
  if (e.target.matches("input")) return;
  if (e.key === "1") setView("shelf");
  if (e.key === "2") setView("bench");
});

const state = await (await fetch("/api/state")).json();
Object.assign(S, state);
S.byId = new Map(S.items.map((i) => [i.id, i]));
$("#root").textContent = S.root;
if (!S.slots.length) document.querySelector('[data-view="bench"]').title =
  "no keepers.config.json, so there are no slots yet";

mountShelf();
mountBench();
renderShelf();
tally();
setView(location.hash.slice(1) || "shelf");
