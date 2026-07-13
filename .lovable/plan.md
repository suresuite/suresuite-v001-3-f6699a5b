## Goal

Expand the new public Landing page (`/`) with the substance from the old `/app` home, using the new tightened design language (mono-accent, sharp borders, minimal decoration, Inter, subtle grid). Keep the funding block **verbatim** — same copy, same logos, same layout — as the last section.

## Design language (applied consistently)

- One canvas: `bg-background`, one accent color for interactive elements, no rainbow gradients or colored card tints from the old page.
- Typography: existing Inter stack, tight tracking on H1/H2, muted-foreground body.
- Surfaces: `border border-border`, `rounded-lg`, `shadow-xs` on hover. No `hover:-translate-y-1`, no `shadow-xl`, no gradient card backgrounds.
- Icons: neutral 4x4 in a `bg-secondary` tile, matching the current value tiles.
- Spacing: 6xl max width, `py-24` section rhythm, `border-t border-border/60` between sections.

## New Landing structure (top → bottom)

1. **Top bar** *(unchanged)* — wordmark, Docs, Log in, Get started.

2. **Hero** *(kept, lightly enriched)*
   - Same eyebrow, headline, subhead, primary + secondary CTA.
   - Add a compact row of 4 credibility chips under CTAs (from old StatChips): "3 network levels · 5k+ simulations · 5 resilience tactics · Scenario library". Rendered as small pill outlines, not colored.

3. **Value tiles** *(existing 3 tiles kept, copy sharpened)*
   - Titles/bodies stay concise. No change to visual treatment.

4. **Core capabilities** *(new, from old "Core Capabilities")*
   - 3-column grid, same card style as value tiles (border, no gradient, no lift).
   - Cards: Interactive Network Graph / Hidden Critical Detection / Strategy Simulation. Icon + eyebrow tag + title + one-line body. No "Learn more" button (CTA lives in hero/footer).

5. **How it works** *(new, replaces old dark "Quick Start")*
   - Light section, 3 numbered steps in a row: Import data → Detect nexus → Simulate strategies.
   - Numbers as small `border` circles, no yellow gradient. Short 1-line description each.

6. **Platform architecture** *(new, distilled from old "Technical Architecture" tabs)*
   - Static 3-column grid instead of tabbed panel: Network Graph, Nexus Detection, Monte Carlo Simulation.
   - No 3D visualization, no auto-rotating tabs — keeps page fast and on-brand.
   - Each column: small icon tile, title, 2 short bullets (e.g. "3 network levels", "Centrality metrics").

7. **Roadmap** *(new, from old Roadmap)*
   - Same 3 items (Enhanced Training / GIS Mapping / Deep-Tier). Rendered as a clean vertical list with a left rule, muted status pill + quarter. No colored icon backgrounds — single accent for status.

8. **CTA strip** *(new, from old "Ready to boost")*
   - Single line: "Ready to strengthen your supply chain?" + primary "Get started" button on a subtle bordered panel (not the black dark section).

9. **Funding & attribution** *(KEPT EXACTLY AS-IS)*
   - Reuse the old `DarkSection` block verbatim: black background, `logo3.png` + Digital SC Lab copy on the left, `logo2.png` + full ACCURATE EU disclaimer + Start/Finish dates on the right. Same 30% / 17% / 53% grid, same text, same spacing.
   - This is the only dark surface on the page and it's intentionally preserved for the funding requirement.

10. **Slim footer** *(existing)* — © year, Docs, Sign in.

## Files

- **Edit** `src/pages/Landing.tsx` — add sections 3–9 above between the existing hero/value tiles and the current slim footer. Import `lucide-react` icons already used elsewhere (Network, Crosshair, Shuffle, Sparkles, MapPin, Layers3, CalendarDays, ArrowRight). Reuse `/logo2.png` and `/logo3.png` from `public/`.
- No changes to `GettingStarted.tsx`, routing, or auth flow. Authenticated users still redirect to `/app`.

## What is intentionally NOT ported

- 3D `NetworkVisualization3D` (heavy, off-brand for a marketing page).
- YouTube intro video (placeholder `VIDEO_ID`, not production-ready).
- Auto-rotating tab animation and hash updates.
- Colored gradient cards, yellow numbered badges, hover lift animations.

## Out of scope

No business logic, no data fetching, no route changes, no new dependencies.
