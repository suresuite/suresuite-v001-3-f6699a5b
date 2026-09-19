export { PageLayout } from './PageLayout';
export { PageHeader, HeaderRefreshButton } from './PageHeader';
export {
  HDR_ICON_BUTTON,
  HDR_ICON_BUTTON_ON,
  HDR_OUTLINE_BUTTON,
  HDR_PRIMARY_BUTTON,
  HDR_GHOST_BUTTON,
  HDR_PROJECT_SELECT,
  HDR_FILTER_SELECT,
  HDR_SEARCH_INPUT,
  HDR_SEGMENTED,
} from './headerControls';
export {
  PageBody,
  PAGE_GUTTER,
  PAGE_GUTTER_BLEED,
  PAGE_GUTTER_SKIN,
  PAGE_GUTTER_SKIN_BLEED,
} from './PageBody';
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
 * §2.7's sticky-column classes now live in a leaf module (`./frozenCell`) and
 * are re-exported here, so every existing importer is unchanged while a module
 * that wants only the class string can take it without this barrel's component
 * surface. WP 5.2j moved them: the manual's tests render in node, and importing
 * one string from here dragged in a module that touches `localStorage`.
 */
export { FROZEN_CELL, FROZEN_CELL_ON_TINT } from './frozenCell';
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
