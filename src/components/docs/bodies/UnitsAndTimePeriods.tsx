// §6.3 section 3's twelfth page (W) — the one that settles `time_unit` against
// `lead_time`, once, beside the tables it governs.
//
// NOT A SECOND UNIT TABLE. The spellings live in
// `supabase/functions/_shared/grading.ts` and are rendered by
// "Units & conventions" in section 15; this page links there rather than
// restating them. What it adds is the thing a table of spellings cannot say:
// WHICH COLUMN a period applies to, which is the misreading that actually costs
// people a run. Every column named below is found by asking the contract which
// ones carry a unit or name one, never by a list typed here.

import { PageTitle, Section, P, Key, Callout, Defs, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

/** Columns whose unit is fixed by the contract, and cannot be changed by a file. */
function fixedUnitColumns() {
  return REFERENCE_TABLES.flatMap((t) =>
    t.columns
      .filter((c) => c.csvHeader && c.unit && !c.unitColumn)
      .map((c) => ({ table: t.table, header: c.csvHeader!, unit: c.unit! })),
  ).sort((a, b) => a.table.localeCompare(b.table) || a.header.localeCompare(b.header));
}

/** Columns whose unit is named by a sibling column on the same row. */
function governedColumns() {
  return REFERENCE_TABLES.flatMap((t) =>
    t.columns
      .filter((c) => c.csvHeader && c.unitColumn)
      .map((c) => ({
        table: t.table,
        header: c.csvHeader!,
        by: c.unitColumn!,
        canonical: c.normalizeAtPromotion?.canonical ?? null,
      })),
  ).sort((a, b) => a.table.localeCompare(b.table) || a.header.localeCompare(b.header));
}

/** Columns that ARE a unit — the ones a reader types a period into. */
function unitColumns() {
  const named = new Set(REFERENCE_TABLES.flatMap((t) => t.columns.map((c) => c.unitColumn)).filter(Boolean));
  const out: { table: string; header: string; governs: string[] }[] = [];
  for (const t of REFERENCE_TABLES) {
    for (const c of t.columns) {
      if (!c.csvHeader) continue;
      const governs = t.columns.filter((x) => x.unitColumn === c.name).map((x) => x.csvHeader ?? x.name);
      // `time_unit` governs `volume` without being declared as its `unit_column`
      // — the contract states that relationship in `volume`'s own unit string
      // ("units per `time_unit`") rather than as a pointer. Both shapes are read
      // here so neither kind of period column is missed.
      const byUnitString = t.columns
        .filter((x) => x.csvHeader && x.unit?.includes(`\`${c.name}\``))
        .map((x) => x.csvHeader!);
      const all = [...new Set([...governs, ...byUnitString])];
      if (all.length || named.has(c.name)) out.push({ table: t.table, header: c.csvHeader, governs: all });
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table) || a.header.localeCompare(b.header));
}

export default function UnitsAndTimePeriods() {
  const fixed = fixedUnitColumns();
  const governed = governedColumns();
  const units = unitColumns();

  return (
    <>
      <PageTitle lead="Which column a period applies to — the question that costs people a run.">
        Units and time periods
      </PageTitle>

      <Section id="the-one-rule" title="The one rule">
        <Key>
          A period column governs the column the contract says it governs, and nothing else on the
          row. It is never “the units for this line”.
        </Key>
        <P>
          Several of the input files carry two quantities with a period in them, and readers
          reasonably assume one setting covers both. It does not, and the two are not even the same
          kind of thing: one is a rate over a period, the other is a duration.
        </P>
      </Section>

      <Callout tone="law" title="time_unit is about volume. Lead times are weeks.">
        <p>
          On an <DocLink to="inbound-logistics">Inbound Logistics</DocLink> row,{" "}
          <Term>time_unit</Term> says what period <Term>volume</Term> is quoted over — 500 a month,
          500 a week. <Term>lead_time</Term> on the same row is fixed at weeks by the contract, and
          has its own optional override, <Term>lead_time_unit</Term>.
        </p>
        <p>
          So <Term>time_unit=month, lead_time=2</Term> means <em>500 a month, delivered in two
          weeks</em>. If the supplier quoted fourteen <em>days</em>, write{" "}
          <Term>lead_time=14</Term> and <Term>lead_time_unit=day</Term> — leaving it out makes it
          fourteen weeks, and nothing will object, because fourteen weeks is a perfectly valid lead
          time.
        </p>
      </Callout>

      <Section id="rates" title="Quantities quoted over a period">
        <P>
          These columns are <em>rates</em>. Their unit is not fixed: another column on the same row
          names the period, and two rows are only comparable once both have been converted to the
          same one.
        </P>
        {units.length > 0 && (
          <Defs
            items={units.map((u) => ({
              term: (
                <>
                  <Term>{u.header}</Term>
                  <span className="ml-2 text-xs text-muted-foreground">{u.table}</span>
                </>
              ),
              def:
                u.governs.length > 0 ? (
                  <>
                    Sets the period for{" "}
                    {u.governs.map((g, i) => (
                      <span key={g}>
                        {i > 0 && ", "}
                        <Term>{g}</Term>
                      </span>
                    ))}{" "}
                    on the same row. Nothing else.
                  </>
                ) : (
                  <>Names a period. It governs no other column on its own row.</>
                ),
            }))}
          />
        )}
      </Section>

      <Section id="durations" title="Durations, and the columns that override them">
        <P>
          A duration is how long something takes. The contract fixes its unit, so a file cannot
          change it by accident — and where a file is allowed to say otherwise, it says so in a
          column of its own.
        </P>
        {governed.length > 0 && (
          <Defs
            items={governed.map((g) => ({
              term: (
                <>
                  <Term>{g.header}</Term>
                  <span className="ml-2 text-xs text-muted-foreground">{g.table}</span>
                </>
              ),
              def: (
                <>
                  Its unit is whatever <Term>{g.by}</Term> says on the same row.
                  {g.canonical && (
                    <>
                      {" "}
                      Whatever you write, it is converted to <Term>{g.canonical}</Term> as it is
                      accepted, and stored that way — so a value already in the table is in that
                      unit and nothing downstream converts it again.
                    </>
                  )}
                </>
              ),
            }))}
          />
        )}
      </Section>

      <Section id="fixed" title="Columns whose unit you cannot change">
        <P>
          Every one of these carries a unit fixed by the contract. There is no column that overrides
          it, and writing a different unit into a neighbouring cell will not be read.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full min-w-[520px] border-collapse">
            <caption className="sr-only">Uploaded columns with a fixed unit</caption>
            <thead>
              <tr>
                {["Column", "In file", "Unit"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="p-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fixed.map((f) => (
                <tr key={`${f.table}.${f.header}`} className="border-t border-border align-top">
                  {/* Frozen on a phone: the header name is what identifies the
                      row, and a table that scrolls the identifier off screen is
                      a table you cannot read (mobile spec §2.7). */}
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-card p-3 text-left font-mono text-[12px] font-medium text-foreground md:static md:bg-transparent"
                  >
                    {f.header}
                  </th>
                  <td className="p-3 font-mono text-[11px] text-muted-foreground">{f.table}</td>
                  <td className="p-3 text-[12px] text-muted-foreground"><Prose text={f.unit} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          {fixed.length} uploaded columns in all. The unit is part of what the column <em>is</em>,
          which is why it is in the contract rather than in a cell.
        </P>
      </Section>

      <Section id="spellings" title="How a period is spelled">
        <P>
          Days, weeks, months, quarters and years, in both the plain and the “-ly” spellings.{" "}
          <DocLink to="units-and-conventions">Units &amp; conventions</DocLink> lists every spelling
          the system accepts and what each one is worth in days — read live from the one table the
          browser, the server and the engine all share.
        </P>
        <P>
          A spelling we do not recognise is treated as weekly. That is a deliberate default and it
          is also a silent one, so check the spelling rather than assuming a rejected value would
          have been reported.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="units-and-conventions">Units &amp; conventions</DocLink> ·{" "}
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink>
        </P>
      </Section>

      <Provenance from="every sidecar's unit, unit_column and normalize_at_promotion declarations" />
    </>
  );
}
