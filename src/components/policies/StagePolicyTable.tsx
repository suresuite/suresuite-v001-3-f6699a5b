import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LAYER, MonoChip, Toggle, tint } from "@/components/intelligence/piUi";
import {
  CellSegmented,
  FamilyBand,
  FamilyChip,
  NumCell,
  ProvenanceDotButton,
  POLICY_TYPE_OPTIONS,
  ProvenanceDot,
  ProvenanceLegend,
  ReplenishmentCell,
  RowFlag,
  SortHeader,
  rowAccent,
  type Provenance,
} from "./policyGridUi";
import {
  specFor,
  familiesForStage,
  fitColsForStage,
  vectorParamCols,
  flattenBundle,
  type ColSpec,
  type ColSpecCtx,
} from "@/lib/policies/columnSpecs";
import { fitColumns, foldNote, type FitCol } from "@/lib/policies/columnFit";
import { groupByKeyA, summarise } from "@/lib/policies/groupRows";
import { ENUM_OPTIONS, SCSIM_ENUM_OPTIONS, type FulfillmentStrategy, type PolicyBundle, type PolicyFamily } from "@/lib/policies/schemas";
import { effectivePolicy, type OverrideRow } from "@/lib/policies/resolve";
import {
  masterValueFor as masterValueForShared,
  derivedValueFor as derivedValueForShared,
  getEffectiveValue as getEffectiveValueShared,
  isPrefillPersistable,
  resolveCell,
  substitutionNote,
} from "@/lib/policies/resolveEffective";
import { policyTypeLabel, inventoryParamsForType, paramFeasibility } from "@/lib/policies/registryPolicyTypes";
import { groupHasPrimary as groupHasPrimaryFor, groupKeyFor, lineNeedsInput } from "@/lib/policies/stageGuards";
import { ParameterSheet } from "./ParameterSheet";
import { supabase } from "@/integrations/supabase/client";
import { fetchProjectLanes } from "@/lib/policies/projectLanes";
import { useAuth } from "@/hooks/useAuth";
import { ValueChainPopover, type ValueChainTarget } from "@/components/policies/ValueChainPopover";
import { sourceFor } from "@/lib/trust/valueChain";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useItemMasters, type ItemMasterTable } from "@/hooks/useItemMasters";
import { useDerivedMaps } from "@/hooks/useDerivedMaps";
import { useDatasetVersion } from "@/hooks/useDatasetVersion";
import { useTimeUnit } from "@/hooks/useTimeUnit";
import type { StageRowsQuery } from "@/hooks/useStageGuards";
import type { StageKey } from "@/lib/policies/stages";

