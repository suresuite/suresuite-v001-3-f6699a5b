
# Typography refresh — Inter + JetBrains Mono

Replace Geist Sans with **Inter** (body/UI) and **JetBrains Mono** (code, tabular, IDs). This is the Linear / Vercel / Perplexity default — the most legible, modern, "AI-platform" neutral sans. No color, layout, or logic changes.

## 1. Install fonts (self-hosted via fontsource)

```bash
bun add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

Import in `src/main.tsx`:

```ts
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
```

Remove the Google Fonts `<link>` for Geist Sans in `index.html`.

## 2. Tailwind config (`tailwind.config.ts`)

```ts
fontFamily: {
  sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
  mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
},
```

## 3. Global styles (`src/index.css`)

Update the `body` and heading rules:

- `body` → `font-family: 'Inter Variable', system-ui, sans-serif;`
- `font-feature-settings: "cv11", "ss01", "ss03", "cv02", "cv04", "calt", "rlig";` — Inter's stylistic sets: single-story `a`, straight-tail `l`, disambiguated `1/I/l`. This is what gives Inter its "AI platform" look versus its default appearance.
- Headings: `letter-spacing: -0.019em` (Inter needs slightly tighter tracking than Geist), `font-weight: 600`.
- Body: `letter-spacing: -0.006em` at 13–14px (Inter reads warmer with a hair of negative tracking).
- Add `font-variation-settings: "opsz" 14;` on body and `"opsz" 32;` on headings ≥20px so Inter's optical size axis kicks in — this is the single biggest quality win.
- Mono utility class: `.font-mono { font-family: 'JetBrains Mono Variable', ui-monospace, monospace; font-feature-settings: "calt", "liga", "zero", "ss01"; }` — enables the slashed-zero and ligatures that make code and IDs read cleanly.

## 4. Size + weight scale (unify what's currently mixed)

Standardize the UI type scale so every surface speaks the same language:

| Token | Size / line-height | Weight | Usage |
|---|---|---|---|
| `text-caption` | 11 / 14 | 500, +0.02em, uppercase | Section labels (Today/Yesterday) |
| `text-xs` | 12 / 16 | 500 | Meta, timestamps, kbd |
| `text-[13px]` | 13 / 18 | 400 | Default UI (nav, buttons, inputs, thread rows) |
| `text-sm` | 14 / 22 | 400 | Message body, prose |
| Title S | 15 / 20 | 600, -0.015em | Page headers |
| Title M | 20 / 26 | 600, -0.018em | Section titles |
| Title L | 24 / 30 | 500, -0.02em | Greeting / empty state |

Numbers everywhere: `font-variant-numeric: tabular-nums`. IDs, hashes, timestamps in tables: `font-mono` (JetBrains Mono at 12.5px).

## 5. Apply to existing components (no logic changes)

Files that hardcode Geist behavior or set their own font sizing and need a pass:

- `src/index.css` — token + feature-settings swap (§3)
- `tailwind.config.ts` — font family (§2)
- `src/main.tsx` — font imports (§1)
- `index.html` — remove Geist `<link>`
- `src/components/shared/PageHeader.tsx` — title 15→matches Title S spec, tabular-nums on any metadata
- `src/components/chat/MessageBubble.tsx` — assistant prose stays 14, user bubble stays 14, code inside prose swaps to JetBrains Mono
- `src/components/chat/ToolCallBadge.tsx` — mono block uses JetBrains Mono with `zero` + `ss01`
- `src/components/intelligence/ChatSidebar.tsx` — thread rows 13px, group labels use `text-caption`
- `src/components/intelligence/ChatComposer.tsx` — textarea 14px, hint kbd `text-xs font-mono`

## 6. Verification

- Preview: greeting, agent tiles, thread list, message bubble, tool-call accordion, page header — glyphs should read noticeably crisper and more "AI-platform" (compare `a`, `g`, `1`, `I`, `l`).
- Grep `font-\[` and hardcoded `font-family` in `src/components/**` — none should remain outside the two families.
- Confirm no layout shift: Inter's x-height is close to Geist so line-heights above should hold.

## Out of scope

Colors, spacing, radii, shadows, motion, component structure, logic, edge functions, data.
