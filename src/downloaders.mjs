/* ---------------------------------------------------------------------
   the two helper programs keeper does not ship, and how they get here.

   yt-dlp and spotDL are fetched from their own github releases into
   appDir()/bin, which is outside ROOT on purpose: a keeper update replaces
   bin, src and web, so anything living in there would be thrown away every
   release and fetched again. Outside ROOT they are fetched once per machine
   and survive every update.

   NOTHING IN HERE RUNS UNTIL SOMEBODY SAYS IT MAY. Same shape as the
   updater: the policy lives in the seat, the server checks it, and this
   module is only ever called after the answer was yes.

   THE TWO VERIFICATIONS ARE NOT THE SAME AND ARE NOT REPORTED AS THE SAME.
   yt-dlp publishes SHA2-256SUMS beside its binaries, so the bytes are proved
   against what the project published before anything is run. spotDL
   publishes no checksum at all, so the only thing that can be proved is that
   the file answers `--version`, which is a weaker claim: it says the download
   was not truncated, it does not say the download was theirs. Each ensure
   returns `verified: "sha256"` or `verified: "ran"` so the page can say which
   one actually happened rather than implying the stronger one.
   --------------------------------------------------------------------- */

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { appDir, plain } from "./runtime.mjs";

const run = promisify(execFile);

/**
 * The same idea as runtime.mjs's `plain()` and deliberately not the same
 * words. Its EACCES sentence explains the .keeper index folder beside the
 * photographs, which is the right sentence when an archive will not open and
 * the wrong one entirely when somebody picked a downloads folder they cannot
 * write to. Anything not about writing falls through to `plain()` rather than
 * being restated here.
 */
const CANNOT = {
  EACCES: "that folder cannot be written to. a read only drive, a locked folder, or a folder belonging to somebody else looks like this. pick another one.",
  ENOSPC: "the disk is full, so there is nowhere to put the file.",
  ENOENT: "that folder is not there any more. an unplugged drive looks like this.",
};
CANNOT.EPERM = CANNOT.EACCES;
CANNOT.EROFS = CANNOT.EACCES;

function why(message) {
  const said = String(message ?? "");
  const code = said.match(/^([A-Z]+)(?::|$)/)?.[1];
  return (code && CANNOT[code]) || plain(said);
}

export function binDir() {
  return path.join(appDir(), "bin");
}

export function ytDlpPath() {
  return path.join(binDir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

export function spotdlPath() {
  return path.join(binDir(), process.platform === "win32" ? "spotdl.exe" : "spotdl");
}

const YTDLP_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const SPOTDL_API = "https://api.github.com/repos/spotDL/spotify-downloader/releases/latest";

/* Checked against a real release listing rather than guessed. yt-dlp ships one
   universal mac binary and one windows exe; spotDL versions its asset names,
   so the platform suffix is the only stable part. */
const ASSETS = {
  ytdlp: { darwin: /^yt-dlp_macos$/, win32: /^yt-dlp\.exe$/ },
  spotdl: { darwin: /^spotdl-.*-darwin$/, win32: /^spotdl-.*-win32\.exe$/ },
};

const SUMS = "SHA2-256SUMS";

/**
 * A release binary is tens of megabytes over somebody's home connection, so
 * the whole request gets minutes rather than the six seconds the updater's
 * version check gets. AbortSignal.timeout covers the body as well as the
 * headers, so this is a ceiling on the entire download, not on the handshake.
 */
const SLOW = 300_000;
const QUICK = 15_000;

/* github answers 403 rather than 429 when an address runs out of its sixty
   unauthenticated requests an hour, and the raw status tells a person
   nothing they can act on. */
async function ask(url) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(QUICK),
      redirect: "follow",
      headers: { accept: "application/vnd.github+json", "user-agent": "keeper" },
    });
  } catch (e) {
    throw new Error(`could not reach github: ${e.message}`);
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error("github is rate limiting this address. it allows sixty requests an hour without a login, so try again later.");
  }
  if (!res.ok) throw new Error(`github answered ${res.status}`);
  return res.json();
}

/**
 * The bytes, with the fraction reported as they arrive.
 *
 * A single `.arrayBuffer()` would be four lines shorter and would leave a
 * person watching a still bar for a minute and a half wondering whether it
 * had hung. `content-length` is present on github's asset redirect target;
 * when it is not, the fraction stays at zero and only the final 1 is
 * reported, which is honest about not knowing rather than inventing a curve.
 */
