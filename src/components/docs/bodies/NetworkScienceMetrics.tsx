// §6.3 section 8 — network science metrics.
//
// Every measure below is read from the analysis catalog in the contract — the
// analyzer that computes it, the code version, and every parameter with its
// declared default. §4 D79 is why that matters: the catalog once declared a
// kind with a parameter no code takes, and §11's "four analyzers" were three.
// A page that typed the list would have re-committed exactly that.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { ANALYSIS_KINDS } from "@/components/docs/generated/policy.generated";
import { refTable, computedColumns } from "@/components/docs/tableFacts";
import { DocFigure } from "@/components/docs/DocFigure";

/** What each measure means, in the reader's terms. */
const MEANING: Record<string, { what: string; use: string }> = {
  degree_centrality: {
    what: "How many other firms this one is directly connected to.",
    use: "A high-degree firm is a hub. Losing it disconnects many relationships at once.",
  },
  weighted_degree_centrality: {
    what: "The same count, weighted by how much of the relationship's revenue each edge carries.",
    use: "Separates a firm with many small relationships from one with a few large ones.",
  },
  eigenvector_centrality: {
    what: "How well connected this firm's connections are.",
    use: "Finds firms that are important because of who they are attached to, not how many.",
  },
  betweenness_centrality: {
    what: "How often the shortest path between two other firms runs through this one.",
    use: "A bottleneck. High betweenness with low degree is the classic single point of failure.",
  },
  closeness_centrality: {
    what: "How short this firm's paths to everyone else are, on average.",
    use: "How quickly a disruption starting here would reach the rest of the graph.",
  },
  prominence: {
    what: "A composite score combining the measures above with the firm's own size.",
    use: "One number to rank by when you want a shortlist rather than five separate views.",
  },
};

export default function NetworkScienceMetrics() {
  const kinds = ANALYSIS_KINDS;
  const nodes = refTable("network_nodes");
  const nodeList = refTable("node_list");
  const measures = [...computedColumns(nodes), ...computedColumns(nodeList)].filter(
    (c) => MEANING[c.name],
  );

  return (
    <>
      <PageTitle lead="Centrality, prominence and critical-node prediction — what each one means and where it comes from.">
        Network science metrics
      </PageTitle>

      <Section id="what-they-are" title="What these numbers are">
        <Key>
          They are statements about the <em>structure</em> of your chain, not about its performance.
          None of them is a simulation result.
        </Key>
        <P>
          A centrality asks a question about the graph — how connected is this firm, how much
          traffic passes through it — and answers it from the shape alone. That is their strength
          and their limit: a firm can be structurally critical and commercially trivial, and the
          graph does not know the difference.
        </P>
      </Section>

      <Section id="which-one" title="They do not agree, and that is not a fault">
        <P>
          Each measure asks a different question of the same graph, so each can name a different
          firm as the most critical one. None of them is the right answer on its own — the right
          question is which failure you are worried about.
        </P>
        <DocFigure id="centralities" />
      </Section>

      <Section id="the-measures" title="The measures">
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {measures.map((c) => (
            <div key={c.name} id={c.name} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-foreground">{c.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  written by {c.computedBy}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {MEANING[c.name].what}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">What it is good for:</span> {MEANING[c.name].use}
              </p>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[12px] text-muted-foreground">
                  What the contract says about this column
                </summary>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  <Prose text={c.meaning} />
                </p>
              </details>
            </div>
          ))}
        </div>
      </Section>

      <Section id="the-analyses" title="The analyses that produce them">
        <P>
          {kinds.length} kinds of analysis are declared, each with the code that computes it, the
          version of that code, and every parameter it takes. A parameter absent from this list does
          not exist — a declared parameter no code reads is exactly the defect this catalog was
          corrected for.
        </P>
        <div className="space-y-3">
          {kinds.map((k) => (
            <div key={k.kind} id={`kind-${k.kind}`} className="scroll-mt-20 rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-foreground">{k.kind}</span>
                <span className="text-[12px] text-muted-foreground">computed by {k.computedBy}</span>
                {k.codeVersion && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {k.codeVersion}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Produces one result per <Term>{k.entityType}</Term>.
              </p>
              {k.params.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {k.params.map((prm) => (
                    <div key={prm.name} className="text-[12px] leading-relaxed text-muted-foreground">
                      <span className="font-mono text-foreground">{prm.name}</span>{" "}
                      <span className="opacity-70">({prm.type})</span> — default{" "}
                      <Term>{prm.default === null ? "none" : String(prm.default)}</Term>
                      <div className="opacity-90">
                        <Prose text={prm.meaning} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[12px] text-muted-foreground">Takes no parameters.</p>
              )}
              {k.note && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-muted-foreground">
                    Why this one is the way it is
                  </summary>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    <Prose text={k.note} />
                  </p>
                </details>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="law" title="A metric belongs to a run, and a run belongs to a version of your data">
        <p>
          Every one of these numbers is computed from a specific state of your project, and the run
          that produced it records which. So the right question about a centrality is never “is it
          high” on its own — it is “high, computed from what”.
        </p>
        <p>
          <DocLink to="dataset-versions">Dataset Versions</DocLink> is how a version of your data is
          identified, and <DocLink to="data-trust-report">Data Trust Report</DocLink> is where a
          project's computed rows are sorted into current, out of date, and{" "}
          <em>we cannot tell</em>.
        </p>
      </Callout>

      <Callout tone="limit" title="What these measures cannot see">
        <p>
          They are computed over the deep-tier graph you supplied, so a firm you have not discovered
          has no centrality and does not lower anyone else's. An incomplete graph produces confident
          numbers about the part of the world it contains, and says nothing at all about the rest.
        </p>
        <p>
          The measures are also purely structural: none of them reads a price, a lead time or a
          capacity. A supplier with an alarming betweenness may be trivially replaceable, and
          nothing here would tell you.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="node-list">Node List</DocLink> ·{" "}
          <DocLink to="dataset-versions">Dataset Versions</DocLink>
        </P>
      </Section>

      <Provenance from="the analysis catalog declared in the data contract, and the computed columns each analyzer writes" />
    </>
  );
}
