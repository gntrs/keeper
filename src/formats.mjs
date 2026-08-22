/**
 * The shapes everything else in the world is cut to.
 *
 * keeper.config.json describes one project's holes. This file describes the
 * holes nobody gets to choose: a reel is nine by sixteen whether you like it
 * or not, and a youtube thumbnail is sixteen by nine at a size that decides
 * whether a face survives being 168 pixels wide in a sidebar. They are built
 * in rather than shipped in the example config because a person opening
 * keeper for the first time has no config at all, and the question they
 * already have is whether the photograph they just took reads as a square.
 *
 * The widths are the real ones each platform wants, not round numbers, so a
 * crop that comes out narrower than the width is a crop that will be upscaled
 * by somebody else's server, and the bench says so in red.
 *
 * A format is a slot in every other respect. It exports the same way, it
 * takes the same placement, and its id is a folder name on the way out, so
 * the ids here obey the same rule as a config id: letters, digits, dash.
 */

export const FORMATS = [
  // --- social. the aspect is the product, and it changes about once a year.
  { id: "ig-post",   label: "instagram post",   aspect: "4/5",    width: 1080,
    group: "social", note: "the tall one. the feed's default since it stopped being square" },
  { id: "ig-square", label: "instagram square", aspect: "1/1",    width: 1080,
    group: "social", note: "still what the profile grid crops to" },
  { id: "reel",      label: "reel and story",   aspect: "9/16",   width: 1080,
    group: "social", note: "tiktok and shorts are the same shape. the top and bottom sixth sit under ui" },
  { id: "x-post",    label: "x, in feed",       aspect: "16/9",   width: 1600,
    group: "social", note: "cropped to this in the timeline whatever you upload" },
  { id: "yt-thumb",  label: "youtube thumb",    aspect: "16/9",   width: 1280,
    group: "social", note: "judge it at a sixth of this. if the subject dies small it dies" },
  { id: "og",        label: "link preview",     aspect: "1.91/1", width: 1200,
    group: "social", note: "open graph, so this is also linkedin and slack and imessage" },
  { id: "pin",       label: "pinterest",        aspect: "2/3",    width: 1000,
    group: "social", note: "tall, and the only place tall wins by default" },

  // --- the ones a layout asks for, plus the awkward ones that are only ever
  // a problem once they are already in the design.
  { id: "wide",      label: "hero",             aspect: "16/9",   width: 2400, group: "web" },
  { id: "classic",   label: "the negative",     aspect: "3/2",    width: 1600,
    group: "web", note: "what the camera shot. no crop at all, for comparison" },
  { id: "four-three",label: "four by three",    aspect: "4/3",    width: 1600, group: "web" },
  { id: "pano",      label: "letterbox",        aspect: "21/9",   width: 2560,
    group: "web", note: "cinema. almost nothing survives it upright" },
  { id: "banner",    label: "banner strip",     aspect: "3/1",    width: 2400,
    group: "web", note: "a header band. everything above the eyes and below the chin is gone" },
  { id: "tall",      label: "portrait column",  aspect: "2/3",    width: 1200, group: "web" },
  { id: "half",      label: "skyscraper",       aspect: "1/2",    width: 1000,
    group: "web", note: "the awkward one. it is here because it is the one that catches you out" },
];

/** the ids are folder names on export, so a clash with a config slot matters */
export const FORMAT_IDS = new Set(FORMATS.map((f) => f.id));
