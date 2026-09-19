// Rendering a manual figure — WP 5.2i.
//
// ── HOW A FILE BECOMES A FIGURE, WITH NO BUILD STEP ───────────────────────
//
// `import.meta.glob` resolves `src/assets/manual/*` at BUILD time and hands
// back a map of filename → hashed URL. So dropping a file into that folder and
// naming it in `figureManifest.ts` is the entire operation: no import to write,
// no path to get right, no generator to remember to run, and no chance of a
// path that works in dev and 404s in production.
//
// It also means the component KNOWS whether a slot's file exists, which is what
// makes the empty state honest rather than a broken image icon.
//
// ── THE EMPTY STATE IS THE POINT ──────────────────────────────────────────
//
// A slot with no file renders a labelled placeholder naming the exact filename
// it is waiting for and describing what the diagram must show. That is §5.3 T3
// applied to the manual's own illustrations: an empty slot is a fact about this
// manual, and a figure that silently fails to appear is the one kind of broken
// a reader cannot report and an author cannot see.

import type { ReactNode } from "react";
import { FIGURE_SLOTS, slotsFor, type FigureSlot } from "@/components/docs/figureManifest";

/**
 * Every file in `src/assets/manual/`, by bare filename.
 *
 * `eager` because the manual is already one lazy chunk — deferring a handful of
 * image URLs inside it would add a loading state to a page that has nothing
 * else to wait for. The URLs are strings; the images themselves are still
 * fetched only when a page that uses one is rendered.
 */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../assets/manual/*.{svg,png,jpg,jpeg,webp,avif}", {
      eager: true,
      query: "?url",
      import: "default",
    }) as Record<string, string>,
  ).map(([path, url]) => [path.split("/").pop() as string, url]),
);

/**
 * The same folder again, as SOURCE TEXT rather than a URL — for `.svg` only.
 *
 * ── WHY A SECOND GLOB, AND WHY WP 5.2k HAD TO WIDEN THIS DOOR ─────────────
 *
 * WP 5.2i rendered every figure as `<img src={url}>`, and an `<img>`-referenced
 * SVG is an ISOLATED DOCUMENT. The page's stylesheet does not reach it, its
 * CSS custom properties do not reach it, and `currentColor` inside it resolves
 * against the SVG's own initial `color` — not the colour of the text it sits
 * beside. So a drawing loaded that way cannot follow the theme by any means,
 * and the drawing standard WP 5.2k works to ("use `currentColor` and the CSS
 * custom properties the manual already defines") was not reachable through the
 * door the previous package built. Nothing failed; the first figure would
 * simply have been drawn in colours that ignore `--border`, `--card` and
 * `--foreground` and gone dark-on-dark the day anything sets `.dark`.
 *
 * `prefers-color-scheme` inside the file is NOT the fix, and is worse than
 * doing nothing: `tailwind.config.ts` sets `darkMode: ["class"]`, so the theme
 * here is a class on an ancestor. A figure keyed to the OS preference would
 * invert itself underneath a page that had not.
 *
 * Inlining the markup puts the drawing in the page's own cascade, which is how
 * `figures.tsx`'s three schematics have always worked — they are JSX, so they
 * were never `<img>` and never had this problem. This makes a `.svg` FILE
 * behave the same way, so the two routes to a figure now theme identically.
 *
 * ── WHAT THIS COSTS, AND THE RULES IT PUTS ON A FILE ──────────────────────
 *
 * `dangerouslySetInnerHTML` is safe here for a reason worth stating: these are
 * repository files resolved at BUILD time by `import.meta.glob`, not content
 * from a user, a database or a network. The set of strings that can appear
 * here is exactly the set of files in `src/assets/manual/`, and changing one is
 * a reviewable diff. `src/assets/manual/README.md` carries the two rules an
 * inlined file must follow — no `<style>` element (an inline SVG's styles are
 * DOCUMENT-scoped and would leak to the whole page) and no `id` that another
 * figure could also define.
 *
 * Raster files still go through `FILES` and stay `<img>`. They have no cascade
 * to join.
 */
/**
 * An SVG's comments are for the repository, not for the page.
 *
 * Every figure file opens with the sources its elements were taken from —
 * which generated module, which component, which engine constant — because
 * that is what makes a drawing checkable rather than merely confident. None of
 * it belongs in the DOM: it is bytes in the DocPage chunk that no reader can
 * see, and `bodies.test.tsx` found the sharper reason first. Those citations
 * name code in backticks, the comments are inlined verbatim by
 * `dangerouslySetInnerHTML`, and the suite fails a page that prints a raw
 * backtick outside a `<code>` element — correctly, because a stray backtick in
 * rendered prose is exactly the markdown-leaking-through defect that rule
 * exists to catch. So the notes stay in the file and stop at the boundary.
 */
