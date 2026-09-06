export { PageLayout } from './PageLayout';
export { PageHeader } from './PageHeader';
export { PageBody, PAGE_GUTTER, PAGE_GUTTER_BLEED } from './PageBody';
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