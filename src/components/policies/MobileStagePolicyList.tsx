// Mobile stage view (spec: mobile users check/verify policy lines, they do
// not configure them there — see docs/mobile-ux-demo-parity-plan.md and the
// user decision this was built from). Replaces StagePolicyTable's editable
// grid + bulk toolbar with a read-only grouped list; tapping a line opens a
// MobileSheet with every field for that line. No filter/sort/export/bulk-edit
// surface exists here at all — those are FocusedStage's `tableLeftActions`,
// which this composition doesn't render.
//
// Value resolution is NOT reimplemented here — resolveCell (lib/policies/
// resolveEffective.ts) is the same function StagePolicyTable itself calls,
// so a line's resolved value and provenance dot can never disagree between
// the two surfaces.
import { useMemo, useState } from "react";
import { LAYER } from "@/components/intelligence/piUi";
import { ProvenanceDot, RowFlag, rowAccent } from "./policyGridUi";
import { MobileSheet } from "@/components/shared/MobileSheet";
import {
  specFor,
  familiesForStage,
  flattenBundle,
  type ColSpec,
  type ColSpecCtx,
} from "@/lib/policies/columnSpecs";
import { groupByKeyA } from "@/lib/policies/groupRows";
import { effectivePolicy, type OverrideRow } from "@/lib/policies/resolve";
import { lineNeedsInput, groupHasPrimary, type ResolveField } from "@/lib/policies/stageGuards";
import { inventoryParamsForType } from "@/lib/policies/registryPolicyTypes";
import {
  resolveCell,
  getEffectiveValue,
  type MasterRowMaps,
} from "@/lib/policies/resolveEffective";
import { useItemMasters } from "@/hooks/useItemMasters";
import type { StageRowsQuery } from "@/hooks/useStageGuards";
import type { FulfillmentStrategy, PolicyBundle, PolicyFamily } from "@/lib/policies/schemas";
import type { StageKey } from "@/lib/policies/stages";

const FAMILY_ORDER: PolicyFamily[] = [
  "sourcing",
  "inventory",
  "transport",
  "production",
  "fulfillment",
  "demand",
];

const FAMILY_TITLE: Record<PolicyFamily, string> = {
  sourcing: "Sourcing",
  inventory: "Inventory",
  transport: "Transport",
  production: "Production",
  fulfillment: "Fulfillment",
  demand: "Demand",
};

interface Props {
  projectId: string | null | undefined;
  stageKey: StageKey;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: FulfillmentStrategy;
  stageRows: StageRowsQuery;
}

function formatValue(col: ColSpec, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return col.format ? col.format(value) : String(value);
  return String(value);
}

