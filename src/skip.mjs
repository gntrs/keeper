/* ---------------------------------------------------------------------
   THE FOLDERS KEEPER DOES NOT OPEN, IN ONE PLACE.

   Two parts of keeper walk a disk and they used to disagree about this.
   The drop search knew that a `.photoslibrary` is a document wearing a
   folder's clothes and walked past it. The scan did not, so pointing keeper
   at a pictures folder walked straight into the photos library inside it:
   a permission prompt nobody asked for on a mac, and then several thousand
   internal derivatives on the wall, presented as if they were photographs
   somebody took.

   The same went for a lightroom preview cache, which is thousands of small
   jpegs of the very photographs already on the wall, so every frame appeared
   twice, once as itself and once as a thumbnail of itself.

   Neither of those is an exotic setup. They are what is inside an ordinary
   photographer's pictures folder. The rule existed and only half the program
   had it, which is the kind of bug that survives for months because both
   halves look correct on their own.
   --------------------------------------------------------------------- */

import path from "node:path";

/**
 * Folders that are the machine's, not yours.
 *
 * Without case, because these are compared against names off a filesystem
 * that does not care about it: the recycler is usually shouted and is not
 * always, and a folder called `Node_Modules` is the same folder.
 */
export const SKIP_DIRS = new Set([
  ".git", "node_modules", ".keeper", ".keepers",
  ".trash", ".trashes", ".spotlight-v100", ".fseventsd", "__macosx", ".ds_store",
  "$recycle.bin", "system volume information", "$windows.~ws", "$windows.~bt",
  /* time machine, which is the worst folder on the list to walk into. its
     backup folder is a copy of the whole disk, so a scan that opens one
     thumbnails every photograph a second time, and once for every dated
     backup after that. the dotted names are already walked past by the rule
     below, but they are written down here as well so a path that came back
     from spotlight rather than from a walk is ruled out too. */
  "backups.backupdb", ".backups.backupdb", ".timemachine", ".mobilebackups",
  ".documentrevisions-v100", ".temporaryitems",
  /* network drives, which is where a lot of archives actually live. a
     synology puts a thumbnail cache called @eaDir beside every folder it has
     ever shown you, and its recycle bin is a folder with a hash in the name
     rather than a dollar. */
  "@eadir", "#recycle", "@recycle", "lost+found",
  ".picasaoriginals", ".thumbnails", ".cache",
]);

/**
 * A FOLDER THE OPERATING SYSTEM PRESENTS AS A SINGLE FILE, AND READING INTO
 * ONE IS NOT FREE.
 *
 * `Photos Library.photoslibrary` sits in the pictures folder and is a
 * directory like any other as far as readdir is concerned. It is not one to
 * the person who owns it, and on macos it is behind its own permission: the
 * first read puts a photos prompt on screen. Somebody who pointed keeper at a
 * folder did not ask to be asked that, and a prompt they did not expect is a
 * prompt they say no to.
 *
 * Nothing is lost by walking past every one of these. An archive keeper can
 * open is a folder of files, and none of these is that.
 */
export const PACKAGES = new Set([
  ".photoslibrary", ".photolibrary", ".aplibrary", ".migratedaperturelibrary",
  ".fcpbundle", ".imovielibrary", ".theater", ".tvlibrary", ".musiclibrary",
  ".lrdata", ".lrcat", ".sparsebundle", ".app", ".bundle", ".framework", ".pkg",
]);

/** a folder whose extension means it is really a document */
export const sealed = (name) => PACKAGES.has(path.extname(name).toLowerCase());

/**
 * Everything above, plus hidden, asked of one folder name.
 *
 * Hidden is in here rather than left to the named list because the named list
 * can only ever hold the caches somebody has already been bitten by. A folder
 * whose name starts with a dot, sitting inside an archive, is a program's
 * working space in every case anybody has met. The person's own photographs
 * are not in one, and if a whole archive is inside a dotted folder that still
 * opens, because this is only ever asked about what is INSIDE the root.
 */
export const walkPast = (name) =>
  name.startsWith(".") || SKIP_DIRS.has(name.toLowerCase()) || sealed(name);

/**
 * The same question asked of a whole path, for ruling out a candidate that
 * came back from the machine's search index rather than from a walk of our
 * own. Hidden is deliberately NOT part of this one: an index can legitimately
 * return something under a dotted folder, and refusing to open a folder
 * somebody explicitly dropped is worse than opening an odd one.
 */
export const buried = (p) =>
  p.split(path.sep).some((seg) => SKIP_DIRS.has(seg.toLowerCase()) || sealed(seg));
