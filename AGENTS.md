# Tagging an archive with a coding agent

keepers does not ship a tagger and does not want an API key. It ships
contact sheets built for a machine to read, and a command that takes the
answer back. The tagger is whatever agent you already pay for.

If you are that agent, this file is the brief. Read it once, then work.

## The job

1. `keepers sheets <archive>` has already run. The sheets are in
   `<archive>/.keepers/sheets/`, numbered `sheet-001.jpg` upward, with
   `index.json` beside them.
2. Read every sheet. One image at a time, in order.
3. For each sheet, write one line of single letter codes, one letter per
   cell, reading left to right and top to bottom.
4. Save the lines to a file and stop. The human runs `keepers tag`.

## The line format

```
3  PWWPSAAA TPSSLPSC ECCPFPLL NSDSSSSL  * r2c5 r3c7
```

- the sheet number first
- then one letter per cell, left to right, top to bottom
- whitespace inside the codes is ignored, so group them by row. Do that.
  It is free and it makes a miscount visible before you save the file.
- everything after `*` is the cells worth actually opening
- lines starting with `#` are comments

## The letters

```
P  portrait     one person, aware of the camera
L  laughing     visible joy, mid laugh, a real face
T  talking      two to four people in conversation
W  working      heads down, laptops open
S  presenting   someone with the room, a mic or a screen
A  audience     seated, all facing one way
C  crowd        many people, unposed, mingling
G  group shot   everyone lined up for the camera
V  celebrating  arms up, a trophy, a cheque
N  night        a bar, a table, low light
F  food         a plate, a table, a meal
R  resting      sofas, beanbags, lying about
E  empty room   the space with nobody in it
D  detail       an object, a sign, a whiteboard
O  outdoors     street, park, a building from outside
X  unusable     blurred, black, or a title card
```

One letter per frame, the loudest thing in it. A frame that is both talking
and laughing gets whichever a person would name first. Do not agonise. The
tags exist to get a few thousand frames down to twenty, and a human looks at
the twenty.

## The star, and what it is for

A starred cell is one worth opening at full size: sharp, a real expression,
and it still reads at thumbnail size. Aim for roughly one in ten. Starring
half a sheet makes the star useless, and starring nothing wastes the only
signal in this pass that a filter cannot recompute.

Stars are not "good photographs". They are "stop scrolling and look at this
one".

## The rule that matters more than any tag

**Count before you write.** A sheet holds `cols x rows` cells and the last
sheet holds the remainder. If your line has 23 codes for a 24 cell sheet,
every tag after the slip lands on the wrong photograph, and it lands
confidently, which is worse than not tagging at all.

`keepers tag` checks this and refuses a sheet whose count disagrees with the
index. It cannot catch a line that is the right length and shifted in the
middle. Group your codes by row.

## What not to do

- Do not guess at a cell that is too dark or too small to read. Tag it `X`.
  An honest `unusable` beats an invented `talking`.
- Do not open the originals. The sheets are the whole input. Reading 1,768
  full size photographs will exhaust your context long before it improves a
  single tag.
- Do not invent letters. `keepers tag` rejects the whole sheet on an unknown
  code rather than dropping the frame quietly.
- Do not describe the photographs back to the human. The file is the output.

## Grid sizing, if you are asked to choose

Vision models resize an image to roughly 1568px on its long edge before
looking at it, so a wider sheet is not a more detailed sheet. The only real
lever is how many cells the sheet is divided into:

```
cols   per frame   what can be judged
 8       196px     scene only: crowd, empty room, outdoors
 6       261px     posture and gesture, faces read as faces
 5       313px     expressions: laughing apart from talking
 4       392px     who a person is, if you know them
```

Six is the default. Ask for `--cols 4` when the job is choosing between
three good frames of one person, and accept that it doubles the number of
sheets you have to read.
