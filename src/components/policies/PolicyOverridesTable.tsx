import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { BulkEditDialog } from "./BulkEditDialog";
import type { PolicyBundle, PolicyFamily } from "@/lib/policies/schemas";
import { diffFields, type OverrideRow } from "@/lib/policies/resolve";

interface Props {
  family: PolicyFamily;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  onUpsert: (row: OverrideRow) => Promise<void>;
  onBulkUpsert: (rows: OverrideRow[]) => Promise<void>;
  onDelete: (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => Promise<void>;
}

/**
 * Minimal overrides table: target · # changed fields · edit · delete.
 * Edit reuses BulkEditDialog with a single target.
 */
export function PolicyOverridesTable({
  family,
  defaults,
  overrides,
  onUpsert,
  onBulkUpsert,
  onDelete,
}: Props) {
  const scope: "node" | "edge" = family === "inventory" ? "node" : "edge";
  const [filter, setFilter] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [editing, setEditing] = useState<string[] | null>(null);

  const familyOverrides = useMemo(
    () => overrides.filter((o) => o.family === family && o.scope === scope),
    [overrides, family, scope],
  );

  const filtered = useMemo(() => {
    if (!filter) return familyOverrides;
    const q = filter.toLowerCase();
    return familyOverrides.filter((o) => o.target_key.toLowerCase().includes(q));
  }, [familyOverrides, filter]);

  const base = defaults[family] as Record<string, unknown>;

  const handleAdd = async () => {
    if (!newTarget.trim()) return;
    await onUpsert({ scope, target_key: newTarget.trim(), family, patch: {} });
    setEditing([newTarget.trim()]);
    setNewTarget("");
  };

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <Input
          placeholder={`Filter ${scope === "node" ? "node id" : "from→to"}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 text-xs max-w-xs"
        />
        <span className="text-[11px] text-muted-foreground">
          {filtered.length} override{filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <Input
          placeholder={scope === "node" ? "Add node-id" : "Add from→to"}
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="h-7 text-xs max-w-xs"
        />
        <Button size="sm" variant="outline" onClick={handleAdd} className="h-7">
          Add
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 px-3">{scope === "node" ? "Node" : "Edge (from→to)"}</th>
              <th className="py-1.5 px-3 w-32">Overridden</th>
              <th className="py-1.5 px-3 w-20 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 px-3 text-center text-muted-foreground text-[11px]">
                  No overrides — defaults apply to all items.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const changed = diffFields(base, row.patch);
              return (
                <tr key={row.target_key} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-mono">{row.target_key}</td>
                  <td className="py-1.5 px-3">
                    {changed.length > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {changed.length} field{changed.length === 1 ? "" : "s"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing([row.target_key])}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => onDelete(row.scope, row.target_key, row.family)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BulkEditDialog
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        family={family}
        defaults={defaults}
        targetKeys={editing ?? []}
        scope={scope}
        onApply={async (patch) => {
          const rows: OverrideRow[] = (editing ?? []).map((target_key) => ({
            scope, target_key, family, patch,
          }));
          await onBulkUpsert(rows);
          setEditing(null);
        }}
      />
    </Card>
  );
}
