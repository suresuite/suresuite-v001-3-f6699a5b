## Problem

On `/` (Landing page), the black funding & attribution section's content doesn't line up with the rest of the page. Every other section uses `mx-auto max-w-6xl px-6`, but the funding section uses `mx-auto max-w-7xl px-6 sm:px-8 lg:px-12`. Its inner content is therefore wider and shifted left compared to the nav, hero, capabilities, quick-start, architecture, roadmap, and slim footer — exactly what the screenshot shows (HWR/ACCURATE blocks pulled further left than the copy above).

## Fix

Single-line change in `src/pages/Landing.tsx` line 493 — swap the funding container to the shared page container so it aligns with every other section and the slim footer below it.

```
- <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-16">
+ <div className="mx-auto max-w-6xl px-6 py-16">
```

No other layout, grid, logo, or copy changes. The `bg-black` band still spans full width; only its inner content column snaps back to the 6xl rail used across the page.

## Verification

Reload `/`, confirm the "Developer / Digital SC Lab" block's left edge matches the section headings above (Roadmap, Architecture) and the `© SuReSuite` line in the slim footer below.