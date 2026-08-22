/* ---------------------------------------------------------------------
   feel.js

   THIS IS NOT HAPTICS, AND IT CANNOT BE. A page in a browser on a mac has
   no route to the trackpad's taptic engine: there is no api for it, the
   force touch feedback apple's own apps use is a native framework, and
   `navigator.vibrate` is android only and returns false here. Anyone
   reading this file looking for the real thing should stop looking.

   So this is the substitute a desktop actually has, which is the one the
   hardware itself used before it could buzz: a click. Very short, very
   quiet, pitched well above the room, and synthesised rather than sampled
   so it ships as forty lines instead of a folder of wav files. It lands on
   the same events a haptic would, and the point is the same: the hand gets
   an answer without the eyes having to leave the photograph.

   The other half of that answer is motion.css and motion.js, and that half
   works whether or not this one is switched on.

   It is off by default. A tool that makes noise before being asked is a
   tool people turn off once and never turn back on, and a tagging run is a
   thousand keystrokes.
   --------------------------------------------------------------------- */

const KEY = "keeper.feel";
let on = localStorage.getItem(KEY) === "1";
let ctx = null;
let bus = null;
let noise = null;

export const feelOn = () => on;

/**
 * A context made before a gesture starts suspended and stays suspended, so
 * this is called from the first real press rather than at load. Making it
 * lazily also means a person who never turns the sound on never has an
 * audio context at all, which is the difference between a tool that uses no
 * audio hardware and one that holds it open in silence.
 */
function wake() {
  if (!on) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return (on = false), null;
    ctx = new AC();
    bus = ctx.createGain();
    /* the ceiling for the whole file. every kind below is a fraction of
       this, so there is exactly one number to turn down. */
    bus.gain.value = 0.5;
    bus.connect(ctx.destination);

    /* a fiftieth of a second of white noise, made once and replayed. a
       click is mostly noise: the pitch comes from the filter, not the
       source, which is why one buffer covers every kind in here. */
    const n = Math.floor(ctx.sampleRate * 0.05);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** one click: filtered noise under a decay short enough to have no pitch */
function click(at, { hz, q = 1, gain, ms }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = hz;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  /* exponential, because a linear fade on something this short is audible
     as a chirp rather than a tap, and never to zero, because zero is not a
     legal target for an exponential ramp. */
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  src.connect(bp).connect(g).connect(bus);
  src.start(at);
  src.stop(at + ms / 1000 + 0.02);
}

/** the body under a click, which is what makes one feel heavier than another */
function body(at, { hz, gain, ms, to = null }) {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(hz, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + ms / 1000);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + ms / 1000 + 0.02);
}

/**
 * Five surfaces, and they are five rather than one because the whole value
 * of this is telling two events apart without looking. A tag and a keep
 * happen a keystroke apart in the same run and must not sound alike.
 */
const KINDS = {
  /* the lightest thing in here. one tag key, a thousand times an hour. */
  tick: (t) => click(t, { hz: 2700, q: 1.3, gain: 0.05, ms: 9 }),
  /* something chosen rather than run through: a keep, a chip, a view */
  tap: (t) => {
    click(t, { hz: 1600, q: 1, gain: 0.07, ms: 16 });
    body(t, { hz: 540, gain: 0.03, ms: 26 });
  },
  /* something committed. a frame set aside, a tray filled. */
  thud: (t) => {
    click(t, { hz: 620, q: 0.8, gain: 0.07, ms: 34 });
    body(t, { hz: 190, gain: 0.06, ms: 90, to: 120 });
  },
  /* a job that finished and wrote something. the only pitched pair in the
     app, and it is two notes rather than a tune. */
  done: (t) => {
    body(t, { hz: 660, gain: 0.05, ms: 90 });
    body(t + 0.075, { hz: 990, gain: 0.045, ms: 130 });
  },
  /* no. low, and twice, because one of anything reads as confirmation. */
  no: (t) => {
    body(t, { hz: 200, gain: 0.06, ms: 60, to: 150 });
    body(t + 0.09, { hz: 165, gain: 0.05, ms: 80, to: 120 });
  },
};

/**
 * The whole api. Never throws, never returns anything, never waits: it sits
 * on the same line as a write in a dozen places and none of them should
 * grow a `try` because the speakers are busy.
 */
export function feel(kind = "tick") {
  if (!on) return;
  try {
    if (!wake() || ctx.state !== "running") return;
    (KINDS[kind] ?? KINDS.tick)(ctx.currentTime + 0.001);
  } catch {
    /* an audio graph that will not build is not a reason for a tag not to
       be written. it goes quiet and the app carries on. */
    on = false;
  }
}

export function setFeel(next) {
  on = Boolean(next);
  localStorage.setItem(KEY, on ? "1" : "0");
  paint();
  if (on) feel("tap");
}

let btn = null;
function paint() {
  if (!btn) return;
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "sound on" : "sound off";
}

/**
 * The switch lives in the shortcuts sheet, next to the keys, because that
 * is the one panel in the app that is about how it responds to you rather
 * than about the photographs.
 */
export function mountFeel() {
  btn = document.querySelector("#feel-toggle");
  if (!btn) return;
  btn.onclick = () => setFeel(!on);
  paint();
}
