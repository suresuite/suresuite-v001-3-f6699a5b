// §6.3 section 11 — performance and caching.
//
// The analysis store as a user meets it: a metric belongs to a run, therefore
// to an input hash and a code version, therefore a repeat request is a HIT BY
// DEFINITION rather than a bet on a timestamp. And the honest half: the store
// is empty in practice because nobody has run an analysis since it shipped
// (§4 D88).

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";

export default function PerformanceAndCaching() {
  return (
    <>
      <PageTitle lead="Why a second run is faster, and when the answer is recomputed instead.">
        Performance &amp; caching
      </PageTitle>

      <Section id="the-rule" title="The rule that decides a reuse">
        <Key>
          An answer is reused when it was computed from the same data, with the same parameters, by
          the same version of the code. Not when it is recent.
        </Key>
        <P>
          That is the whole design, and it is the opposite of the usual one. A cache keyed on
          freshness is a bet: <em>probably nothing has changed in the last hour</em>. This is keyed
          on identity — two requests carrying the same three things are asking the same question, so
          answering from the store is not an optimisation with a risk attached, it is the same
          answer.
        </P>
        <P>
          The consequence a user feels: change your data and the next request recomputes, every
          time, without you having to remember to clear anything. Change nothing and it returns
          immediately, however long ago it was computed.
        </P>
      </Section>

      <Callout tone="law" title="A result you are shown always knows what it was computed from">
        <p>
          Because reuse is keyed on identity, every stored answer carries the identity it was keyed
          on — which data, which parameters, which code version. That is what lets{" "}
          <DocLink to="data-trust-report">the Data Trust Report</DocLink> sort a project's computed
          rows into current, out of date, and <em>we cannot tell</em>.
        </p>
      </Callout>

      <Callout tone="limit" title="In practice the store is empty, and that is worth knowing">
        <p>
          The mechanism is shipped and correct. What has not happened is that anybody has run an
          analysis since it shipped — so every computed row that exists predates it and carries no
          identity at all, and none of them can be reused.
        </p>
        <p>
          The first analysis you run fills it in for the rows it writes. Until then, everything
          recomputes, and <DocLink to="reproducibility-record">Reproducibility record</DocLink>{" "}
          explains why the old rows cannot be back-filled rather than being given a plausible stamp.
        </p>
      </Callout>

      <Section id="why-a-run-is-slow" title="Why a particular run is slow">
        <P>
          The simulation cost scales with the size of your chain, the length of the window and the
          number of replications — and only the last of those is free to change. Halving
          replications halves the time and widens every interval, which is a trade to make
          deliberately rather than to discover.
        </P>
        <P>
          Replications are independent, so they parallelise; a single replication does not, and is
          deterministic for that reason. A run that is slow because the model is large will not get
          faster on a bigger machine per replication — it gets faster because more of them run at
          once.
        </P>
      </Section>

      <Callout title="Uploading a large network is one recomputation, not one per row">
        <p>
          Loading a deep-tier graph used to trigger a full recomputation of the whole graph{" "}
          <em>for every row inserted</em> — thousands of identical requests, none of which could
          reuse another because each one saw a slightly different graph. That is fixed: a bulk load
          is one statement and triggers one recomputation.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="dataset-versions">Dataset Versions</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink> ·{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink>
        </P>
      </Section>

      <Provenance from="the analysis store's five-part identity, as the contract declares it" />
    </>
  );
}
