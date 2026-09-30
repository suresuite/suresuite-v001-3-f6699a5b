/**
 * Chrome tokens for the three network lenses' desktop layout (network-lenses
 * handoff, "Design tokens used"). Neutrals only — every CATEGORY colour comes from
 * `@/lib/graph/palette`, and the pages hold none of their own (`onePalette.test.ts`).
 *
 * The rule and quiet-ink values reuse the product-wide variables in `index.css`
 * (`--hair-border` #d4d4d4, `--hair-quiet` #6b6b6b, `--brand-ink` #171717); the
 * lighter in-card hairline and fills have no variable yet, so they are named here
 * once rather than repeated across four components.
 */
export const LENS = {
  border: 'border-[var(--hair-border)]',
  hairline: 'border-[#ebebeb]',
  hairlineBg: 'bg-[#ebebeb]',
  ink: 'text-[var(--brand-ink)]',
  body: 'text-[#525252]',
  muted: 'text-[var(--hair-quiet)]',
  quiet: 'text-[#9a9a9a]',
  chip: 'bg-[#f0f0f0] text-[#525252]',
  hoverRow: 'hover:bg-[#f5f5f5]',
  hoverControl: 'hover:bg-[#fafafa]',
  hoverTableRow: 'hover:bg-[#fcfcfc]',
  track: 'bg-[#f0f0f0]',
} as const;

/** `#rrggbb` at an alpha, for the class badge's 12% tint. */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
}
