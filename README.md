# keepers

Point it at a drive of photographs. Get back the ones worth keeping, cropped
into the holes they have to fill.

Built because a shoot comes back as 1,768 frames and a website has sixteen
slots, and every hour between those two numbers is spent scrolling a Finder
window at 200px a thumbnail.

```
keepers ~/Archive
```

Scans, thumbnails, and opens a browser. Nothing is uploaded, nothing leaves
the machine, and the originals are never written to.

## The three commands

**Browse and tag.**

```
keepers ~/Archive
```

Every frame, filterable by tag and by folder. Tagging is keyboard first,
because that is the only way it gets done: arrow keys move, a letter tags,
space keeps, and the cursor advances on its own. A thousand frames is twenty
minutes through the home row and an afternoon through a mouse.

**Let an agent tag it instead.**

```
keepers sheets ~/Archive
keepers tag ~/Archive tags.txt
```

`sheets` writes contact sheets built for a machine to read rather than for a
person to print. You hand them to Claude Code, Cursor, or whatever you use,
along with [AGENTS.md](AGENTS.md), and it writes one line of codes per
sheet. `tag` takes that file back.

No API key ships with keepers and none is wanted. The tagger is the agent
you already pay for.

**Place them.**

```
keepers export ~/Archive
```

Define the holes once, in `keepers.config.json`:

```json
{
  "slots": [
    { "id": "hero",    "aspect": "16/9", "width": 2400 },
    { "id": "about-1", "aspect": "3/2",  "width": 1200,
      "note": "the room rather than a wall of faces" }
  ]
}
```

The bench draws each slot at its real aspect. Drag a frame onto a slot, then
drag inside it to move the picture and alt+wheel to punch in until the crop
is right.
`export` writes the cut file plus a `placement.json` for every slot.

## What it tells you that a Finder window does not

- **Whether the crop still ships whole.** If you have not punched in, keepers
  prints the exact `object-position` line and your original ships uncut. If
  you have, it says so, because that cut is permanent.
- **When a crop has gone soft.** Punch in far enough and the surviving
  rectangle is narrower than the slot it has to fill. keepers compares the
  two and warns before you export, not after you deploy.
- **Which frames you have already seen.** Tagged, kept, and placed are three
  different states and all three are visible at once.

## Two decisions worth knowing about

**A placement is stored in the negative's own coordinates, not the screen's.**
Three numbers: where the centre of the crop sits in the source, and how wide
it is as a fraction of the source. The height falls out of the slot's aspect
at the moment of painting. This is what lets a layout change a frame's aspect
at a breakpoint without silently meaning something different: a placement
written in screen pixels would.

**A frame's id is a hash of its path, not its position.** Drop 200 new
photographs into the archive and every tag written last month still points at
the same picture. Position based ids would have slid by 200 and repointed the
lot, quietly.

## Install

```
npm install
node bin/keepers.mjs ~/Archive
```

Node 20 or newer. One dependency, `sharp`.

Reads jpg, png, webp, avif, tif, heic and dng. Raw files are read through
their embedded preview, which is all a contact sheet needs.

## Where things live

Everything keepers writes goes in `<archive>/.keepers/`: the index, the
thumbnails, the contact sheets, your tags and your placements. Delete that
folder and the archive is exactly as it was. Nothing else on the drive is
touched.

## Licence

MIT. Built at [basedcollective](https://basedcollective.ai).
