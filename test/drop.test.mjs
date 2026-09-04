/* ---------------------------------------------------------------------
   what the window does with something it cannot open.

   Every one of these was measured going wrong in a real browser before it was
   written down, and every one of them ends the same way: the app behind the
   scrim cannot be touched and the only way out is a reload. A photograph, a
   text file or a pdf dropped on the window raised a native folder dialog
   nobody asked for, behind a card with no button on it that ignored escape.
   A dialog left open while the person went back and dragged the folder in by
   hand tore that archive down when it was finally cancelled: the poll stopped,
   the card went away, and the folder went on opening with nothing on screen
   ever saying so. And a second drop in either of those windows sent a second
   of everything, because the flag that turns a drop away was not raised until
   an open had already started.

   So these are as much about what the module refuses to do as about what it
   does: no dialog for a file, no second dialog, no second open, and no answer
   acted on by a dialog that is no longer the question. The last assertion in
   almost every one of them is the same, because it is the whole point: a real
   folder dropped straight afterwards still opens.

   web/ is served to a browser exactly as written, so there is nothing here to
   import in node without standing a window up first. The shim below is the
   smallest one the module actually touches, and its one import, an absolute
   url the page serves from its root, is answered by a resolve hook rather than
   by rewriting the file under test.

   Nothing here touches an archive anybody owns, or a disk at all.
   --------------------------------------------------------------------- */

import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

