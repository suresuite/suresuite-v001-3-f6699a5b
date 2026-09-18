// The unit table is READ, not restated (§6.3 marks this page G).
//
// `UNIT_DAYS` is imported live from the one table this repository has —
// `supabase/functions/_shared/grading.ts`, which is dependency-free TypeScript
// precisely so that the browser, the edge functions and the tests can all read
// the same object. `contract:units -- --check` generates the SQL mirror from it
// and `unitTableParity.test.ts` pins TypeScript, SQL and Python against each
// other, so a unit added to one and not the others fails the build.
//
// The alternative — a table of spellings typed into this page — is D10 with
// extra steps: the defect where `quarter` matched none of three SQL branches
// and a quarterly rate was silently read as a weekly one, 13x its real value.

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { PageTitle, Section, P, Key, Callout, Defs, Prose, Provenance, Term, DocLink } from "@/components/docs/prose";
import { UNIT_DAYS } from "../../../../supabase/functions/_shared/grading";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

/** Spellings grouped by the period they mean. */
function periods() {
  const byDays = new Map<number, string[]>();
  for (const [spelling, days] of Object.entries(UNIT_DAYS)) {
    if (!byDays.has(days)) byDays.set(days, []);
    byDays.get(days)!.push(spelling);
  }
  return [...byDays.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, spellings]) => ({ days, spellings: spellings.sort() }));
}

/** Every described column that declares a unit, from the contract. */
function unitedColumns() {
  const out: { table: string; column: string; unit: string }[] = [];
  for (const t of REFERENCE_TABLES) {
    for (const c of t.columns) {
      if (c.unit) out.push({ table: t.table, column: c.csvHeader ?? c.name, unit: c.unit });
    }
  }
  return out.sort((a, b) => a.unit.localeCompare(b.unit) || a.table.localeCompare(b.table));
}

export default function UnitsAndConventions() {
  const rows = useMemo(periods, []);
  const united = useMemo(unitedColumns, []);
  const spellingCount = Object.keys(UNIT_DAYS).length;

  return (
    <>
      <PageTitle lead="Every unit the system understands, what each one means, and where the definition lives.">
        Units &amp; conventions
      </PageTitle>

      <Section id="time-periods" title="Time periods">
        <P>
          Wherever you give a period — a lead time, a rate, a window — you may spell it any of
          the ways below. They are understood identically, and anything not on this list is
          rejected at upload rather than guessed at.
        </P>
        <Key>
          {spellingCount} accepted spellings, {rows.length} distinct periods. One table, read by
          the browser, the database and the engine alike.
        </Key>

        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full min-w-[520px] border-collapse">
            <caption className="sr-only">Accepted unit spellings and their length in days</caption>
            <thead>
              <tr>
                {["Period", "In days", "Ways you may write it"].map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${
                      i === 1 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.days} className="border-t border-border align-top">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-card p-3 text-left font-medium md:static md:bg-transparent"
                  >
                    {r.spellings[0]}
                  </th>
                  <td className="whitespace-nowrap p-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.days}
                  </td>
                  <td className="p-3">
                    <ul className="flex flex-wrap gap-1.5">
                      {r.spellings.map((s) => (
                        <li key={s}>
                          <span className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {s}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Callout title="Why a month is 30.4375 days">
          <p>
            It is a year divided by twelve, and a year is 365.25 days — the average that accounts
            for leap years. Using 30 or 31 would make a monthly rate drift against a yearly one,
            and the drift would show up as a small unexplained difference in a result nobody
            could trace. The quarter follows from the same arithmetic.
          </p>
        </Callout>
      </Section>

      <Section id="one-table" title="One table, three languages">
        <P>
          Conversion is defined exactly once, in TypeScript. The database's version is{" "}
          <strong className="text-foreground">generated</strong> from it, and the engine's Python
          copy is checked against it on every build. Adding a unit to one and not the others
          fails CI.
        </P>
        <Callout tone="law" title="This is a fix, not a design flourish">
          <p>
            There used to be three conversions. Two agreed; the third lived in a database view as
            a handful of pattern matches with a catch-all, so a row quoted in{" "}
            <Term>quarter</Term> matched none of them, fell through to the catch-all, and was
            read as weekly — thirteen times its real value, silently, on that product's demand.
            Nothing failed. The number was simply wrong.
          </p>
        </Callout>
        <P>
          Conversion happens once, when data is promoted into your project, and nothing
          downstream converts anything again. That is what stops a value being converted twice —
          the failure that turns a week into a month and looks entirely ordinary on screen. See{" "}
          <DocLink to="how-your-data-flows">How your data flows</DocLink>.
        </P>
      </Section>

      <Section id="fields-with-units" title="Fields that carry a unit">
        <P>
          {united.length} described fields declare a unit. Where a field's unit is set by another
          column — a lane's lead time reading its own <Term>lead_time_unit</Term> — that is
          recorded against the field in <DocLink to="all-tables">All tables</DocLink>.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full min-w-[480px] border-collapse">
            <caption className="sr-only">Described fields that declare a unit</caption>
            <thead>
              <tr>
                {["Field", "Table", "Unit"].map((h) => (
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
              {united.map((u) => (
                <tr key={`${u.table}.${u.column}`} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-card p-3 text-left font-normal md:static md:bg-transparent"
                  >
                    <span className="font-mono text-[12px] text-foreground">{u.column}</span>
                  </th>
                  <td className="p-3 font-mono text-[12px] text-muted-foreground">{u.table}</td>
                  <td className="p-3 text-[12px] text-muted-foreground"><Prose text={u.unit} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="other-conventions" title="Other conventions">
        <Defs
          items={[
            {
              term: "Money",
              def: "Prices and costs are plain numbers in one currency of your choosing, consistently across a project. The system does no conversion and holds no exchange rates — a project mixing currencies produces arithmetic nobody should act on.",
            },
            {
              term: "Percentages",
              def: "Fields named as a percentage are given as a percentage, not a fraction: a holding cost of 20 % is 20, not 0.2. The field's own entry in All tables states which it expects.",
            },
            {
              term: "Quantities",
              def: "Counts of physical units, consistent within a material. The system does not convert kilograms to units or pallets to cases.",
            },
            {
              term: "The simulation clock",
              def: "The engine advances one week at a time. Periods you supply in other units are converted to weeks on the way in, so a lead time of 10 days becomes a lead time the engine reads in weeks.",
            },
            {
              term: "Dates",
              def: "Calendar dates are ISO — four-digit year, two-digit month, two-digit day.",
            },
          ]}
        />
        <Callout tone="limit" title="Consistency is yours to keep">
          <p>
            Nothing checks that every price in a project is in the same currency, or that every
            quantity counts the same kind of thing. The unit table settles time; money and
            quantity are conventions the software trusts you to hold. That is a real limit and it
            belongs on <DocLink to="known-limits">Known limits</DocLink> rather than in a
            footnote.
          </p>
        </Callout>
      </Section>

      <Section id="where-defined" title="Where this is defined">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            supabase/functions/_shared/grading.ts
          </Badge>
          <Badge variant="secondary" className="text-[10px]">UNIT_DAYS</Badge>
        </div>
        <P>
          This page imports that object directly rather than copying it, so the table above is
          the table the software uses — not a description of it. For the narrative difference
          between a lane's time unit and its lead time, see{" "}
          <DocLink to="units-and-time-periods">Units and time periods</DocLink>.
        </P>
      </Section>

      <Provenance from="grading.ts::UNIT_DAYS, read directly, and the unit declarations in the data contract" />
    </>
  );
}