export function MobileStagePolicyList({
  projectId,
  stageKey,
  defaults,
  overrides,
  fulfillmentStrategy,
  stageRows,
}: Props) {
  const spec = specFor(stageKey);
  const families = useMemo(() => familiesForStage(stageKey), [stageKey]);
  const { rows: dataRows, loading } = stageRows;
  const { materials, products, suppliers, derived } = useItemMasters(projectId);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);

  const masterRowById: MasterRowMaps = useMemo(
    () => ({
      materials: new Map(materials.map((m) => [m.material_id, m as unknown as Record<string, unknown>])),
      products: new Map(products.map((p) => [p.product_id, p as unknown as Record<string, unknown>])),
      suppliers: new Map(suppliers.map((s) => [s.supplier_id, s as unknown as Record<string, unknown>])),
    }),
    [materials, products, suppliers],
  );

  const masterColByField = useMemo(() => {
    const m = new Map<string, ColSpec>();
    for (const c of spec.cols) if (c.master) m.set(c.field, c);
    return m;
  }, [spec]);

  const specColByField = useMemo(() => {
    const m = new Map<string, ColSpec>();
    for (const c of spec.cols) m.set(c.field, c);
    return m;
  }, [spec]);

  const rowEffective = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of dataRows) {
      m.set(String(r.key), flattenBundle(effectivePolicy(defaults, overrides, spec.scope, String(r.key))));
    }
    return m;
  }, [dataRows, defaults, overrides, spec.scope]);

  const familyDefault = (field: string, family: PolicyFamily): unknown =>
    ((defaults[family] ?? {}) as Record<string, unknown>)[field];

  // Same resolver signature stageGuards.lineNeedsInput/groupHasPrimary expect —
  // no draft (read-only), no family disambiguation, matching StagePolicyTable's
  // own `resolveForGuard`.
  const resolveForGuard: ResolveField = (row, field) =>
    getEffectiveValue({
      rowKey: String(row.key),
      dataRow: row,
      field,
      family: undefined,
      families,
      masterColByField,
      masterRowById,
      derived,
      defaults,
      overrides,
      scope: spec.scope,
    });

  const hasOverride = (rowKey: string): boolean => overrides.some((o) => o.target_key === rowKey);

  const groups = useMemo(
    () => groupByKeyA(dataRows as Record<string, unknown>[], spec.keyCols[0].id),
    [dataRows, spec.keyCols],
  );

  const openRow = dataRows.find((r) => String(r.key) === openRowKey) as
    | Record<string, unknown>
    | undefined;

  const resolveCol = (row: Record<string, unknown>, col: ColSpec) =>
    resolveCell({
      rowKey: String(row.key),
      row,
      col,
      families,
      masterColByField,
      masterRowById,
      derived,
      defaults,
      overrides,
      scope: spec.scope,
      familyDefault,
    });

  if (loading) {
    return (
      <div className="py-8 text-center font-mono text-[11px] text-muted-foreground">
        loading lines…
      </div>
    );
  }

  if (dataRows.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-[11px] text-muted-foreground">
        no lines for this stage
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const keyALabel = String(group.members[0].row[spec.keyCols[0].id] ?? "");
        return (
          <div key={group.id} className="overflow-hidden rounded-sm border border-[--hair-border]">
            <div className="border-b border-[--hair-divider] bg-[--hair-th] px-2.5 py-1.5 font-mono text-[11px] font-medium text-muted-foreground">
              {spec.keyCols[0].label}: {keyALabel || "—"}
              {group.members.length > 1 && (
                <span className="ml-1.5 text-[--hair-quiet]">· {group.members.length} lines</span>
              )}
            </div>
            {group.members.map(({ row }) => {
              const rowKey = String(row.key);
              const keyBLabel = String(row[spec.keyCols[1]?.id ?? ""] ?? "");
              const attention = lineNeedsInput(stageKey, row, dataRows as Record<string, unknown>[], resolveForGuard);
              const multiSource =
                (stageKey === "supplier" || stageKey === "customer") &&
                Number((row as Record<string, unknown>).__lane_count ?? 0) > 1;
              const isPrimaryMissing =
                multiSource && !groupHasPrimary(stageKey, row, dataRows as Record<string, unknown>[], resolveForGuard);
              const accent = rowAccent({ edited: false, attention, multiSource });
              const overridden = hasOverride(rowKey);
              return (
                <button
                  key={rowKey}
                  type="button"
                  onClick={() => setOpenRowKey(rowKey)}
                  className="flex w-full min-h-11 items-center gap-2.5 border-b border-[--hair-divider] px-2.5 py-2 text-left last:border-b-0 active:bg-[#fafafa]"
                  style={accent ? { borderLeft: `2px solid ${accent}` } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {spec.keyCols[1]?.label ?? spec.keyCols[0].label}: {keyBLabel || "—"}
                  </span>
                  {overridden && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LAYER.product }} title="Has a saved override" />
                  )}
                  {(row as Record<string, unknown>).__needs_supplier && (
                    <RowFlag title="No supplier assigned">no supplier</RowFlag>
                  )}
                  {isPrimaryMissing && <RowFlag title="Multiple sources — no primary picked">pick primary</RowFlag>}
                  <span className="shrink-0 text-[--hair-faint]">›</span>
                </button>
              );
            })}
          </div>
        );
      })}

      <MobileSheet
        open={openRow != null}
        title={
          openRow
            ? `${String(openRow[spec.keyCols[0].id] ?? "")} · ${String(openRow[spec.keyCols[1]?.id ?? ""] ?? "")}`
            : ""
        }
        sub="Read-only — edit on desktop"
        onClose={() => setOpenRowKey(null)}
      >
        {openRow && (
          <div className="flex flex-col gap-4 p-3.5">
            {FAMILY_ORDER.filter((fam) => families.includes(fam)).map((fam) => {
              const rowCtx: ColSpecCtx = {
                fulfillmentStrategy,
                row: openRow,
                draft: undefined,
                effective: rowEffective.get(String(openRow.key)),
              };
              const cols = spec.cols.filter(
                (c) => c.family === fam && !c.synthetic && (!c.visibleWhen || c.visibleWhen(rowCtx)),
              );
              const vectorCols = spec.cols.filter(
                (c) => c.family === fam && c.vectorGroup === "invParams",
              );
              if (cols.length === 0 && vectorCols.length === 0) return null;
              const type = String(
                resolveCol(openRow, specColByField.get("type") ?? cols[0]).value ?? "min_max",
              );
              const activeParams =
                vectorCols.length > 0 ? inventoryParamsForType(type).filter((p) => p.field !== "basis") : [];
              return (
                <div key={fam}>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    {FAMILY_TITLE[fam]}
                  </div>
                  <div className="overflow-hidden rounded-sm border border-[--hair-border]">
                    {cols.map((col) => {
                      const { value, provenance } = resolveCol(openRow, col);
                      return (
                        <div
                          key={col.field}
                          className="relative flex min-h-11 items-center justify-between gap-3 border-b border-[--hair-divider] px-3 py-2 last:border-b-0"
                        >
                          <span className="text-[12.5px] text-muted-foreground">{col.label}</span>
                          <span className="flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-foreground">
                            {formatValue(col, value)}
                            <span className="relative inline-block h-2 w-2">
                              <ProvenanceDot p={provenance} />
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    {activeParams.map((p) => {
                      const raw = resolveCol(openRow, { field: p.field, family: fam, label: p.label } as ColSpec).value;
                      const n = typeof raw === "number" ? raw : Number(raw);
                      const shown = Number.isFinite(n) ? `${n}${p.unit ? ` ${p.unit}` : ""}` : "—";
                      return (
                        <div
                          key={p.field}
                          className="flex min-h-11 items-center justify-between gap-3 border-b border-[--hair-divider] px-3 py-2 last:border-b-0"
                        >
                          <span className="text-[12.5px] text-muted-foreground">{p.label}</span>
                          <span className="font-mono text-[13px] tabular-nums text-foreground">{shown}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MobileSheet>
    </div>
  );
}
