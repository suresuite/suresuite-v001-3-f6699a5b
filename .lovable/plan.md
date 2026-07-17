## Refine hero on `/` to "Precision technical editorial"

Edit only the hero block in `src/pages/Landing.tsx`. Keep palette (paper white / near-black / gray), keep CTAs and copy, keep the rest of the page untouched.

### Structural changes in the hero

1. **Top meta line** above the eyebrow — a flex row with a full-width hairline `<div class="h-px flex-1 bg-border" />` and a monospaced right-aligned tag: `SYSTEM: SURESUITE-V2.0 // ACTIVE` in `font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground`.

2. **Eyebrow pill** — add a small pulsing black dot (`w-1.5 h-1.5 rounded-full bg-foreground animate-pulse`) before the existing "Resilience-grade supply chain simulator" text. Keep pill shape, tighten to `text-[11px]`.

3. **Two-column headline block** (12-col grid, gap-8):
   - Left `col-span-8`: headline "Design supply chains that survive **the next shock.**" — the phrase "the next shock." rendered in a serif italic muted class (`font-serif italic text-muted-foreground`) as a tasteful editorial accent. Followed by the CTA row (Get started primary black + Sign in outlined), both with `rounded-sm` (sharper than current) and the arrow that translates on hover.
   - Right `col-span-4`, bottom-aligned: the subhead paragraph moved here inside a left hairline rule (`border-l border-border pl-6`) as marginalia, at `text-sm text-muted-foreground`.

4. **Credibility row** — replace the pill chips with a 4-column data grid separated by a top hairline. Each cell:
   - Kicker: `font-mono text-[10px] uppercase tracking-tighter text-muted-foreground` — labels: "Network architecture", "Compute capacity", "Stress modules", "Access level".
   - Value: `text-sm font-medium` — "3 network levels", "5k+ simulations", "5 resilience tactics", "Scenario library".

### Tokens & constraints

- Use existing semantic tokens (`text-foreground`, `text-muted-foreground`, `border-border`, `bg-background`) — no hardcoded hex.
- Use the project's existing sans stack; the serif italic accent can use Tailwind's default `font-serif` (browser serif) to avoid loading a new webfont.
- No palette changes, no purple, no gradient. Motion limited to the arrow hover and the eyebrow dot pulse.
- Section width stays consistent with rest of page (`max-w-6xl px-6`).

### Not changed

Core Capabilities, Quick Start, Technical Architecture, Roadmap, funding footer, slim footer — all untouched.

### Verification

Reload `/`, confirm: hairline meta line at top, pulsing dot in eyebrow, serif-italic "the next shock." accent, marginalia subhead on the right, mono-labeled 4-column credibility grid at bottom. Sign-in still routes to `/auth`, Get started still routes to `/auth`.