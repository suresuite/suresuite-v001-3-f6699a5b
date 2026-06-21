## Problem

`PageHeader` is sticky and uses `-mx-12 -mt-6` to bleed into its parent wrapper. It assumes the wrapper is `px-12 py-6` (the standard used by Firm/Process/Product Network, Interactive Network Space, Data Manager, Project Intelligence, etc.).

Two pages break that contract:

- `src/pages/ProjectPolicies.tsx` line 71 → `<div className="px-12 py-8">`
- `src/pages/SimulationLab.tsx` line 130 → `<div className="px-12 py-8">`

The extra `py-8` (vs the header's `-mt-6`) leaves an 8px gap above the sticky header band, so the title bar visually sits lower than on every other page.

## Fix

Change the wrapper padding on both pages from `py-8` to `py-6` so they match the standard PageHeader contract.

- `src/pages/ProjectPolicies.tsx`: `px-12 py-8` → `px-12 py-6`
- `src/pages/SimulationLab.tsx`: `px-12 py-8` → `px-12 py-6`

No changes to `PageHeader`, `PageLayout`, or any other page. Pure presentation tweak — two-character edit per file.