const stripComments = (svg: string) => svg.replace(/<!--[\s\S]*?-->/g, "").trim();

const SVG_SOURCE: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../assets/manual/*.svg", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>,
  ).map(([path, src]) => [path.split("/").pop() as string, stripComments(src)]),
);

/** Slots by id, built from the manifest so an id can only be wrong in one place. */
const FIGURE_BY_ID: Record<string, FigureSlot> = Object.fromEntries(
  FIGURE_SLOTS.map((s) => [s.id, s]),
);

function EmptySlot({ slot }: { slot: FigureSlot }) {
  return (
    <figure id={`figure-${slot.id}`} className="scroll-mt-20 space-y-2">
      <div className="rounded-sm border border-dashed border-border bg-muted/30 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Figure — not drawn yet
        </div>
        <div className="mt-1.5 text-sm font-semibold text-foreground">{slot.title}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{slot.shows}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          To fill it: put the file at{" "}
          <code className="rounded-sm border border-border bg-muted/50 px-1 py-0.5 font-mono text-[11px] text-foreground">
            src/assets/manual/{slot.id}.svg
          </code>{" "}
          and set this slot's <code className="font-mono text-[11px]">file</code> in{" "}
          <code className="font-mono text-[11px]">src/components/docs/figureManifest.ts</code>.
        </p>
      </div>
      <figcaption className="text-xs text-muted-foreground">{slot.caption}</figcaption>
    </figure>
  );
}

/**
 * One figure, by slot id.
 *
 * `fallback` is the schematic a page already has — WP 5.2a drew three inline
 * SVGs, and an empty slot rendered beside one of those would say "not drawn
 * yet" underneath a drawing. So a slot with a file SUPERSEDES the schematic, a
 * slot without one falls back to it, and only a slot with neither shows the
 * placeholder. Dropping a real diagram in is then a replacement rather than an
 * addition, which is what those three pages actually want.
 */
export function DocFigure({ id, fallback }: { id: string; fallback?: ReactNode }) {
  const slot = FIGURE_BY_ID[id];
  if (!slot) {
    // A page asking for a slot that does not exist is a broken page, and a
    // silent nothing is the worst way to find that out. `figures.test.ts`
    // fails on it; this is what a reader would see if one ever shipped.
    throw new Error(
      `DocFigure: no slot "${id}" in figureManifest.ts. A page cannot render a figure ` +
        `the manifest does not declare — add the slot, or fix the id.`,
    );
  }
  if (!slot.file || !FILES[slot.file]) {
    if (fallback) {
      return (
        <figure id={`figure-${slot.id}`} className="scroll-mt-20 space-y-2">
          <div className="overflow-x-auto rounded-sm border border-border bg-card p-4 shadow-xs">
            {fallback}
          </div>
          <figcaption className="text-xs leading-relaxed text-muted-foreground">
            {slot.caption}
          </figcaption>
        </figure>
      );
    }
    return <EmptySlot slot={slot} />;
  }

  const inline = SVG_SOURCE[slot.file];
  return (
    <figure id={`figure-${slot.id}`} className="scroll-mt-20 space-y-2">
      <div className="overflow-x-auto rounded-sm border border-border bg-card p-4 shadow-xs">
        {inline ? (
          // `role="img"` + `aria-label` on the WRAPPER, because an inlined
          // drawing has no `alt`. The slot's alt text is what a screen reader
          // says, exactly as it would through an `<img>`, and the SVG itself is
          // hidden from the tree by the `aria-hidden` on its own root element
          // so the label is not read twice.
          //
          // 480px, not `max-w-3xl`. Every manual figure is authored on a
          // 320-unit grid so that one unit is about one CSS pixel at 360px
          // viewport width — which is what lets the drawing standard forbid
          // horizontal scrolling and hold a 11px floor on type at the same
          // time. Letting it stretch to 768px would scale a 12px label to 29px.
          <div
            role="img"
            aria-label={slot.alt}
            className="mx-auto block w-full max-w-[480px] [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: inline }}
          />
        ) : (
          <img
            src={FILES[slot.file]}
            alt={slot.alt}
            // Height auto with a width cap rather than fixed dimensions: the
            // figures are diagrams of unknown aspect and the manual is read on a
            // phone as often as a laptop.
            className="mx-auto block h-auto w-full max-w-3xl"
            loading="lazy"
          />
        )}
      </div>
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {slot.caption}
      </figcaption>
    </figure>
  );
}

/** Every slot a page declares, in manifest order. Nothing when it has none. */
export function PageFigures({ page }: { page: string }) {
  const slots = slotsFor(page);
  if (!slots.length) return null;
  return (
    <div className="space-y-6">
      {slots.map((s) => (
        <DocFigure key={s.id} id={s.id} />
      ))}
    </div>
  );
}
