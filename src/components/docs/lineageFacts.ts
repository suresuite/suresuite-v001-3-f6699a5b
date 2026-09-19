// The lineage facts behind §6.3 sections 8 and 9 — WP 5.2e.
//
// A function, not a component, for the reason `tableFacts.ts` exists.
// The grade discipline that makes this safe to publish is documented in
// `lineage.tsx`, which is the only thing that renders it.

import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

/** Tables a given page reads, table-grain, with the path each read goes by. */
export function tablesReadBy(page: string) {
  return REFERENCE_TABLES.flatMap((t) =>
    t.surfaces.filter((s) => s.page === page).map((s) => ({ table: t.table, via: s.via, evidence: s.evidence, tier: t.tier })),
  ).sort((a, b) => a.table.localeCompare(b.table));
}
