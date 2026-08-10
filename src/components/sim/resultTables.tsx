import { cn } from "@/lib/utils";

/**
 * Tables of numbers stay tables of numbers. What changed is legibility: each
 * ± CI is attached to the mean it belongs to, neutral deltas sit at
 * --zinc-quiet, and the three table levels read as three things — the name on
 * the canvas (L1, supplied by the calling panel), the column row as an ink
 * block (L2, below), and the content on white (L3).
 *
 * L3 carries no zebra: the row divider does the separating, and the objective
 * row is marked the way a selected row is.
 */

const TH =
  "bg-[--brand-ink] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white border-r border-r-[rgba(255,255,255,0.22)] last:border-r-0";
const TD = "px-3 py-1.5 border-b border-[--sim-divider]";
/** L3 is white; the objective row uses the selected-row value. */
const SELECTED = "#f0f0f0";

export interface KpiStat {
  key: string;
  label: string;
  mean: string;
  ci: string;
  std: string;
  min: string;
  max: string;
  n: number;
}

export function KpiStatTable({ rows, primaryKpi }: { rows: KpiStat[]; primaryKpi: string }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={cn(TH, "text-left")}>KPI</th>
          <th className={cn(TH, "text-right")}>Mean</th>
          <th className={cn(TH, "text-left pl-1")}>± 95% CI</th>
          <th className={cn(TH, "text-right")}>σ</th>
          <th className={cn(TH, "text-right")}>Min</th>
          <th className={cn(TH, "text-right")}>Max</th>
          <th className={cn(TH, "text-right")}>n</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const primary = r.key === primaryKpi;
          const bg = primary ? SELECTED : "#ffffff";
          return (
            <tr key={r.key}>
              <td className={TD} style={{ background: bg }}>
                <span
                  className="inline-block whitespace-nowrap border-l-2 pl-2 text-[12.5px] text-[#18181b]"
                  style={{ borderLeftColor: primary ? "#18181b" : "transparent" }}
                >
                  {r.label}
                </span>
              </td>
              <td className={cn(TD, "pr-1 text-right text-[12.5px] tabular-nums text-[#18181b]")} style={{ background: bg }}>
                {r.mean}
              </td>
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[--zinc-quiet]")} style={{ background: bg }}>
                {r.ci}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#52525b]")} style={{ background: bg }}>
                {r.std}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[--zinc-quiet]")} style={{ background: bg }}>
                {r.min}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[--zinc-quiet]")} style={{ background: bg }}>
                {r.max}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#a1a1aa]")} style={{ background: bg }}>
                {r.n}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export interface CompareRow {
  key: string;
  label: string;
  a: string;
  aci: string;
  b: string;
  bci: string;
  delta: string;
  /** true when B is better than A on this KPI */
  better: boolean | null;
  overlap: boolean;
}

export function CompareTable({ rows }: { rows: CompareRow[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={cn(TH, "text-left")}>KPI</th>
          <th className={cn(TH, "text-right")}>A mean</th>
          <th className={cn(TH, "text-left pl-1")}>± 95% CI</th>
          <th className={cn(TH, "text-right")}>B mean</th>
          <th className={cn(TH, "text-left pl-1")}>± 95% CI</th>
          <th className={cn(TH, "text-right")}>B − A</th>
          <th className={cn(TH, "text-left")}>CI overlap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const bg = "#ffffff";
          const deltaColor = r.better === null ? "var(--zinc-quiet)" : r.better ? "#14b8c4" : "#BF2330";
          return (
            <tr key={r.key}>
              <td className={cn(TD, "whitespace-nowrap text-[12.5px] text-[#18181b]")} style={{ background: bg }}>
                {r.label}
              </td>
              <td
                className={cn(TD, "pr-1 text-right text-[12.5px] tabular-nums text-[#18181b]")}
                style={{ background: bg }}
              >
                {r.a}
              </td>
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[--zinc-quiet]")} style={{ background: bg }}>
                {r.aci}
              </td>
              <td
                className={cn(TD, "pr-1 text-right text-[12.5px] tabular-nums text-[#18181b]")}
                style={{ background: bg }}
              >
                {r.b}
              </td>
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[--zinc-quiet]")} style={{ background: bg }}>
                {r.bci}
              </td>
              <td
                className={cn(TD, "text-right text-[12.5px] font-medium tabular-nums")}
                style={{ background: bg, color: deltaColor }}
              >
                {r.delta}
              </td>
              <td className={TD} style={{ background: bg }}>
                <span className="flex items-center gap-[7px]">
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: r.overlap ? "#a1a1aa" : "#18181b" }}
                  />
                  <span
                    className="whitespace-nowrap text-[11.5px]"
                    style={{ color: r.overlap ? "var(--zinc-quiet)" : "#18181b" }}
                  >
                    {r.overlap ? "overlapping" : "separated"}
                  </span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export interface ImpactRow {
  label: string;
  without: string;
  with: string;
  delta: string;
  better: boolean | null;
}

export function ImpactTable({ head, rows }: { head: string; rows: ImpactRow[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={cn(TH, "text-left")}>{head}</th>
          <th className={cn(TH, "text-right")}>Without</th>
          <th className={cn(TH, "text-right")}>With</th>
          <th className={cn(TH, "text-right")}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const bg = "#ffffff";
          const color = r.better === null ? "var(--zinc-quiet)" : r.better ? "#14b8c4" : "#BF2330";
          return (
            <tr key={r.label}>
              <td className={cn(TD, "whitespace-nowrap text-[12.5px] text-[#18181b]")} style={{ background: bg }}>
                {r.label}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#52525b]")} style={{ background: bg }}>
                {r.without}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#18181b]")} style={{ background: bg }}>
                {r.with}
              </td>
              <td
                className={cn(TD, "text-right text-[12.5px] font-medium tabular-nums")}
                style={{ background: bg, color }}
              >
                {r.delta}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
