import { cn } from "@/lib/utils";

/**
 * Tables of numbers stay tables of numbers. What changed is legibility:
 * zebra banding, each ± CI attached to the mean it belongs to, deltas at
 * #71717a when zero (was #a8a8a8, under 3:1), and one TH/TD treatment shared
 * with ProjectIntelligence.
 */

const TH =
  "bg-[#f4f4f5] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#52525b] border-b border-[#e0e0e3]";
const TD = "px-3 py-1.5 border-b border-[#ececee]";
const band = (i: number) => (i % 2 ? "#fcfcfd" : "#ffffff");

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
        {rows.map((r, i) => {
          const primary = r.key === primaryKpi;
          const bg = primary ? "#f4f4f5" : band(i);
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
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[#71717a]")} style={{ background: bg }}>
                {r.ci}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#52525b]")} style={{ background: bg }}>
                {r.std}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#71717a]")} style={{ background: bg }}>
                {r.min}
              </td>
              <td className={cn(TD, "text-right text-[12.5px] tabular-nums text-[#71717a]")} style={{ background: bg }}>
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
        {rows.map((r, i) => {
          const bg = band(i);
          const deltaColor = r.better === null ? "#71717a" : r.better ? "#14b8c4" : "#BF2330";
          return (
            <tr key={r.key}>
              <td className={cn(TD, "whitespace-nowrap text-[12.5px] text-[#18181b]")} style={{ background: bg }}>
                {r.label}
              </td>
              <td
                className={cn(TD, "border-l border-l-[#ececee] pr-1 text-right text-[12.5px] tabular-nums text-[#18181b]")}
                style={{ background: bg }}
              >
                {r.a}
              </td>
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[#71717a]")} style={{ background: bg }}>
                {r.aci}
              </td>
              <td
                className={cn(TD, "border-l border-l-[#ececee] pr-1 text-right text-[12.5px] tabular-nums text-[#18181b]")}
                style={{ background: bg }}
              >
                {r.b}
              </td>
              <td className={cn(TD, "pl-1 text-left text-[11.5px] tabular-nums text-[#71717a]")} style={{ background: bg }}>
                {r.bci}
              </td>
              <td
                className={cn(TD, "border-l border-l-[#ececee] text-right text-[12.5px] font-medium tabular-nums")}
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
                    style={{ color: r.overlap ? "#71717a" : "#18181b" }}
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
        {rows.map((r, i) => {
          const bg = band(i);
          const color = r.better === null ? "#71717a" : r.better ? "#14b8c4" : "#BF2330";
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
                className={cn(TD, "border-l border-l-[#ececee] text-right text-[12.5px] font-medium tabular-nums")}
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
