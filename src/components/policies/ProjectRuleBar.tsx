// A project-level policy setting, inline on ONE line above a stage grid.
//
// The grid edits rows; a few settings the engine reads once per project — the
// customer allocation rule (P-C.2), the backorder defaults an empty Customer
// row inherits (P-C.1), the FG safety buffer (P-P.4) — have no row to live on.
// They used to be a PARAMETER / VALUE / UNIT table card under the grid, four
// rows of chrome around one select and three numbers. Here they are a sentence
// the planner reads next to the rows they govern, saved through the same
// `saveDefault` path (`save_policy_defaults`), so storage, the policy hash and
// the run are unchanged.
import { useEffect, useMemo, useState } from "react";
import { ProjectRightRefused } from "@/lib/auth/projectRights";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/intelligence/piUi";
import { toast } from "sonner";
import {
  ENUM_OPTIONS,
  PolicySchemas,
  SCSIM_ENUM_OPTIONS,
  type PolicyBundle,
  type PolicyFamily,
} from "@/lib/policies/schemas";
import type { RuleField } from "@/lib/policies/projectRules";

interface Props<F extends PolicyFamily> {
  family: F;
  /** The bar's name, first on the line. */
  title: string;
  /** One sentence on what it governs — the hover on the title. */
  hint: string;
  fields: RuleField[];
  value: PolicyBundle[F];
  onSave: (next: PolicyBundle[F]) => Promise<void>;
  /** A read-only bar (no right to edit policies) shows the values only. */
  readOnly?: boolean;
  /** One plain sentence after the controls: what the setting does HERE, so
   *  the line explains itself without a hover. */
  note?: string;
}

const optionsFor = (field: string): readonly string[] =>
  SCSIM_ENUM_OPTIONS[field] ?? ENUM_OPTIONS[field] ?? [];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ProjectRuleBar<F extends PolicyFamily>({
  family, title, hint, fields, value, onSave, readOnly, note,
}: Props<F>) {
  const saved = value as unknown as Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, unknown>>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [saved]);

  const shown = fields.filter((f) => !f.when || f.when(draft));
  const dirty = useMemo(() => fields.some((f) => !same(draft[f.field], saved[f.field])), [draft, saved, fields]);
  const set = (field: string, v: unknown) => setDraft((d) => ({ ...d, [field]: v }));

  const persist = async () => {
    setSaving(true);
    try {
      const validated = PolicySchemas[family].parse({ ...saved, ...draft });
      await onSave(validated as PolicyBundle[F]);
      toast.success(`${title} saved`);
    } catch (err) {
      // D230 — a refusal was already said by usePolicies; it is not a validation error.
      if (!(err instanceof ProjectRightRefused)) toast.error(`Invalid: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-[#e6e6e6] bg-white px-2.5 py-1.5 text-[11.5px]"
      data-testid={`project-rule-bar-${family}`}
    >
      <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[#737373]" title={hint}>
        {title}
      </span>
      {shown.map((f) => {
        const v = draft[f.field];
        const opts = optionsFor(f.field);
        return (
          <label key={f.field} className="flex items-center gap-1.5 whitespace-nowrap text-[#404040]">
            <span>{f.label}</span>
            {opts.length > 0 ? (
              <Select value={String(v ?? "")} onValueChange={(x) => set(f.field, x)} disabled={readOnly}>
                <SelectTrigger className="h-6 min-w-[112px] px-2 text-[11.5px]" aria-label={f.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opts.map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">
                      {f.optionLabel ? f.optionLabel(o) : o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : typeof saved[f.field] === "boolean" ? (
              <Toggle checked={v === true} onChange={(x) => !readOnly && set(f.field, x)} />
            ) : (
              <input
                type="number"
                step="any"
                aria-label={f.label}
                disabled={readOnly}
                value={v === undefined || v === null ? "" : String(v)}
                onChange={(e) => set(f.field, e.target.value === "" ? undefined : Number(e.target.value))}
                className="h-6 rounded-sm border border-[#dcdcdc] px-1.5 text-right font-mono text-[11px] tabular-nums"
                style={{ width: f.w ?? 56 }}
              />
            )}
            {f.unit && <span className="font-mono text-[10px] text-[#8a8a8a]">{f.unit}</span>}
          </label>
        );
      })}
      {note && <span className="min-w-0 text-[11px] text-[#8a8a8a]">{note}</span>}
      {!readOnly && (
        <span className="ml-auto flex items-center gap-1.5">
          {dirty && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setDraft(saved)}>
              Revert
            </Button>
          )}
          <Button size="sm" className="h-6 px-2.5 text-[11px]" disabled={!dirty || saving} onClick={persist}>
            {dirty ? "Save" : "Saved"}
          </Button>
        </span>
      )}
    </div>
  );
}
