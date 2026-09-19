/**
 * §2.7's sticky-column classes, in a LEAF module — WP 5.2j.
 *
 * They were declared in `shared/index.ts`, which also re-exports every shared
 * component. That is fine for a screen, which is already pulling those in, and
 * it is not fine for a documentation page: importing one class string from the
 * barrel drags the whole component surface with it, and the manual's tests
 * render in node with no DOM, where a module touching `localStorage` at import
 * time throws before a single assertion runs.
 *
 * So the constants live here and `shared/index.ts` re-exports them. Every
 * existing importer is unchanged; a module that wants only the class string can
 * take it without the rest.
 */

/**
 * §2.7: freeze a scrolling table's identifying column so a row keeps its name
 * once you swipe sideways. Below `md` only — `md:static` releases it, so the
 * desktop row still paints its hover tint across every cell and the table is
 * byte-identical to what it was.
 *
 * FROZEN_CELL carries its own opaque background, which a sticky cell needs or
 * the columns underneath show through. Use FROZEN_CELL_ON_TINT where the cell
 * already sits on an opaque fill of its own (a ledger `TH`, say) and only the
 * positioning is wanted.
 */
export const FROZEN_CELL =
  'sticky left-0 z-[1] bg-background md:static md:bg-transparent';
export const FROZEN_CELL_ON_TINT = 'sticky left-0 z-[1] md:static';