async function pull(url, onProgress = () => {}) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(SLOW),
      redirect: "follow",
      headers: { "user-agent": "keeper" },
    });
  } catch (e) {
    throw new Error(`the download did not finish: ${e.message}`);
  }
  if (!res.ok) throw new Error(`the download answered ${res.status}`);

  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) {
    const whole = Buffer.from(await res.arrayBuffer());
    onProgress(1);
    return whole;
  }

  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    got += value.length;
    if (total > 0) onProgress(Math.min(got / total, 1));
  }
  onProgress(1);
  return Buffer.concat(parts);
}

function assetFor(which, release) {
  const want = ASSETS[which]?.[process.platform];
  if (!want) {
    throw new Error(`keeper only fetches these on macos and windows, and this is ${process.platform}`);
  }
  const found = (release?.assets ?? []).find((a) => want.test(String(a?.name ?? "")));
  if (!found?.browser_download_url) {
    throw new Error(`the newest release does not have a build for this machine (nothing matching ${want.source})`);
  }
  return found;
}

/** `<hex sha256>  <filename>`, one per line, for every asset in the release */
function sumFor(text, name) {
  for (const line of String(text).split("\n")) {
    const [hex, file] = line.trim().split(/\s+/);
    if (file === name && /^[0-9a-f]{64}$/i.test(hex ?? "")) return hex.toLowerCase();
  }
  return null;
}

/**
 * A real invocation, not a `which` and not an existence check, for the same
 * reason film.mjs runs ffprobe: a binary that is on the disk and will not
 * start is the failure that wastes the afternoon. The existence check in
 * front of it is only there so the common case, nothing fetched yet, does not
 * pay for a spawn that was always going to fail.
 *
 * spotDL is a pyinstaller bundle and unpacks itself on first run, so its
 * first `--version` can take several seconds. That is what the long timeout
 * is for, and it is one cost per process because the answer is cached.
 */
/**
 * Ran and said its version, ran and failed, or never got to the end.
 *
 * The three are kept apart because one of them must not be treated as
 * evidence of a bad download. These are 40 mb bundles that unpack themselves
 * on first run, and on windows defender scans that unpack the first time, so
 * a slow first answer is an ordinary machine rather than a broken file.
 * Deleting on a timeout meant a slow machine could never finish setting up,
 * and the retry did exactly the same thing again.
 *
 * The timeouts are long for the same reason. This runs once, after a
 * download, so waiting is cheap and being wrong is not.
 */
async function answers(file, timeout = 180_000) {
  if (!existsSync(file)) return { said: null, timedOut: false };
  try {
    const { stdout } = await run(file, ["--version"], { windowsHide: true, timeout });
    const said = String(stdout).trim().split("\n")[0]?.trim();
    return { said: said || "unknown", timedOut: false };
  } catch (e) {
    return { said: null, timedOut: !!(e.killed || e.signal) };
  }
}

let ytdlpVersion;
let spotdlVersion;

/**
 * IS IT SET UP IS A QUESTION ABOUT THE DISK, NOT ABOUT BEHAVIOUR.
 *
 * This used to run each binary with `--version`, which is the more honest
 * check and the wrong place for it. They are 40 mb pyinstaller bundles that
 * unpack themselves every time they start: measured at 9 to 23 seconds each
 * on a fast mac with a warm cache, paid on every keeper launch, while the tab
 * showed a box with nothing written in it.
 *
 * It got worse than slow. Two callers could be in flight at once, because the
 * cache is only written after the await, so a page load and a first click on
 * the tab meant four of these unpacking at the same time. Under that
 * contention the check hit its own timeout, keeper concluded the binary was
 * not installed, and the tab quietly fetched 37 mb again underneath a card
 * that reads "this is once, not every time".
 *
 * So the binaries are still run, once, in ensure*, straight after they are
 * fetched, which is where a program that will not start is news worth having.
 * After that, the file being there is what set up means.
 */
async function sitting(file) {
  try {
    const found = await stat(file);
    /* a truncated fetch leaves a short file and a folder is not a program.
       anything real here is tens of megabytes. */
    return found.isFile() && found.size > 1_000_000;
  } catch {
    return false;
  }
}

export const haveYtDlp = () => sitting(ytDlpPath());
export const haveSpotdl = () => sitting(spotdlPath());

async function makeBin() {
  try {
    await mkdir(binDir(), { recursive: true });
  } catch (e) {
    /* the folder is named nowhere in here on purpose. it is under somebody's
       home directory, and this sentence ends up on a card they may well paste
       into a message asking for help. */
    throw new Error(`keeper could not make the folder it keeps these two in: ${why(e.message)}`);
  }
}