interface Props {
  projectId: string | null | undefined;
  plantName: string | null | undefined;
  stageKey: StageKey;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: FulfillmentStrategy;
  /**
   * WP 6.3 · THE OPTIONS ARGUMENT WAS MISSING FROM THIS TYPE, AND ITS LAZY FIX
   * WOULD HAVE BEEN A SILENT DATA DEFECT.
   *
   * `usePolicies` declares `(rows, opts?: { seeded?: boolean })`; this prop
   * declared one parameter, so line 936's `bulkUpsertOverrides(toUpsert,
   * { seeded: true })` was a type error — baselined as debt on this surface.
   *
   * `{ seeded: true }` is WP 4.4's `seeded_from_hash`: the flag that makes a
   * prefilled override report itself STALE after a re-upload, because the engine
   * reads overrides rather than the grid. Deleting the second argument would have
   * made the error go away and stopped that flag being stamped — a green
   * typecheck bought by turning off D70's staleness machinery. The type widens to
   * match the hook instead.
   */
  bulkUpsertOverrides: (rows: OverrideRow[], opts?: { seeded?: boolean }) => Promise<void>;
  deleteOverride?: (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => Promise<void>;
  /** Save a policy version snapshot — offered after saving grid edits. */
  saveSnapshot?: (label?: string) => Promise<string | null>;
  leftActions?: React.ReactNode;
  /** The stage's lines, loaded once at the page level (see useStageGuards). */
  stageRows: StageRowsQuery;
}

type RowDraft = Record<string, unknown>;

// Grid actions live on the left of the toolbar — keep the pointer's travel to
// their confirmation short.
const TOAST = { position: "bottom-left" } as const;

// Canonical ordering for family bands.
const FAMILY_ORDER: PolicyFamily[] = [
  "sourcing",
  "inventory",
  "transport",
  "production",
  "fulfillment",
  "demand",
];

/**
 * Frozen key-column widths, by viewport breakpoint (the ids carry the row's
 * identity). Both the `<col>` and the sticky `left` offset read the same
 * constant — never hard-code one and derive the other (columnFit.ts §0.2).
 */
const KEY_W = {
  wide: { a: 168, b: 132 }, // ≥1280
  mid: { a: 148, b: 116 }, // ≥1024
  narrow: { a: 132, b: 104 }, // <1024
} as const;

function keyWidthsFor(winWidth: number): { a: number; b: number } {
  if (winWidth >= 1280) return KEY_W.wide;
  if (winWidth >= 1024) return KEY_W.mid;
  return KEY_W.narrow;
}

/** Short segmented labels for the inventory Policy Type (titles stay the
 *  registry library's own labels — "Min-max (s, S)", "(R, Q)", …). */
const POLICY_TYPE_SHORT: Record<string, string> = Object.fromEntries(
  POLICY_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

type CellKind = "readonly" | "segmented" | "select" | "toggle" | "number" | "text";

/** Supabase errors are plain objects, not Error instances — extract either. */
function errMsg(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown })?.message;
  return typeof m === "string" && m ? m : fallback;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `fitColsForStage` reruns on every draft edit (drafts is in its deps via
 * rowCtxs), but the resolved *set* of visible columns only changes when an
 * edit actually flips a `visibleWhen` gate — not on every keystroke. Columns
 * are drawn from the static ColSpec definitions, so two calls describe the
 * same layout iff their `.key`s match in order. Reusing the previous
 * reference here lets `fit`, `bandGroups`, `visible` and `folded` below skip
 * recomputation on the vast majority of edits, which don't affect layout.
 */
function useStableColumnList(cols: FitCol[]): FitCol[] {
  const ref = useRef(cols);
  const prev = ref.current;
  const same =
    prev.length === cols.length && prev.every((c, i) => c.key === cols[i].key);
  if (!same) ref.current = cols;
  return ref.current;
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
  stageRows,
}: Props) {
  const spec = specFor(stageKey);
  const families = familiesForStage(stageKey);
  const { rows: dataRows, loading, fallback, reload: reloadRows } = stageRows;
  const { adaptLabel } = useTimeUnit(projectId);
  const { user } = useAuth();
  const { selectedProject } = useGlobalProject();

  // Item masters back the economics columns (ColSpec.master): the grid shows
  // and edits materials.cost / products.sell_price / production_capacity /
  // demand_mean directly, with the engine's derived fallback (≈) when unset.
  const {
    materials,
    products,
    suppliers,
    derived: derivedEconomics,
    lanes,
    saveRows,
    error: mastersError,
  } = useItemMasters(projectId);
  // The economics maps plus the capacity chain, which needs the bundle and its
  // overrides as well as the lanes — assembled by the one hook both grid
  // surfaces call, never per surface (§4 D167).
  const derived = useDerivedMaps({
    derived: derivedEconomics,
    products,
    outbound: lanes.outbound,
    defaults,
    overrides,
  });
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
  // masterValueFor/derivedValueFor/getEffective delegate to
  // lib/policies/resolveEffective.ts — the single source of truth also used
  // by MobileStagePolicyList, so the two surfaces cannot disagree about a
  // line's own resolved value.
  const masterValueFor = (col: ColSpec, r: Record<string, unknown>): number | undefined =>
    masterValueForShared(col, r, masterRowById);
  // Suppliers the user can assign to an "(unassigned supplier)" material:
  // the suppliers master plus every supplier already sourcing in this stage.
  const knownSuppliers = useMemo(() => {
    const set = new Set<string>(suppliers.map((s) => s.supplier_id));
    for (const r of dataRows) {
      const sid = String((r as Record<string, unknown>).supplier_id ?? "");
      if (sid && !sid.startsWith("(")) set.add(sid);
    }
    return [...set].sort();
  }, [suppliers, dataRows]);
  const [assigning, setAssigning] = useState<string | null>(null);
  // Inline "new supplier" input state (per material row).
  const [newSupplierFor, setNewSupplierFor] = useState<string | null>(null);
  const [newSupplierId, setNewSupplierId] = useState("");
  const assignSupplier = async (materialId: string, supplierId: string) => {
    if (!projectId || !user) return;
    setAssigning(materialId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      // Fast path: the dedicated RPC (creates lane + edge + supplier master).
      const { error } = await sb.rpc("assign_material_supplier", {
        p_project_id: projectId,
        p_material_id: materialId,
        p_supplier_id: supplierId,
        p_user_id: user.id,
        p_user_email: user.email,
      });
      if (error) throw error;
      toast.success(`Assigned ${supplierId} to ${materialId}`, TOAST);
      reloadRows();
    } catch (rpcErr) {
      // Fallback: the upload pipeline that provably works in every deployed
      // environment (same edge function the Data Manager uploads use), then a
      // combine so the supply-chain edge list picks the pair up.
      try {
        // The ingest edge function validates plant_name against the PROJECT
        // record (projects.plant_name) — which can differ from the plant name
        // stamped on older data rows. Prefer the project's registered plant,
        // then the page prop, then any existing lane as last resort.
        let plant =
          (selectedProject?.id === projectId ? selectedProject?.plant_name : null) ||
          (plantName && plantName !== "Focal plant" ? plantName : null);
        if (!plant) {
          const lanes = await fetchProjectLanes(projectId, user);
          plant = String(
            lanes.inbound[0]?.plant_name ?? lanes.outbound[0]?.plant_name ?? "",
          ) || null;
        }
        if (!plant) throw new Error("could not resolve the project's plant name");
        const { data, error: edgeErr } = await supabase.functions.invoke("ingest-inbound-logistics", {
          body: {
            rows: [{
              project_id: projectId,
              plant_name: plant,
              supplier_id: supplierId,
              material_id: materialId,
              volume: null,
              time_unit: null,
              lead_time: null,
              unit_price: null,
            }],
            userId: user.id,
            userEmail: user.email,
          },
        });
        if (edgeErr) {
          // FunctionsHttpError hides the response body — surface the real
          // error message the edge function returned.
          let detail = errMsg(edgeErr, "edge function failed");
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body = await (edgeErr as any).context?.json?.();
            if (body?.error) detail = String(body.error);
          } catch { /* keep generic message */ }
          throw new Error(detail);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((data as any)?.success === false) {
          throw new Error(String((data as { error?: string })?.error ?? "upload failed"));
        }
        await sb.rpc("combine_project_into_supply_chain", {
          p_project_id: projectId,
          p_user_id: user.id,
          p_user_email: user.email,
        });
        toast.success(`Assigned ${supplierId} to ${materialId}`, TOAST);
        reloadRows();
      } catch (fallbackErr) {
        const msg = (e: unknown) => (e as { message?: string })?.message ?? String(e);
        toast.error(`Failed to assign supplier: ${msg(rpcErr)} · fallback: ${msg(fallbackErr)}`, TOAST);
      }
    } finally {
      setAssigning(null);
    }
  };

  const derivedValueFor = (col: ColSpec, r: Record<string, unknown>): number | undefined =>
    derivedValueForShared(col, r, derived);

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

  // Fit/render metadata for the header union (columnFit.ts, joined by field).
  const fitColsRaw = useMemo(() => fitColsForStage(stageKey, rowCtxs), [stageKey, rowCtxs]);
  const fitCols = useStableColumnList(fitColsRaw);

  // Every family that has at least one column at this stage, in canonical
  // order — independent of fold/collapse state, so the toolbar always offers
  // every family a chip.
  const familiesPresent = useMemo(() => {
    const set = new Set<PolicyFamily>();
    for (const c of fitCols) set.add(c.family);
    return FAMILY_ORDER.filter((f) => set.has(f));
  }, [fitCols]);

  // Per-stage collapsed family set persisted in localStorage.
  const collapseKey = `policy.table.collapsed.${stageKey}`;
  // 6.B — per-parameter transparency side-sheet (opened from a column header).
  const [paramSheetCol, setParamSheetCol] = useState<ColSpec | null>(null);

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
  const collapsedFamilies = useMemo(
    () => Object.fromEntries([...collapsed].map((f) => [f, true])),
    [collapsed],
  );

  // Row-group collapse (§5) — a material's suppliers, a plant's products, a
  // customer's product lanes. State resets per stage on purpose (§5 note).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => {
    setCollapsedGroups((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Responsive chrome: the frozen key-column breakpoint and the family
  // summary column's narrow variant both key off the viewport, not the grid
  // container (columnFit.ts §3.1 / §1 narrow flag).
  const [winWidth, setWinWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const keyW = keyWidthsFor(winWidth);
  const narrowFamily = winWidth < 860;

  // Fit-fold: `enabled=false` means "show all columns", scrolling
  // horizontally instead of folding. Observe the scroll container's
  // offsetWidth (not clientWidth — that shrinks when a vertical scrollbar
  // appears, which the fold itself can cause, oscillating).
  const [fitEnabled, setFitEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const avail = Math.max(0, containerW - 2 - 24 - keyW.a - keyW.b);
  const fit = useMemo(
    () =>
      fitColumns({
        cols: fitCols,
        avail,
        collapsedFamilies,
        enabled: fitEnabled,
        narrow: narrowFamily,
      }),
    [fitCols, avail, collapsedFamilies, fitEnabled, narrowFamily],
  );
  const { visible, folded, fills } = fit;
  const totalCols = visible.length + folded.length;

  // Band groups: contiguous same-family runs of the currently visible
  // columns (declaration order already groups by family, so a partial fold
  // never interleaves two families).
  const bandGroups = useMemo(() => {
    const out: { family: PolicyFamily; cols: FitCol[] }[] = [];
    for (const c of visible) {
      const last = out[out.length - 1];
      if (last && last.family === c.family) last.cols.push(c);
      else out.push({ family: c.family, cols: [c] });
    }
    return out;
  }, [visible]);

  // Frozen key columns: cumulative left offsets from the breakpoint widths.
  const keyWidths = [keyW.a, keyW.b];
  const keyLeft = (i: number) => (i === 0 ? 0 : keyW.a);
  const keyTotal = keyW.a + keyW.b;
  const tableMinWidth = keyTotal + fit.valueWidth;

  // Reset drafts + filters/sort/group-collapse when stage / project changes.
  useEffect(() => {
    setDrafts({});
    setColFilters({});
    setSort(null);
    setCollapsedGroups(new Set());
  }, [stageKey, projectId]);

  /** Effective value lookup: data prefill → override → default.
   *  Master-backed columns resolve draft → item-master value → derived fallback.
   *  `family` is the column's declared family: when a field name is shared across
   *  families, resolve it from the column's OWN family first so the value matches
   *  the header (otherwise the flattened first-wins order could show a sibling
   *  family's value under the wrong label). */
  const getEffective = (
    rowKey: string,
    dataRow: Record<string, unknown>,
    field: string,
    family?: PolicyFamily,
  ): unknown =>
    getEffectiveValueShared({
      rowKey,
      dataRow,
      field,
      family,
      families,
      draft: drafts[rowKey]?.[field],
      masterColByField,
      masterRowById,
      derived,
      defaults,
      overrides,
      scope: spec.scope,
    });

  const getDefault = (field: string, family: PolicyFamily): unknown =>
    ((defaults[family] ?? {}) as Record<string, unknown>)[field];

  /** Saved-state + draft resolver shared with the step track's guardrail. */
  const resolveForGuard = (row: Record<string, unknown>, field: string): unknown =>
    getEffective(String(row.key), row, field);

  // Full field→col map (includes vectorized inventory params hidden from the
  // header) so save/prefill can resolve a param's family even though it renders
  // inside the "Replenishment parameters" vector cell rather than its own column.
  const specColByField = useMemo(() => {
    const m = new Map<string, ColSpec>();
    for (const c of specFor(stageKey).cols) m.set(c.field, c);
    return m;
  }, [stageKey]);

  // The type-specific inventory params grouped into the per-row vector cell.
  const invParamColByField = useMemo(() => {
    const m = new Map<string, ColSpec>();
    for (const c of vectorParamCols(stageKey)) m.set(c.field, c);
    return m;
  }, [stageKey]);

  /** Enum choices for a column, with the registry's own labels for Policy Type. */
  const enumOptionsFor = (
    col: ColSpec,
  ): Array<{ value: string; label: string; title?: string }> | null => {
    const opts = SCSIM_ENUM_OPTIONS[col.field] ?? ENUM_OPTIONS[col.field];
    if (!opts) return null;
    if (col.field === "type" && col.family === "inventory") {
      return opts.map((o) => ({
        value: o,
        label: POLICY_TYPE_SHORT[o] ?? o,
        title: policyTypeLabel("inventory", o),
      }));
    }
    return opts.map((o) => ({ value: o, label: o }));
  };

  /**
   * The dynamic "Replenishment parameters" cell (§II.3): only the params the
   * row's chosen policy type needs, each as symbol + input. The per-row Policy
   * Basis control is hidden while the line uses the default basis — it repeated
   * identically on every line.
   */
  const renderInvParamsCell = (rowKey: string, r: Record<string, unknown>, paramW?: number) => {
    const type = String(getEffective(rowKey, r, "type", "inventory") ?? "min_max");
    const regParams = inventoryParamsForType(type).filter((p) => p.field !== "basis");
    const basis = String(getEffective(rowKey, r, "basis", "inventory") ?? "days_of_supply");
    return (
      <ReplenishmentCell
        policyType={type}
        paramW={paramW}
        params={regParams.map((p) => {
          const value = getEffective(rowKey, r, p.field, "inventory");
          const n = typeof value === "number" ? value : value == null ? undefined : Number(value);
          return {
            field: p.field,
            value: n !== undefined && Number.isFinite(n) ? n : undefined,
            onCommit: (v: number | undefined) => onCellChange(rowKey, p.field, v),
            invalid: paramFeasibility(p, value ?? undefined) ?? undefined,
          };
        })}
        labelFor={(f) => adaptLabel(invParamColByField.get(f)?.label ?? f)}
        basis={basis as "days_of_supply" | "forward_visible"}
        onBasisChange={(b) => onCellChange(rowKey, "basis", b)}
      />
    );
  };

  // Detect whether a row currently has any existing override (vs default).
  const hasOverride = (rowKey: string): boolean =>
    overrides.some((o) => o.target_key === rowKey);

  /** Comparable cell value for any column (key col or value col). */
  const cellValueFor = (r: Record<string, unknown>, colId: string): unknown => {
    if (spec.keyCols.some((c) => c.id === colId)) return r[colId];
    const spec2 = specFor(stageKey).cols.find((c) => c.field === colId);
    if (spec2?.synthetic) return ""; // vector cell — not sortable/filterable
    return getEffective(String(r.key), r, colId, spec2?.family);
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

  // Row-group collapse (§5): consecutive runs sharing key A — a material's
  // suppliers, a plant's products, a customer's product lanes. An active sort
  // that scrambles key-A order degrades gracefully to singleton "groups",
  // which simply offer nothing to collapse.
  const rowGroups = useMemo(
    () => groupByKeyA(filtered as Record<string, unknown>[], spec.keyCols[0]?.id ?? ""),
    [filtered, spec.keyCols],
  );
  const collapsibleGroups = useMemo(() => rowGroups.filter((g) => g.members.length > 1), [rowGroups]);
  const anyGroupExpanded = collapsibleGroups.some((g) => !collapsedGroups.has(`${stageKey}::${g.id}`));
  const toggleAllGroups = () => {
    if (anyGroupExpanded) {
      setCollapsedGroups((cur) => {
        const next = new Set(cur);
        for (const g of collapsibleGroups) next.add(`${stageKey}::${g.id}`);
        return next;
      });
    } else {
      setCollapsedGroups((cur) => {
        const next = new Set(cur);
        for (const g of collapsibleGroups) next.delete(`${stageKey}::${g.id}`);
        return next;
      });
    }
  };

  const dirtyKeys = Object.keys(drafts).filter((k) => Object.keys(drafts[k] ?? {}).length > 0);

  const onCellChange = (rowKey: string, field: string, v: unknown) => {
    setDrafts((d) => {
      const next: Record<string, RowDraft> = {
        ...d,
        [rowKey]: { ...(d[rowKey] ?? {}), [field]: v },
      };
      // Mutual exclusion: only one primary per material / per (customer, product).
      if (field === "primary_source" && v === true) {
        const me = dataRows.find((row) => row.key === rowKey);
        const gk = me ? groupKeyFor(stageKey, me as Record<string, unknown>) : null;
        if (gk) {
          for (const other of dataRows) {
            if (other.key === rowKey) continue;
            if (groupKeyFor(stageKey, other as Record<string, unknown>) !== gk) continue;
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
        // Resolve from the FULL spec (not the header union) so vectorized
        // inventory params — which render inside the vector cell, not their own
        // column — still save under their family.
        const col = specColByField.get(field);
        if (!col || col.synthetic) continue;
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
        // ── "EQUAL TO THE DEFAULT" IS NOT ALWAYS A NO-OP (§4 D23) ──────────
        //
        // Skipping an edit that matches the family default keeps the bundle
        // clean: an override restating the default is noise, and writing one is
        // how §4 D1 froze decisions nobody made. But it is only a no-op when the
        // default is what the cell would SHOW after the skip, and there are two
        // cases where it is not:
        //
        //   · a saved override already carries a different value for this field,
        //     so dropping the edit leaves the STALE override in place. Setting
        //     `primary_source` back to `false` looked saved and reloaded as
        //     `true`, because `false` is the schema default (`schemas.ts:81`).
        //   · the field is a routing DECISION, so the row's own suggestion is
        //     what shows when no override exists — not the default. Un-checking
        //     the suggested primary wrote nothing and changed nothing.
        //
        // Both are the same user action — un-checking a primary supplier — and
        // it was unsaveable either way.
        const overridden = overrides.some(
          (o) => o.target_key === rowKey && o.family === col.family && field in (o.patch ?? {}),
        );
        const isDecision = ((dataRow?.__decided ?? {}) as Record<string, true>)[field] === true;
        if (isEqual(v, def) && !overridden && !isDecision) continue;
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
      toast.info("No effective changes to save.", TOAST);
      return;
    }
    const masterTablesToSave = (["materials", "products", "suppliers"] as ItemMasterTable[]).filter(
      (t) => masterMerged[t].size > 0,
    );
    if (masterTablesToSave.length > 0 && mastersError) {
      // Don't pretend: if the masters failed to load (missing table/RPC in
      // this environment), a save would clobber unseen data or fail anyway.
      toast.error(`Cannot save master data — item masters failed to load: ${mastersError}`, TOAST);
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
      toast.error(errMsg(e, "Failed to save changes"), TOAST);
      return;
    }
    setDrafts({});
    // Offer to capture the edit as a version right away: master edits are
    // dataset state (dataset_versions), override edits are policy state
    // (policy version snapshot) — runs bind to both.
    const savedMasters = masterRowCount > 0;
    const savedOverrides = toUpsert.length > 0;
    toast.success(`Saved ${dirtyKeys.length} line(s)`, {
      ...TOAST,
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
              toast.success("Version saved", TOAST);
            } catch (e) {
              toast.error(errMsg(e, "Failed to save version"), TOAST);
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
  /** A prefill has run for the current (project, stage) — see `dataBannerState`. */
  const [prefillSettled, setPrefillSettled] = useState(false);
  useEffect(() => {
    setPrefillSettled(false);
  }, [projectId, stageKey]);

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
      toast.success(`Removed ${stageOverrides.length} saved override(s)`, TOAST);
    } catch (e) {
      toast.error(errMsg(e, "Failed to reset overrides"), TOAST);
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
  const applyPrefill = async (opts: { silent?: boolean } = {}) => {
    // Armed BEFORE the row loop, not after it: the auto-seed effect below
    // re-runs on every `dataRows` identity change, and with the flag raised
    // only at the upsert it had an open window to re-enter and seed twice.
    setApplying(true);
    try {
      await runPrefill(opts);
    } finally {
      setApplying(false);
      setConfirmPrefill(false);
    }
  };

  const runPrefill = async ({ silent = false }: { silent?: boolean }) => {
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
      // Iterate the FULL spec (incl. vectorized inventory params rendered in the
      // vector cell), honoring each col's per-row gate so only params the row's
      // policy type actually uses are persisted.
      for (const col of specFor(stageKey).cols) {
        if (col.synthetic || col.readOnly) continue;
        // Master-backed fields live in the item masters, never in overrides.
        if (col.master) continue;
        if (
          col.visibleWhen &&
          !col.visibleWhen({
            fulfillmentStrategy,
            row: r,
            draft: drafts[rowKey],
            effective: rowEffective.get(rowKey),
          })
        )
          continue;
        // D1 — persist ONLY what the project data or the user actually says;
        // never a value that would come from a default. Imputed averages stay
        // excluded. The rule is `isPrefillPersistable`, unit-tested.
        if (!isPrefillPersistable(r, col.field, (drafts[rowKey] ?? {})[col.field]))
          continue;
        // draft → project-data prefill → effective default
        const v = getEffective(rowKey, r, col.field, col.family);
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
      // Nothing the uploaded data can answer for this stage's columns. Say so
      // in the banner rather than leaving "uploaded data not applied" standing
      // over a stage where there is nothing left to apply.
      setPrefillSettled(true);
      if (!silent) toast.info("Nothing to persist", TOAST);
      return;
    }
    // WP 4.4 · SEEDED. These values are copies of numbers the project's data had
    // at this moment, not decisions somebody made, so the RPC stamps
    // `seeded_from_hash` and a later re-upload reports them stale. The engine
    // reads overrides rather than the grid, so that flag is what stops a run
    // silently using a number the project no longer holds.
    await bulkUpsertOverrides(toUpsert, { seeded: true });
    setDrafts({});
    setPrefillSettled(true);
    if (!silent)
      toast.success(
        `Persisted prefill for ${written} line(s)` + (skipped > 0 ? ` · ${skipped} skipped` : ""),
        TOAST,
      );
  };

  // Auto-seed: project data loaded for the first time with no existing overrides.
  // The marker is a SET, not one slot: holding a single `${projectId}::${stageKey}`
  // meant a supplier → plant → supplier tab round trip overwrote the supplier
  // marker with the plant one, so returning to supplier re-seeded it.
  const autoSeededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const marker = `${projectId}::${stageKey}`;
    if (autoSeededRef.current.has(marker)) return;
    if (loading || applying || dataRows.length === 0) return;
    if (!hasRealProjectData || hasOverridesForStage) return;
    autoSeededRef.current.add(marker);
    // An effect body cannot await; it does not need to. `applyPrefill` raises
    // `applying` synchronously before it touches a row, and this effect's own
    // guard reads it, so the whole write is covered. The seed is silent — the
    // user did not ask for it, so it does not toast.
    void applyPrefill({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, applying, dataRows, hasRealProjectData, hasOverridesForStage]);

  // Banner state: derived from project data presence + override existence.
  const dataBannerState = useMemo(():
    | "no_data"
    | "seeding"
    | "seeded"
    | "none_applicable"
    | "pending" => {
    if (!hasRealProjectData) return "no_data";
    if (applying) return "seeding";
    if (hasOverridesForStage) return "seeded";
    // Prefill has run and the uploaded data had nothing to say about any of
    // this stage's columns. "Not applied" would be a standing instruction to
    // press a button that does nothing.
    if (prefillSettled) return "none_applicable";
    return "pending";
  }, [hasRealProjectData, applying, hasOverridesForStage, prefillSettled]);

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
    if (rowOverrides.length > 0) toast.success("Reverted to project data", TOAST);
  };

  /** Does the primary-source group for this row already have a chosen primary? */
  const groupHasPrimary = (r: Record<string, unknown>): boolean =>
    groupHasPrimaryFor(stageKey, r, dataRows as Record<string, unknown>[], resolveForGuard);

  /** Line needs the user's input — the same rule the step track counts. */
  const rowNeedsAttention = (r: Record<string, unknown>): boolean =>
    lineNeedsInput(stageKey, r, dataRows as Record<string, unknown>[], resolveForGuard);

  const imputedLines = useMemo(
    () =>
      dataRows.filter(
        (r: any) => r.__imputed && Object.keys(r.__imputed).length > 0,
      ).length,
    [dataRows],
  );

  /** Which control a column's value renders as. */
  const kindOf = (
    col: ColSpec,
    opts: ReturnType<typeof enumOptionsFor>,
    firms: string[] | undefined,
    value: unknown,
    liveDefault: unknown,
  ): CellKind => {
    if (col.readOnly) return "readonly";
    if (col.field === "sourcing_firm" && firms && firms.length > 0)
      return firms.length <= 4 ? "segmented" : "select";
    if (opts) return opts.length <= 4 ? "segmented" : "select";
    if (typeof liveDefault === "boolean" || typeof value === "boolean") return "toggle";
    // A master column whose empty state is DECLARED has `liveDefault ===
    // undefined` by construction (§4 D17 — the fix is precisely that it no longer
    // invents a `0`), so the numeric probe below cannot see that the column is
    // numeric and the cell would silently become a text input. `nullMeans` is
    // only ever declared on a numeric master column; `columnNullMeans.test.ts`
    // is the gate that keeps that true.
    if (col.master?.nullMeans) return "number";
    if (typeof liveDefault === "number" || typeof value === "number") return "number";
    return "text";
  };

  const colCount = spec.keyCols.length + visible.length;

  /** The outermost column carries no right rule (§0.4) — it would otherwise
   *  spring a permanent 2px horizontal scrollbar. */
  const cellDivider = (isLastCol: boolean): React.CSSProperties => ({
    borderRight: isLastCol ? "none" : "1px solid var(--hair-divider)",
  });

  /** One data row (§5.1 — plain or a group's expanded member). */
  const renderRow = (
    r: Record<string, unknown>,
    groupMeta?: { isFirstOfGroup: boolean; isContinuation: boolean; groupId: string },
  ) => {
    const rowKey = String(r.key);
    const isDirty = (drafts[rowKey] && Object.keys(drafts[rowKey]).length > 0) ?? false;
    const overrode = hasOverride(rowKey);
    const attention = rowNeedsAttention(r);
    // Multi-source pairs stay marked permanently for review, even
    // once a primary is chosen.
    const isMultiSource = Number(r.__lane_count ?? 0) > 1;
    const accent = rowAccent({ edited: isDirty, attention, multiSource: isMultiSource });
    return (
      <tr key={rowKey} className="group">
        {spec.keyCols.map((c, i) => (
          <td
            key={c.id}
            className={cn(
              "sticky z-20 border-b border-r border-[--hair-divider] bg-background px-2 py-[3px] font-mono text-[11px] group-hover:bg-[#fafafa]",
              i === spec.keyCols.length - 1 && "border-r-[--hair-border]",
            )}
            style={{
              left: keyLeft(i),
              width: keyWidths[i],
              minWidth: keyWidths[i],
              maxWidth: keyWidths[i],
              ...(i === 0 && accent ? { borderLeft: `2px solid ${accent}` } : {}),
            }}
          >
            <span className="flex items-center gap-1.5">
              {i === 0 && groupMeta?.isFirstOfGroup && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(groupMeta.groupId);
                  }}
                  className="-m-[14px] box-content grid h-[15px] w-[15px] shrink-0 place-items-center p-[14px] font-mono text-[10px] text-muted-foreground hover:text-foreground md:m-0 md:p-0"
                  title="Collapse this group"
                >
                  ▾
                </button>
              )}
              {i === 0 && groupMeta && !groupMeta.isFirstOfGroup ? (
                // Continuation member of an expanded group: key A repeats the
                // same id as the first member — show ↳ instead of restating it.
                <span
                  className="w-[15px] shrink-0 text-center font-mono text-[10px] text-[#c4c4c4]"
                  title={String(r[c.id] ?? "")}
                >
                  ↳
                </span>
              ) : c.id === "supplier_id" && r.__needs_supplier ? (
                newSupplierFor === rowKey ? (
                  // Typing a brand-new supplier id: Enter confirms,
                  // Escape cancels.
                  <Input
                    autoFocus
                    value={newSupplierId}
                    placeholder="new supplier id"
                    className="h-5 border-[--zinc-border] px-1.5 font-mono text-[11px]"
                    disabled={assigning === String(r.material_id)}
                    onChange={(e) => setNewSupplierId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setNewSupplierFor(null);
                        setNewSupplierId("");
                      }
                      if (e.key === "Enter") {
                        const id = newSupplierId.trim();
                        if (!id || id.startsWith("(")) {
                          toast.warning("Enter a valid supplier id.", TOAST);
                          return;
                        }
                        setNewSupplierFor(null);
                        setNewSupplierId("");
                        void assignSupplier(String(r.material_id), id);
                      }
                    }}
                    onBlur={() => {
                      setNewSupplierFor(null);
                      setNewSupplierId("");
                    }}
                  />
                ) : (
                  // Unassigned material: pick (or create) a supplier —
                  // creates the sourcing lane.
                  <Select
                    disabled={assigning === String(r.material_id)}
                    onValueChange={(v) => {
                      if (v === "__new__") {
                        setNewSupplierFor(rowKey);
                        setNewSupplierId("");
                        return;
                      }
                      void assignSupplier(String(r.material_id), v);
                    }}
                  >
                    <SelectTrigger
                      className="h-5 w-full px-1.5 font-mono text-[10.5px]"
                      style={{ borderColor: LAYER.brand, color: LAYER.brand }}
                    >
                      <SelectValue
                        placeholder={assigning === String(r.material_id) ? "assigning…" : "assign supplier"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__" className="text-xs font-medium">
                        + new supplier
                      </SelectItem>
                      {knownSuppliers.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              ) : (
                <span className="min-w-[62px] flex-1 truncate" title={String(r[c.id] ?? "")}>
                  {String(r[c.id] ?? "")}
                </span>
              )}

              {/* material-level required actions */}
              {i === 0 && r.__needs_supplier && (
                <RowFlag title="This material has no supplier in the project data — assign one in the Supplier column.">
                  needs supplier
                </RowFlag>
              )}
              {/* §4 D175 — the two material classes this stage used to hide. */}
              {i === 0 && r.__in_house && (
                <RowFlag title="Consumed by another BOM item and produced from its own components — modeled through the BOM. There is no supplier to configure; sourcing does not apply to this line.">
                  made in-house
                </RowFlag>
              )}
              {i === 0 && r.__not_in_bom && (
                <RowFlag title="In the item master but in no BOM and no inbound lane. The pre-run check blocks a simulation while such a row exists — assign a supplier lane, add it to the BOM, or remove the master row.">
                  not in BOM
                </RowFlag>
              )}
              {i === 0 &&
                !r.__needs_supplier &&
                Number(r.__lane_count ?? 0) > 1 &&
                !groupHasPrimary(r) && (
                  <RowFlag title="Multiple sources — pick exactly one primary.">pick primary</RowFlag>
                )}
              {c.id === "product_id" && r.__unknown_product && (
                <span
                  title="Not found in BOM"
                  className="shrink-0 rounded-sm px-1 font-mono text-[9px]"
                  style={{ background: tint(LAYER.firm, 0.12), color: LAYER.firm }}
                >
                  !
                </span>
              )}
              {/* "set firm" only when the customer product has no known firms in data. */}
              {i === spec.keyCols.length - 1 &&
                stageKey === "customer" &&
                (!r.__firms_available || (r.__firms_available as string[]).length === 0) &&
                !getEffective(rowKey, r, "sourcing_firm") && (
                  <RowFlag title="No firms detected for this product — type a sourcing firm">set firm</RowFlag>
                )}
              {/* Per-row reset (drafts + saved overrides) */}
              {i === 0 && deleteOverride && (overrode || isDirty) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetRow(rowKey);
                  }}
                  className="shrink-0 font-mono text-[9.5px] text-[#c4c4c4] opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title="Revert this line to project data"
                >
                  ↺
                </button>
              )}
            </span>
          </td>
        ))}

        {visible.map((fc, fi) => {
          const isLastCol = fi === visible.length - 1;
          const width = fills && isLastCol ? undefined : fc.w;
          if (fc.foldedFamily) {
            return (
              <td
                key={fc.key}
                className="border-b bg-[#fcfcfc]"
                style={{ width, minWidth: width, ...cellDivider(isLastCol) }}
              />
            );
          }
          const col = specColByField.get(fc.key);
          if (!col) return null;
          const rowDraft = drafts[rowKey] ?? {};
          const eff = rowEffective.get(rowKey);
          // per-row gating: hide cells whose policy choice doesn't apply
          const isVisibleForRow =
            !col.visibleWhen ||
            col.visibleWhen({ fulfillmentStrategy, row: r, draft: rowDraft, effective: eff });
          if (!isVisibleForRow) {
            return (
              <td
                key={col.field}
                className="border-b p-0 text-center font-mono text-[10px] text-[#dcdcdc]"
                style={{ width, minWidth: width, ...cellDivider(isLastCol) }}
                title="Not applicable for the current policy choice"
              >
                —
              </td>
            );
          }
          // The dynamic "Replenishment parameters" vector cell.
          if (col.synthetic && col.field === "__inv_params") {
            return (
              <td
                key={col.field}
                className="border-b p-0 align-middle group-hover:bg-[#fafafa]"
                style={{ width, minWidth: width, ...cellDivider(isLastCol) }}
              >
                {renderInvParamsCell(rowKey, r, fc.paramW)}
              </td>
            );
          }
          // ONE RESOLVER (WP 6.2). This was a verbatim copy of
          // `resolveEffective.ts::resolveCell` — masterSet, derivedVal,
          // liveDefault, the provenance ladder, all of it — carried in lockstep
          // since WP 0.1 with a comment in each copy telling the reader to
          // change both. That is `single-source` (I1) broken in the one place
          // the product decides what a number MEANS, and D26 is the record of
          // what the shape costs: two implementations of the D1 prefill rule,
          // both unit-tested, one dead, the suite green while only one ran.
          const resolved = resolveCell({
            rowKey,
            row: r,
            col,
            draft: rowDraft[col.field],
            families,
            masterColByField,
            masterRowById,
            derived,
            defaults,
            overrides,
            scope: spec.scope,
            familyDefault: getDefault,
          });
          const {
            cellValue, liveDefault, provenance: prov, edited,
            placeholder: cellPlaceholder, placeholderTitle, supersededBy,
          } = resolved;
          // T1/T2 — one sentence, assembled from the registry's own chain, used
          // by the hover AND by the popover so the two cannot disagree about
          // what stood in for this number (§4 D167).
          const substitution = substitutionNote(resolved);

          const firms = r.__firms_available as string[] | undefined;
          const opts = enumOptionsFor(col);
          const kind = kindOf(col, opts, firms, cellValue, liveDefault);
          const commit = (v: unknown) => onCellChange(rowKey, col.field, v);

          return (
            <td
              key={col.field}
              className="relative overflow-hidden border-b px-1 py-[3px] align-middle group-hover:bg-[#fafafa]"
              style={{
                width,
                minWidth: width,
                ...cellDivider(isLastCol),
                ...(edited ? { background: "rgba(17,17,17,0.04)" } : {}),
              }}
            >
              {kind !== "number" && <ProvenanceDot p={prov} />}

              {kind === "readonly" && (
                <span
                  title={col.engineStatus ? `Activates with ${col.engineStatus.milestone}` : undefined}
                  className="block w-full px-[5px] text-right font-mono text-[11px] tabular-nums text-[#c4c4c4]"
                >
                  {(() => {
                    const raw = cellValue ?? liveDefault;
                    const n = typeof raw === "number" ? raw : null;
                    if (n != null && Number.isFinite(n)) return col.format ? col.format(n) : String(n);
                    return typeof raw === "string" && raw !== "" ? raw : "—";
                  })()}
                </span>
              )}

              {kind === "segmented" && (
                <CellSegmented
                  value={String(
                    cellValue ?? liveDefault ?? (col.field === "sourcing_firm" ? firms?.[0] : opts?.[0]?.value) ?? "",
                  )}
                  options={
                    col.field === "sourcing_firm" && firms
                      ? firms.map((f) => ({ value: f, label: f }))
                      : opts!
                  }
                  onChange={commit}
                />
              )}

              {kind === "select" && (
                <Select value={String(cellValue ?? liveDefault ?? "")} onValueChange={commit}>
                  <SelectTrigger className="h-5 border-transparent bg-transparent px-1.5 font-mono text-[10.5px] hover:bg-[#fafafa]">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {(col.field === "sourcing_firm" && firms
                      ? firms.map((f) => ({ value: f, label: f, title: undefined }))
                      : opts ?? []
                    ).map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.title ?? o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {kind === "toggle" && (
                <span className="flex justify-center">
                  <Toggle
                    checked={typeof cellValue === "boolean" ? cellValue : Boolean(liveDefault)}
                    onChange={commit}
                  />
                </span>
              )}

              {kind === "number" && (() => {
                // A2 (§5.4) — the dot becomes the trigger for the value chain.
                //
                // `sourceFor` names the tier-2 table only for a master-backed
                // column; for everything else it returns null and the popover
                // renders the bundle-resolution chain, which is that cell's TRUE
                // answer rather than a gap (§4 D125 says why the lane columns
                // cannot be named yet).
                const src = sourceFor(col as { field: string; master?: { table: string; field: string } });
                const masterRow = src && col.master
                  ? masterRowById[col.master.table].get(String(r[col.master.idFrom] ?? ""))
                  : undefined;
                const target: ValueChainTarget = {
                  dataset: src?.dataset ?? null,
                  column: src?.column ?? col.field,
                  stage: stageKey,
                  field: col.field,
                  // The masters have carried `source_row_id` since WP 3.3 and
                  // `select("*")` has been returning it with nothing reading it.
                  // This is the reader.
                  sourceRowId: (masterRow as { source_row_id?: string | null } | undefined)?.source_row_id ?? null,
                  projectId: projectId ?? null,
                };
                const shown = cellValue == null ? (cellPlaceholder ?? "—") : String(cellValue);
                return (
                  <NumCell
                    value={(() => {
                      const n = typeof cellValue === "number" ? cellValue : Number(cellValue);
                      return cellValue == null || !Number.isFinite(n) ? undefined : n;
                    })()}
                    provenance={prov}
                    decimals={fc.kind === "num" ? (fc.dec ?? 2) : prov === "derived" ? 2 : undefined}
                    integer={fc.kind === "int"}
                    unit={fc.unit}
                    placeholder={cellPlaceholder}
                    title={substitution ?? placeholderTitle}
                    superseded={!!supersededBy}
                    onCommit={commit}
                    dot={
                      <ValueChainPopover
                        target={target}
                        provenance={prov}
                        displayed={shown}
                        substitution={substitution}
                        superseded={!!supersededBy}
                        userId={user?.id ?? null}
                      >
                        <ProvenanceDotButton p={prov} label={col.label} />
                      </ValueChainPopover>
                    }
                  />
                );
              })()}

              {kind === "text" && (
                <input
                  value={String(cellValue ?? liveDefault ?? "")}
                  onChange={(e) => commit(e.target.value)}
                  className="h-5 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-[5px] font-mono text-[11.5px] outline-none hover:bg-[#fafafa] focus:border-[--zinc-border] focus:bg-background"
                  style={{ boxSizing: "border-box" }}
                  size={1}
                />
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {mastersError && (
        <div
          className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-[11px]"
          style={{ borderColor: tint(LAYER.brand, 0.4), color: LAYER.brand }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER.brand }} />
          item masters unavailable ({mastersError}) — master-data columns cannot be saved
        </div>
      )}

      {/* Toolbar — sticky under the page header so the actions follow the grid.
          `top-[62px]` is desktop's PageHeader height; below `md` the mobile
          header is taller (two-line title + project switcher) and this offset
          would stick the toolbar too high, so the table's own `sticky top-0`
          thead — inside its own scroll container, z-40 — paints over it during
          scroll (the overlap the user hit). Not sticky at all below `md`. */}
      <div className="static z-20 flex flex-wrap items-center gap-2 bg-background py-0.5 md:sticky md:top-[62px]">
        <span className="font-mono text-[11px] text-muted-foreground">
          {filtered.length}/{dataRows.length} lines
        </span>
        {hasActiveQuery && (
          <button
            type="button"
            className="rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-[#fafafa] hover:text-foreground"
            onClick={() => {
              setColFilters({});
              setSort(null);
            }}
          >
            clear filters
          </button>
        )}
        {dirtyKeys.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#f4f4f4] px-1.5 py-px font-mono text-[10px]">
            <span className="h-[5px] w-[5px] rounded-full bg-foreground" />
            {dirtyKeys.length} edited
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {familiesPresent.map((f) => (
            <FamilyChip
              key={f}
              family={f}
              hidden={collapsed.has(f)}
              onToggle={() => toggleFamily(f)}
            />
          ))}
        </div>
        {collapsibleGroups.length > 0 && (
          <button
            type="button"
            onClick={toggleAllGroups}
            className="inline-flex h-[22px] items-center gap-1 rounded-sm border border-[--zinc-border] bg-white px-[7px] font-mono text-[10px] text-muted-foreground hover:text-foreground"
            title={anyGroupExpanded ? "Collapse every group to one summary row" : "Expand every group"}
          >
            {anyGroupExpanded ? "⇕" : "⇔"}{" "}
            {anyGroupExpanded ? `collapse ${collapsibleGroups.length} groups` : `expand ${collapsibleGroups.length} groups`}
          </button>
        )}
        {totalCols > 0 && (
          <button
            type="button"
            onClick={() => setFitEnabled((v) => !v)}
            className="inline-flex h-[22px] items-center gap-1 rounded-sm border border-[--zinc-border] bg-white px-[7px] font-mono text-[10px] text-muted-foreground hover:text-foreground"
            title={
              fitEnabled
                ? "Show every column and scroll horizontally instead of folding"
                : "Fold low-priority columns to fit the box"
            }
          >
            {!fitEnabled
              ? `all ${totalCols} columns · scrolls`
              : folded.length > 0
                ? `${folded.length} folded · ${visible.length}/${totalCols}`
                : `all ${totalCols} columns fit`}
          </button>
        )}
        {dataBannerState === "pending" && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: LAYER.firm }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER.firm }} />
            uploaded data not applied
          </span>
        )}
        {dataBannerState === "seeding" && (
          <span className="font-mono text-[10.5px] text-muted-foreground">seeding from project data…</span>
        )}
        {dataBannerState === "none_applicable" && (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            uploaded data says nothing about these columns — bundle defaults
          </span>
        )}
        {dataBannerState === "no_data" && !loading && (
          <span className="font-mono text-[10.5px] text-muted-foreground">no uploaded data — bundle defaults</span>
        )}
        {fallback && dataRows.length > 0 && (
          <span className="font-mono text-[10.5px]" style={{ color: LAYER.firm }}>
            one line per location — upload logistics + BOM for per-material lines
          </span>
        )}
        <div className="flex-1" />
        {leftActions}
        <Button
          variant="outline"
          size="sm"
          className="h-[26px] px-2.5 text-[11.5px]"
          disabled={dataRows.length === 0 || applying}
          onClick={() => setConfirmPrefill(true)}
        >
          Apply prefill
        </Button>
        {deleteOverride && stageOverrides.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-[26px] px-2.5 text-[11.5px]"
            disabled={resetting}
            onClick={() => setConfirmResetAll(true)}
          >
            Reset overrides {stageOverrides.length}
          </Button>
        )}
        {dirtyKeys.length > 0 && (
          <Button variant="ghost" size="sm" className="h-[26px] px-2.5 text-[11.5px]" onClick={revertAll}>
            Revert
          </Button>
        )}
        <Button
          size="sm"
          className="h-[26px] px-2.5 text-[11.5px]"
          disabled={dirtyKeys.length === 0}
          onClick={saveAll}
        >
          Save changes
        </Button>
      </div>

      {dataRows.length > 0 && <ProvenanceLegend imputedLines={imputedLines} />}

      {/* Nothing folded is hidden silently (§0.5) — name it and say how to get it back. */}
      {fitEnabled && folded.length > 0 && (
        <div className="font-mono text-[10px] text-muted-foreground">
          folded: {folded.slice(0, 4).map((c) => c.label).join(", ")} · {foldNote(folded)}
        </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-[614px] overflow-auto rounded-sm border border-[--hair-border] border-t-2 border-t-foreground [scrollbar-gutter:stable]"
      >
        <table
          className="border-separate border-spacing-0"
          style={{ width: "100%", minWidth: tableMinWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: keyW.a }} />
            <col style={{ width: keyW.b }} />
            {visible.map((c, i) => (
              <col
                key={c.key}
                style={{ width: fills && i === visible.length - 1 ? "auto" : c.w }}
              />
            ))}
          </colgroup>
          <thead>
            {/* Row 1 — family bands. Widths come from the fit, never a fresh
                measurement — the <colgroup> above is the only source (§0.1). */}
            <tr>
              <th
                colSpan={spec.keyCols.length}
                className="sticky left-0 top-0 z-40 h-[23px] border-r border-r-[rgba(255,255,255,0.22)] bg-[--brand-ink] p-0"
                style={{ width: keyTotal, minWidth: keyTotal }}
              />
              {bandGroups.map((g, gi) => {
                const isCollapsed = collapsed.has(g.family);
                const width = g.cols.reduce((a, c) => a + c.w, 0);
                return (
                  <th
                    key={`${g.family}-${gi}`}
                    colSpan={g.cols.length}
                    className="sticky top-0 z-30 h-[23px] bg-[--brand-ink] p-0 align-middle"
                  >
                    <FamilyBand
                      family={g.family}
                      label={isCollapsed ? `${g.family} (folded)` : undefined}
                      width={width}
                      collapsed={isCollapsed}
                      last={gi === bandGroups.length - 1}
                      onToggle={() => toggleFamily(g.family)}
                    />
                  </th>
                );
              })}
            </tr>
            {/* Row 2 — column heads, two lines (label + sub) on one baseline. */}
            <tr>
              {spec.keyCols.map((c, i) => (
                <th
                  key={c.id}
                  className="sticky top-[23px] z-40 bg-[--brand-ink] p-0 align-top"
                  style={{
                    left: keyLeft(i),
                    width: keyWidths[i],
                    minWidth: keyWidths[i],
                  }}
                >
                  <SortHeader
                    label={c.label}
                    dir={sort?.col === c.id ? sort.dir : null}
                    onSort={() => toggleSort(c.id)}
                    filter={colFilters[c.id] ?? ""}
                    onFilter={(v) => setColFilter(c.id, v)}
                  />
                </th>
              ))}
              {visible.map((fc, i) => {
                const isLast = i === visible.length - 1;
                const width = fills && isLast ? undefined : fc.w;
                if (fc.foldedFamily) {
                  return (
                    <th
                      key={fc.key}
                      className="sticky top-[23px] z-30 bg-[--brand-ink] px-2 py-1 text-left font-mono text-[9.5px] text-white/60"
                      style={{ width, minWidth: width, borderRight: isLast ? "none" : "1px solid rgba(255,255,255,0.22)" }}
                    >
                      {fc.foldedFamily} field{fc.foldedFamily === 1 ? "" : "s"} folded
                    </th>
                  );
                }
                const col = specColByField.get(fc.key);
                if (!col) return null;
                if (col.synthetic) {
                  return (
                    <th
                      key={fc.key}
                      className="sticky top-[23px] z-30 bg-[--brand-ink] p-0 align-top"
                      style={{ width, minWidth: width }}
                    >
                      {/* Vector cell anchor: a plain label — its params carry
                          their own meaning inside the cell. */}
                      <div
                        className="flex h-full flex-col items-start justify-center gap-px overflow-hidden px-1.5 py-1 font-mono font-medium uppercase text-white"
                        style={{ borderRight: isLast ? "none" : "1px solid rgba(255,255,255,0.22)" }}
                        title={adaptLabel(fc.label)}
                      >
                        <span className="w-full truncate text-[10px] leading-[1.2] tracking-[0.08em]">
                          {adaptLabel(fc.label)}
                        </span>
                        {fc.sub && (
                          <span className="w-full truncate text-[9px] font-normal normal-case tracking-normal text-white/55">
                            {fc.sub}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                }
                return (
                  <th
                    key={fc.key}
                    className="sticky top-[23px] z-30 bg-[--brand-ink] p-0 align-top"
                    style={{ width, minWidth: width }}
                  >
                    <SortHeader
                      label={adaptLabel(fc.label)}
                      sub={fc.sub}
                      dir={sort?.col === col.field ? sort.dir : null}
                      onSort={() => toggleSort(col.field)}
                      onInfo={() => setParamSheetCol(col)}
                      pending={!!col.engineStatus}
                      quiet={fc.quiet}
                      last={isLast}
                      filter={fc.filterable === false ? undefined : (colFilters[col.field] ?? "")}
                      onFilter={fc.filterable === false ? undefined : (v) => setColFilter(col.field, v)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount} className="py-6 text-center font-mono text-[11px] text-muted-foreground">
                  loading lines…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-8 text-center font-mono text-[11px] text-muted-foreground">
                  no {stageKey === "plant" ? "focal plant" : `${stageKey}`} lines for this project
                </td>
              </tr>
            )}
            {!loading &&
              rowGroups.flatMap((group) => {
                const isCollapsible = group.members.length > 1;
                const groupId = `${stageKey}::${group.id}`;
                const isGroupCollapsed = isCollapsible && collapsedGroups.has(groupId);

                if (!isGroupCollapsed) {
                  return group.members.map((m, mi) =>
                    renderRow(m.row as Record<string, unknown>, {
                      isFirstOfGroup: isCollapsible && mi === 0,
                      isContinuation: isCollapsible && mi > 0,
                      groupId,
                    }),
                  );
                }

                // §5.2 — collapsed group: one summary row, Σ / ø / distinct
                // aggregates per column kind. No provenance dots — they would
                // claim a provenance the aggregate does not have.
                const rows = group.members.map((m) => m.row as Record<string, unknown>);
                const anyFlagged = rows.some((rr) => rowNeedsAttention(rr));
                const flaggedCount = rows.filter((rr) => rowNeedsAttention(rr)).length;
                const accent = anyFlagged ? "#BF2330" : "#171717";
                const keyBLabel =
                  stageKey === "supplier"
                    ? `${rows.length} suppliers`
                    : stageKey === "plant"
                      ? `${rows.length} products`
                      : `${rows.length} lines`;
                return (
                  <tr key={groupId} className="group">
                    <td
                      className="sticky z-20 border-b border-r border-[--hair-divider] bg-[#f7f7f7] px-2 py-[3px] font-mono text-[11px]"
                      style={{
                        left: keyLeft(0),
                        width: keyWidths[0],
                        minWidth: keyWidths[0],
                        maxWidth: keyWidths[0],
                        borderLeft: `2px solid ${accent}`,
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(groupId)}
                          className="-m-[14px] box-content grid h-[15px] w-[15px] shrink-0 place-items-center p-[14px] font-mono text-[10px] text-muted-foreground hover:text-foreground md:m-0 md:p-0"
                          title="Expand this group"
                        >
                          ▸
                        </button>
                        <span className="min-w-0 flex-1 truncate font-medium" title={group.id}>
                          {group.id}
                        </span>
                        {anyFlagged && (
                          <RowFlag title="One or more lines in this group need input">
                            {flaggedCount} open
                          </RowFlag>
                        )}
                      </span>
                    </td>
                    <td
                      className="sticky z-20 border-b border-r border-r-[--hair-border] bg-[#f7f7f7] px-2 py-[3px] font-mono text-[11px] text-muted-foreground"
                      style={{ left: keyLeft(1), width: keyWidths[1], minWidth: keyWidths[1], maxWidth: keyWidths[1] }}
                    >
                      {keyBLabel}
                    </td>
                    {visible.map((fc, fi) => {
                      const isLastCol = fi === visible.length - 1;
                      const width = fills && isLastCol ? undefined : fc.w;
                      if (fc.foldedFamily) {
                        return (
                          <td
                            key={fc.key}
                            className="border-b bg-[#f7f7f7]"
                            style={{ width, minWidth: width, ...cellDivider(isLastCol) }}
                          />
                        );
                      }
                      const col = specColByField.get(fc.key);
                      if (!col) return null;
                      if (col.synthetic) {
                        return (
                          <td
                            key={fc.key}
                            className="border-b bg-[#f7f7f7] px-1.5 py-[3px] font-mono text-[10.5px] text-muted-foreground"
                            style={{ width, minWidth: width, ...cellDivider(isLastCol) }}
                          >
                            per line
                          </td>
                        );
                      }
                      const values = rows.map((rr) => cellValueFor(rr, col.field));
                      const summary = summarise({ kind: fc.kind, dec: fc.dec }, values);
                      const align = fc.align === "left" ? "left" : fc.align === "center" ? "center" : "right";
                      return (
                        <td
                          key={fc.key}
                          className="border-b bg-[#f7f7f7] px-1.5 py-[3px] font-mono text-[10.5px] text-muted-foreground"
                          style={{ width, minWidth: width, textAlign: align, ...cellDivider(isLastCol) }}
                        >
                          {summary}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* §2.7's affordance line — the identifying column freezes (keyLeft
          above), this just says so below `md`, where a table this wide is
          always wider than the viewport. */}
      <p className="mt-1 font-mono text-[10px] text-muted-foreground md:hidden">
        swipe the table sideways for the remaining columns
      </p>

      <AlertDialog open={confirmPrefill} onOpenChange={setConfirmPrefill}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[13px]">Apply prefill to all lines?</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px]">
              Saves the resolved values as overrides. Lines that need input are skipped.
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
            <AlertDialogTitle className="text-[13px]">
              Reset {stageOverrides.length} saved override(s)?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px]">
              The grid falls back to project data + bundle defaults. Uploads and item masters are
              not touched.
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

      {/* 6.B — per-parameter transparency side-sheet. */}
      <ParameterSheet
        col={paramSheetCol}
        open={paramSheetCol !== null}
        onOpenChange={(v) => !v && setParamSheetCol(null)}
      />
    </div>
  );
}
