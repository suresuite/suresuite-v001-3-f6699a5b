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
import { DocPageTitle, InShort, Section, P, Key, Callout, Prose, Provenance, DocLink } from "@/components/docs/prose";
import { ALL_PAGES } from "@/components/docs/registry";
import { COUNTS, TIERS, UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

/** The manual page that is this table's reference, if the site map has one. */
function pageForTable(table: string) {
  return ALL_PAGES.find((p) => p.table === table);
}

// The first sentence describes one record; engineering history stays in source metadata.
function TableRow({ table, grain, columns }: { table: string; grain: string; columns: number }) {
  const page = pageForTable(table);
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="sticky left-0 z-[1] bg-card p-3 text-left font-normal md:static md:bg-transparent">
        <span className="font-mono text-[12px] font-medium text-foreground">{table}</span>
        <span className="mt-1 block text-[11px] text-muted-foreground">{columns} columns</span>
      </th>
      <td className="p-3 text-sm leading-relaxed text-muted-foreground"><Prose text={grain.split(/(?<=\.)\s/)[0].replace(/\([^)]*(?:§4|WP \d)[^)]*\)/g, "").trim()} /></td>
      <td className="whitespace-nowrap p-3 text-right text-xs">
        {page ? (
          page.status === "live" ? (
            <Link to={`/docs/${page.slug}`} className="text-primary underline-offset-2 hover:underline">
              {page.title}
            </Link>
          ) : (
            <span className="text-muted-foreground">Reference planned</span>
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
      <DocPageTitle slug="data-model" />
      <InShort items={[
        "This is a reference map of tables: stored lists of records with named fields.",
        "Use the six tier numbers (stages in your data's life) to distinguish inputs, computed views, decisions and results.",
        <>New to the tool? Read <DocLink to="how-suresuite-is-designed">the architecture overview</DocLink> first. Return here when you need a field reference.</>,
      ]} />

      <Section id="how-to-read-this" title="How to read this page">
        <P>
          Tiers are the stages data passes through, described on{" "}
          <DocLink to="how-suresuite-is-designed">How SuReSuite is designed</DocLink>. A table's
          tier tells you what it is for and who writes it: tier 2 holds accepted input facts, tier 3 holds computed views, tier 4 holds decisions, and tier 5 holds version-bound results. The overview explains the rules and their current exceptions.
        </P>
        <Key>
          {COUNTS.tablesInSchema} tables, of which {COUNTS.tablesDescribed} are described by the
          data contract (the shared definitions of fields and units) today — {COUNTS.columnsDescribed} columns in all.
        </Key>
        <Callout title="Why the other tables are listed rather than hidden">
          <p>
            A page called “the data model” that showed only the {COUNTS.tablesDescribed} described
            tables would be making a false claim by omission. The remaining{" "}
            {COUNTS.tablesUndescribed} are listed at the bottom of this page while their field
            descriptions are pending. You can see what exists, what is explained, and what is
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
          manual is generated from. Both lists are checked against the actual database, so a
          table cannot silently disappear from this map.
        </P>
        {UNDESCRIBED.map((group) => (
          <div key={group.wp} className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">Field descriptions pending</Badge>
              <span className="text-xs text-muted-foreground">
                {group.tables.length} {group.tables.length === 1 ? "table" : "tables"}
              </span>
            </div>
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
          <DocLink to="field-index">Field index</DocLink> lists every field alphabetically. Start there for a field definition, unit or constraint.
        </P>
      </Section>

      <Provenance from="the schema, the table descriptions in the data contract, and the coverage record" />
    </>
  );
}
