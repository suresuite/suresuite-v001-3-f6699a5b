# Plan: Light gray canvas (inverted contrast)

Flip the current dark canvas to a light gray palette. The sidebar becomes the darker accent surface so contrast is preserved.

## Changes

1. **`src/components/shared/PageLayout.tsx`**
   - Remove the `dark` class from the content wrapper.
   - Set the content wrapper background to a light gray token (`bg-slate-50` equivalent via semantic token — e.g. `bg-[hsl(var(--surface-sunken))]` which resolves to `#f8fafc`-ish).

2. **`src/components/Navbar.tsx`**
   - Swap the sidebar from `.light` (white) to `.dark` wrapper so the sidebar becomes the dark accent surface (`#0f172a`-range).
   - Keep active rail marker in `primary` — will now read as a light marker on dark sidebar.
   - Update account dropdown `className` from `light` to `dark` for consistency.

3. **`src/index.css`**
   - No new tokens required. The existing `.dark` scope and default light tokens cover both surfaces.
   - Optionally tune `--surface-sunken` in `:root` to `210 40% 98%` (#f8fafc) and `--border` to `214 32% 91%` (#e2e8f0) to match the chosen palette exactly.

4. **`src/components/Footer.tsx`**
   - Confirm footer uses semantic tokens so it inherits the new light canvas cleanly; no structural change.

## Result

- Canvas: light gray `#f8fafc` → `#e2e8f0` range, easy to read.
- Sidebar: dark `#0f172a` accent rail — inverted contrast vs. current setup.
- Active nav marker + text remain legible on dark sidebar.
- No component API changes; purely token/wrapper swaps.
