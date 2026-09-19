// §6.3 section 8 — the interactive network space.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { ReadsFrom } from "@/components/docs/lineage";

export default function InteractiveNetworkSpace() {
  return (
    <>
      <PageTitle lead="Exploring the chain without a fixed layout.">
        Interactive Network Space
      </PageTitle>

      <Section id="what-it-is-for" title="What it is for">
        <P>
          The other three network views each answer a question by fixing a layout: materials flow
          left to right, manufacture stacks by level, firms arrange by tier. A fixed layout is what
          makes those views readable, and it is also what stops you seeing anything the layout was
          not designed to show.
        </P>
        <Key>
          This one fixes nothing. You move nodes, pull a cluster apart, and look at the shape you
          get. It is for the question you have not formed yet — if you know what you are looking
          for, one of the structured views will answer it faster.
        </Key>
        <DocFigure id="interactive-space" />
      </Section>

      <Section id="what-you-can-do" title="What you can do here">
        <div className="space-y-3">
          {[
            {
              t: "Drag anything",
              d: "Pull a node out of a cluster to see what it is actually attached to. Dense regions in an automatic layout hide their own structure, and separating them by hand is often the fastest way to read one.",
            },
            {
              t: "Search and focus",
              d: "Find a node by name and highlight what it reaches. On a large graph this is the difference between a picture and a diagram.",
            },
            {
              t: "Turn labels off",
              d: "Labels make a small graph readable and a large one unreadable. Without them the shape comes through — clusters, bridges, isolated pieces.",
            },
            {
              t: "Work by level",
              d: "The level counts tell you how the graph is distributed in depth before you start moving things, so you know whether you are looking at a broad shallow chain or a narrow deep one.",
            },
          ].map((x) => (
            <div key={x.t} className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">{x.t}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="limit" title="A layout you arrange is not saved, and is not evidence">
        <p>
          Moving nodes changes what you are looking at and nothing else. The arrangement is not
          stored, is not part of any run's provenance, and cannot be exported as a result — so a
          picture from this screen is an illustration, not a finding.
        </p>
        <p>
          It also means an arrangement you spent time on is gone when you leave. That is worth
          knowing before you spend the time: if a layout is telling you something, capture the
          conclusion rather than the picture.
        </p>
        <p>
          Anything you intend to quote should come from a measure with a run behind it —{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> — or from a
          simulation result, which carries the data version that produced it.
        </p>
      </Callout>

      <Callout title="What to do with what you find here">
        <p>
          The useful output of this screen is a hypothesis. A cluster that looks over-connected, a
          node that bridges two halves of the chain — take that to{" "}
          <DocLink to="network-science-metrics">the measures</DocLink>, which will tell you whether
          the impression is real, or to a{" "}
          <DocLink to="disruptions">disruption</DocLink>, which will tell you whether it matters.
        </p>
      </Callout>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="InteractiveNetworkSpace.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="product-level-network">Product-Level Network</DocLink> ·{" "}
          <DocLink to="process-level-network">Process-Level Network</DocLink> ·{" "}
          <DocLink to="firm-level-network">Firm-Level Network</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
        <P>
          Open it at{" "}
          <AppLink to="/network/interactive-space">/network/interactive-space</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