/**
 * Written under a temporary name and renamed into place, so a download that
 * dies halfway leaves nothing that looks like a working binary. The rename is
 * inside one folder, so it cannot cross a volume and cannot half happen.
 */
async function place(dst, bytes) {
  const tmp = `${dst}.part`;
  await rm(tmp, { force: true }).catch(() => {});
  try {
    await writeFile(tmp, bytes);
    if (process.platform !== "win32") await chmod(tmp, 0o755);
    await rm(dst, { force: true }).catch(() => {});
    await rename(tmp, dst);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw new Error(`it could not be written into the folder keeper keeps these two in: ${why(e.message)}`);
  }
}

/**
 * yt-dlp, proved against the checksums the project publishes beside it.
 *
 * A mismatch deletes and throws, because bytes that are not what the release
 * said they are have no business being executed. A binary that matches and
 * then will not start is a different problem and is not treated as one: the
 * download is provably theirs, so it is kept and `ran: false` is reported
 * rather than quietly thrown away and fetched again on the next attempt.
 */
export async function ensureYtDlp(onProgress = () => {}) {
  const dst = ytDlpPath();
  if (await haveYtDlp()) {
    /* verified is a claim about a download, and there was no download, so it
       is null rather than the checksum this run never computed */
    return {
      path: dst,
      version: ytdlpVersion,
      verified: null,
      note: "it was already here from an earlier setup",
      fetched: false,
      ran: true,
    };
  }

  const release = await ask(YTDLP_API);
  const asset = assetFor("ytdlp", release);
  const sumsAsset = (release?.assets ?? []).find((a) => a?.name === SUMS);
  if (!sumsAsset?.browser_download_url) {
    throw new Error(`the newest yt-dlp release does not publish ${SUMS}, so the download could not be checked. nothing was installed.`);
  }

  const sums = (await pull(sumsAsset.browser_download_url)).toString("utf8");
  const want = sumFor(sums, asset.name);
  if (!want) throw new Error(`${SUMS} has no line for ${asset.name}, so the download could not be checked. nothing was installed.`);

  const bytes = await pull(asset.browser_download_url, onProgress);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) {
    throw new Error("the yt-dlp download does not match the checksum the release published, so it was thrown away");
  }

  await makeBin();
  await place(dst, bytes);

  /* kept whatever it says, because the bytes are already proved against the
     checksum the project published. a yt-dlp that will not start is a
     different problem from a yt-dlp that is not the project's. */
  const ran = await answers(dst);
  ytdlpVersion = ran.said;
  return {
    path: dst,
    asset: asset.name,
    tag: release?.tag_name ?? null,
    sha256: got,
    verified: "sha256",
    fetched: true,
    version: ran.said,
    ran: ran.said !== null,
    note: ran.said !== null ? null
      : ran.timedOut ? "it did not answer in time, which on a slow machine is ordinary. the bytes match the published checksum, so it was kept."
        : "the bytes match the published checksum, but it would not run here.",
  };
}

/**
 * spotDL, which publishes no checksum, so the only thing that can be proved
 * is that the file runs.
 *
 * That is a weaker claim than yt-dlp's and it is reported as a different one:
 * `verified: "ran"`. It catches a truncated or a rate limited half download,
 * it does not catch a substituted one. A file that will not answer is deleted
 * rather than left sitting where haveSpotdl would find it, because a broken
 * binary on the path is worse than no binary at all.
 */
export async function ensureSpotdl(onProgress = () => {}) {
  const dst = spotdlPath();
  if (await haveSpotdl()) {
    return {
      path: dst,
      version: spotdlVersion,
      verified: null,
      note: "it was already here from an earlier setup",
      fetched: false,
    };
  }

  const release = await ask(SPOTDL_API);
  const asset = assetFor("spotdl", release);
  const bytes = await pull(asset.browser_download_url, onProgress);

  await makeBin();
  await place(dst, bytes);

  const ran = await answers(dst);

  /* A TIMEOUT IS NOT A BAD DOWNLOAD, AND USED TO BE TREATED AS ONE.
     spotdl is a 42 mb bundle that unpacks on first run, and on windows
     defender scans it while it does. A slow machine could therefore never
     finish setting up: the file was deleted for being slow, and pressing try
     again deleted the next copy for the same reason. It is kept now, and the
     next thing that uses it will say if it really is broken. */
  if (ran.said === null && !ran.timedOut) {
    await rm(dst, { force: true }).catch(() => {});
    spotdlVersion = undefined;
    throw new Error("the spotdl download would not run, so it was deleted. spotdl publishes no checksum, so running it is the only check there is.");
  }

  spotdlVersion = ran.said;
  return {
    path: dst,
    asset: asset.name,
    tag: release?.tag_name ?? null,
    /* say it plainly here as well as in the field, because whatever ends up
       on the page will be read as a claim about how safe this was. a copy
       that timed out was not verified at all, and says so rather than
       borrowing the word from the copy that answered. */
    verified: ran.said !== null ? "ran" : null,
    note: ran.said !== null
      ? "spotdl publishes no checksum. this was verified by running it, not by checking its bytes."
      : "spotdl publishes no checksum, and this copy did not answer in time to be verified by running it either. it was kept rather than deleted, because being slow to start is not the same as being broken.",
    fetched: true,
    version: ran.said,
    ran: ran.said !== null,
  };
}

