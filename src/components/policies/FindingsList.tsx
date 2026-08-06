// The one findings renderer for the §8.2 vocabulary (block / warn / info) —
// extracted from the /policies Run & Validate verification step so the
// Simulation Lab pre-run panel renders findings IDENTICALLY instead of
// forking the treatment. Optional extras the Lab uses: severity group
// headers, walk-to links into /project-manager (dataMap.ts vocabulary), and
// a per-finding action slot (e.g. the assign-supplier one-click fix).
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LAYER, tint } from "@/components/intelligence/piUi";
import type { Finding, Severity } from "@/lib/policies/validationService";

/** Severity → layer color: blocking is brand red, a warning is the firm
 *  amber, a note is neutral. */
const SEV_COLOR: Record<Severity, string | null> = {
  block: LAYER.brand,
  warn: LAYER.firm,
  info: null,
};

function sevStyle(severity: Severity): React.CSSProperties {
  const c = SEV_COLOR[severity];
  return c
    ? { color: c, borderColor: tint(c, 0.4), background: tint(c, 0.06) }
    : { color: "#8a8a8a", borderColor: "#ebebeb", background: "#fafafa" };
}

const GROUP_LABEL: Record<Severity, string> = {
  block: "Blocking — must be fixed before the run can dispatch",
  warn: "Warnings — engine defaults apply; acknowledge to run anyway",
  info: "Notes — derived values, nothing to do",
};

interface Props {
  findings: Finding[];
  /** Render severity section headers (Lab pre-run panel). */
  groupBySeverity?: boolean;
  /** Route for a finding's walk-to link; return null to omit. */
  walkTo?: (f: Finding) => string | null;
  /** Extra per-finding UI (e.g. a one-click remediation control). */
  action?: (f: Finding) => React.ReactNode;
  className?: string;
}

export function FindingsList({ findings, groupBySeverity, walkTo, action, className }: Props) {
  const order: Severity[] = ["block", "warn", "info"];
  const groups: Array<{ severity: Severity | null; items: Finding[] }> = groupBySeverity
    ? order
        .map((severity) => ({ severity: severity as Severity | null, items: findings.filter((f) => f.severity === severity) }))
        .filter((g) => g.items.length > 0)
    : [{ severity: null, items: findings }];

  return (
    <div className={cn("max-h-72 overflow-auto rounded-sm border border-[#ebebeb]", className)}>
      {groups.map((g, gi) => (
        <div key={g.severity ?? gi}>
          {g.severity && (
            <div
              className="border-b border-[#ebebeb] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={sevStyle(g.severity)}
            >
              {GROUP_LABEL[g.severity]}
            </div>
          )}
          <ul className="divide-y divide-[#f4f4f4] text-[12px]">
            {g.items.map((f) => {
              const route = walkTo?.(f) ?? null;
              const c = SEV_COLOR[f.severity];
              return (
                <li
                  key={f.id}
                  className="flex items-start gap-2 border-l-2 px-2.5 py-1.5"
                  style={sevStyle(f.severity)}
                >
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: c ?? "#c4c4c4" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{f.message}</div>
                    {(f.rowKey || f.field || f.policy) && (
                      <div className="font-mono text-[10px] opacity-70">
                        {[f.rowKey, f.field, f.policy && f.policy !== "engine" ? `demanded by ${f.policy}` : f.policy]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                    {f.hint && <div className="mt-0.5 text-[10.5px] opacity-80">{f.hint}</div>}
                    {action?.(f)}
                  </div>
                  {route && (
                    <Link
                      to={route}
                      className="shrink-0 whitespace-nowrap font-mono text-[10px] underline-offset-2 hover:underline"
                      title="Open the editor for this field in the Project Manager"
                    >
                      fix data ↗
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
