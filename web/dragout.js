/* ---------------------------------------------------------------------
   dragging a frame out of the window and into finder.

   One fact shapes every line in here: a drag out of a browser is always a
   copy. A page can hand Finder a url and Finder will fetch it, name it, and
   drop a real file on the desktop, but those are bytes going back through
   the network stack. There is no flavour, on any browser, that hands Finder
   a reference to a file already sitting on the disk. So "it already has a
   path, do not copy it" is not something a drag can be; it is what the
   tray's link and alias export modes are for, and this file says so once
   rather than pretending otherwise.

   Nothing here starts a drag. shelf.js and bench.js already make their
   figures draggable and already write the private mime that the tray and
   the bench slots listen for, and tray.js does the same for its own tiles.
   This is a delegated dragstart on the document, which runs after all three
   because a listener on an ancestor sees the event on the way back up. It
   only ever adds flavours, and it never touches the private one: rewriting
   that would break every drop that stays inside the app.

   The module mounts itself on import and exports nothing.
   --------------------------------------------------------------------- */

import { S } from "/app.js";

/* The same string shelf.js, bench.js and tray.js write, spelled out again
   for the same reason they spell it out: nobody owns it, and a module
   invented to hold one constant is a module invented for nothing. */
const MIME = "application/x-keepers-frame";

/**
 * What Finder is told the file is. It matters more than it looks: the type
 * in a DownloadURL is what decides the icon and, for anything Quick Look
 * knows, whether the thing that lands is previewable at all. The map is the
 * server's TYPES with the film formats added, because a tray of clips is as
 * ordinary here as a tray of stills, and octet-stream is the honest answer
 * for the rest rather than a guess that would be wrong.
 */
const TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif", dng: "image/x-adobe-dng",
  mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v",
  avi: "video/x-msvideo", mkv: "video/x-matroska", webm: "video/webm",
  mts: "video/mp2t", m2ts: "video/mp2t",
};

const typeOf = (name) => TYPES[name.split(".").pop().toLowerCase()] ?? "application/octet-stream";

/**
 * Each segment encoded on its own, so the slashes stay slashes. A photo
 * archive is full of spaces, brackets and accented folder names, and a
 * file:// url with a raw space in it is a url that a terminal splits in two
 * and a text editor refuses to open.
 */
const fileUrl = (abs) => `file://${abs.split("/").map(encodeURIComponent).join("/")}`;

/**
 * The absolute path of the original. S.root is the archive and item.path is
 * relative to it, which is the pair every other part of keepers works from,
 * so the join happens here rather than the server being asked for a path it
 * has already told the browser twice.
 */
const absOf = (item) => `${S.root.replace(/\/+$/, "")}/${item.path}`;

/* ------------------------------------------------------------------ */
/* the listener                                                        */
/* ------------------------------------------------------------------ */

document.addEventListener("dragstart", (e) => {
  const dt = e.dataTransfer;
  if (!dt || !dt.types.includes(MIME)) return;

  /* getData rather than a data attribute on the element, because the shelf's
     figures carry no id in their markup and the drag itself already knows.
     dragstart is the one moment the store is readable and writable at once,
     which is exactly why this decoration cannot happen anywhere later. */
  const id = dt.getData(MIME);
  const item = id && S.byId.get(id);
  if (!item) return;

  const name = item.path.split("/").pop();
  const abs = absOf(item);

  /**
   * The flavour that produces a file. `mime:filename:url` is Chrome's own
   * shape and the url has to be absolute, so location.origin is spelled out
   * rather than a /full/<id> that Finder would have nothing to resolve
   * against. The filename is the original's, so what lands on the desktop
   * is DSC_0041.jpg and not a hash.
   *
   * Chrome carries exactly one of these per drag, no matter how many items
   * the drag claims. That is a browser limit and not a thing to work around
   * with a zip nobody asked for, so a drag out is one file and the note
   * below points at the tray export for the rest.
   */
  dt.setData("DownloadURL", `${typeOf(name)}:${name}:${location.origin}/full/${id}`);

  /* And the path itself, for the half of the time the thing you actually
     want is not a file but somewhere to type. Dropped into a terminal, an
     editor or a chat box this pastes the original's location, which costs
     nothing and copies nothing. It replaces the relative path the shelf put
     in text/plain: relative to an archive the receiving app has never heard
     of is relative to nothing. */
  dt.setData("text/uri-list", fileUrl(abs));
  dt.setData("text/plain", fileUrl(abs));

  /* effectAllowed stays whatever the figure set. Saying "copy" out loud is
     already true of every drop this app accepts, and Finder decides for
     itself regardless. */
  note();
});

/* ------------------------------------------------------------------ */
/* the one sentence                                                    */
/* ------------------------------------------------------------------ */

/* Once per load, and then never again while the page is up. A drag out is
   discovered by trying it, so the sentence has to arrive on the first one,
   and someone dragging forty frames out one after another does not need to
   be told forty times that Chrome carries one. Reloading a tagging session
   is rare enough that once per load is honestly once. */
let said = false;
let hide = 0;

function note() {
  if (said) return;
  said = true;

  const p = document.createElement("p");
  p.className = "dragout-note";
  p.textContent = "one file per drag, that is chrome's limit. the tray export writes the whole tray at once.";
  document.body.append(p);

  /* Two frames before the class that fades it in, because an element that
     is appended and styled in the same tick is an element the browser never
     saw in its starting state, and the transition does not run. */
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add("in")));

  hide = setTimeout(() => {
    p.classList.remove("in");
    p.addEventListener("transitionend", () => p.remove(), { once: true });
    /* a transition that never runs, because the tab went to the background
       mid fade, would leave the note in the document forever. */
    setTimeout(() => p.remove(), 800);
  }, 5200);
}

/* the note is about the drag that is happening, so a drag that ends early
   should not leave it hanging around for its full five seconds. it stays
   long enough to read and no longer. */
document.addEventListener("dragend", () => {
  if (!hide) return;
  const p = document.querySelector(".dragout-note");
  if (!p) return;
  clearTimeout(hide);
  hide = setTimeout(() => {
    p.classList.remove("in");
    setTimeout(() => p.remove(), 800);
  }, 1600);
}, { passive: true });
