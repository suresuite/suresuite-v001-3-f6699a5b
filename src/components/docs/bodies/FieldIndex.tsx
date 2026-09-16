// GENERATED CONTENT (§6.3 section 15 marks this page G).
//
// Every entry is derived from `reference.generated.ts` at render time — the same
// data "All tables" renders, flattened and sorted. There is no second list to
// fall out of step with the first, which is the point: a field index maintained
// by hand is a field index that is wrong about exactly the field you looked up.

import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageTitle, Section, P, Key, Provenance, Term, DocLink } from "@/components/docs/prose";
import { REFERENCE_TABLES, REFERENCE_COLUMN_COUNT } from "@/components/docs/generated/reference.generated";

type Entry = {
  /** The name the reader is most likely to search for — the CSV header where there is one. */
  name: string;
  stored: string;
  table: string;
  type: string;
  unit: string | null;
  uploaded: boolean;
};

/** Flatten every column of every described table, A to Z. */
function buildIndex(): Entry[] {
  const out: Entry[] = [];
  for (const t of REFERENCE_TABLES) {
    for (const c of t.columns) {
      out.push({
        name: c.csvHeader ?? c.name,
        stored: c.name,
        table: t.table,
        type: c.type,
        unit: c.unit,
        uploaded: Boolean(c.csvHeader),
      });
    }
  }
  return out.sort(
    (a, b) => a.name.localeCompare(b.name) || a.table.localeCompare(b.table),
  );
}

export default function FieldIndex() {
  const all = useMemo(buildIndex, []);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.stored.toLowerCase().includes(needle) ||
        e.table.toLowerCase().includes(needle),
    );
  }, [all, q]);

  const letters = useMemo(() => {
    const seen = new Set<string>();
    for (const e of shown) seen.add(e.name[0].toUpperCase());
    return [...seen].sort();
  }, [shown]);

  return (
    <>
      <PageTitle lead="Every field the contract describes, alphabetically, with the table it belongs to.">
        Field index
      </PageTitle>

      <Section id="how-to-use-this" title="How to use this page">
        <P>
          You have a column name and you want to know what it is. Start typing — the list
          filters on the name you type, the name it is stored under, and the table.
        </P>
        <Key>
          {REFERENCE_COLUMN_COUNT} fields across {REFERENCE_TABLES.length} described tables.
        </Key>
        <P>
          Entries are listed under the name <strong className="text-foreground">you type</strong>{" "}
          where the field is one you upload, with the stored name beside it when the two differ.
          Fields the system fills in itself are marked <Term>internal</Term>. Every row links to
          that exact column in <DocLink to="all-tables">All tables</DocLink>.
        </P>
      </Section>

      <Section id="the-index" title="The index">
        <div className="sticky top-14 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter fields…"
            aria-label="Filter fields"
            className="h-11 md:h-9"
          />
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            <span>{shown.length} shown</span>
            {letters.length > 0 && <span>· {letters.join(" ")}</span>}
          </div>
        </div>

        {shown.length === 0 ? (
          <P>
            Nothing matches “{q}”. If it is a field you have in a file, it may belong to a table
            the contract does not describe yet — those are listed at the foot of{" "}
            <DocLink to="all-tables">All tables</DocLink>.
          </P>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
            <table className="w-full min-w-[560px] border-collapse">
              <caption className="sr-only">Every described field, alphabetically</caption>
              <thead>
                <tr>
                  {["Field", "Table", "Type", ""].map((h, i) => (
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
                {shown.map((e) => (
                  <tr key={`${e.table}.${e.stored}`} className="border-t border-border align-top">
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] bg-card p-3 text-left font-normal md:static md:bg-transparent"
                    >
                      <Link
                        to={`/docs/all-tables#${e.table}.${e.stored}`}
                        className="font-mono text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {e.name}
                      </Link>
                      {e.name !== e.stored && (
                        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                          stored as {e.stored}
                        </span>
                      )}
                    </th>
                    <td className="p-3 font-mono text-[12px] text-muted-foreground">{e.table}</td>
                    <td className="whitespace-nowrap p-3 text-[12px] text-muted-foreground">
                      <span className="font-mono">{e.type}</span>
                      {e.unit && <span className="mt-0.5 block">in {e.unit}</span>}
                    </td>
                    <td className="whitespace-nowrap p-3 text-right">
                      {!e.uploaded && (
                        <Badge variant="outline" className="text-[10px]">
                          internal
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Provenance from="every column of every sidecar in the data contract" />
    </>
  );
}
