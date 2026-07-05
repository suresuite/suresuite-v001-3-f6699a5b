import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  specFor,
  familiesForStage,
  headerColsUnion,
  flattenBundle,
  type ColSpec,
  type ColSpecCtx,
} from "@/lib/policies/columnSpecs";
import { ENUM_OPTIONS, SCSIM_ENUM_OPTIONS, type FulfillmentStrategy, type PolicyBundle, type PolicyFamily } from "@/lib/policies/schemas";
import { effectivePolicy, type OverrideRow } from "@/lib/policies/resolve";
import { useStageRows } from "@/hooks/useStageRows";
import { useItemMasters, type ItemMasterTable } from "@/hooks/useItemMasters";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { useTimeUnit } from "@/hooks/useTimeUnit";
import type { StageKey } from "@/lib/policies/stages";

interface Props {
  projectId: string | null | undefined;
  plantName: string | null | undefined;
  stageKey: StageKey;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: FulfillmentStrategy;
  bulkUpsertOverrides: (rows: OverrideRow[]) => Promise<void>;
  deleteOverride?: (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => Promise<void>;
  /** Save a policy version snapshot — offered after saving grid edits. */
  saveSnapshot?: (label?: string) => Promise<string | null>;
  leftActions?: React.ReactNode;
}

type RowDraft = Record<string, unknown>;

// Canonical ordering and palette for family bands (GitHub-style colored bands).
const FAMILY_ORDER: PolicyFamily[] = [
  "sourcing",
  "inventory",
  "transport",
  "production",
  "fulfillment",
  "demand",
];

const FAMILY_HUE: Record<PolicyFamily, number> = {
  sourcing: 210,
  inventory: 270,
  transport: 35,
  production: 340,
  fulfillment: 150,
  demand: 190,
  recovery: 0,
};

function familyBandStyle(family: PolicyFamily): React.CSSProperties {
  const h = FAMILY_HUE[family] ?? 220;
  return {
    backgroundColor: `hsl(${h} 60% 96%)`,
    color: `hsl(${h} 60% 30%)`,
    borderColor: `hsl(${h} 50% 80%)`,
  };
}
function familyDotStyle(family: PolicyFamily): React.CSSProperties {
  const h = FAMILY_HUE[family] ?? 220;
  return { backgroundColor: `hsl(${h} 65% 50%)` };
}

function ValueCell({
  spec,
  value,
  defaultValue,
  firmsAvailable,
  onChange,
}: {
  spec: ColSpec;
  value: unknown;
  defaultValue: unknown;
  firmsAvailable?: string[];
  onChange: (v: unknown) => void;
}) {
  // Read-only synthetic columns (e.g. share_pct) render as a static badge.
  if (spec.readOnly) {
    const n =
      typeof value === "number"
        ? value
        : typeof defaultValue === "number"
        ? defaultValue
        : null;
    return (
      <div className="flex items-center justify-end h-6 px-2">
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {n == null || !Number.isFinite(n) ? "—" : spec.format ? spec.format(n) : String(n)}
        </span>
      </div>
    );
  }
  // Sourcing-firm dropdown when we know the candidate firms from project data.
  if (spec.field === "sourcing_firm" && firmsAvailable && firmsAvailable.length > 0) {
    const v = String(value ?? defaultValue ?? "");
    return (
      <Select value={v || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-6 text-xs border-transparent bg-transparent hover:bg-muted/50 px-2">
          <SelectValue placeholder="(none)" />
        </SelectTrigger>
        <SelectContent>
          {firmsAvailable.map((f) => (
            <SelectItem key={f} value={f} className="text-xs">
              {f}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const opts = SCSIM_ENUM_OPTIONS[spec.field] ?? ENUM_OPTIONS[spec.field];
  if (opts) {
    return (
      <Select value={String(value ?? defaultValue ?? "")} onValueChange={onChange}>
        <SelectTrigger className="h-6 text-xs border-transparent bg-transparent hover:bg-muted/50 px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (typeof defaultValue === "boolean") {
    const v = typeof value === "boolean" ? value : (defaultValue as boolean);
    return (
      <div className="flex items-center justify-center h-6">
        <Switch size="sm" checked={v} onCheckedChange={onChange} />
      </div>
    );
  }
  if (typeof defaultValue === "number") {
    return (
      <Input
        type="number"
        step="any"
        value={value === undefined || value === null ? "" : (value as number)}
        placeholder={String(defaultValue)}
        onChange={(e) => {
          const s = e.target.value;
          onChange(s === "" ? undefined : parseFloat(s));
        }}
        className="h-6 text-xs text-right font-mono tabular-nums border-transparent bg-transparent hover:bg-muted/50 focus:bg-background px-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    );
  }
  return (
    <Input
      value={(value ?? defaultValue ?? "") as string}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 text-xs border-transparent bg-transparent hover:bg-muted/50 focus:bg-background px-2"
    />
  );
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function StagePolicyTable({
  projectId,
  plantName,
  stageKey,
  defaults,
  overrides,
  fulfillmentStrategy,
  bulkUpsertOverrides,
  deleteOverride,
  saveSnapshot,
  leftActions,
}: Props) {
  const spec = specFor(stageKey);
  const families = familiesForStage(stageKey);
  const { rows: dataRows, loading, fallback } = useStageRows({ projectId, plantName, stage: stageKey });
  const { unit, adaptLabel } = useTimeUnit(projectId);

  // Item masters back the economics columns (ColSpec.master): the grid shows
  // and edits materials.cost / products.sell_price / production_capacity /
  // demand_mean directly, with the engine's derived fallback (≈) when unset.
  const {
    materials,
    products,
    suppliers,
    derived,
    saveRows,
    error: mastersError,
  } = useItemMasters(projectId);
  const { snapshot: snapshotDataset } = useDatasetVersion(projectId);
  const masterRowById = useMemo(
    () => ({
      materials: new Map(materials.map((m) => [m.material_id, m as unknown as Record<string, unknown>])),
      products: new Map(products.map((p) => [p.product_id, p as unknown as Record<string, unknown>])),
      suppliers: new Map(suppliers.map((s) => [s.supplier_id, s as unknown as Record<string, unknown>])),
    }),
    [materials, products, suppliers],
  );
  const masterColByField = useMemo(() => {
    const m = new Map<string, ColSpec>();
    for (const c of specFor(stageKey).cols) if (c.master) m.set(c.field, c);
    return m;
  }, [stageKey]);
  const masterValueFor = (col: ColSpec, r: Record<string, unknown>): number | undefined => {
    if (!col.master) return undefined;
    const id = String(r[col.master.idFrom] ?? "");
    const v = masterRowById[col.master.table].get(id)?.[col.master.field];
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? undefined : n;
  };
  const derivedValueFor = (col: ColSpec, r: Record<string, unknown>): number | undefined => {
    if (!col.master) return undefined;
    const id = String(r[col.master.idFrom] ?? "");
    if (col.master.table === "materials" && col.master.field === "cost")
      return derived.materialCost.get(id);
    if (col.master.field === "sell_price") return derived.sellPrice.get(id);
    if (col.master.field === "demand_mean") {
      const v = derived.demandMean.get(id) ?? 0;
      return v > 0 ? v : undefined;
    }
    return undefined; // production_capacity has no logistics-derived fallback
  };

  // Per-column "contains" filters (key = column id/field) + single active sort.
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  // Per-row flattened effective bundle (default + overrides), used by gates AND provenance.
  const rowEffective = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of dataRows) {
      m.set(String(r.key), flattenBundle(effectivePolicy(defaults, overrides, spec.scope, String(r.key))));
    }
    return m;
  }, [dataRows, defaults, overrides, spec.scope]);

  // Build the per-row ColSpecCtx once, then compute the union for the header.
  const rowCtxs: ColSpecCtx[] = useMemo(
    () =>
      dataRows.map((r) => ({
        fulfillmentStrategy,
        row: r as Record<string, unknown>,
        draft: drafts[String(r.key)],
        effective: rowEffective.get(String(r.key)),
      })),
    [dataRows, drafts, fulfillmentStrategy, rowEffective],
  );

  const allCols = useMemo(
    () => headerColsUnion(stageKey, rowCtxs),
    [stageKey, rowCtxs],
  );

  // Group columns by family in canonical order so bands are contiguous.
  const colGroups = useMemo(() => {
    const buckets = new Map<PolicyFamily, ColSpec[]>();
    for (const c of allCols) {
      const arr = buckets.get(c.family) ?? [];
      arr.push(c);
      buckets.set(c.family, arr);
    }
    return FAMILY_ORDER
      .filter((f) => buckets.has(f))
      .map((f) => ({ family: f, cols: buckets.get(f)! }));
  }, [allCols]);

  // Per-stage collapsed family set persisted in localStorage.
  const collapseKey = `policy.table.collapsed.${stageKey}`;
  const [collapsed, setCollapsed] = useState<Set<PolicyFamily>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(collapseKey);
      return raw ? new Set(JSON.parse(raw) as PolicyFamily[]) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(collapseKey, JSON.stringify(Array.from(collapsed)));
    } catch {
      /* noop */
    }
  }, [collapseKey, collapsed]);
  const toggleFamily = (f: PolicyFamily) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  // Flattened visible cols (respecting collapse) — used for rendering rows.
  const cols = useMemo(
    () => colGroups.filter((g) => !collapsed.has(g.family)).flatMap((g) => g.cols),
    [colGroups, collapsed],
  );


  // Reset drafts + filters/sort when stage / project changes.
  useEffect(() => {
    setDrafts({});
    setColFilters({});
    setSort(null);
  }, [stageKey, projectId]);

  /** Effective value lookup: data prefill → override → default.
   *  Master-backed columns resolve draft → item-master value → derived fallback. */
  const getEffective = (rowKey: string, dataRow: Record<string, unknown>, field: string): unknown => {
    const draft = drafts[rowKey]?.[field];
    if (draft !== undefined) return draft;
    const mcol = masterColByField.get(field);
    if (mcol) {
      const mv = masterValueFor(mcol, dataRow);
      return mv !== undefined ? mv : derivedValueFor(mcol, dataRow);
    }
    if (dataRow[field] !== undefined && dataRow[field] !== null) return dataRow[field];
    for (const fam of families) {
      const eff = effectivePolicy(defaults, overrides, spec.scope, rowKey)[fam] as Record<string, unknown>;
      if (eff[field] !== undefined) return eff[field];
    }
    return undefined;
  };

  const getDefault = (field: string, family: PolicyFamily): unknown =>
    ((defaults[family] ?? {}) as Record<string, unknown>)[field];

  // Detect whether a row currently has any existing override (vs default).
  const hasOverride = (rowKey: string): boolean =>
    overrides.some((o) => o.target_key === rowKey);

  /** Comparable cell value for any column (key col or value col). */
  const cellValueFor = (r: Record<string, unknown>, colId: string): unknown => {
    if (spec.keyCols.some((c) => c.id === colId)) return r[colId];
    return getEffective(String(r.key), r, colId);
  };

  /** Toggle sort on a column: asc → desc → none. */
  const toggleSort = (colId: string) => {
    setSort((cur) => {
      if (!cur || cur.col !== colId) return { col: colId, dir: "asc" };
      if (cur.dir === "asc") return { col: colId, dir: "desc" };
      return null;
    });
  };

  const setColFilter = (colId: string, v: string) =>
    setColFilters((f) => ({ ...f, [colId]: v }));

  const hasActiveQuery =
    sort !== null || Object.values(colFilters).some((v) => v.trim() !== "");

  const filtered = useMemo(() => {
    const active = Object.entries(colFilters).filter(([, v]) => v.trim() !== "");
    let out = dataRows;
    if (active.length > 0) {
      out = dataRows.filter((r) =>
        active.every(([colId, q]) =>
          String(cellValueFor(r as Record<string, unknown>, colId) ?? "")
            .toLowerCase()
            .includes(q.trim().toLowerCase()),
        ),
      );
    }
    if (sort) {
      out = [...out].sort((a, b) => {
        const av = cellValueFor(a as Record<string, unknown>, sort.col);
        const bv = cellValueFor(b as Record<string, unknown>, sort.col);
        const an = typeof av === "number" ? av : Number(av);
        const bn = typeof bv === "number" ? bv : Number(bv);
        let cmp: number;
        if (Number.isFinite(an) && Number.isFinite(bn)) {
          cmp = an - bn;
        } else {
          cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        }
        return sort.dir === "desc" ? -cmp : cmp;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRows, colFilters, sort, drafts, overrides, spec.keyCols]);

  const dirtyKeys = Object.keys(drafts).filter((k) => Object.keys(drafts[k] ?? {}).length > 0);

  /** Group key used to enforce one-primary-per-group. */
  const groupKeyFor = (r: Record<string, unknown>): string | null => {
    if (stageKey === "supplier") return r.material_id ? `mat::${r.material_id}` : null;
    if (stageKey === "customer")
      return r.customer_id && r.product_id ? `cp::${r.customer_id}::${r.product_id}` : null;
    return null;
  };

  const onCellChange = (rowKey: string, field: string, v: unknown) => {
    setDrafts((d) => {
      const next: Record<string, RowDraft> = {
        ...d,
        [rowKey]: { ...(d[rowKey] ?? {}), [field]: v },
      };
      // Mutual exclusion: only one primary per material / per (customer, product).
      if (field === "primary_source" && v === true) {
        const me = dataRows.find((row) => row.key === rowKey);
        const gk = me ? groupKeyFor(me as Record<string, unknown>) : null;
        if (gk) {
          for (const other of dataRows) {
            if (other.key === rowKey) continue;
            if (groupKeyFor(other as Record<string, unknown>) !== gk) continue;
            const cur = getEffective(String(other.key), other as Record<string, unknown>, "primary_source");
            if (cur === true) {
              next[String(other.key)] = {
                ...(next[String(other.key)] ?? {}),
                primary_source: false,
              };
            }
          }
        }
      }
      return next;
    });
  };

  const saveAll = async () => {
    if (dirtyKeys.length === 0) return;
    const toUpsert: OverrideRow[] = [];
    // Master-backed drafts, merged onto the FULL current master row — the
    // bulk_upsert RPCs overwrite every column, so a partial row would wipe
    // the other master fields.
    const masterMerged: Record<ItemMasterTable, Map<string, Record<string, unknown>>> = {
      materials: new Map(),
      products: new Map(),
      suppliers: new Map(),
    };
    for (const rowKey of dirtyKeys) {
      const draft = drafts[rowKey];
      const dataRow = dataRows.find((row) => row.key === rowKey) as
        | Record<string, unknown>
        | undefined;
      const byFamily = new Map<PolicyFamily, Record<string, unknown>>();
      for (const [field, v] of Object.entries(draft)) {
        const col = allCols.find((c) => c.field === field);
        if (!col) continue;
        const mcol = col.master;
        if (mcol && dataRow) {
          const id = String(dataRow[mcol.idFrom] ?? "");
          if (!id) continue;
          // Merge onto the loaded master row when one exists (the upsert RPCs
          // overwrite every column); when the master table has no row yet,
          // send a minimal row — the RPC inserts it.
          const base =
            masterMerged[mcol.table].get(id) ??
            masterRowById[mcol.table].get(id) ??
            ({ [mcol.idFrom]: id } as Record<string, unknown>);
          if (isEqual(v ?? null, (base as Record<string, unknown>)[mcol.field] ?? null)) continue;
          masterMerged[mcol.table].set(id, { ...base, [mcol.field]: v ?? null });
          continue;
        }
        if (v === undefined) continue;
        const def = getDefault(field, col.family);
        if (isEqual(v, def)) continue;
        const bucket = byFamily.get(col.family) ?? {};
        bucket[field] = v;
        byFamily.set(col.family, bucket);
      }
      for (const [family, patch] of byFamily.entries()) {
        if (Object.keys(patch).length === 0) continue;
        toUpsert.push({ scope: spec.scope, target_key: rowKey, family, patch });
      }
    }
    const masterRowCount =
      masterMerged.materials.size + masterMerged.products.size + masterMerged.suppliers.size;
    if (toUpsert.length === 0 && masterRowCount === 0) {
      setDrafts({});
      toast.info("No effective changes to save.");
      return;
    }
    const masterTablesToSave = (["materials", "products", "suppliers"] as ItemMasterTable[]).filter(
      (t) => masterMerged[t].size > 0,
    );
    if (masterTablesToSave.length > 0 && mastersError) {
      // Don't pretend: if the masters failed to load (missing table/RPC in
      // this environment), a save would clobber unseen data or fail anyway.
      toast.error(
        `Cannot save master data — item masters failed to load: ${mastersError}. ` +
          "Apply the item-master DB migrations, then retry.",
      );
      return;
    }
    try {
      for (const table of masterTablesToSave) {
        await saveRows(
          table,
          [...masterMerged[table].values()] as unknown as Parameters<typeof saveRows>[1],
        );
      }
      if (toUpsert.length > 0) await bulkUpsertOverrides(toUpsert);
    } catch (e) {
      // Surface RPC failures (e.g. bulk_upsert_* missing in this DB) instead
      // of swallowing them — the click handler has no other catch.
      toast.error(e instanceof Error ? e.message : "Failed to save changes");
      return;
    }
    setDrafts({});
    // Offer to capture the edit as a version right away: master edits are
    // dataset state (dataset_versions), override edits are policy state
    // (policy version snapshot) — runs bind to both.
    const savedMasters = masterRowCount > 0;
    const savedOverrides = toUpsert.length > 0;
    toast.success(`Saved ${dirtyKeys.length} row(s)`, {
      action: {
        label: "Save version",
        onClick: () => {
          void (async () => {
            try {
              if (savedMasters) await snapshotDataset();
              if (savedOverrides && saveSnapshot) {
                await saveSnapshot(`Grid edits — ${new Date().toLocaleString()}`);
              } else if (savedMasters && !savedOverrides && saveSnapshot) {
                // Masters changed only: still offer a policy version so the
                // run picker has a labeled point-in-time to bind to.
                await saveSnapshot(`Data edits — ${new Date().toLocaleString()}`);
              }
              toast.success("Version saved — runs can now bind to this state.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to save version");
            }
          })();
        },
      },
    });
  };

  const revertAll = () => setDrafts({});

  // Confirm dialog for "Apply prefill" (writes a lot of rows at once).
  const [confirmPrefill, setConfirmPrefill] = useState(false);
  const [applying, setApplying] = useState(false);

  // Bulk reset: delete every saved override targeting a row in this stage.
  // Clears stale values frozen by the old auto-seed (e.g. 0-prices) so the
  // grid shows pure project data + bundle defaults again.
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [resetting, setResetting] = useState(false);
  const stageOverrides = useMemo(() => {
    const keys = new Set(dataRows.map((r) => String(r.key)));
    return overrides.filter((o) => keys.has(o.target_key));
  }, [overrides, dataRows]);
  const resetAllOverrides = async () => {
    if (!deleteOverride || stageOverrides.length === 0) {
      setConfirmResetAll(false);
      return;
    }
    setResetting(true);
    try {
      for (const o of stageOverrides) {
        await deleteOverride(spec.scope, o.target_key, o.family);
      }
      setDrafts({});
      toast.success(`Removed ${stageOverrides.length} saved override(s) — showing project data + defaults.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset overrides");
    } finally {
      setResetting(false);
      setConfirmResetAll(false);
    }
  };

  // Whether any row has at least one field backed by real uploaded data.
  const hasRealProjectData = useMemo(
    () => dataRows.some((r) => Object.keys((r as any).__from_data ?? {}).length > 0),
    [dataRows],
  );
  // Whether any override already targets a row in this stage.
  const hasOverridesForStage = useMemo(
    () => overrides.some((o) => dataRows.some((r) => r.key === o.target_key)),
    [overrides, dataRows],
  );

  /**
   * Persist the project-data prefill (+ any unsaved edits) as saved override
   * rows for every resolved row in the current stage. Rows still missing a
   * supplier / primary are skipped so we never lock in bad data.
   */
  const applyPrefill = async () => {
    const toUpsert: OverrideRow[] = [];
    let written = 0;
    let skipped = 0;
    for (const row of dataRows) {
      const r = row as Record<string, unknown>;
      const rowKey = String(r.key);
      if (rowNeedsAttention(r)) {
        skipped++;
        continue;
      }
      const byFamily = new Map<PolicyFamily, Record<string, unknown>>();
      for (const col of allCols) {
        if (col.readOnly) continue;
        // Master-backed fields live in the item masters, never in overrides.
        if (col.master) continue;
        // Never persist imputed averages — they are estimates to verify,
        // not data (silently freezing them poisoned projects before).
        if ((r.__imputed as Record<string, true> | undefined)?.[col.field]) continue;
        // draft → project-data prefill → effective default
        const v = getEffective(rowKey, r, col.field);
        if (v === undefined || v === null) continue;
        const bucket = byFamily.get(col.family) ?? {};
        bucket[col.field] = v;
        byFamily.set(col.family, bucket);
      }
      let touched = false;
      for (const [family, patch] of byFamily.entries()) {
        if (Object.keys(patch).length === 0) continue;
        toUpsert.push({ scope: spec.scope, target_key: rowKey, family, patch });
        touched = true;
      }
      if (touched) written++;
    }
    if (toUpsert.length === 0) {
      setConfirmPrefill(false);
      toast.info("Nothing to persist — no resolved rows with prefill values.");
      return;
    }
    setApplying(true);
    try {
      await bulkUpsertOverrides(toUpsert);
      setDrafts({});
      toast.success(
        `Persisted prefill for ${written} row(s)` +
          (skipped > 0 ? ` — ${skipped} skipped (need a supplier/primary)` : ""),
      );
    } finally {
      setApplying(false);
      setConfirmPrefill(false);
    }
  };

  // Auto-seed: project data loaded for the first time with no existing overrides.
  const autoSeedMarkerRef = useRef<string | null>(null);
  useEffect(() => {
    const marker = `${projectId}::${stageKey}`;
    if (autoSeedMarkerRef.current === marker) return;
    if (loading || applying || dataRows.length === 0) return;
    if (!hasRealProjectData || hasOverridesForStage) return;
    autoSeedMarkerRef.current = marker;
    applyPrefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, applying, dataRows, hasRealProjectData, hasOverridesForStage]);

  // Banner state: derived from project data presence + override existence.
  const dataBannerState = useMemo((): "no_data" | "seeding" | "seeded" | "pending" => {
    if (!hasRealProjectData) return "no_data";
    if (applying) return "seeding";
    if (hasOverridesForStage) return "seeded";
    return "pending";
  }, [hasRealProjectData, applying, hasOverridesForStage]);

  /** Reset one row: drop drafts + delete all saved overrides on that row. */
  const resetRow = async (rowKey: string) => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[rowKey];
      return next;
    });
    if (!deleteOverride) return;
    const rowOverrides = overrides.filter((o) => o.target_key === rowKey);
    for (const o of rowOverrides) {
      await deleteOverride(spec.scope, rowKey, o.family);
    }
    if (rowOverrides.length > 0) toast.success("Reverted to project data");
  };

  /** Does the primary-source group for this row already have a chosen primary? */
  const groupHasPrimary = (r: Record<string, unknown>): boolean => {
    const gk = groupKeyFor(r);
    if (!gk) return true;
    return dataRows.some(
      (o) =>
        groupKeyFor(o as Record<string, unknown>) === gk &&
        getEffective(String(o.key), o as Record<string, unknown>, "primary_source") === true,
    );
  };

  /** Row needs the user's attention (red): no supplier, or multi-source with no primary picked. */
  const rowNeedsAttention = (r: Record<string, unknown>): boolean => {
    if (r.__needs_supplier) return true;
    if (
      (stageKey === "supplier" || stageKey === "customer") &&
      Number(r.__lane_count ?? 0) > 1 &&
      !groupHasPrimary(r)
    ) {
      return true;
    }
    return false;
  };

  /** Sortable label + type-to-filter box rendered inside a column header. */
  const renderSortFilter = (colId: string, label: string) => {
    const active = sort?.col === colId;
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => toggleSort(colId)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors w-full text-left"
          title="Sort"
        >
          <span className="truncate">{label}</span>
          {active ? (
            sort!.dir === "asc" ? (
              <ArrowUp className="h-3 w-3 shrink-0" />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0" />
            )
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
          )}
        </button>
        <Input
          placeholder="Filter"
          value={colFilters[colId] ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setColFilter(colId, e.target.value)}
          className="h-6 text-[11px] bg-background px-1.5 font-normal normal-case tracking-normal"
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Item masters unavailable → master-backed columns can't save. */}
      {mastersError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
          Item masters failed to load ({mastersError}) — master-data columns (cost, capacity,
          demand, MOQ, reliability) cannot be saved until the item-master DB migrations are
          applied to this environment.
        </div>
      )}
      {/* Project data status banner */}
      {dataBannerState === "seeded" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
          Policies seeded from your uploaded project data.
        </div>
      )}
      {dataBannerState === "pending" && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="flex-1">Uploaded data has not been applied to policies yet.</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] border-amber-500/40 hover:bg-amber-500/10"
            onClick={() => setConfirmPrefill(true)}
          >
            Apply now
          </Button>
        </div>
      )}
      {dataBannerState === "seeding" && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 animate-pulse" />
          Seeding policies from project data…
        </div>
      )}
      {dataBannerState === "no_data" && !loading && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
          No uploaded project data found — using default values.
        </div>
      )}
      {/* GitHub-style toolbar: dense, single line, sticky-feeling chrome. */}
      <div className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {filtered.length}/{dataRows.length} rows
        </span>
        {hasActiveQuery && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => {
              setColFilters({});
              setSort(null);
            }}
          >
            Clear filters
          </Button>
        )}
        {dirtyKeys.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {dirtyKeys.length} edited
          </Badge>
        )}
        {/* family chips for quick show/hide */}
        <div className="flex items-center gap-1">
          {colGroups.map((g) => {
            const isCollapsed = collapsed.has(g.family);
            return (
              <button
                key={g.family}
                type="button"
                onClick={() => toggleFamily(g.family)}
                className={cn(
                  "h-6 px-2 rounded-full text-[10px] border transition-colors flex items-center gap-1 uppercase tracking-wide",
                  isCollapsed ? "opacity-40 line-through" : "",
                )}
                style={familyBandStyle(g.family)}
                title={isCollapsed ? `Show ${g.family}` : `Hide ${g.family}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={familyDotStyle(g.family)} />
                {g.family}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {leftActions}
        <div className="mx-1 h-6 w-px bg-border" aria-hidden />
        {dirtyKeys.length > 0 && (
          <Button size="sm" variant="ghost" className="h-8" onClick={revertAll}>
            Revert
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={dataRows.length === 0 || applying}
          onClick={() => setConfirmPrefill(true)}
          title="Save the project-data prefill values as real rows for every resolved row"
        >
          Apply prefill
        </Button>
        {deleteOverride && stageOverrides.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={resetting}
            onClick={() => setConfirmResetAll(true)}
            title="Delete every saved override in this stage — the grid falls back to project data + defaults"
          >
            Reset overrides ({stageOverrides.length})
          </Button>
        )}
        <Button size="sm" className="h-8" disabled={dirtyKeys.length === 0} onClick={saveAll}>
          Save changes
        </Button>
      </div>


      {!unit && (
        <div className="rounded-md border border-destructive bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          Select a planning time unit above before editing — cell labels depend on it.
        </div>
      )}

      {fallback && dataRows.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          No material/product columns found in raw uploads — showing one row per location. Upload
          inbound/outbound logistics + BOM to unlock per-material editing.
        </div>
      )}

      {/* Provenance legend — explains the corner dots on each cell. */}
      {dataRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> from project data
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> imputed average — verify
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> derived fallback (≈)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> saved override
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> edited
          </span>
          {(() => {
            const imputedRows = dataRows.filter(
              (r: any) => r.__imputed && Object.keys(r.__imputed).length > 0,
            ).length;
            return imputedRows > 0 ? (
              <span className="text-destructive">
                {imputedRows} row{imputedRows === 1 ? "" : "s"} use estimated values — please review
              </span>
            ) : null;
          })()}
        </div>
      )}

      <div className="border rounded-md relative min-w-0">
        <div className="overflow-auto max-h-[65vh] [scrollbar-gutter:stable]">
        <table className="w-max min-w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-30 bg-muted backdrop-blur">
            {/* Row 1: family bands (GitHub-style colored group headers). */}
            <tr>
              {spec.keyCols.map((c, i) => {
                const isLast = i === spec.keyCols.length - 1;
                return (
                  <th
                    key={c.id}
                    rowSpan={2}
                    className={cn(
                      "py-2 px-3 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground border-b border-r bg-muted sticky z-40 align-bottom",
                      isLast && "shadow-[4px_0_6px_-2px_hsl(var(--border))]",
                    )}
                    style={{ left: `${i * 140}px`, width: 140, minWidth: 140 }}
                  >
                    {renderSortFilter(c.id, c.label)}
                  </th>
                );
              })}
              {colGroups.map((g) => {
                const isCollapsed = collapsed.has(g.family);
                return (
                  <th
                    key={g.family}
                    colSpan={isCollapsed ? 1 : g.cols.length}
                    className="text-left text-[10px] uppercase tracking-wider font-semibold border-b border-r px-2 py-1"
                    style={familyBandStyle(g.family)}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFamily(g.family)}
                      className="inline-flex items-center gap-1.5 hover:opacity-80"
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={familyDotStyle(g.family)} />
                      {g.family}
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
            {/* Row 2: per-column labels (skipped for collapsed families). */}
            <tr>
              {colGroups.flatMap((g) => {
                if (collapsed.has(g.family)) {
                  return [
                    <th
                      key={`${g.family}-collapsed`}
                      className="border-b border-r px-2 py-1 text-[10px] text-muted-foreground/60 text-center"
                    >
                      {g.cols.length} cols hidden
                    </th>,
                  ];
                }
                return g.cols.map((col) => (
                  <th
                    key={col.field}
                    className="py-1.5 px-2 text-left text-[10px] font-medium text-muted-foreground border-b border-r whitespace-nowrap bg-muted/70"
                  >
                    {renderSortFilter(col.field, adaptLabel(col.label))}
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={spec.keyCols.length + cols.length + collapsed.size} className="py-6 text-center text-muted-foreground">
                  Loading data…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={spec.keyCols.length + cols.length + collapsed.size} className="py-8 text-center text-muted-foreground">
                  No {stageKey === "plant" ? "focal plant" : stageKey + "s"} found for this project. Upload supply-chain data first.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r, rowIdx) => {
                const rowKey = r.key;
                const isDirty = (drafts[rowKey] && Object.keys(drafts[rowKey]).length > 0) ?? false;
                const overrode = hasOverride(rowKey);
                const attention = rowNeedsAttention(r as Record<string, unknown>);
                // Multi-source pairs stay highlighted permanently for review,
                // even once a primary is chosen.
                const isMultiSource = Number((r as Record<string, unknown>).__lane_count ?? 0) > 1;
                return (
                  <tr
                    key={rowKey}
                    className={cn(
                      "group transition-colors",
                      rowIdx % 2 === 1 && !isDirty && "bg-muted/15",
                      isDirty && "bg-primary/5",
                      (attention || isMultiSource) && "bg-destructive/5",
                      "hover:bg-accent/40",
                    )}
                  >
                    {spec.keyCols.map((c, i) => {
                      const isLast = i === spec.keyCols.length - 1;
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "py-1.5 px-3 font-mono text-[11px] border-b border-r sticky z-20 bg-card group-hover:bg-accent truncate",
                            rowIdx % 2 === 1 && !isDirty && "bg-muted",
                            isDirty && "bg-accent",
                            isDirty && i === 0 && "border-l-2 border-l-primary",
                            isLast && "shadow-[4px_0_6px_-2px_hsl(var(--border))]",
                          )}
                          style={{ left: `${i * 140}px`, width: 140, minWidth: 140, maxWidth: 140 }}
                          title={String(r[c.id] ?? "")}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {i === 0 && overrode && !isDirty && (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0"
                                title="Row has saved overrides"
                              />
                            )}
                            <span className="truncate">{String(r[c.id] ?? "")}</span>
                          </span>
                          {/* material-level required actions (red) */}
                          {i === 0 && r.__needs_supplier && (
                            <span
                              className="ml-1.5 inline-block rounded-sm bg-destructive/15 text-destructive px-1 text-[9px] align-middle"
                              title="This material has no supplier in the project data — assign one."
                            >
                              needs supplier
                            </span>
                          )}
                          {i === 0 &&
                            !r.__needs_supplier &&
                            Number(r.__lane_count ?? 0) > 1 &&
                            !groupHasPrimary(r as Record<string, unknown>) && (
                              <span
                                className="ml-1.5 inline-block rounded-sm bg-destructive/15 text-destructive px-1 text-[9px] align-middle"
                                title="Multiple sources — pick exactly one primary."
                              >
                                pick primary
                              </span>
                            )}
                          {c.id === "product_id" && r.__unknown_product && (
                            <span
                              className="ml-1.5 inline-block rounded-sm bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1 text-[9px] align-middle"
                              title="Not found in BOM"
                            >
                              !
                            </span>
                          )}
                          {/* "set firm" only when the customer product has no known firms in data. */}
                          {i === spec.keyCols.length - 1 &&
                            stageKey === "customer" &&
                            (!r.__firms_available || (r.__firms_available as string[]).length === 0) &&
                            !getEffective(rowKey, r, "sourcing_firm") && (
                              <span
                                className="ml-1.5 inline-block rounded-sm bg-destructive/15 text-destructive px-1 text-[9px] align-middle"
                                title="No firms detected for this product — type a sourcing firm"
                              >
                                set firm
                              </span>
                            )}
                          {/* Per-row reset (drafts + saved overrides) */}
                          {i === 0 && deleteOverride && (overrode || isDirty) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                resetRow(rowKey);
                              }}
                              className="ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-muted-foreground hover:text-foreground underline align-middle"
                              title="Revert this row to project-data prefill"
                            >
                              reset
                            </button>
                          )}
                        </td>
                      );
                    })}

                    {colGroups.flatMap((g) => {
                      if (collapsed.has(g.family)) {
                        return [
                          <td
                            key={`${rowKey}-${g.family}-collapsed`}
                            className="border-b border-r bg-muted/10"
                          />,
                        ];
                      }
                      return g.cols.map((col) => {
                        const rowDraft = drafts[rowKey] ?? {};
                        const eff = rowEffective.get(rowKey);
                        // per-row gating: hide cells whose policy choice doesn't apply
                        const isVisibleForRow = !col.visibleWhen || col.visibleWhen({
                          fulfillmentStrategy,
                          row: r,
                          draft: rowDraft,
                          effective: eff,
                        });
                        if (!isVisibleForRow) {
                          return (
                            <td
                              key={col.field}
                              className="border-b border-r p-0 min-w-[120px] bg-muted/10 text-center text-[10px] text-muted-foreground/40"
                              title="Not applicable for the current policy choice"
                            >
                              —
                            </td>
                          );
                        }
                        const cellValue = getEffective(rowKey, r, col.field);
                        // Master-backed columns: value from the item master, with
                        // the engine's derived fallback (≈) shown when unset.
                        const masterSet = col.master ? masterValueFor(col, r) !== undefined : false;
                        const derivedVal = col.master && !masterSet ? derivedValueFor(col, r) : undefined;
                        // live default = bundle value > spec.defaultWhenMissing > family raw default
                        const bundleVal = eff?.[col.field];
                        const liveDefault = col.master
                          ? derivedVal ?? 0
                          : bundleVal !== undefined
                            ? bundleVal
                            : col.defaultWhenMissing !== undefined
                            ? col.defaultWhenMissing
                            : getDefault(col.field, col.family);
                        const edited = rowDraft[col.field] !== undefined;
                        // Provenance maps emitted by useStageRows for project-backed fields.
                        const fromDataMap = (r.__from_data ?? {}) as Record<string, true>;
                        const imputedMap = (r.__imputed ?? {}) as Record<string, true>;
                        const tracked = col.field in fromDataMap || col.field in imputedMap;
                        const imputed = !edited && !col.master && imputedMap[col.field] === true;
                        const fromData =
                          !edited &&
                          !imputed &&
                          (col.master
                            ? masterSet
                            : tracked
                            ? fromDataMap[col.field] === true
                            : r[col.field] !== undefined && r[col.field] !== null);
                        const derivedFallback =
                          !edited && !!col.master && !masterSet && derivedVal !== undefined;
                        const fromOverride =
                          !edited && !imputed && !fromData && !col.master && overrides.some(
                            (o) => o.target_key === rowKey && o.family === col.family && col.field in (o.patch ?? {}),
                          );
                        const dotClass = edited
                          ? "bg-primary"
                          : imputed
                          ? "bg-destructive"
                          : fromData
                          ? "bg-sky-500"
                          : derivedFallback
                          ? "bg-amber-500"
                          : fromOverride
                          ? "bg-emerald-500"
                          : null;
                        const dotTitle = edited
                          ? "Edited"
                          : imputed
                          ? "Imputed project average — verify"
                          : fromData
                          ? col.master
                            ? "From item master"
                            : "From project data"
                          : derivedFallback
                          ? "Derived fallback (≈) — engine computes this from your inbound/outbound uploads"
                          : fromOverride
                          ? "Saved override"
                          : "Bundle default";
                        return (
                          <td
                            key={col.field}
                            className={cn(
                              "border-b border-r p-0 min-w-[120px] group-hover:bg-accent/30 relative",
                              edited && "bg-primary/10",
                            )}
                          >
                            {dotClass && (
                              <span
                                className={cn("absolute top-0.5 right-0.5 h-1 w-1 rounded-full", dotClass)}
                                aria-hidden
                                title={dotTitle}
                              />
                            )}
                            <ValueCell
                              spec={col}
                              value={cellValue}
                              defaultValue={liveDefault}
                              firmsAvailable={r.__firms_available as string[] | undefined}
                              onChange={(v) => onCellChange(rowKey, col.field, v)}
                            />

                          </td>
                        );
                      });
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
        </div>
        {dirtyKeys.length > 0 && (
          <div className="sticky bottom-0 left-0 right-0 z-30 flex items-center justify-end gap-2 border-t bg-card/95 backdrop-blur px-3 py-2">
            <span className="text-[11px] text-muted-foreground mr-auto">
              {dirtyKeys.length} row(s) with unsaved changes
            </span>
            <Button size="sm" variant="ghost" className="h-8" onClick={revertAll}>
              Revert
            </Button>
            <Button size="sm" className="h-8" onClick={saveAll}>
              Save changes
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmPrefill} onOpenChange={setConfirmPrefill}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply prefill to all rows?</AlertDialogTitle>
            <AlertDialogDescription>
              This saves the project-data prefill values (plus any unsaved edits) as real
              rows for every resolved row in this stage. Rows still missing a supplier or a
              primary source are skipped. You can still edit any value afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void applyPrefill();
              }}
              disabled={applying}
            >
              {applying ? "Applying…" : "Apply prefill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmResetAll} onOpenChange={setConfirmResetAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all saved overrides in this stage?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {stageOverrides.length} saved override(s) for the rows in this stage.
              The grid falls back to your uploaded project data and the bundle defaults — use it
              to clear stale values (e.g. zeros frozen by an earlier auto-prefill). Uploaded
              data and item masters are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void resetAllOverrides();
              }}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Reset overrides"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
