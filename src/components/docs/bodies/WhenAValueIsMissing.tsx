// §6.3 section 5 — every substitution. Marked G: generated from the contract.
//
// The complete list of "we put something else there", read from the sidecars.
// A hand-written list of substitutions is a promise that decays: the whole
// point of `declared-fallback` (I6) is that a fallback absent from the contract
// may not exist in code, and the corollary is that this page can be complete by
// construction rather than by diligence.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { REFERENCE_TABLES } from "@/components/docs/generated/reference.generated";

type Row = {
  table: string;
  name: string;
  when: string;
  value: string;
  provenance: string | null;
  visibleAs: string | null;
};

function substitutions(): Row[] {
  const out: Row[] = [];
  for (const t of REFERENCE_TABLES) {
    for (const c of t.columns) {
      for (const s of c.substitutions) {
        out.push({
          table: t.table,
          name: c.csvHeader ?? c.name,
          when: s.when,
          value: s.value,
          provenance: s.provenance,
          visibleAs: s.visibleAs,
        });
      }
    }
  }
  return out;
}

export default function WhenAValueIsMissing() {
  const rows = substitutions();
  const byProvenance = [...new Set(rows.map((r) => r.provenance ?? "unmarked"))].sort();
  const invisible = rows.filter((r) => !r.visibleAs);

  return (
    <>
      <PageTitle lead="Every substitution the system will make, what it puts there, and where you can see it happen.">
        When a value is missing
      </PageTitle>

      <Section id="the-rule" title="The rule behind this list">
        <Key>
          A substitution that is not on this page does not exist in the software. The list is
          generated from the same declarations the code reads, so it cannot be incomplete by
          oversight.
        </Key>
        <P>
          {rows.length} substitutions across {new Set(rows.map((r) => r.table)).size} tables. Each
          says what triggers it, what goes in, and how it is marked when you look at the value.
        </P>
        <P>
          A substitution is not an error. Most of them are the answer you would have given: the
          cheapest price you actually pay, the demand your own outbound arcs imply. What matters is
          that you can tell one from a number you supplied — which is what{" "}
          <DocLink to="where-a-number-came-from">the provenance marks</DocLink> are for.
        </P>
      </Section>

      {invisible.length > 0 && (
        <Callout tone="limit" title={`${invisible.length} of them do not say where you would see them`}>
          <p>
            The contract records what these substitutions do and not where the substitution becomes
            visible. In practice most are marked in the grid like any other; what is missing is the
            declaration, so this page cannot promise it for them. They are the rows below with no
            “you see it here” line.
          </p>
        </Callout>
      )}

      {byProvenance.map((p) => {
        const group = rows.filter((r) => (r.provenance ?? "unmarked") === p);
        return (
          <Section key={p} id={`marked-${p}`} title={`Marked ${p} — ${group.length}`}>
            <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
              {group.map((r, i) => (
                <div key={i} id={`${r.table}.${r.name}.${i}`} className="scroll-mt-20 p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[13px] font-semibold text-foreground">{r.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.table}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    <span className="text-foreground">When</span> <Prose text={r.when} /> →{" "}
                    <Prose text={r.value} />
                  </p>
                  {r.visibleAs && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      <span className="text-foreground">You see it here:</span>{" "}
                      <Prose text={r.visibleAs} />
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        );
      })}

      <Section id="related" title="Related">
        <P>
          <DocLink to="where-a-number-came-from">Where a number came from</DocLink> ·{" "}
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> ·{" "}
          <DocLink to="all-tables">All tables</DocLink>, where each substitution sits beside its
          column ·{" "}
          <DocLink to="known-limits">Known limits</DocLink>
        </P>
      </Section>

      <Provenance from="every substitutions block in the data contract" />
    </>
  );
}
