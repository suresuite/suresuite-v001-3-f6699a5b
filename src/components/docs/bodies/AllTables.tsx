// GENERATED CONTENT, authored narrative (§6.3 section 15 marks this page G).
//
// Not one table name, column name, type, unit, constraint or substitution below
// is typed. They come from `generated/reference.generated.ts`, which the data
// contract emits from the sidecars, and from `generated/dataModel.generated.ts`
// for the tables nothing describes yet. If you find yourself about to type a
// column name into this file, the answer is a sidecar edit.
//
// THE HONESTY CONDITION (§5.3 T3): every table in the schema appears, either
// with its columns or under the work package that owes it. A page called "All
// tables" that showed only the described ones would be making a false claim by
// omission — which is the whole reason this page is shaped the way it is.

import { Badge } from "@/components/ui/badge";
import { PageTitle, Section, P, Key, Callout, Prose, Provenance, Term, DocLink } from "@/components/docs/prose";
import { REFERENCE_TABLES, type RefColumn } from "@/components/docs/generated/reference.generated";
import { COUNTS, UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

/** The name the user types, where the table is one they upload. */
function LeadName({ c }: { c: RefColumn }) {
  // D21: the CSV header leads, because it is the name the reader has in front
  // of them. The database name follows in smaller type when the two differ.
  const header = c.csvHeader;
  return (
    <>
      <span className="block font-mono text-[12px] font-medium text-foreground">
        {header ?? c.name}
      </span>
      {header && header !== c.name && (
        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
          stored as {c.name}
        </span>
      )}
      {!header && <span className="mt-0.5 block text-[11px] text-muted-foreground">not uploaded</span>}
    </>
  );
}

function ColumnRow({ table, c }: { table: string; c: RefColumn }) {
  const id = `${table}.${c.name}`;
  return (
    <tr id={id} className="scroll-mt-20 border-t border-border align-top">
      <th scope="row" className="sticky left-0 z-[1] bg-card p-3 text-left font-normal md:static md:bg-transparent">
        <LeadName c={c} />
      </th>
      <td className="whitespace-nowrap p-3 text-[12px] text-muted-foreground">
        <span className="font-mono">{c.type}</span>
        {c.unit && <span className="mt-0.5 block">in {c.unit}</span>}
      </td>
      <td className="p-3 text-sm leading-relaxed text-muted-foreground">
        {c.meaning ? <Prose text={c.meaning} /> : "—"}
        {c.validate && (
          <span className="mt-1 block text-[12px]">
            <span className="text-foreground">Checked:</span> <Prose text={c.validate} />
          </span>
        )}
        {c.substitutions.map((s, i) => (
          <span key={i} className="mt-1 block text-[12px]">
            <span className="text-foreground">If missing:</span> <Prose text={s.value} /> — <Prose text={s.when} />
            {s.provenance ? ` (shown as ${s.provenance})` : ""}
          </span>
        ))}
        {c.engineChain && (
          <span className="mt-1 block text-[12px]">
            <span className="text-foreground">Engine fallback:</span>{" "}
            <span className="font-mono">{c.engineChain}</span>
          </span>
        )}
      </td>
      <td className="whitespace-nowrap p-3 text-right text-[11px] text-muted-foreground">
        {c.required && <Badge variant="secondary" className="text-[10px]">required</Badge>}
        {!c.required && !c.nullable && <span>never empty</span>}
        {c.primaryKey && <span className="mt-0.5 block">key</span>}
      </td>
    </tr>
  );
}

export default function AllTables() {
  return (
    <>
      <PageTitle lead="Every table in the system, and every column of every table the contract describes.">
        All tables
      </PageTitle>

      <Section id="how-to-read-this" title="How to read this page">
        <P>
          This is the detailed index. For the shape of the system rather than its
          detail, <DocLink to="data-model">The data model at a glance</DocLink> is the map;
          for a single field, <DocLink to="field-index">Field index</DocLink> lists every one
          alphabetically.
        </P>
        <Key>
          {COUNTS.tablesInSchema} tables exist. {COUNTS.tablesDescribed} are described here in
          full — {COUNTS.columnsDescribed} columns. The other {COUNTS.tablesUndescribed} are
          listed at the bottom, each under the work package that will describe it.
        </Key>
        <Callout title="Columns lead with the name you type">
          <p>
            Where a column is one you upload, the CSV header is the name shown first and the
            stored name follows underneath. They are usually the same and occasionally not — a
            products file says <Term>sell_price</Term> where the engine says{" "}
            <Term>unit_price</Term>. Leading with the engine's vocabulary is what made the
            previous manual unusable to the person holding the file.
          </p>
        </Callout>
        <P>
          Every row has a stable address: <Term>#table.column</Term>. Linking someone to one
          exact field is a link, not an instruction to scroll.
        </P>
      </Section>

      {REFERENCE_TABLES.map((t) => (
        <Section key={t.table} id={t.table} title={t.table}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Tier {t.tier}</Badge>
            <Badge variant="outline">{t.owner}</Badge>
            <span className="text-xs text-muted-foreground">
              {t.columns.length} columns
            </span>
          </div>
          <P><Prose text={t.grain} /></P>

          {t.naturalKeyIntended && t.naturalKey.length <= 1 && (
            <Callout tone="limit" title="Re-uploading duplicates these rows">
              <p>
                One row should be identified by{" "}
                {t.naturalKeyIntended.map((k, i) => (
                  <span key={k}>
                    {i > 0 && " + "}
                    <Term>{k}</Term>
                  </span>
                ))}
                , and the table does not yet enforce it. Uploading the same file twice adds the
                rows twice. See <DocLink to="known-limits">Known limits</DocLink>.
              </p>
            </Callout>
          )}

          <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
            <table className="w-full min-w-[720px] border-collapse">
              <caption className="sr-only">Columns of {t.table}</caption>
              <thead>
                <tr>
                  {["Column", "Type", "What it means", ""].map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className={`p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${
                        i === 3 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <ColumnRow key={c.name} table={t.table} c={c} />
                ))}
              </tbody>
            </table>
          </div>

          {t.checks.length > 0 && (
            <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Rules the database enforces
              </div>
              <ul className="space-y-1.5">
                {t.checks.map((c) => (
                  // A CHECK on an enum is a long quoted list with no spaces after
                  // its commas — one unbreakable token that spills off a phone and
                  // takes the whole page's width with it. `break-words` breaks it.
                  <li key={c.name} className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {c.definition}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      ))}

      <Section id="not-yet-described" title="Not yet described">
        <P>
          These {COUNTS.tablesUndescribed} tables exist and hold real data. What they lack is a
          description of every column — the thing this page is generated from. Each is listed
          under the work package that owes it, so the index is complete and true rather than
          partial and quiet.
        </P>
        {UNDESCRIBED.map((g) => (
          <div key={g.wp} className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">WP {g.wp}</Badge>
              <span className="text-xs text-muted-foreground">
                {g.tables.length} {g.tables.length === 1 ? "table" : "tables"}
              </span>
            </div>
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{g.why}</p>
            <ul className="flex flex-wrap gap-1.5">
              {g.tables.map((t) => (
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

      <Provenance from="every sidecar in the data contract, joined to the schema and the engine registry" />
    </>
  );
}
