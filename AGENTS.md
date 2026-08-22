# tagging an archive with a coding agent

keeper does not ship a tagger and does not want an api key. it ships contact
sheets built for a machine to read, and a command that takes the answer back.
the tagger is whatever agent you already pay for.

if you are that agent, this file is the brief. read it once, then work.

## the job

1. `keeper sheets <archive>` has already run. the sheets are in
   `<archive>/.keeper/sheets/`, numbered `sheet-001.jpg` upward, with
   `index.json` beside them.
2. read every sheet. one image at a time, in order.
3. for each sheet, write one line of single letter codes, one letter per
   cell, reading left to right and top to bottom.
4. save the lines to a file and stop. the human runs `keeper tag`.

## the line format

```
3  PWWPSAAA TPSSLPSC ECCPFPLL NSDSSSSL  * r2c5 r3c7
```

- the sheet number first
- then one letter per cell, left to right, top to bottom
- whitespace inside the codes is ignored, so group them by row. do that. it
  is free and it makes a miscount visible before you save the file.
- everything after `*` is the cells worth actually opening
- lines starting with `#` are comments

## the letters

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

one letter per frame, the loudest thing in it. a frame that is both talking
and laughing gets whichever a person would name first. do not agonise. the
tags exist to get a few thousand frames down to twenty, and a human looks at
the twenty.

## the star, and what it is for

a starred cell is one worth opening at full size: sharp, a real expression,
and it still reads at thumbnail size. aim for roughly one in ten. starring
half a sheet makes the star useless, and starring nothing wastes the only
signal in this pass that a filter cannot recompute.

stars are not "good photographs". they are "stop scrolling and look at this
one".

## the rule that matters more than any tag

**count before you write.** a sheet holds `cols x rows` cells and the last
sheet holds the remainder. if your line has 23 codes for a 24 cell sheet,
every tag after the slip lands on the wrong photograph, and it lands
confidently, which is worse than not tagging at all.

`keeper tag` checks this and refuses a sheet whose count disagrees with the
index. it cannot catch a line that is the right length and shifted in the
middle. group your codes by row.

## what not to do

- **do not guess** at a cell that is too dark or too small to read. tag it
  `X`. an honest `unusable` beats an invented `talking`.
- **do not open the originals.** the sheets are the whole input. reading
  1,768 full size photographs will exhaust your context long before it
  improves a single tag.
- **do not invent letters.** `keeper tag` rejects the whole sheet on an
  unknown code rather than dropping the frame quietly.
- **do not describe the photographs back to the human.** the file is the
  output.

## grid sizing, if you are asked to choose

vision models resize an image to roughly 1568px on its long edge before
looking at it, so a wider sheet is not a more detailed sheet. the only real
lever is how many cells the sheet is divided into:

```
cols   per frame   what can be judged
 8       196px     scene only: crowd, empty room, outdoors
 6       261px     posture and gesture, faces read as faces
 5       313px     expressions: laughing apart from talking
 4       392px     who a person is, if you know them
```

six is the default. ask for `--cols 4` when the job is choosing between three
good frames of one person, and accept that it doubles the number of sheets
you have to read.
