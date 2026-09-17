import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, X } from "lucide-react";
import {
  REQUIRED_FIELDS,
  useItemMasters,
  type DerivedEconomics,
  type ItemMasterTable,
  type MaterialRow,
  type ProductRow,
  type SupplierRow,
} from "@/hooks/useItemMasters";
import { ProvenanceBadge } from "@/components/policies/ProvenanceBadge";
// WP 3.4 (§10: "show provenance on canonical rows"). The item masters became
// promotion targets in WP 3.3 (D55), so every row written since carries
// `ingest_run_id` + `source_row_id` and can name the line of the file it came
// from. Every row written BEFORE carries neither, and the badge says "source
// unknown" rather than inventing one — which today is every row in production.
import { RowProvenance } from "@/components/ingest/RowProvenance";
import type { Provenance } from "@/lib/policies/effectiveEconomics";

// Enum options restricted to what the scsim engine accepts
// (scsim/scsim/io/project_map.py). `ato` parses but hard-errors at compile,
// `empirical` lead times and `bootstrap` demand are not runnable yet — none
// of them are offered here, and the write RPCs reject them as a second line.
const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  fulfillment_mode: [
    { value: "mto", label: "Make-to-order" },
    { value: "mts", label: "Make-to-stock" },
  ],
  demand_distribution: [
    { value: "triangular", label: "Triangular" },
    { value: "deterministic", label: "Deterministic" },
    { value: "poisson", label: "Poisson" },
    { value: "negbin", label: "Negative binomial" },
  ],
  lead_time_dist: [
    { value: "deterministic", label: "Deterministic" },
    { value: "lognormal", label: "Lognormal" },
    { value: "gamma", label: "Gamma" },
  ],
};

interface ColumnSpec {
  field: string;
  label: string;
  hint?: string;
  kind: "text" | "number" | "enum";
}

const COLUMNS: Record<ItemMasterTable, ColumnSpec[]> = {
  materials: [
    { field: "name", label: "Name", kind: "text" },
    { field: "cost", label: "Cost", hint: "€/unit", kind: "number" },
    { field: "holding_cost_pct", label: "Holding cost", hint: "fraction/yr, e.g. 0.2", kind: "number" },
    { field: "moq", label: "MOQ", hint: "units", kind: "number" },
    { field: "initial_on_hand", label: "Initial on-hand", hint: "units", kind: "number" },
    { field: "lead_time_dist", label: "Lead-time dist.", kind: "enum" },
    { field: "lead_time_cv", label: "Lead-time CV", kind: "number" },
  ],
  products: [
    { field: "name", label: "Name", kind: "text" },
    { field: "sell_price", label: "Sell price", hint: "€/unit", kind: "number" },
    { field: "production_capacity", label: "Capacity", hint: "units/week", kind: "number" },
    { field: "fulfillment_mode", label: "Fulfillment", kind: "enum" },
    { field: "demand_distribution", label: "Demand dist.", kind: "enum" },
    { field: "demand_mean", label: "Demand mean", hint: "units/week", kind: "number" },
    { field: "demand_cv", label: "Demand CV", kind: "number" },
    { field: "demand_min", label: "Demand min", hint: "units/week — empty = mean·(1−CV)", kind: "number" },
    { field: "demand_max", label: "Demand max", hint: "units/week — empty = mean·(1+CV)", kind: "number" },
  ],
  suppliers: [
    { field: "name", label: "Name", kind: "text" },
    { field: "capacity_per_week", label: "Capacity", hint: "units/week — empty = unlimited", kind: "number" },
    { field: "reliability_score", label: "Reliability", hint: "0–1", kind: "number" },
  ],
};

const ID_COLUMN: Record<ItemMasterTable, string> = {
  materials: "material_id",
  products: "product_id",
  suppliers: "supplier_id",
};

type AnyRow = MaterialRow | ProductRow | SupplierRow;
type Drafts = Record<string, Record<string, string | null>>;

interface ItemMasterEditorProps {
  projectId: string;
  /** Tab to open on mount (walk-to deep link from the findings surfaces). */
  initialTab?: ItemMasterTable;
  onClose?: () => void;
}

