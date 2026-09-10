export { PageLayout } from './PageLayout';
export { PageHeader } from './PageHeader';
export { PageBody, PAGE_GUTTER, PAGE_GUTTER_BLEED, PAGE_GUTTER_SKIN } from './PageBody';
export { ResponsiveLedger } from './ResponsiveLedger';
export type { LedgerColumn } from './ResponsiveLedger';
export { ProjectSelector } from './ProjectSelector';
export { ScenarioImpactSlider } from './ScenarioImpactSlider';
export { YouTubeEmbed } from './YouTubeEmbed';
export { SectionCard } from './SectionCard';
export { TableShell, TableName, TableBlock } from './TableShell';
export { TableLoading } from './TableLoading';
export { TableEmpty } from './TableEmpty';
export { ErrorBanner } from './ErrorBanner';
export { ApiCodeBlock } from './ApiCodeBlock';
export { InlineCode } from './InlineCode';
export {
  AdaptiveLabel,
  TruncatedText,
  ProseText,
  Disclosure,
  NumericValue,
} from './AdaptiveText';

/** Dense uppercase micro-header for data tables (C8). Append alignment classes as needed. */
export const TH_DENSE = 'h-9 text-[11px] uppercase tracking-wide text-muted-foreground';

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
/**
 * Spec 2.6 / 4.4 - a centred dialog is the wrong container on a phone, so below
 * `md` it becomes a bottom sheet and at `md` it is handed straight back to the
 * primitive's centred geometry.
 *
 * Positioning is written as explicit `left`/`right` rather than `inset-x`,
 * because `inset-x-*` and `left-*` are one conflict group to tailwind-merge:
 * an `md:inset-x-auto` sitting beside an `md:left-[50%]` is silently dropped,
 * which leaves the desktop dialog stretched edge to edge. Keep them explicit.
 *
 * The call site adds its own desktop width after this (e.g. `md:max-w-sm`);
 * `max-w-none` here exists to beat the primitive's `max-w-lg` on mobile only.
 *
 * The height cap and the scroll are mobile-only for the same reason: the
 * primitive sets neither, so an ungated `max-h`/`overflow-y` would silently
 * change how a tall desktop dialog behaves.
 */
export const DIALOG_AS_SHEET =
  'bottom-0 left-0 right-0 top-auto max-h-[85svh] w-full max-w-none ' +
  'translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-t-xl p-4 ' +
  'md:bottom-auto md:left-[50%] md:right-auto md:top-[50%] md:max-h-none ' +
  'md:overflow-visible md:translate-x-[-50%] md:translate-y-[-50%] md:gap-4 ' +
  'md:rounded-lg md:p-6';
