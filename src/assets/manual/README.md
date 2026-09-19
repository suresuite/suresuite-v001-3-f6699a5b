# Manual figures — drop your diagrams here

A figure in the `/docs` manual is **one file in this folder plus one line in
`src/components/docs/figureManifest.ts`**. Nothing else.

## Adding a figure

1. Put the file here. `.svg` is best (it stays sharp and scales), then `.png`
   or `.webp`. Name it after what it shows: `tier-journey.svg`, not `fig3.svg`.
2. Find its slot in `figureManifest.ts` — every page that should carry a figure
   already has one, with a `shows:` line describing what the diagram needs to
   depict. Set that slot's `file` to your filename.
3. That is all. Vite picks the file up at build time; there is no import to
   write and no path to get right.

## What happens if you skip step 2

The page renders a **visible, labelled placeholder** naming the exact filename
it is waiting for. That is deliberate: an empty slot is a fact about the manual
(§5.3 T3), and a figure that silently fails to appear is the one kind of broken
a reader cannot report.

## What happens if you skip step 1

The same placeholder. A slot whose `file` names something that is not here is
reported by `figures.test.ts` as an OPEN SLOT, not as a failure — the manual
ships with slots unfilled on purpose while the diagrams are being drawn.

## What IS a failure

A file in this folder that **no slot uses**. `figures.test.ts` fails on it,
because a dead asset in a repository is a file nobody can tell is dead.

## Alt text is not optional

Every slot carries `alt`. It is what a screen reader says and what shows if the
image fails to load, and a diagram whose only explanation is the picture is a
diagram half this manual's readers cannot use. `shows:` is for the author;
`alt:` is for the reader.
