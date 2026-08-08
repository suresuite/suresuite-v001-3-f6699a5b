import { cn } from "@/lib/utils";
import { DAYS_PER_UNIT, UNIT_LABEL_PLURAL, type TimeUnit } from "@/hooks/useTimeUnit";

/**
 * One parameter group = one titled card holding a Parameter | Value | Unit table.
 * Same shape as components/policies/PolicyDefaultsCard.tsx so the two pages read
 * as siblings. No prose, no helper sentences — the unit column carries the units
 * and provenance rides on a chip.
 */

export type Provenance = "edited" | "inherited" | null;

export type FieldControl =
  | { kind: "number"; value: number; onChange: (v: number) => void; onCommit?: () => void; width?: number; min?: number }
  | { kind: "segmented"; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }
  | { kind: "toggle"; value: boolean; onChange: (v: boolean) => void; onLabel?: string; offLabel?: string };

export interface ParamField {
  label: string;
  unit?: string;
  provenance?: Provenance;
  control: FieldControl;
}

export interface ParamGroup {
  name: string;
  chip?: string | null;
  fields: ParamField[];
}

const PROV: Record<Exclude<Provenance, null>, { label: string; chip: string; row: string }> = {
  edited: { label: "edited", chip: "bg-[rgba(224,147,11,0.13)] text-[#9a6206]", row: "bg-[#fffdf7]" },
  inherited: { label: "inherited", chip: "bg-[rgba(20,184,196,0.12)] text-[#0e7f88]", row: "bg-white" },
};

const TH =
  "bg-[#f4f4f5] px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#52525b] border-b border-[#e0e0e3]";
const TD = "px-3 py-[5px] border-b border-[#ececee]";

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex rounded-sm border border-[#e0e0e3] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "whitespace-nowrap rounded-[2px] px-[10px] py-[3px] text-[12.5px]",
            // every segmented control shows its selection: black on white, never grey on grey
            o.value === value ? "bg-foreground text-background" : "text-[#52525b]",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

function Switch({
  value,
  onChange,
  onLabel = "on",
  offLabel = "off",
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2">
      <span
        className={cn(
          "relative h-4 w-7 rounded-sm border",
          value ? "border-foreground bg-foreground" : "border-[#d4d4d8] bg-white",
        )}
      >
        <span
          className={cn("absolute top-px h-3 w-3 rounded-[1px]", value ? "bg-white" : "bg-[#d4d4d8]")}
          style={{ left: value ? 14 : 1 }}
        />
      </span>
      <span className="text-[12.5px] text-[#27272a]">{value ? onLabel : offLabel}</span>
    </button>
  );
}

export function ParameterCard({ group, footer }: { group: ParamGroup; footer?: string }) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-sm border border-[#e0e0e3] bg-white">
      <div className="flex items-center gap-[9px] border-b border-[#e0e0e3] px-3 py-[9px]">
        <h3 className="whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.011em] text-[#18181b]">
          {group.name}
        </h3>
        {group.chip ? (
          <span className="whitespace-nowrap rounded-sm bg-[rgba(20,184,196,0.12)] px-[7px] py-px text-[11px] text-[#0e7f88]">
            {group.chip}
          </span>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-[12.5px] text-[#71717a]">
          {group.fields.length} parameters
        </span>
      </div>

      {/* flex-1 so surplus height is shared across rows instead of collapsing
          into one dead band when two cards sit side by side */}
      <table className="w-full flex-1 border-collapse">
        <thead>
          <tr>
            <th className={TH}>Parameter</th>
            <th className={TH}>Value</th>
            <th className={cn(TH, "w-[34%]")}>Unit</th>
          </tr>
        </thead>
        <tbody>
          {group.fields.map((f) => {
            const prov = f.provenance ? PROV[f.provenance] : null;
            return (
              <tr key={f.label}>
                <td className={cn(TD, prov?.row)}>
                  <span className="flex items-center gap-[7px]">
                    <span className="whitespace-nowrap text-[12.5px] text-[#18181b]">{f.label}</span>
                    {prov ? (
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap rounded-sm px-1.5 py-px text-[10.5px]",
                          prov.chip,
                        )}
                      >
                        {prov.label}
                      </span>
                    ) : null}
                  </span>
                </td>
                {/* fixed height so switch rows share the rhythm of input rows */}
                <td className={cn(TD, "h-[38px] whitespace-nowrap", prov?.row)}>
                  {f.control.kind === "number" ? (
                    <input
                      type="number"
                      min={f.control.min}
                      value={f.control.value}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) (f.control as { onChange: (n: number) => void }).onChange(v);
                      }}
                      onBlur={f.control.onCommit}
                      className="h-7 rounded-sm border border-[#d4d4d8] px-[9px] text-[13px] tabular-nums text-[#18181b] focus:border-foreground focus:outline-none"
                      style={{ width: f.control.width ?? 76 }}
                    />
                  ) : f.control.kind === "segmented" ? (
                    <Segmented
                      value={f.control.value}
                      options={f.control.options}
                      onChange={f.control.onChange}
                    />
                  ) : (
                    <Switch
                      value={f.control.value}
                      onChange={f.control.onChange}
                      onLabel={f.control.onLabel}
                      offLabel={f.control.offLabel}
                    />
                  )}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-[12px] text-[#52525b]", prov?.row)}>
                  {f.unit ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {footer ? (
        <div className="bg-[#fafafa] px-3 py-[7px] text-[11.5px] tabular-nums text-[#52525b]">{footer}</div>
      ) : null}
    </section>
  );
}

/** Days are the stored truth; the planning unit is a view concern — the single
 *  conversion table lives in useTimeUnit and is re-exported here so the card
 *  and the page share one contract. */
export { DAYS_PER_UNIT, UNIT_LABEL_PLURAL, type TimeUnit };

export function TimeUnitBar({
  unit,
  onUnit,
  horizonDays,
}: {
  unit: TimeUnit;
  onUnit: (u: TimeUnit) => void;
  horizonDays: number;
}) {
  const factor = DAYS_PER_UNIT[unit];
  return (
    <div className="flex items-center gap-3 bg-[#fcfcfc] px-4 py-[10px]">
      <span className="whitespace-nowrap text-[12.5px] text-[#3f3f46]">Show time in</span>
      <Segmented
        value={unit}
        onChange={(v) => onUnit(v as TimeUnit)}
        options={(Object.keys(DAYS_PER_UNIT) as TimeUnit[]).map((u) => ({
          value: u,
          label: UNIT_LABEL_PLURAL[u],
        }))}
      />
      <span className="text-[13px] tabular-nums text-[#52525b]">
        {horizonDays} days
        {unit === "day" ? "" : ` · ${(horizonDays / factor).toFixed(1)} ${UNIT_LABEL_PLURAL[unit]}`}
      </span>
    </div>
  );
}
