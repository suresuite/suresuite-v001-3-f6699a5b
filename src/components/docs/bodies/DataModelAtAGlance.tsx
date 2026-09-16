// The one page in sections 1 and 2 that is GENERATED (§6.3 marks it G).
//
// Nothing below names a table. The tiers, the tables, the grains, the column
// counts and the coverage figures are all read from
// `generated/dataModel.generated.ts`, which the data-contract generator writes
// from the schema, the sidecars and coverage.yaml. A hand-written table list
// would be right on the day it was typed and wrong by the next migration —
// which is the defect (D21, D22) this phase exists to end.

import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PageTitle, Section, P, Key, Callout, Prose, Provenance, Term, DocLink } from "@/components/docs/prose";
import { ALL_PAGES } from "@/components/docs/registry";
import { COUNTS, TIERS, UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

/** The manual page that is this table's reference, if the site map has one. */
function pageForTable(table: string) {
  return ALL_PAGES.find((p) => p.table === table);
}

function TableRow({ table, grain, columns }: { table: string; grain: string; columns: number }) {
  const page = pageForTable(table);
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="sticky left-0 z-[1] bg-card p-3 text-left font-normal md:static md:bg-transparent">
        <span className="font-mono text-[12px] font-medium text-foreground">{table}</span>
        <span className="mt-1 block text-[11px] text-muted-foreground">{columns} columns</span>
      </th>
      <td className="p-3 text-sm leading-relaxed text-muted-foreground"><Prose text={grain} /></td>
      <td className="whitespace-nowrap p-3 text-right text-xs">
        {page ? (
          page.status === "live" ? (
            <Link to={`/docs/${page.slug}`} className="text-primary underline-offset-2 hover:underline">
              {page.title}
            </Link>
          ) : (
            <span className="text-muted-foreground">WP {page.wp}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

export default function DataModelAtAGlance() {
  return (
    <>
      <PageTitle lead="Every table in the system, grouped by the tier its data sits in. The map worth keeping open in another tab.">
        The data model at a glance
      </PageTitle>

      <Section id="how-to-read-this" title="How to read this page">
        <P>
          Tiers are the stages data passes through, described on{" "}
          <DocLink to="how-suresuite-is-designed">How SuReSuite is designed</DocLink>. A table's
          tier tells you what it is for and who writes it: tier 2 is the only tier a person edits,
          tier 3 is always rebuildable, and tier 5 is stamped and never rewritten.
        </P>
        <Key>
          {COUNTS.tablesInSchema} tables, of which {COUNTS.tablesDescribed} are described by the
          data contract today — {COUNTS.columnsDescribed} columns in all.
        </Key>
        <Callout title="Why the other tables are listed rather than hidden">
          <p>
            A page called “the data model” that showed only the {COUNTS.tablesDescribed} described
            tables would be making a false claim by omission. The remaining{" "}
            {COUNTS.tablesUndescribed} are listed at the bottom of this page, each under the work
            package that will document it. You can see what exists, what is explained, and what is
            not yet — which is the whole of commitment T3 on{" "}
            <DocLink to="what-happens-to-your-data">What happens to your data</DocLink>.
          </p>
        </Callout>
      </Section>

      {TIERS.map((tier) => (
        <Section key={tier.tier} id={`tier-${tier.tier.toLowerCase()}`} title={`Tier ${tier.tier}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tier.name}</Badge>
            <span className="text-xs text-muted-foreground">
              {tier.tables.length} {tier.tables.length === 1 ? "table" : "tables"}
            </span>
          </div>
          <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
            <table className="w-full min-w-[560px] border-collapse">
              <caption className="sr-only">Tables in tier {tier.tier}</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Table
                  </th>
                  <th scope="col" className="p-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    One row is
                  </th>
                  <th scope="col" className="p-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Reference
                  </th>
                </tr>
              </thead>
              <tbody>
                {tier.tables.map((t) => (
                  <TableRow key={t.table} table={t.table} grain={t.grain} columns={t.columns} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}

      <Section id="not-yet-described" title="Not yet described">
        <P>
          These {COUNTS.tablesUndescribed} tables exist in the schema and carry real data. What they
          do not yet have is a written description of every column — the thing the rest of this
          manual is generated from. Each is listed here under the work package that owes it, and a
          table that appeared in neither list would fail the build.
        </P>
        {UNDESCRIBED.map((group) => (
          <div key={group.wp} className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">WP {group.wp}</Badge>
              <span className="text-xs text-muted-foreground">
                {group.tables.length} {group.tables.length === 1 ? "table" : "tables"}
              </span>
            </div>
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{group.why}</p>
            <ul className="flex flex-wrap gap-1.5">
              {group.tables.map((t) => (
                <li key={t.table}>
                  <span className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {t.table}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section id="the-detailed-index" title="Looking for a specific column?">
        <P>
          This page is the map. The detailed index — every column of every described table, with its
          type, unit and constraints — is <DocLink to="all-tables">All tables</DocLink>, and{" "}
          <DocLink to="field-index">Field index</DocLink> lists every field alphabetically. Both
          arrive with WP 5.2h. In the meantime the same facts are generated for the team under{" "}
          <Term>docs/data/tables/</Term>.
        </P>
      </Section>

      <Provenance from="the schema, the table descriptions in the data contract, and the coverage record" />
    </>
  );
}
