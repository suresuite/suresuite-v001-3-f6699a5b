## Goal

When a project-backed value can't be mapped to a specific row, fill it with a **smart average** (per-item, then project-wide) instead of the silent `0`, and mark that cell with a **red provenance dot** so users know it's an estimate to verify. Imputed values persist through "Apply prefill" exactly like real prefill. Also fix the misleading sky-blue dot that currently appears on sentinel `0` fallbacks.

## Background (what we have & why it misses)

Uploads land in `inbound_logistics` (`supplier_id, material_id, unit_price, lead_time, volume, time_unit`), `outbound_logistics` (`customer_id, product_id, unit_price, expected_lead_time, volume, time_unit`), and `bom_multi_level`. `useStageRows.tsx` joins the `get_supply_chain_data` RPC edges to those tables by exact string key (`from_location::to_location` vs `supplier_id::material_id` / `customer_id::product_id`). Any mismatch (ID vs name, casing/whitespace, multi-tier aggregated edge, or a pair missing from the logistics upload) makes the lookup miss → the field falls back to `0`/`undefined`. That's why prices we "have" show as `0`.

## Project-backed fields that get imputation

Only fields genuinely sourced from uploads (hardcoded documented defaults like capacity/ordering_cost stay as-is, no red dot):
- **Supplier:** `material_price` (inbound `unit_price`), `lead_time_mean_days` (inbound `lead_time`).
- **Customer:** `price` (outbound `unit_price`), `mean_per_day` (outbound volume/day), `delivery_window_days` (outbound `expected_lead_time`).
- **Plant:** `production_lead_time_mean_days` (median inbound lead of feeding components).

## 1. `src/hooks/useStageRows.tsx`

**Compute averages once per load (from the already-fetched `inbound`/`outbound` arrays):**
- Helper `avg(nums)` = mean of finite, positive values (ignore missing/0 sentinels).
- Inbound: `priceByMaterial`, `leadByMaterial` (per `material_id`) + global `priceGlobal`, `leadGlobal`.
- Outbound: `priceByProduct`, `volByProduct`, `leadByProduct` (per `product_id`) + global equivalents.
- "Smart" resolver: `impute(perItemMap, key, globalAvg)` → per-item average if available, else global average, else `undefined` (nothing to average → leave blank).

**Tag provenance per row** with two plain maps written onto each row object:
- `__from_data: Record<field, true>` — set when the value came from a real matched enrichment row.
- `__imputed: Record<field, true>` — set when the value was filled from an average.

**Per stage**, for each project-backed field: if the enrichment lookup has a finite value → use it and set `__from_data[field]`. Else compute the smart average; if defined → set the value (rounded: prices 2dp, volume/lead 2dp) and set `__imputed[field]`; else leave undefined. (Supplier `material_price` stops defaulting to `0`; customer `price`/`mean_per_day`/`delivery_window_days` and plant `production_lead_time_mean_days` get the same treatment.)

No change to capacity/cost/MOQ documented defaults, share logic, or primary-source logic.

## 2. `src/components/policies/StagePolicyTable.tsx` (provenance dots ~lines 865–897)

Replace the dot resolution with an explicit, 4-state priority chain:
- `edited` (draft) → **primary** dot, "Edited".
- `__imputed[field]` → **red** dot (`bg-destructive`), "Imputed project average — verify".
- real data: `__from_data[field]` is true, OR (field untracked by the new maps AND `r[field] != null`, preserving current behavior for non-imputed fields) → **sky** dot, "From project data".
- saved override → **emerald** dot.
- else no dot (bundle default).

This both adds the red alert dot and fixes the bug where a `0` fallback showed the sky "from project data" dot.

Add the red dot to the provenance legend (if a legend is rendered near the toolbar; otherwise rely on the cell tooltip).

## 3. Persistence

No new code needed: imputed values live on the row (`r[field]`), so `getEffective` returns them and the existing **Apply prefill** path writes them as overrides like any other prefill value (still shown red until the user edits, since `__imputed` is row metadata, not an override flag). Plain "Save changes" continues to save only edited cells.

## Notes / non-goals

- Root-cause key normalization (RPC name-vs-ID matching) is out of scope here; imputation is the agreed mitigation so the simulation always has reasonable numbers with a clear "verify" signal.
- `@ts-nocheck` files stay as-is; new fields are dynamic on the row object.