const YOUTUBE = new Set(["youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"]);
const SPOTIFY = new Set(["open.spotify.com"]);

/** the default the page fills in, not the decision. a person can override it. */
export function detectKind(url) {
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (YOUTUBE.has(host)) return "youtube";
  if (SPOTIFY.has(host)) return "spotify";
  return null;
}

/**
 * WHERE FFMPEG ACTUALLY IS, WHICH IS NOT WHEREVER PATH SAYS.
 *
 * yt-dlp downloads a video stream and then needs ffmpeg to turn it into an
 * mp3. Launched from its icon on a mac, keeper is handed
 * PATH=/usr/bin:/bin:/usr/sbin:/sbin, homebrew is not on it, and
 * `launchctl getenv PATH` is empty, so the ffmpeg a person definitely
 * installed is invisible to everything keeper spawns.
 *
 * Measured, not guessed: under that PATH yt-dlp fetches the whole stream and
 * then fails with `ffprobe and ffmpeg not found`, leaving a .webm in
 * somebody's folder where an mp3 was asked for. So the path is found by
 * looking, and handed to yt-dlp rather than hoped for.
 */
const FFMPEG_IN = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"],
  /* winget and scoop are how most people on windows have ffmpeg now, and
     neither puts it anywhere near program files. both keep a stable folder of
     shims, which is the part worth naming: winget's real install folder
     carries the package version in its name and would be out of date here
     within a month. */
  win32: [
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.USERPROFILE ?? "", "scoop", "shims"),
    "C:\\ProgramData\\chocolatey\\bin",
    "C:\\Program Files\\ffmpeg\\bin",
    "C:\\Program Files (x86)\\ffmpeg\\bin",
    "C:\\ffmpeg\\bin",
    /* an unset environment variable leaves a relative path behind, which
       would be looked for next to wherever keeper happens to be running. */
  ].filter((dir) => path.isAbsolute(dir)),
};

let ffmpegDir;

/**
 * The folder holding a working ffmpeg, or null.
 *
 * PATH first, because somebody running keeper from a terminal has the answer
 * already and it is the one that is right when ffmpeg is somewhere nobody
 * predicted. The listed folders are the fallback for the icon launch, and
 * both are proved by running the thing rather than by finding a file: an
 * ffmpeg that exists and will not execute is the failure that wastes an
 * afternoon.
 */
