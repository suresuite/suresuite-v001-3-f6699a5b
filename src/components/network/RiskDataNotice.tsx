import { AlertTriangle } from "lucide-react";

/**
 * D4 — `risk_data` is read by the product-level and firm-level network pages to
 * shade every node by its country's risk class. Until WP 1.4 it existed in **no
 * migration**: the read failed, the pages logged a `console.warn` and carried
 * on, and the country-risk map stayed empty — so every node rendered as
 * "Unknown" and the map lost its risk shading, with nothing on screen to say a
 * data source was missing rather than benign.
 *
 * A graph that quietly drops a dimension is worse than one that admits it
 * (PLAN.md §5: negative transparency outranks positive). This says so, once,
 * where the graph is.
 *
 * WP 1.4 reconciled the orphan: the table is real
 * (`20260915000003_risk_data.sql`), project-independent reference data with
 * `source` / `vintage` / `licence` / `refreshed_at`. The read therefore succeeds
 * now — and this notice still earns its place, because an EMPTY table renders
 * exactly like an unreadable one. `reason` distinguishes them.
 */
export function RiskDataNotice({ reason }: { reason?: string | null }) {
  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-amber-900"
    >
      <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium">Country risk is not shown.</strong>{" "}
        The <code className="font-mono">risk_data</code> reference table is empty or could not be
        read, so every node&rsquo;s risk class reads &ldquo;Unknown&rdquo; and the map is not
        risk-shaded. The rest of the network is unaffected.
        {reason ? <span className="block opacity-70">Reason: {reason}</span> : null}
      </span>
    </div>
  );
}
