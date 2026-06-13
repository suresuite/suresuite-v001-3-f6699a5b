import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PolicySchemas,
  FIELD_LABELS,
  ENUM_OPTIONS,
  SCSIM_ENUM_OPTIONS,
  MULTI_SELECT_FIELDS,
  MULTI_SELECT_OPTIONS,
  RESPONSE_ENGINE_EFFECTS,
  visibleFieldGroups,
  type PolicyBundle,
  type PolicyFamily,
} from "@/lib/policies/schemas";

interface Props {
  family: PolicyFamily;
  value: PolicyBundle[PolicyFamily];
  onSave: (next: PolicyBundle[PolicyFamily]) => Promise<void>;
}

const FAMILY_META: Record<PolicyFamily, { title: string; description: string }> = {
  sourcing: { title: "Sourcing", description: "Supplier strategy & failover." },
  inventory: { title: "Inventory", description: "Stock policy, safety stock & costs." },
  transport: { title: "Transportation", description: "Mode, lead time, capacity & cost." },
  fulfillment: { title: "Customer fulfillment", description: "Allocation, backorder & service level." },
  production: { title: "Production", description: "Lot sizing, capacity & scheduling." },
  recovery: { title: "Recovery", description: "Disruption triggers & response." },
  demand: { title: "Demand", description: "Pattern, forecast & service tier." },
};

const optionsFor = (key: string): readonly string[] | undefined =>
  SCSIM_ENUM_OPTIONS[key] ?? ENUM_OPTIONS[key];

/** Fields only meaningful given another field's value. */
const fieldVisible = (key: string, draft: Record<string, unknown>): boolean => {
  if (key === "service_level_target") return draft.safety_stock_method === "service_level";
  if (key === "max_backorder_days" || key === "backorder_cost_per_day") {
    return draft.backorder_allowed === true;
  }
  return true;
};

function hintFor(key: string, value: unknown): string {
  if (key === "response") {
    return Object.entries(RESPONSE_ENGINE_EFFECTS)
      .map(([k, v]) => `${k} → ${v}`)
      .join(" · ");
  }
  if (MULTI_SELECT_FIELDS.has(key)) return "multi";
  const opts = optionsFor(key);
  if (opts) return opts.join(" | ");
  if (typeof value === "boolean") return "true / false";
  if (typeof value === "number") {
    if (key.endsWith("_pct")) return "%";
    if (key.includes("days")) return "days";
    if (key.startsWith("cost")) return "currency";
    return "number";
  }
  return "text";
}

function ValueCell({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (MULTI_SELECT_FIELDS.has(fieldKey)) {
    const options = MULTI_SELECT_OPTIONS[fieldKey] ?? [];
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = selected.has(opt);
          return (
            <Badge
              key={opt}
              variant={active ? "default" : "outline"}
              className="cursor-pointer select-none text-[10px] h-5"
              onClick={() => {
                const next = new Set(selected);
                active ? next.delete(opt) : next.add(opt);
                onChange(Array.from(next));
              }}
            >
              {opt}
            </Badge>
          );
        })}
      </div>
    );
  }

  const enumOpts = optionsFor(fieldKey);
  if (enumOpts) {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {enumOpts.map((opt) => (
            <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (typeof value === "boolean") {
    return <Switch checked={value} onCheckedChange={onChange} />;
  }

  if (typeof value === "number") {
    return (
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-7 text-xs"
      />
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs"
    />
  );
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PolicyDefaultsCard({ family, value, onSave }: Props) {
  const [draft, setDraft] = useState<Record<string, unknown>>(value as Record<string, unknown>);
  const saved = value as Record<string, unknown>;

  useEffect(() => {
    setDraft(value as Record<string, unknown>);
  }, [value, family]);

  const meta = FAMILY_META[family];
  const groups = visibleFieldGroups(family);

  const dirty = useMemo(
    () => Object.keys(draft).some((k) => !isEqual(draft[k], saved[k])),
    [draft, saved],
  );

  const persist = async () => {
    try {
      const validated = PolicySchemas[family].parse(draft);
      await onSave(validated as PolicyBundle[PolicyFamily]);
      toast.success(`${meta.title} saved`);
    } catch (err) {
      toast.error(`Invalid: ${String(err)}`);
    }
  };

  // Families with no scsim-consumed fields (transport, demand) are not editable.
  if (Object.keys(groups).length === 0) return null;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">{meta.title}</CardTitle>
        <CardDescription className="text-xs">{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 px-3 w-1/3">Parameter</th>
                <th className="py-1.5 px-3 w-1/3">Value</th>
                <th className="py-1.5 px-3 w-1/3">Unit / options</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).map(([groupName, fields]) => (
                <>
                  <tr key={`g-${groupName}`} className="bg-muted/20">
                    <td colSpan={3} className="py-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {groupName}
                    </td>
                  </tr>
                  {fields.filter((k) => fieldVisible(k, draft)).map((k) => {
                    const changed = !isEqual(draft[k], saved[k]);
                    return (
                      <tr
                        key={k}
                        className={cn(
                          "border-t border-border/60",
                          changed && "bg-primary/5",
                        )}
                      >
                        <td className={cn("py-1.5 px-3", changed && "border-l-2 border-l-primary")}>
                          {FIELD_LABELS[k] ?? k}
                        </td>
                        <td className="py-1.5 px-3">
                          <ValueCell
                            fieldKey={k}
                            value={draft[k]}
                            onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))}
                          />
                        </td>
                        <td className="py-1.5 px-3 text-[10px] text-muted-foreground truncate">
                          {hintFor(k, saved[k])}
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty && (
            <>
              <span className="text-[11px] text-muted-foreground">Unsaved changes</span>
              <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                Revert
              </Button>
            </>
          )}
          <Button onClick={persist} disabled={!dirty} size="sm">
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