export async function ffmpegAt() {
  if (ffmpegDir !== undefined) return ffmpegDir;

  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const works = async (cmd) => {
    try {
      await run(cmd, ["-version"], { windowsHide: true, timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  };

  if (await works(exe)) {
    /* on PATH, so yt-dlp will find it the same way and needs telling nothing */
    ffmpegDir = null;
    return ffmpegDir;
  }

  for (const dir of FFMPEG_IN[process.platform] ?? []) {
    if (!existsSync(path.join(dir, exe))) continue;
    if (!(await works(path.join(dir, exe)))) continue;
    ffmpegDir = dir;
    return ffmpegDir;
  }

  ffmpegDir = false;
  return ffmpegDir;
}

/** whether an mp3 can be made at all, whichever way ffmpeg was found */
export async function haveFfmpeg() {
  return (await ffmpegAt()) !== false;
}

/**
 * WHAT TO SAVE, AND HOW GOOD.
 *
 * Two questions rather than a list of a dozen presets, because they are the
 * two a person actually has: what kind of file do I want, and how much do I
 * care about size. Everything is an allowed key looked up in here and never
 * a string from the page reaching a command line, so a browser cannot ask
 * yt-dlp for an argument keeper did not write.
 *
 * `source` is the honest top of the audio list. mp3 is a re-encode of
 * whatever came down, so it can only ever be a little worse than the thing
 * it was made from; keeping the original stream is both faster and better,
 * and it is only second by default because an mp3 plays in everything.
 */
export const FORMATS = {
  mp3: { label: "mp3", what: "audio", say: "plays in everything" },
  m4a: { label: "m4a", what: "audio", say: "aac, smaller than mp3 at the same quality" },
  source: { label: "original audio", what: "audio", say: "the stream as it came, no re-encode" },
  video: { label: "video", what: "video", say: "picture as well, saved as mp4" },
};

export const QUALITIES = {
  max: { label: "max", say: "the best the link actually offers" },
  good: { label: "good", say: "smaller, and nobody can hear it" },
  small: { label: "small", say: "for when the disk matters more" },
};

/* how good, per kind. the audio numbers are yt-dlp's own 0 to 10 scale where
   0 is best, and the video ones are a ceiling on height rather than a
   target, so a link that only has 720 still comes down at 720. */
const AUDIO_Q = { max: "0", good: "5", small: "9" };
const VIDEO_CAP = { max: "", good: "[height<=1080]", small: "[height<=720]" };

export const defaultsFor = () => ({ format: "mp3", quality: "max" });

/* --no-playlist on purpose. a playlist url pasted out of habit must not
   silently start two hundred downloads into somebody's folder. */
function GRAB(url, outDir, ffmpeg, format, quality) {
  const args = [
    "--no-playlist",
    "--add-metadata",
    "--embed-thumbnail",
    ...(ffmpeg ? ["--ffmpeg-location", ffmpeg] : []),
    "-o", path.join(outDir, "%(title)s.%(ext)s"),
  ];

  if (FORMATS[format]?.what === "video") {
    const cap = VIDEO_CAP[quality] ?? "";
    /* best picture plus best sound, and the single best file as the fallback
       for a source that does not offer them apart. */
    args.push("-f", `bv*${cap}+ba/b${cap}`, "--merge-output-format", "mp4");
  } else {
    args.push("-x");
    if (format === "source") {
      /* no re-encode at all. whatever the site handed over is what lands. */
      args.push("--audio-format", "best");
    } else {
      args.push("--audio-format", format, "--audio-quality", AUDIO_Q[quality] ?? "0");
    }
  }

  args.push(url);
  return args;
}

/**
 * SPOTDL RESOLVES THE TRACK AND DOES NOT DOWNLOAD IT.
 *
 * `spotdl download` was the obvious call and it does not work. spotDL 4.5.2
 * carries its own frozen copy of yt-dlp inside the binary, that copy is old
 * enough that youtube refuses it, and every track fails with
 * `AudioProviderError`. Measured on two different tracks, and worse than
 * failing: it writes nothing and still exits zero.
 *
 * `spotdl url` is the half that works. It takes the spotify link, does the
 * matching that is the only thing spotDL is really needed for, and prints the
 * youtube music url it landed on. Keeper then hands that to its own yt-dlp,
 * which is fetched fresh and is the same binary the youtube path already
 * uses.
 *
 * So there is one downloader in here, not two, and the half that goes stale
 * fastest is the half keeper keeps up to date itself.
 */
const FIND = (url) => ["url", url];

/* every link `spotdl url` printed. it writes one line per track, and how many
   it wrote is the difference between a track and an album. */
const MATCH = /https?:\/\/[^\s"']*(?:youtube\.com|youtu\.be|music\.youtube\.com)\/[^\s"']*/gi;

/**
 * WHAT KIND OF SPOTIFY LINK THAT IS, ASKED BEFORE ANYTHING RUNS.
 *
 * An album link used to be accepted, take three minutes while spotdl resolved
 * all eighteen tracks, and then quietly download the first one under the
 * words "one file, in your folder". Nothing anywhere said the other
 * seventeen had been dropped.
 *
 * The kind is in the url, so it costs nothing to ask first and it saves the
 * three minutes as well as the wrong answer.
 *
 * Episodes are refused rather than attempted. spotdl has no audio for a
 * podcast either, so it matches the episode against youtube by title and
 * hands back the closest thing it finds, which for a podcast is very often
 * somebody else entirely. A file that is confidently the wrong recording is
 * worse than a sentence saying no.
 */
const SPOTIFY_KIND = /\/(track|album|playlist|artist|episode|show)\//i;

const REFUSE = {
  album: "that is an album link. keeper does one track at a time, so open the track you want in spotify and paste that.",
  playlist: "that is a playlist link. keeper does one track at a time, so open the track you want in spotify and paste that.",
  artist: "that is an artist link rather than a track. open the track you want in spotify and paste that.",
  episode: "keeper does music tracks. a podcast episode has no audio on spotify that spotdl can reach, so it would be matched to whatever youtube video has the closest title, which is regularly the wrong recording.",
  show: "keeper does music tracks rather than podcasts.",
};

/* yt-dlp says where it put things. Best effort, and checked against the disk
   before being believed, so a format change costs the file list and never the
   result. */
const SAID = [
  /^\[[A-Za-z]+\] Destination: (.+)$/,
  /^\[MoveFiles\] Moving file "(?:.+)" to "(.+)"$/,
  /^\[download\] (.+) has already been downloaded$/,
];

function claimed(line) {
  for (const re of SAID) {
    const hit = line.match(re);
    if (hit) return hit[1].trim();
  }
  return null;
}

/**
 * A ZERO EXIT IS NOT ON ITS OWN A FILE ON THE DISK.
 *
 * spotDL taught this the hard way: a failed track exits zero and writes
 * nothing, which would tell somebody their song was saved and hand them an
 * empty folder. It is not the downloader any more, and the lesson is kept
 * anyway, because it costs one directory read and it is the one failure this
 * whole tab cannot afford.
 *
 * So a run counts as a success only if something is on the disk to show for
 * it, or the program said in as many words that the file was already there.
 */
const WORKED = [
  / has already been downloaded$/,
];

/* what this could have produced, for the fallback below. anything else
   appearing in the folder while a download runs belongs to whoever put it
   there. */
const OURS = /\.(mp3|m4a|opus|ogg|flac|wav|aac|mp4|mkv|webm|mov)$/i;

const NO_FFMPEG = "keeper needs ffmpeg to turn a download into an mp3, and cannot find one on this machine. install ffmpeg from ffmpeg.org, then open keeper again.";

/**
 * yt-dlp's last word, made fit for somebody who did not type a command.
 *
 * It prefixes everything with ERROR: and then says whatever it likes,
 * including, measured, advice to pass `--ffmpeg-location`, which is a flag
 * nobody reaching this has a command line to pass it on. The raw line is
 * already in the log, so what is being replaced here is only the sentence on
 * the card.
 */
const YTDLP_SAYS = [
  [/ffprobe and ffmpeg not found|ffmpeg not found/i, NO_FFMPEG],
  [/\[Errno \d+\]|Traceback|Unable to create directory/i,
    "that file could not be written where it was going. check the folder is still there and can be written to."],
  [/HTTP Error 4\d\d|Private video|Video unavailable|members-only|Sign in to confirm/i,
    "youtube would not hand that one over. a private, removed or age restricted video looks like this."],
];

function readable(line) {
  const said = String(line ?? "").replace(/^ERROR:\s*/i, "").trim();
  if (!said) return "";
  for (const [looks, sentence] of YTDLP_SAYS) if (looks.test(said)) return sentence;
  return said;
}

/* the progress bar redraws contain the word Error as a status column, so a
   naive last-error-line search would report the bar rather than the fault */
const BAR = /[\u2500-\u257f]/;

/* rich and yt-dlp both colour their output, and colour codes in a log the
   page prints as text are just noise wrapped around the sentence */
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

async function listing(dir) {
  try {
    return new Set(await readdir(dir));
  } catch {
    return new Set();
  }
}

/** the last thing a program said that was not a redrawn progress bar */
function lastWord(text) {
  return String(text ?? "")
    .replace(ESCAPES, "")
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l && !BAR.test(l))
    .pop() ?? "";
}

/**
 * Is that sentence written for a person or for whoever wrote the program.
 *
 * spotdl is python and it lets python answer for it: a spotify link with a
 * track id that does not exist comes back as `KeyError: 'uri'`, which is a
 * true statement about a dictionary and tells the person holding the link
 * nothing at all. A traceback line goes in the log, where it belongs, and the
 * sentence on the card says what to do instead.
 */
const PROGRAMMER = /^(?:[A-Za-z_.]*(?:Error|Exception|Warning)\b|Traceback\b|\s*File ")/;

const NO_TRACK = "spotdl could not find a track behind that link. check that it opens in spotify.";

/**
 * What the card says, and what the log keeps.
 *
 * Nothing is thrown away: a line written for a programmer still goes into the
 * log, where somebody sending a report can copy it. It just does not get to
 * be the sentence.
 */
function gave(said, fallback, say) {
  if (said && !PROGRAMMER.test(said)) return said;
  if (said) say(said);
  return fallback || NO_TRACK;
}

/**
 * The youtube url behind a spotify link, found by spotdl.
 *
 * Buffered rather than streamed, unlike the download itself, because this
 * prints one line and the wait is a lookup rather than a transfer: there is no
 * percentage to watch. It takes a few seconds and can take longer on a slow
 * answer from spotify, so it says what it is doing first and what it found
 * afterwards, and both go into the same log the download writes to.
 */
async function findBehind(url, onLine) {
  /* tagged, because the page prints this stream verbatim and a reader of it
     is entitled to know which words are keeper's and which came off one of
     the programs. an untagged line there used to be attributed to keeper on
     the strength of having no tag, which quietly credited yt-dlp's sentences
     to us in the one view whose whole job is being literal. */
  const say = (text) => {
    try {
      onLine(`[keeper] ${text}`);
    } catch {
      /* a listener that throws is the page's problem, not the lookup's */
    }
  };

  say("finding the track behind that spotify link.");

  let out;
  try {
    out = await run(spotdlPath(), FIND(url), {
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, COLUMNS: "200", NO_COLOR: "1" },
    });
  } catch (e) {
    /* A lookup that ran and failed, a lookup that timed out, and a binary
       that would not start are three different sentences. Node's own message
       is none of them: it is `Command failed: <full path to the binary>`,
       which says nothing a person can act on and puts somebody's home
       directory into a message they might paste into a bug report. It is
       never the sentence, whichever of the three this was. */
    if (e.killed || e.signal) {
      return { error: "spotdl took too long looking that link up, so nothing was downloaded." };
    }
    if (typeof e.code === "string") {
      return { error: `spotdl would not run: ${why(e.message)}` };
    }
    return { error: gave(lastWord(e.stderr) || lastWord(e.stdout), "", say) };
  }

  const hits = [...new Set(String(out.stdout ?? "").replace(ESCAPES, "").match(MATCH) ?? [])];
  if (!hits.length) {
    /* it exits zero having found nothing, the same way it used to exit zero
       having downloaded nothing, so what it printed is the only evidence. */
    return { error: gave(lastWord(out.stdout), "", say) };
  }

  /* a link whose shape said track but which resolved to several. the url
     check above catches the ordinary cases and this catches the rest, rather
     than picking one of them and calling it the answer. */
  if (hits.length > 1) {
    return { error: `that link holds ${hits.length} tracks. keeper does one at a time, so open the track you want in spotify and paste that.` };
  }

  say(`found it: ${hits[0]}`);
  return { url: hits[0] };
}

/**
 * Run it, and hand every line back as it is printed.
 *
 * spawn rather than execFile because the point of this is the stream: a
 * person watching a four minute track come down wants the percentage yt-dlp
 * is already printing, not a spinner and then a result. Lines are split on
 * carriage returns as well as newlines, because that is how both of these
 * redraw a progress bar, and splitting on newlines alone would hold the whole
 * bar back until the download finished and then print it all at once.
 *
 * `ok` and `error` are the trustworthy part and are checked against the disk
 * rather than taken off the exit code alone; `files` is a best effort at
 * naming what landed and is allowed to come back short.
 */
export async function startDownload({ url, kind, outDir, format, quality }, onLine = () => {}) {
  if (kind !== "youtube" && kind !== "spotify") {
    return { ok: false, error: `keeper does not know how to download "${kind}". it handles youtube and spotify links.` };
  }

  /* an unknown key falls back rather than failing, and never reaches a
     command line either way. the page can only ask for what is in the two
     tables above. */
  const want = FORMATS[format] ? format : defaultsFor().format;
  const howGood = QUALITIES[quality] ? quality : defaultsFor().quality;
  if (typeof url !== "string" || !url.trim()) {
    return { ok: false, error: "no link was given" };
  }
  if (typeof outDir !== "string" || !outDir.trim()) {
    return { ok: false, error: "no folder was chosen to download into" };
  }

  try {
    await mkdir(outDir, { recursive: true });
    await access(outDir, constants.W_OK);
  } catch (e) {
    return { ok: false, error: why(e.message) };
  }

  /* asked before anything is fetched, because the alternative is measured
     and ugly: yt-dlp pulls the whole stream down and only then finds it
     cannot convert it, which leaves a webm in the folder and ten megabytes
     of somebody's connection spent on a file they did not ask for. */
  const ffmpeg = await ffmpegAt();
  if (ffmpeg === false) {
    return { ok: false, error: NO_FFMPEG, files: [] };
  }

  /* both kinds end up here, so it is asked about first. checking it after the
     spotify lookup would spend a minute working out which track somebody
     meant before admitting it could never have fetched it. */
  const bin = ytDlpPath();
  const which = "yt-dlp";
  const missing = "is not set up yet. turn downloads on and let keeper fetch it first.";
  if (!existsSync(bin)) {
    return { ok: false, error: `${which} ${missing}`, files: [] };
  }

  let target = url.trim();

  /* a spotify link is a name, not a file. spotdl turns it into the youtube
     url that actually holds the audio, and everything after this line is the
     same path a pasted youtube link takes. */
  if (kind === "spotify") {
    const holds = target.match(SPOTIFY_KIND)?.[1]?.toLowerCase();
    if (holds && REFUSE[holds]) {
      return { ok: false, error: REFUSE[holds], files: [] };
    }
    if (!existsSync(spotdlPath())) {
      return { ok: false, error: `spotdl ${missing}`, files: [] };
    }
    const found = await findBehind(target, onLine);
    if (found.error) return { ok: false, error: found.error, files: [] };
    target = found.url;
  }

  const before = await listing(outDir);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, GRAB(target, outDir, ffmpeg, want, howGood), {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        /* this is not going to a terminal, so the colour is dead weight, and
           a width stops a long title being folded in half. TERM is
           deliberately left alone: setting it to dumb gives a much tidier log
           and switches the live progress bar off entirely, and a tidy log
           that says nothing for four minutes is the spinner this was supposed
           to replace. */
        env: { ...process.env, COLUMNS: "200", NO_COLOR: "1" },
      });
    } catch (e) {
      resolve({ ok: false, error: `${which} would not start: ${why(e.message)}` });
      return;
    }

    const named = new Set();
    let lastError = "";
    let lastFault = "";
    let worked = false;
    let settled = false;

    const feed = (stream, isError) => {
      let held = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        held += chunk;
        const lines = held.split(/\r\n|\n|\r/);
        held = lines.pop() ?? "";
        for (const line of lines) emit(line, isError);
      });
      stream.on("end", () => {
        if (held) emit(held, isError);
        held = "";
      });
    };

    const emit = (raw, isError) => {
      const text = raw.replace(ESCAPES, "").trimEnd();
      const said = text.trim();
      if (!said) return;

      /* a bar redrawing itself is not the last thing that went wrong, even
         when it is the last thing on the error stream */
      if (isError && !BAR.test(said)) lastError = said;
      if (/error/i.test(said) && !BAR.test(said)) lastFault = said;
      if (WORKED.some((re) => re.test(said))) worked = true;

      const where = claimed(said);
      if (where) named.add(path.resolve(outDir, where));

      try {
        onLine(text);
      } catch {
        /* a listener that throws is the page's problem, not the download's */
      }
    };

    feed(child.stdout, false);
    feed(child.stderr, true);

    const done = async (code, error) => {
      if (settled) return;
      settled = true;

      /**
       * WHAT IT SAID IT WROTE, AND ONLY THEN WHAT TURNED UP.
       *
       * The folder diff used to come first and it credited anything at all
       * that appeared while the download ran. Measured: a browser saving a
       * pdf into the same folder came back as a file keeper claimed to have
       * fetched, with a reveal button on it, under the words "2 files, in
       * your folder". The downloads folder is exactly the folder somebody
       * will pick, so that is a normal afternoon rather than a corner case.
       *
       * So the log is the truth, checked against the disk: it names the
       * intermediate as well as the mp3, and the intermediate is gone by the
       * time this runs, which is what the existsSync is for. The diff stays
       * as a fallback for the day a log line changes shape, narrowed to what
       * this could actually have produced.
       */
      const files = new Set();
      for (const file of named) if (existsSync(file)) files.add(file);

      if (!files.size) {
        const after = await listing(outDir);
        for (const name of after) {
          if (before.has(name)) continue;
          if (!OURS.test(name)) continue;
          files.add(path.join(outDir, name));
        }
      }

      const got = [...files];

      if (error) {
        resolve({ ok: false, error, files: got });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          error: readable(lastError || lastFault) || `${which} stopped with code ${code}`,
          files: got,
        });
        return;
      }
      if (!got.length && !worked) {
        resolve({
          ok: false,
          error: readable(lastFault || lastError) || `${which} finished without saving anything into that folder`,
          files: got,
        });
        return;
      }
      resolve({ ok: true, files: got });
    };

    child.on("error", (e) => {
      done(null, `${which} would not run: ${why(e.message)}`);
    });
    child.on("close", (code) => {
      done(code, null);
    });
  });
}