/* the page loads /host.js from the site root. node has no site root. */
const HOOK = `
export function resolve(spec, ctx, next) {
  if (spec === "/host.js") {
    return { url: "data:text/javascript,export const files = () => 'finder';", shortCircuit: true };
  }
  return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(HOOK));

/* ---- the smallest window the module will run in ---------------------- */

class El {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    this.type = "";
    this.onclick = null;
    this.taps = {};
  }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  addEventListener(kind, fn) { (this.taps[kind] ??= []).push(fn); }
  /* the class names are the only handle the module gives anything, which is
     the same handle the css has */
  find(cls) {
    if (this.className.split(" ").includes(cls)) return this;
    for (const k of this.children) {
      const hit = k.find?.(cls);
      if (hit) return hit;
    }
    return null;
  }
}

let seq = 0;

/**
 * A window, a server and a fresh copy of the module in it.
 *
 * The module mounts itself on import and keeps its state in module scope, so
 * every test needs its own: the query on the specifier is what makes node
 * treat it as a different module rather than handing back the one already
 * evaluated.
 */
async function mount(reply) {
  const win = [];
  const calls = [];
  let root = null;
  let reloads = 0;
  const said = [];

  globalThis.document = {
    createElement: (tag) => new El(tag),
    body: { append: (el) => { root = el; } },
    addEventListener: () => {},
  };
  globalThis.addEventListener = (kind, fn) => win.push([kind, fn]);
  globalThis.location = { reload: () => { reloads++; } };
  globalThis.fetch = async (route, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ route, body });
    const { status = 200, ...rest } = (await reply(route, body)) ?? {};
    return { ok: status < 400, status, json: async () => rest };
  };
  /* the module says what it caught on the console before it puts a card up,
     and that sentence is worth asserting on. it stays hooked for the life of
     the test rather than only over the import, and this file is its own
     process, so nothing outside it is affected. */
  console.error = (...a) => said.push(a.map(String).join(" "));

  await import(`../web/drop.js?n=${++seq}`);

  const fire = (kind, e) => {
    for (const [k, fn] of win) if (k === kind) fn(e);
  };
  const card = () => {
    const say = (cls) => {
      const el = root.find(cls);
      return el && !el.hidden ? el.textContent : null;
    };
    return {
      hidden: root.hidden,
      mode: root.dataset.mode ?? "",
      eyebrow: say("drop-eyebrow"),
      line: say("drop-line"),
      note: say("drop-note"),
      hint: say("drop-hint"),
      buttons: (root.find("drop-acts")?.children ?? []).map((b) => b.textContent),
    };
  };
  const press = (button) => root.find("drop-acts").children.find((b) => b.textContent === button).onclick();

  return {
    calls, card, fire, press,
    reloads: () => reloads,
    logged: () => said,
    root: () => root,
    /* the backdrop is the layer itself, and the card is what a click on it
       must not dismiss */
    backdrop: () => root.taps.click?.forEach((fn) => fn({ target: { closest: () => null } })),
    escape: () => fire("keydown", { key: "Escape", preventDefault() {} }),
    counts: (route) => calls.filter((c) => c.route === route).length,
  };
}

/* the shapes a real drop arrives in. a browser hands the page an entry for a
   folder and never a path, and a file has no entry worth reading at all. */
const folder = (name) => ({
  isDirectory: true,
  name,
  createReader: () => ({ readEntries: (done) => done([]) }),
});
const carrier = (entries, files) => ({
  types: ["Files"],
  getData: () => "",
  items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry })),
  files,
});

const drop = (w, dt) => {
  w.fire("dragenter", { dataTransfer: dt });
  w.fire("drop", { dataTransfer: dt, preventDefault() {} });
};
const dropFolder = (w, name) => drop(w, carrier([folder(name)], []));
const dropFile = (w, name) => drop(w, carrier([{ isDirectory: false, name }], [{ name, size: 12 }]));

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* a server that finds one folder by name and nothing else, which is every
   answer the page has to deal with in three lines */
const stub = (known = {}, extra = () => ({})) => async (route, body) => {
  if (route === "/api/locate") {
    const hit = known[body?.name];
    return { candidates: hit ? [{ path: hit, frames: 4 }] : [] };
  }
  if (route === "/api/open") return { ok: true, root: body.path };
  if (route === "/api/progress") return { phase: "ready", root: "/somewhere" };
  /* the dialog is on screen until somebody answers it, and a request that
     never comes back is exactly that */
  if (route === "/api/choose") return new Promise(() => {});
  return extra(route, body);
};

const KNOWN = { "roll two": "/pictures/roll two" };

/* ---- a drop keeper cannot use ---------------------------------------- */

test("a file dropped on the window raises no folder dialog", async () => {
  const w = await mount(stub(KNOWN));
  dropFile(w, "paper.pdf");
  await settle();

  assert.equal(w.counts("/api/choose"), 0, "no system dialog nobody asked for");
  const c = w.card();
  assert.equal(c.line, "paper.pdf is a file, not a folder");
  assert.deepEqual(c.buttons, ["choose a folder", "not now"], "and the way forward is on the card");
  assert.ok(!c.hidden);
});

test("the folder it came out of is still worth a look before saying so", async () => {
  const w = await mount(stub({ "": "/pictures/roll two" }));
  dropFile(w, "DSC_0001.jpg");
  await settle();

  assert.equal(w.counts("/api/locate"), 1, "the loose file went to the search index first");
  assert.equal(w.calls.find((c) => c.route === "/api/locate").body.kind, "files");
  assert.equal(w.counts("/api/open"), 1, "and the folder it found is what opened");
});

test("several files say so in the plural", async () => {
  const w = await mount(stub(KNOWN));
  drop(w, carrier([], [{ name: "one.jpg", size: 1 }, { name: "two.jpg", size: 2 }]));
  await settle();
  assert.equal(w.card().line, "those are files, not a folder");
});

test("a drop with nothing in it at all is not called a failure", async () => {
  const w = await mount(stub(KNOWN));
  drop(w, carrier([], []));
  await settle();
  const c = w.card();
  assert.equal(c.mode, "pick");
  assert.equal(c.eyebrow, "one more step");
  assert.deepEqual(c.buttons, ["choose a folder", "not now"]);
});

/* ---- and the way back out of every card ------------------------------ */

for (const [what, land] of [
  ["a file", (w) => dropFile(w, "paper.pdf")],
  ["a folder the index cannot place", (w) => dropFolder(w, "roll nine")],
]) {
  test(`escape leaves the window usable after ${what}`, async () => {
    const w = await mount(stub(KNOWN));
    land(w);
    await settle();
    assert.equal(w.card().hidden, false);

    w.escape();
    assert.equal(w.card().hidden, true, "the scrim is gone");
    assert.equal(w.root().dataset.mode, "", "and it is not left half up");
  });

  test(`a click on the backdrop leaves the window usable after ${what}`, async () => {
    const w = await mount(stub(KNOWN));
    land(w);
    await settle();
    w.backdrop();
    assert.equal(w.card().hidden, true);
  });

  test(`a real folder opens straight after ${what}, with nothing dismissed`, async () => {
    const w = await mount(stub(KNOWN));
    land(w);
    await settle();
    const before = w.counts("/api/open");

    dropFolder(w, "roll two");
    await settle();
    assert.equal(w.counts("/api/open") - before, 1, "the drop was taken, card and all");
    assert.equal(w.calls.find((c) => c.route === "/api/open").body.path, "/pictures/roll two");
  });
}

/* ---- the dialog, and everything that arrives while it is open -------- */

test("a folder the index cannot place does still open the dialog by itself", async () => {
  const w = await mount(stub(KNOWN));
  dropFolder(w, "roll nine");
  await settle();

  assert.equal(w.counts("/api/choose"), 1);
  const c = w.card();
  assert.equal(c.line, "pick the folder");
  assert.deepEqual(c.buttons, ["not now"], "and it can be put away without answering it");
});

test("a second bad drop while the dialog is open raises no second dialog", async () => {
  let answer;
  const w = await mount(async (route, body) => {
    if (route === "/api/choose") return new Promise((done) => { answer = done; });
    return stub(KNOWN)(route, body);
  });

  dropFolder(w, "roll nine");
  await settle();
  assert.equal(w.counts("/api/choose"), 1);

  dropFile(w, "paper.pdf");
  await settle();
  assert.equal(w.counts("/api/choose"), 1, "a file raises none at all");

  dropFolder(w, "roll ten");
  await settle();
  assert.equal(w.counts("/api/choose"), 1, "and a second folder waits on the one already up");
  assert.ok(answer, "the request is still open, which is the dialog still on screen");
});

test("the dialog cancelled by the person who opened it puts the window back", async () => {
  let answer;
  const w = await mount(async (route, body) => {
    if (route === "/api/choose") return new Promise((done) => { answer = done; });
    return stub(KNOWN)(route, body);
  });

  dropFolder(w, "roll nine");
  await settle();
  answer({ cancelled: true });
  await settle();

  assert.equal(w.card().hidden, true, "cancel is an answer and not an error");
  dropFolder(w, "roll two");
  await settle();
  assert.equal(w.counts("/api/open"), 1, "and the next folder opens");
});

test("a dialog cancelled after the folder went in by hand does not tear that down", async () => {
  let answer;
  let phase = "thumbnailing";
  const w = await mount(async (route, body) => {
    if (route === "/api/choose") return new Promise((done) => { answer = done; });
    if (route === "/api/progress") return { phase, root: "/pictures/roll two", done: 3, total: 90 };
    return stub(KNOWN)(route, body);
  });

  /* the dialog goes up on a folder the index could not place */
  dropFolder(w, "roll nine");
  await settle();
  assert.equal(w.counts("/api/choose"), 1);

  /* it is ignored. the folder goes in by hand instead, and starts opening. */
  dropFolder(w, "roll two");
  await settle();
  await sleep(60);
  assert.equal(w.counts("/api/open"), 1);
  assert.equal(w.card().eyebrow, "thumbnailing");
  const polled = w.counts("/api/progress");

  /* and only now does somebody go back and press cancel on the stray dialog */
  answer({ cancelled: true });
  await settle();

  assert.equal(w.card().hidden, false, "the archive that is opening keeps the window");
  assert.equal(w.card().eyebrow, "thumbnailing");
  assert.equal(w.reloads(), 0);

  await sleep(500);
  assert.ok(w.counts("/api/progress") > polled, "and the poll that puts it on the wall is still running");

  phase = "ready";
  await sleep(500);
  assert.equal(w.reloads(), 1, "so the archive arrives");
});

test("a path chosen after the folder went in by hand does not steal the open either", async () => {
  let answer;
  const w = await mount(async (route, body) => {
    if (route === "/api/choose") return new Promise((done) => { answer = done; });
    if (route === "/api/progress") return { phase: "thumbnailing", root: "/pictures/roll two", done: 3, total: 90 };
    return stub(KNOWN)(route, body);
  });

  dropFolder(w, "roll nine");
  await settle();
  dropFolder(w, "roll two");
  await settle();
  await sleep(60);

  answer({ path: "/pictures/somewhere else" });
  await settle();

  const opened = w.calls.filter((c) => c.route === "/api/open").map((c) => c.body.path);
  assert.deepEqual(opened, ["/pictures/roll two"], "one drop, one open, and the stale answer said nothing");
});

/* ---- two drops, one archive ------------------------------------------ */

test("the same folder dropped twice in the same breath sends one of everything", async () => {
  const w = await mount(stub(KNOWN));
  dropFolder(w, "roll two");
  dropFolder(w, "roll two");
  await settle();

  assert.equal(w.counts("/api/locate"), 1, "the guard is up before the search, not after it");
  assert.equal(w.counts("/api/open"), 1);
});

test("a second folder dropped while one is opening is turned away", async () => {
  const w = await mount(async (route, body) => {
    if (route === "/api/progress") return { phase: "scanning", root: "/pictures/roll two", frames: 12 };
    return stub({ ...KNOWN, "roll three": "/pictures/roll three" })(route, body);
  });

  dropFolder(w, "roll two");
  await settle();
  await sleep(30);
  assert.equal(w.card().eyebrow, "scanning");

  dropFolder(w, "roll three");
  await settle();
  const opened = w.calls.filter((c) => c.route === "/api/open").map((c) => c.body.path);
  assert.deepEqual(opened, ["/pictures/roll two"], "two scans over one index is not a thing to allow");
});

/* ---- and when the drop itself goes wrong ----------------------------- */

test("a throw while reading the drop ends on a card with a way out on it", async () => {
  const w = await mount(stub(KNOWN));
  const bad = carrier([folder("roll two")], []);
  bad.getData = () => { throw new Error("reading the drop went wrong"); };

  drop(w, bad);
  await settle();

  const c = w.card();
  assert.equal(c.mode, "fail");
  assert.equal(c.note, "that drop could not be read.");
  assert.deepEqual(c.buttons, ["choose a folder", "not now"]);
  assert.ok(w.logged().some((l) => l.includes("reading the drop went wrong")), "and it says what happened");

  /* the guard came back down with it, which is the half that used to be
     missing: the window went on refusing every drop after one throw */
  dropFolder(w, "roll two");
  await settle();
  assert.equal(w.counts("/api/open"), 1);
});

test("not now clears the card whatever put it there", async () => {
  const w = await mount(stub(KNOWN));
  dropFile(w, "notes.txt");
  await settle();
  w.press("not now");
  assert.equal(w.card().hidden, true);

  dropFolder(w, "roll two");
  await settle();
  assert.equal(w.counts("/api/open"), 1);
});
