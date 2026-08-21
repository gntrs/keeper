import { S, post, dirOf, tally, open } from "/app.js";

const $ = (s) => document.querySelector(s);
const F = { tag: new Set(), dir: new Set(), star: false, untagged: false, q: "" };
let visible = [];
let cursor = 0;

const countTag = (c) => S.items.filter((i) => S.tags[i.id]?.tag === c).length;
const countDir = (d) => S.items.filter((i) => dirOf(i.path) === d).length;

function chips(host, values, label, count, key) {
  host.innerHTML = "";
  for (const v of values) {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = `${label(v)}<i>${count(v)}</i>`;
    if (key === "tag" && S.hints[v]) b.title = S.hints[v];
    b.onclick = () => {
      F[key].has(v) ? F[key].delete(v) : F[key].add(v);
      b.classList.toggle("on");
      renderShelf();
    };
    host.append(b);
  }
}

export function mountShelf() {
  const tagsPresent = Object.keys(S.vocab).filter((c) => countTag(c) > 0);
  chips($("#f-tag"), tagsPresent.length ? tagsPresent : Object.keys(S.vocab),
    (c) => S.vocab[c], countTag, "tag");

  const dirs = [...new Set(S.items.map((i) => dirOf(i.path)))]
    .sort((a, b) => countDir(b) - countDir(a)).slice(0, 40);
  chips($("#f-dir"), dirs, (d) => d, countDir, "dir");

  $("#f-star").onclick = (e) => { F.star = !F.star; e.currentTarget.classList.toggle("on"); renderShelf(); };
  $("#f-untagged").onclick = (e) => { F.untagged = !F.untagged; e.currentTarget.classList.toggle("on"); renderShelf(); };
  $("#f-clear").onclick = () => location.reload();
  $("#f-q").oninput = (e) => { F.q = e.target.value.trim().toLowerCase(); renderShelf(); };

  addEventListener("keydown", onKey);
}

export function renderShelf() {
  visible = S.items.filter((i) => {
    const t = S.tags[i.id] ?? {};
    return (!F.tag.size || F.tag.has(t.tag)) &&
      (!F.dir.size || F.dir.has(dirOf(i.path))) &&
      (!F.star || t.star) &&
      (!F.untagged || !t.tag) &&
      (!F.q || i.path.toLowerCase().includes(F.q));
  });
  cursor = Math.min(cursor, Math.max(0, visible.length - 1));

  $("#f-star").querySelector("i").textContent = S.items.filter((i) => S.tags[i.id]?.star).length;
  $("#f-untagged").querySelector("i").textContent = S.items.filter((i) => !S.tags[i.id]?.tag).length;
  $("#none").hidden = visible.length > 0;

  $("#grid").replaceChildren(...visible.map((item, n) => tile(item, n)));
}

function tile(item, n) {
  const t = S.tags[item.id] ?? {};
  const fig = document.createElement("figure");
  fig.className = (t.star ? "star " : "") + (n === cursor && S.view === "shelf" ? "cursor" : "");
  const img = new Image();
  img.loading = "lazy"; img.decoding = "async"; img.src = `/thumb/${item.id}`; img.alt = "";
  fig.append(img);
  if (t.tag) { const b = document.createElement("b"); b.textContent = S.vocab[t.tag]; fig.append(b); }
  const cap = document.createElement("figcaption");
  cap.textContent = item.path.split("/").pop();
  fig.append(cap);
  fig.onclick = () => { cursor = n; renderShelf(); };
  fig.ondblclick = () => open(item);
  return fig;
}

/**
 * Tagging is keyboard first because it is the only way it gets done. A
 * thousand frames through a mouse is an afternoon; through the home row it
 * is twenty minutes. The letters are the same ones the agent writes, so a
 * person correcting a machine's pass never has to learn a second alphabet.
 */
async function onKey(e) {
  if (S.view !== "shelf" || e.target.matches("input") || e.metaKey || e.ctrlKey) return;
  if (!visible.length) return;
  const cols = Math.max(1, Math.round($("#grid").clientWidth / 164));
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];

  if (move !== undefined) {
    cursor = Math.min(Math.max(cursor + move, 0), visible.length - 1);
    renderShelf();
    $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
    return e.preventDefault();
  }

  const item = visible[cursor];
  if (e.key === "Enter") { open(item); return e.preventDefault(); }

  if (e.key === " ") {
    const star = S.tags[item.id]?.star ? 0 : 1;
    S.tags[item.id] = { ...S.tags[item.id], star };
    await post("/api/tag", { id: item.id, star });
    step(); return e.preventDefault();
  }

  const code = e.key.toUpperCase();
  if (S.vocab[code]) {
    S.tags[item.id] = { ...S.tags[item.id], tag: code };
    await post("/api/tag", { id: item.id, tag: code });
    step(); return e.preventDefault();
  }
}

function step() {
  // advancing after a tag is what makes it a run rather than a series of
  // decisions. it stops at the end rather than wrapping, so you can feel
  // the bottom of the pile.
  cursor = Math.min(cursor + 1, visible.length - 1);
  renderShelf();
  tally();
  $("#grid").children[cursor]?.scrollIntoView({ block: "nearest" });
}
