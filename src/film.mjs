import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Film needs ffmpeg and keepers does not ship it. Rather than fail a whole
 * archive because one dependency is missing, keepers checks once, says so
 * plainly, and files every clip as unreadable film: it still appears in the
 * shelf, it still gets tagged, it just has no poster behind it.
 *
 * On this mac ffmpeg is homebrew's, so PATH finds it. The check is a real
 * invocation rather than a `which`, because a binary that exists and does
 * not run is the failure that wastes the afternoon.
 */
let available = null;

export async function haveFfmpeg() {
  if (available !== null) return available;
  try {
    await run("ffprobe", ["-version"]);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** duration in seconds, and the frame size as displayed */
export async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration,r_frame_rate:format=duration",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout);
  const st = j.streams?.[0];
  if (!st) throw new Error("no video stream");
  const seconds = Number(st.duration || j.format?.duration || 0);
  return { w: Number(st.width) || 0, h: Number(st.height) || 0, seconds };
}

/**
 * A poster from a third of the way in, not from frame one. The first second
 * of a clip is a lens cap, a whip pan or a slate on almost every camera, and
 * a contact sheet of first frames is a sheet of black rectangles.
 */
export async function poster(file, dstAbs, { seconds = 0, width = 400 } = {}) {
  const at = seconds > 3 ? Math.min(seconds / 3, 30) : 0;
  await run("ffmpeg", [
    "-v", "error",
    "-ss", at.toFixed(2),
    "-i", file,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2`,
    "-y", dstAbs,
  ]);
}

/** 96 -> "1:36", 3725 -> "1:02:05" */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}
