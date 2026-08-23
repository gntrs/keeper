import * as macos from "./macos.mjs";
import * as windows from "./windows.mjs";

/**
 * THE ONLY PLACE KEEPER KNOWS WHICH MACHINE IT IS ON.
 *
 * Everything above this line is the same code on both platforms, because the
 * differences are not in what keeper does. They are in four things the
 * operating system owns and will not let a program reimplement:
 *
 *   the file manager        showing somebody a file where they can pick it up
 *   the wastebasket         a delete that is still undoable afterwards
 *   the shortcut            a file that stands for a file somewhere else
 *   the search index        turning a folder name back into a path
 *
 * Plus a raw decoder, which is not owned by the OS in principle and is in
 * practice, because one of these two ships one and the other does not.
 *
 * A platform module answers all of those or says plainly that it cannot. It
 * is never asked to answer in a way that hides which machine it is: a windows
 * user should be told about the recycle bin and file explorer in those words,
 * so every module carries its own vocabulary and the ui reads it rather than
 * spelling either one into a string.
 */
const BY_PLATFORM = { darwin: macos, win32: windows };

/**
 * Null on anything else, and the routes that need it say so rather than
 * guessing. Linux almost works: the copy and symlink export modes are pure
 * node, and the scan, the thumbnails and the bench never leave the process.
 * What it has no answer for is the trash, and a culling tool whose one
 * irreversible key is quietly a permanent delete is worse than one that says
 * it does not run here.
 */
export const host = BY_PLATFORM[process.platform] ?? null;

/** for the message a route gives when it is running somewhere it cannot work */
export const HOSTS = "macos or windows";