/**
 * Grid editors for the item-master economics the engine reads
 * (Phase A / G4 / §8.3 of docs/design/next-gen-platform-design.md).
 * Draft-then-save pattern after StagePolicyTable: edits stay local until
 * "Save changes" bulk-upserts the dirty rows via the item-master RPCs.
 */
// Which derived (engine-fallback) value backs each nullable master field.
const derivedLookup = (
  derived: DerivedEconomics,
  table: ItemMasterTable,
  field: string,
  rowId: string,
): { value: number; source: Provenance } | undefined => {
  if (table === "materials" && field === "cost") {
    const v = derived.materialCost.get(rowId);
    return v === undefined ? undefined : { value: v, source: "inbound" };
  }
  if (table === "products" && field === "sell_price") {
    const v = derived.sellPrice.get(rowId);
    return v === undefined ? undefined : { value: v, source: "outbound" };
  }
  if (table === "products" && field === "demand_mean") {
    const v = derived.demandMean.get(rowId) ?? 0;
    return v > 0 ? { value: v, source: "outbound" } : undefined;
  }
  return undefined;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const ItemMasterEditor = ({ projectId, initialTab, onClose }: ItemMasterEditorProps) => {
  const { materials, products, suppliers, loading, error, missingCounts, derived, saveRows } =
    useItemMasters(projectId);
  const [activeTab, setActiveTab] = useState<ItemMasterTable>(initialTab ?? "materials");
  // drafts[table] = { [rowId]: { [field]: raw input value } }
  const [drafts, setDrafts] = useState<Record<ItemMasterTable, Drafts>>({
    materials: {},
    products: {},
    suppliers: {},
  });
  const [saving, setSaving] = useState(false);

  const rowsByTable: Record<ItemMasterTable, AnyRow[]> = useMemo(
    () => ({ materials, products, suppliers }),
    [materials, products, suppliers],
  );

  const setDraft = (table: ItemMasterTable, rowId: string, field: string, value: string | null) => {
    setDrafts((prev) => ({
      ...prev,
      [table]: {
        ...prev[table],
        [rowId]: { ...(prev[table][rowId] ?? {}), [field]: value },
      },
    }));
  };

  const dirtyCount = (table: ItemMasterTable) => Object.keys(drafts[table]).length;

  const cellValue = (table: ItemMasterTable, row: AnyRow, field: string): string => {
    const rowId = String(row[ID_COLUMN[table] as keyof AnyRow] ?? "");
    const draft = drafts[table][rowId];
    if (draft && field in draft) return draft[field] ?? "";
    const v = row[field as keyof AnyRow];
    return v == null ? "" : String(v);
  };

  const handleSave = async (table: ItemMasterTable) => {
    const tableDrafts = drafts[table];
    const idCol = ID_COLUMN[table];
    const dirtyRows = rowsByTable[table]
      .filter((r) => String(r[idCol as keyof AnyRow]) in tableDrafts)
      .map((r) => {
        const rowId = String(r[idCol as keyof AnyRow]);
        const merged: Record<string, unknown> = { ...r };
        for (const [field, raw] of Object.entries(tableDrafts[rowId])) {
          const spec = COLUMNS[table].find((c) => c.field === field);
          if (spec?.kind === "number") {
            merged[field] = raw === "" || raw == null ? null : Number(raw);
          } else {
            merged[field] = raw === "" || raw == null ? null : raw;
          }
        }
        return merged as unknown as AnyRow;
      });
    if (dirtyRows.length === 0) return;

    const invalid = dirtyRows.some((r) =>
      COLUMNS[table].some((c) => {
        if (c.kind !== "number") return false;
        const v = r[c.field as keyof AnyRow] as unknown as number | null;
        return v != null && (!Number.isFinite(v) || v < 0);
      }),
    );
    if (invalid) {
      toast.error("Numeric fields must be non-negative numbers.");
      return;
    }

    setSaving(true);
    try {
      await saveRows(table, dirtyRows);
      setDrafts((prev) => ({ ...prev, [table]: {} }));
      toast.success(`Saved ${dirtyRows.length} ${table} row${dirtyRows.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to save ${table}`);
    } finally {
      setSaving(false);
    }
  };

  const renderGrid = (table: ItemMasterTable) => {
    const rows = rowsByTable[table];
    const columns = COLUMNS[table];
    const idCol = ID_COLUMN[table];
    const required = REQUIRED_FIELDS[table];

    if (rows.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No {table} yet — upload BOM / logistics data first; master rows are derived from it.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">ID</TableHead>
              <TableHead className="whitespace-nowrap">
                Source
                <span className="block text-[10px] font-normal text-muted-foreground">
                  the file and line this row came from
                </span>
              </TableHead>
              {columns.map((c) => (
                <TableHead key={c.field} className="whitespace-nowrap">
                  {c.label}
                  {required.includes(c.field) && <span className="text-destructive"> *</span>}
                  {c.hint && (
                    <span className="block text-[10px] font-normal text-muted-foreground">{c.hint}</span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowId = String(row[idCol as keyof AnyRow]);
              const rowDraft = drafts[table][rowId];
              return (
                <TableRow key={rowId} className={rowDraft ? "bg-primary/5" : undefined}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{rowId}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <RowProvenance row={row as { ingest_run_id?: string | null; source_row_id?: string | null }} />
                  </TableCell>
                  {columns.map((c) => {
                    const value = cellValue(table, row, c.field);
                    const missing = required.includes(c.field) && value === "";
                    if (c.kind === "enum") {
                      return (
                        <TableCell key={c.field} className="min-w-[10rem]">
                          <Select
                            value={value || "__unset__"}
                            onValueChange={(v) =>
                              setDraft(table, rowId, c.field, v === "__unset__" ? null : v)
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unset__">— (default)</SelectItem>
                              {ENUM_OPTIONS[c.field].map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      );
                    }
                    const fallback =
                      c.kind === "number"
                        ? derivedLookup(derived, table, c.field, rowId)
                        : undefined;
                    // Truly missing = required, empty, and no logistics fallback
                    // the engine could resolve it from.
                    const trulyMissing = missing && !fallback;
                    return (
                      <TableCell key={c.field} className="min-w-[7rem]">
                        <Input
                          type={c.kind === "number" ? "number" : "text"}
                          min={c.kind === "number" ? 0 : undefined}
                          step={c.kind === "number" ? "any" : undefined}
                          value={value}
                          placeholder={
                            value === "" && fallback
                              ? `≈ ${round2(fallback.value)}`
                              : trulyMissing
                              ? "required"
                              : ""
                          }
                          className={`h-8 text-xs ${trulyMissing ? "border-destructive" : ""}`}
                          onChange={(e) => setDraft(table, rowId, c.field, e.target.value)}
                        />
                        {fallback && (
                          <ProvenanceBadge
                            className="mt-0.5"
                            source={value === "" ? fallback.source : "master"}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Item master — simulation economics</CardTitle>
          <CardDescription>
            Costs, prices, capacities and demand parameters the simulation engine reads. Empty
            fields showing ≈ values resolve automatically from your uploaded inbound/outbound
            unit prices — type a value only to override. Fields marked * with no fallback would
            hit a meaningless engine default.
          </CardDescription>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading item masters…
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ItemMasterTable)}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <TabsList>
                {(["materials", "products", "suppliers"] as ItemMasterTable[]).map((table) => (
                  <TabsTrigger key={table} value={table} className="capitalize">
                    {table}
                    <Badge variant="secondary" className="ml-2">
                      {rowsByTable[table].length}
                    </Badge>
                    {missingCounts[table] > 0 && (
                      <Badge variant="destructive" className="ml-1">
                        {missingCounts[table]} incomplete
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button
                size="sm"
                disabled={saving || dirtyCount(activeTab) === 0}
                onClick={() => void handleSave(activeTab)}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save changes{dirtyCount(activeTab) > 0 ? ` (${dirtyCount(activeTab)})` : ""}
              </Button>
            </div>
            {(["materials", "products", "suppliers"] as ItemMasterTable[]).map((table) => (
              <TabsContent key={table} value={table} className="mt-3">
                {renderGrid(table)}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};

export default ItemMasterEditor;
