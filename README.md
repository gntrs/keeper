# keeper

<!-- one badge is red and the rest are the ground, for the same reason one
     thing on the shelf is red: the accent marks the claim that matters, and
     a row of five red badges marks nothing. -->
![no api key](https://img.shields.io/badge/no_api_key-e1062c?style=flat-square)
![mac](https://img.shields.io/badge/mac-131315?style=flat-square)
![node 20+](https://img.shields.io/badge/node_20+-131315?style=flat-square)
![one dependency](https://img.shields.io/badge/one_dependency-131315?style=flat-square)
![offline](https://img.shields.io/badge/offline-131315?style=flat-square)
![mit](https://img.shields.io/badge/mit-131315?style=flat-square)

a shoot comes back as 1,768 frames and a website has sixteen holes. every
hour between those two numbers goes on scrolling a finder window at 200px a
thumbnail, and that is the hour this takes back.

```
keeper ~/Archive
```

it scans, writes thumbnails, and **opens the browser itself**. pass
`--no-open` and it prints the url instead. **mac only.** nothing is uploaded,
the server binds to loopback, and **no original is ever edited.** no key
touches a file on your drive: `delete` sets a frame aside in keeper's own bin
and the photograph stays exactly where it was. one button, at the bottom of
that bin, moves files to the macos trash, and you have to go there to press
it.

## at a glance

| | |
|---|---|
| what it is | a culling and cropping bench for a photo and video archive |
| runs on | macos, node 20 or newer |
| dependencies | one, `sharp` |
| network | none. it binds to `127.0.0.1` and talks to nothing |
| who tags the photographs | the coding agent you already pay for |
| what it writes | one folder, `<archive>/.keeper/`, and nothing else |
| licence | mit |

## the commands

```
keeper <folder>                 scan, thumbnail, and open the shelf
keeper sheets <folder>          contact sheets for a coding agent to read
keeper tag <folder> <file>      apply the tags that agent wrote
keeper export <folder>          write the placed crops out
keeper trays <folder>           what is in the trays, and how much
keeper init [folder]            create keeper.config.json
```

`--port` defaults to 7777, `--cols` and `--rows` set the contact sheet grid at
6 by 4, `--rescan` rebuilds an index that already exists, and `--no-open`
leaves the browser alone. typed bare, with no folder after it, `keeper`
prints this list: **a terminal opens in your home folder**, and thumbnailing
every file you own is not what someone asking what the command does had in
mind.

## no api key, and none wanted

keeper does not ship a vision model and does not ask for a key. it writes
**contact sheets built for a machine to read**, sized so a face survives the
cell, and it takes the answer back as one line of letters per sheet.

```
keeper sheets ~/Archive
```

hand the sheets to claude code, or cursor, or whatever agent is already open,
together with [AGENTS.md](AGENTS.md), which is the brief. it reads them and
writes a file. then:

```
keeper tag ~/Archive tags.txt
```

a sheet whose letter count disagrees with its cell count is **refused whole**,
not applied. one miscounted sheet silently shifting every later tag onto the
wrong photograph is the failure that would make the whole thing worthless.

six frames across is the default. `--cols 4` gives each frame 392px and lets a
model tell one person from another; `--cols 8` gives it 196px and gets you the
scene and nothing finer. that trade is the only real choice in the command,
and `keeper sheets --help` prints the table.

## drag a folder in

drop a folder from finder anywhere on the window and keeper opens it. no
command, no path typed.

it is worth knowing what happens under that, because it is the one place a
browser cannot do the obvious thing. **a page is never told the absolute path
of anything dragged in from outside.** it gets the name, and for a folder it
may list what sits directly inside, and that is the end of it. so keeper
recovers the path in three steps and each one is a real way in:

1. the drag's own url flavour. some sources write a `file://` url and some
   write nothing, so it is always worth asking and never worth relying on.
2. spotlight. the folder's name plus a couple of dozen of the names inside it
   is enough to tell one folder called `2026` from the other four on the
   disk. one match opens, several are offered, none falls through to step 3.
3. the real finder folder dialog.

nothing in it ever says the drop failed when what happened is that the
browser withheld the path. those are two different sentences and only one of
them is ever true.

## the shelf

every frame, filterable by what is in it and by where it came from. the `what`
row is the tag legend as well as the filter: each chip wears the letter that
types it, so the alphabet is on screen before the first keystroke.

keyboard first, because that is the only way it actually gets done:

| | |
|---|---|
| arrows | move the cursor, and **a letter tags** whatever it is on |
| `k` | keeps the frame |
| `space` | quick look, the way it works everywhere else on this machine |
| click | picks, `shift`+click a range, `cmd`+click one, `cmd`+drag a box |
| `cmd`+`a` | everything the filters left, and not one frame more |
| a letter, with frames picked | **tags all of them at once**, and moves nothing |
| `cmd`+`return` | sends the picked frames to the tray |
| `option`+`r` | reveals the original in finder, selected |
| `cmd`+`f` | finds, `option`+`o` opens another folder, `option`+`1` and `option`+`2` change view |
| `delete` | sets the frame aside in keeper's bin, nothing on the drive moves |

the modifier is option and not cmd on three of those because **chrome resolves
`cmd`+`r`, `cmd`+`o` and `cmd`+`1`** above the page: `preventDefault` runs and
the tab reloads anyway. the physical key is read off `e.code` rather than
`e.key`, because option on a mac rewrites the character and `option`+`r`
arrives as `®`.

a thousand frames is twenty minutes through the home row and an afternoon
through a mouse.

- untagged frames sit under a scrim, so what is left to do is **visible from
  across the room**, and hovering lifts it almost all the way off
- the frame under the pointer is the frame the keyboard acts on, so no click
  is needed to tell the app what you were obviously already looking at
- double click opens a card over the dimmed page rather than a full screen
  takeover, because the row you were comparing against is worth keeping in
  the corner of your eye
- **delete arms and then commits.** the first press says how many frames and
  which way they are going, the second sends them, and finder puts them back
  in one keystroke. it is the only key in keeper that touches an original,
  and nothing here ever deletes anything for good

## the bench

the bench asks one question: **does this photograph survive that shape.**

click a frame in the strip and it is **tried on in every shape at once**,
which is the question you actually have before you know which hole it wants.
drag it onto a slot to commit it there, drag inside the slot to move the
picture, `option`+wheel to punch in. every slot is drawn at its true
proportions and every one prints the crop it is holding, in the negative's own
pixels.

the shapes nobody gets to choose are built in, so the bench is full on the
first run with no config at all:

| | | |
|---|---|---|
| instagram post | 4/5 | 1080px |
| instagram square | 1/1 | 1080px |
| reel and story | 9/16 | 1080px, and tiktok and shorts are the same shape |
| x, in feed | 16/9 | 1600px |
| youtube thumb | 16/9 | 1280px, judged at a sixth of that |
| link preview | 1.91/1 | 1200px, so also linkedin and slack and imessage |
| pinterest | 2/3 | 1000px |
| hero | 16/9 | 2400px |
| the negative | 3/2 | 1600px, no crop at all, for comparison |
| four by three | 4/3 | 1600px |
| letterbox | 21/9 | 2560px |
| banner strip | 3/1 | 2400px |
| portrait column | 2/3 | 1200px |
| skyscraper | 1/2 | 1000px |

they live in [`src/formats.mjs`](src/formats.mjs). the widths are the real ones
each platform wants rather than round numbers, so a crop that comes out
narrower **will be upscaled by somebody else's server**, and the bench says so
in red before you export.

then your own holes, in `keeper.config.json`:

```json
{
  "slots": [
    { "id": "hero",    "aspect": "16/9", "width": 2400 },
    { "id": "about-1", "aspect": "3/2",  "width": 1200,
      "note": "the room rather than a wall of faces" }
  ]
}
```

the config is read from **the folder you run keeper in**, not from the
archive, because the holes belong to the project and the photographs do not.
`keeper init` writes the example there for you. a slot of yours with the same
id as a built in one **replaces it quietly**, and `"formats": false` turns the
whole standard set off for a project that knows exactly what it wants.

`export this one` under a picture, `export all the placed ones` at the foot of
the bench, and `keeper export` in the terminal all write the same files out of
the same function, because two copies of that code would be two chances for
the crop you saw and the crop you shipped to stop being the same picture.

crops land in **`~/Downloads/keeper`** unless a `"out"` in your config says
otherwise, and that path is printed next to the button so it is never a
question. each crop is a new file: `hero.jpg`, then `hero-2.jpg`, then
`hero-3.jpg`, because a crop you spent a minute framing should not be
destroyed by the next press of the same button. beside each one is a json of
the same name holding the source path, the source size, the crop box in whole
pixels, and the `object-position` that reproduces it.

## trays

a tray is the pile you build while you browse. click a frame in, keep going,
start another tray when the subject changes, export the one you want as a real
folder of real files.

```
keeper trays ~/Archive
keeper trays ~/Archive --export tray-1 --to ~/Desktop/for-the-site
keeper trays ~/Archive --export tray-1 --to ~/Desktop/live --mode symlink
```

a tray goes out three ways, and the panel spells out what each one leaves you
holding. **copies** are real files, yours to hand to anyone. **symlinks** and
**finder aliases** copy nothing and point at the originals, the first breaking
if you move them and the second following them. the terminal names the mode it
just ran every time, because a folder of links and a folder of copies look
identical in a listing and weigh nothing alike.

frames also **drag straight out to finder** and land as real files. a drag out
of a browser is always a copy, on every browser, because no drag flavour
exists that hands finder a reference to a file already on the disk. that is
what the link and alias modes are for and this is the one place it is said.

**export never moves.** the archive is the negative. a tool that shuffles your
originals into a folder for a website is a tool that has lost your originals,
so export reads from the archive and writes somewhere else, and the archive
comes out of it byte for byte identical.

for the same reason keeper refuses to export into a folder inside the
archive. it would work once. the next scan would find the copies, give them
their own ids, thumbnail them, and you would be browsing every exported frame
twice with the tags on only one of the pair.

two frames landing in the destination with the same filename, which happens
constantly in an archive that files by day, gets the second one's frame id
appended rather than the first one overwritten.

## film

clips are scanned, tagged and kept the same way stills are, and they open in
the preview as a real player rather than as a still. **the poster frame is cut
from a third of the way in**, not from frame one, because frame one is a lens
cap, a whip pan or a slate often enough that it is not worth trusting.

needs `ffmpeg` on the path. without it the stills still work and keeper says
which clips it could not read.

## what it tells you that a finder window does not

- **whether the crop still ships whole.** if you have not punched in and you
  have a `keeper.config.json`, the bench prints the exact `object-position`
  line for your stylesheet and your original ships uncut. the line is only for
  someone who has holes of their own, because that is who is holding a
  stylesheet to paste it into.
- **when a crop has gone soft.** punch in far enough and the surviving
  rectangle is narrower than the slot it has to fill. keeper compares the
  two and warns before you export, not after you deploy.
- **which frames you have already seen.** tagged, kept, placed and in a tray
  are four different states, drawn in four different channels, and none of
  them changes the colour of the picture.
- **where a frame was taken.** a drive that files by date says
  `space/2026-06-19`, which is a when and not a where, so `places` in the
  config match a pattern against the path and give it the name you actually
  use for it.

## two decisions worth knowing about

**a placement is stored in the negative's own coordinates, not the screen's.**
three numbers: where the centre of the crop sits in the source, and how wide
it is as a fraction of the source. the height falls out of the slot's aspect
at the moment of painting. that is what lets a layout change a frame's aspect
at a breakpoint without silently meaning something different. a placement
written in screen pixels would.

**a frame's id is a hash of its path, not its position.** drop 200 new
photographs into the archive and every tag written last month still points at
the same picture. position based ids would have slid by 200 and repointed the
lot, quietly. it is also why a frame you take back out of the bin, or out of
finder's trash, comes back to its own tags.

## install

```
npm install
node bin/keeper.mjs ~/Archive
```

reads jpg, png, webp, avif, tif, heic and dng, and mov, mp4, m4v, mkv, avi,
webm and mts. raw files come in through their embedded preview, which is all a
contact sheet needs.

## where things live

everything keeper writes goes in `<archive>/.keeper/`: the index, the
thumbnails, the contact sheets, your tags, your placements and your trays.
delete that folder and the archive is exactly as it was. nothing else on the
drive is touched by anything you can reach with a keystroke. `delete` writes
an id to `binned.json` and nothing else: the frame leaves the shelf, the file
does not leave the folder. the only thing in keeper that moves a file is
`delete off the drive`, which lives inside the bin, asks first, and uses
finder's own delete so the put back record survives.

**this is the second design and the first one was wrong.** `delete` used to go
straight to the macos trash. a bad shot can still be the only copy of itself,
and wiring the fastest key in a culling tool to the one irreversible thing on
the machine is how a tool eats somebody's footage. two decisions, two places,
and only one of them can reach a file.

## the look

a red square and the word `keeper` beside it, and a photograph is the only
thing on the screen worth looking at.

one accent, `#e1062c`, over `#131315` raised and `#0b0b0c` ground. it means
one of exactly two things anywhere it appears: you chose this, or you have to
deal with this. a tab you are already looking at is neither, and neither is a
photograph.

**type is geist and geist mono**, self hosted in `web/font`, ofl, nothing
fetched at runtime. the line between them is not decorative: the mono
carries the wordmark, the nav, every label, every chip and every number,
and the sans is left to do the one thing a mono cannot, which is read as a
sentence.

## licence

mit.
