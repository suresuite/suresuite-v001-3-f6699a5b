// The one findings renderer for the §8.2 vocabulary (block / warn / info) —
// extracted from the /policies Run & Validate verification step so the
// Simulation Lab pre-run panel renders findings IDENTICALLY instead of
// forking the treatment. Optional extras the Lab uses: severity group
// headers, walk-to links into /project-manager (dataMap.ts vocabulary), and
// a per-finding action slot (e.g. the assign-supplier one-click fix).
import { Link } from "react-router-dom";
import { AlertOctagon, AlertTriangle, ArrowUpRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding, Severity } from "@/lib/policies/validationService";

const SEV_ICON = { block: AlertOctagon, warn: AlertTriangle, info: Info } as const;
const SEV_COLOR = {
  block: "text-destructive border-destructive/40 bg-destructive/10",
  warn: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10",
  info: "text-muted-foreground border-border bg-muted/40",
} as const;

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
    <div className={cn("max-h-72 overflow-auto rounded-md border", className)}>
      {groups.map((g, gi) => (
        <div key={g.severity ?? gi}>
          {g.severity && (
            <div className={cn("px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest border-b", SEV_COLOR[g.severity])}>
              {GROUP_LABEL[g.severity]}
            </div>
          )}
          <ul className="text-xs divide-y">
            {g.items.map((f) => {
              const Icon = SEV_ICON[f.severity];
              const route = walkTo?.(f) ?? null;
              return (
                <li key={f.id} className={cn("flex items-start gap-2 px-2.5 py-1.5 border-l-2", SEV_COLOR[f.severity])}>
                  <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{f.message}</div>
                    {(f.rowKey || f.field || f.policy) && (
                      <div className="text-[10px] opacity-70 font-mono">
                        {[f.rowKey, f.field, f.policy && f.policy !== "engine" ? `demanded by ${f.policy}` : f.policy]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                    {f.hint && <div className="text-[10px] opacity-80 mt-0.5">{f.hint}</div>}
                    {action?.(f)}
                  </div>
                  {route && (
                    <Link
                      to={route}
                      className="shrink-0 inline-flex items-center gap-0.5 text-[10px] underline-offset-2 hover:underline whitespace-nowrap"
                      title="Open the editor for this field in the Project Manager"
                    >
                      Fix data <ArrowUpRight className="h-3 w-3" />
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
