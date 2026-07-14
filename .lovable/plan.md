## Goal

Replace the current mid-page sections of `src/pages/Landing.tsx` with the 5 sections migrated from `/app` (GettingStarted), preserving the exact "Quick Start" block and the 3D Network Graph figure. Keep the existing top bar, hero, value tiles, funding block, and footer. Normalize section rhythm so vertical spacing is uniform.

## Section order (top → bottom)

1. Top bar *(unchanged)*
2. Hero *(unchanged, keeps credibility chips)*
3. Value tiles *(unchanged)*
4. **Core Capabilities** *(migrated, tuned)*
5. **Quick Start with SuReSuite** *(migrated verbatim — dark section, red heading, yellow numbered steps, "Launch SuReSuite" CTA row)*
6. **SuReSuite Technical Architecture** *(migrated, tuned; keeps 3D figure)*
7. **Ready to boost the resilience of your supply chain?** *(migrated, tuned)*
8. **Roadmap** *(migrated, tuned)*
9. Funding & attribution *(unchanged, verbatim)*
10. Footer *(unchanged)*

Removes the previously-added "How it works", static "Platform architecture" grid, and generic CTA strip — they are superseded by Quick Start, Technical Architecture, and the "Ready to boost" strip.

## Per-section tuning

**Core Capabilities** — keep 3-card grid + centered heading. Drop the pastel gradient card backgrounds, colored badge chips, hover lift, and "Learn more" buttons. Use the Landing card style: `border border-border bg-card`, neutral `bg-secondary` icon tile, small uppercase tag, title, body. Icons and copy unchanged.

**Quick Start with SuReSuite** — KEEP AS-IS. Same black background, red `#BF2330` heading, `border-b border-white/10` divider row with "Launch SuReSuite" pill button, 3 columns with yellow gradient numbered circles, uppercase eyebrows, bold titles, white bodies. No visual changes.

**SuReSuite Technical Architecture** — keep the tab pattern (Network / Nexus Detection / Simulation), keep `NetworkVisualization3D` for the Network tab, keep auto-rotate effect. Tuning: swap the outer `bg-gradient-to-br from-muted to-background` panel for a flat `border border-border bg-card rounded-lg`; swap the 3D figure's `from-slate-900 to-gray-800` for a subtle single tone (`bg-neutral-950`) with a soft radial grid overlay so it sits better on the light Landing canvas; recolor accents to neutral (drop `#BF2330` in tab active + info tile icons, use `text-foreground` on tab active + `bg-secondary` icon tiles), keeping the Network Graph 3-level illustration itself untouched.

**Ready to boost…** — replace the compact dark strip with a bordered light panel matching the Landing card language: `rounded-lg border border-border bg-card p-8`, headline left, primary `Get started` button right. Same copy.

**Roadmap** — reuse the migrated list. Tuning: unify status pill color (single muted `border` chip instead of primary/blue tints), unify roadmap icons to `text-foreground` inside `bg-secondary` tiles (drop green/blue/primary tints), keep the left vertical rule + circular icon markers. Same 3 items and dates.

## Spacing normalization

Every content section between hero and funding uses the same rhythm:

- Outer wrapper: `border-t border-border/60`
- Inner container: `mx-auto max-w-6xl px-6 py-24`
- Section header (when present): `max-w-2xl` with `text-3xl font-semibold tracking-tight` + `mt-3 text-muted-foreground`, followed by `mt-12` grid.

Exception: the Quick Start dark section keeps its own internal spacing verbatim, but its outer wrapper still uses `border-t border-border/60` and `py-24` so the vertical rhythm across the page stays consistent.

## Files

- **Edit** `src/pages/Landing.tsx` only. Replace the "How it works", "Platform architecture", "Roadmap", and "CTA strip" blocks with the 5 migrated sections above; keep hero, value tiles, funding, footer.
- Import `NetworkVisualization3D` from `@/components/NetworkVisualization3D`.
- Add state + effect for `activeTech` tab (copied from GettingStarted, no logic changes).
- No changes to `GettingStarted.tsx`, routing, auth, or any other file.

## Out of scope

No business logic, no route changes, no new deps, no changes to the funding block.
