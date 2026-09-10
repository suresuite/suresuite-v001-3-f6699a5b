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
import { ProvenanceDot, rowAccent } from "./policyGridUi";
import { MobileSheet } from "@/components/shared/MobileSheet";
import { M, MobileChip, MobilePanel, MobileRow } from "@/components/mobile";
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

// Every member of PolicyFamily, so the map cannot fall out of step with the
// enum. `recovery` has no column in any stage spec today — familiesForStage
// derives its result from the columns — so it never reaches the render; it is
// here to keep the record total rather than to add a section.
const FAMILY_TITLE: Record<PolicyFamily, string> = {
  sourcing: "Sourcing",
  inventory: "Inventory",
  transport: "Transport",
  production: "Production",
  fulfillment: "Fulfillment",
  recovery: "Recovery",
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

  if (loading || dataRows.length === 0) {
    return (
      <MobilePanel label={spec.keyCols[0].label}>
        <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-[#525252]">
          {loading ? "Loading lines…" : "No lines for this stage."}
        </p>
      </MobilePanel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const keyALabel = String(group.members[0].row[spec.keyCols[0].id] ?? "");
        return (
          <MobilePanel
            key={group.id}
            label={`${spec.keyCols[0].label} · ${keyALabel || "—"}`}
            counter={`${group.members.length}`}
          >
            {group.members.map(({ row }) => {
              const rowKey = String(row.key);
              const keyBLabel = String(row[spec.keyCols[1]?.id ?? ""] ?? "");
              const attention = lineNeedsInput(stageKey, row, dataRows as Record<string, unknown>[], resolveForGuard);
              const multiSource =
                (stageKey === "supplier" || stageKey === "customer") &&
                Number((row as Record<string, unknown>).__lane_count ?? 0) > 1;
              const isPrimaryMissing =
                multiSource && !groupHasPrimary(stageKey, row, dataRows as Record<string, unknown>[], resolveForGuard);
              const overridden = hasOverride(rowKey);
              // The desktop grid carries the same three states as a 2px left
              // accent; the skin spends colour as a 6px dot instead (§3), so
              // `rowAccent`'s value becomes the dot and the flags stay chips.
              // Same function, same precedence — nothing is re-derived here.
              const accent = rowAccent({ edited: false, attention, multiSource });
              return (
                <MobileRow
                  key={rowKey}
                  onClick={() => setOpenRowKey(rowKey)}
                  dot={accent || (overridden ? M.product : undefined)}
                  label={`${spec.keyCols[1]?.label ?? spec.keyCols[0].label}: ${keyBLabel || "—"}`}
                  sub={
                    overridden
                      ? "has a saved override"
                      : attention
                        ? "needs input"
                        : undefined
                  }
                  trailing={
                    (row as Record<string, unknown>).__needs_supplier || isPrimaryMissing ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {(row as Record<string, unknown>).__needs_supplier ? (
                          <MobileChip>no supplier</MobileChip>
                        ) : null}
                        {isPrimaryMissing ? <MobileChip>pick primary</MobileChip> : null}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </MobilePanel>
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
          <div className="flex flex-col gap-3 p-3.5">
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
                <MobilePanel
                  key={fam}
                  label={FAMILY_TITLE[fam]}
                  counter={`${cols.length + activeParams.length}`}
                >
                  {cols.map((col) => {
                    const { value, provenance } = resolveCol(openRow, col);
                    return (
                      <MobileRow
                        key={col.field}
                        chevron={false}
                        label={col.label}
                        value={
                          <span className="inline-flex items-center gap-1.5">
                            {formatValue(col, value)}
                            <span className="relative inline-block h-2 w-2">
                              <ProvenanceDot p={provenance} />
                            </span>
                          </span>
                        }
                      />
                    );
                  })}
                  {activeParams.map((p) => {
                    const raw = resolveCol(openRow, { field: p.field, family: fam, label: p.label } as ColSpec).value;
                    const n = typeof raw === "number" ? raw : Number(raw);
                    const shown = Number.isFinite(n) ? `${n}${p.unit ? ` ${p.unit}` : ""}` : "—";
                    return <MobileRow key={p.field} chevron={false} label={p.label} value={shown} />;
                  })}
                </MobilePanel>
              );
            })}
          </div>
        )}
      </MobileSheet>
    </div>
  );
}
