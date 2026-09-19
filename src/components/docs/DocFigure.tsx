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

  return (
    <figure id={`figure-${slot.id}`} className="scroll-mt-20 space-y-2">
      <div className="overflow-x-auto rounded-sm border border-border bg-card p-4 shadow-xs">
        <img
          src={FILES[slot.file]}
          alt={slot.alt}
          // Height auto with a width cap rather than fixed dimensions: the
          // figures are diagrams of unknown aspect and the manual is read on a
          // phone as often as a laptop.
          className="mx-auto block h-auto w-full max-w-3xl"
          loading="lazy"
        />
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
