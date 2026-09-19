// "What this screen reads" — WP 5.2e, from WP 5.1's lineage block.
//
// ── THE GRADE IS THE WHOLE POINT ──────────────────────────────────────────
//
// WP 5.1 produced 129 lineage entries in three grades that are never blurred:
//
//   `column`  this page names this column in an explicit select
//   `table`   this page reads this table by this path
//   `shell`   reached only through modules ≥80% of pages import — auth and
//             session plumbing, and EXPLICITLY NOT LINEAGE
//
// §4 D82 is what mixing them costs: a 404 page was reported as a surface for
// user data because it imports the session hook like everything else. So the
// generator emits `table`-grade confirmed entries only, and this component says
// exactly what that grade supports — "this screen reads this table" — and never
// more. It does not claim a column is rendered; that needs `column` grade, and
// §4 D83 is the 979 unverifiable field-page pairs that came of guessing.
//
// Every entry carries a `path:line` a reviewer can open, and `contract:check`
// R12 re-opens all of them on every run, so an entry cannot go stale the way
// §4's citations did.

import { Badge } from "@/components/ui/badge";
import { P, Term } from "@/components/docs/prose";
import { tablesReadBy } from "@/components/docs/lineageFacts";

/**
 * The lineage panel for one screen.
 *
 * Deliberately NOT a promise that these are the only tables involved: it is
 * what the confirmed table-grain analysis can see, which is a narrower and
 * truer claim. A page that reads nothing renders the honest empty case rather
 * than being left out.
 */
export function ReadsFrom({ page }: { page: string }) {
  const rows = tablesReadBy(page);
  if (!rows.length) {
    return (
      <P>
        Nothing in the lineage analysis records this screen reading project data by a confirmed
        path. That is a statement about what has been verified, not a guarantee that it reads
        nothing.
      </P>
    );
  }
  return (
    <div className="space-y-2">
      <P>
        {rows.length} {rows.length === 1 ? "table" : "tables"}, each confirmed against the call site
        that reads it. Every line below is re-checked by CI, so it cannot quietly go stale.
      </P>
      <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
        {rows.map((r) => (
          <div key={`${r.table}-${r.evidence}`} className="flex flex-wrap items-baseline gap-2 p-3">
            <Term>{r.table}</Term>
            <Badge variant="outline" className="text-[10px]">
              tier {r.tier}
            </Badge>
            <span className="text-[12px] text-muted-foreground">via {r.via}</span>
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground opacity-70">
              {r.evidence}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
