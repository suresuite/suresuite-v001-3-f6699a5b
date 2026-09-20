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

## Two rules an SVG in this folder must follow

`.svg` files are **inlined into the page** rather than loaded through `<img>`, so
that `hsl(var(--border))`, `hsl(var(--foreground))` and the rest of the manual's
tokens actually reach the drawing. (An `<img>`-referenced SVG is an isolated
document: no page CSS reaches it, and `currentColor` inside it resolves against the
SVG's own initial colour, not the text beside it. WP 5.2k widened `DocFigure` for
exactly this.) Being in the page's document puts two rules on the file:

1. **No `<style>` element.** An inline SVG's styles are *document*-scoped — a rule
   written inside one figure applies to the whole manual. Put every fill and stroke
   on the element as a presentation attribute.
2. **No `id` another figure could also define.** Two figures on one page share an
   id namespace, and the first `<marker id="arrow">` wins for both. Draw arrowheads
   as explicit `<polygon>`s rather than reusing a `<defs>` entry.

Raster files (`.png`, `.webp`, …) are unaffected — they still render as `<img>`,
because they have no cascade to join.

## The drawing grid

Author on a **320-unit-wide viewBox with a 12 px minimum font size**, and let the
figure grow downwards rather than sideways. The arithmetic: at a 360 px viewport the
manual's gutter and the figure card's padding leave **298 px** of drawing width, so a
label at font-size *F* in a viewBox *W* units wide renders at *F × 298/W*. An 11 px
floor therefore needs *F/W ≥ 0.0369* — which 12/320 meets and 12/640 does not.
`DocFigure` caps an inlined figure at 480 px so the same label does not balloon to
29 px on a desktop.

A figure that cannot survive 360 px without scrolling sideways is two figures.
