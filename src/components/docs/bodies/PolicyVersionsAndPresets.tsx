// §6.3 section 5 — policy versions and presets.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function PolicyVersionsAndPresets() {
  // `policy_versions` and `policy_presets` are deferred rather than described.
  // Which package owes them is a fact the contract holds; naming it here would
  // be a second authoring that goes stale the moment the deferral moves.
  const owing = UNDESCRIBED.filter((g) =>
    g.tables.some((t) => t.table === "policy_versions" || t.table === "policy_presets"),
  );

  return (
    <>
      <PageTitle lead="Saving a set of decisions, reusing it, and comparing two of them.">
        Policy versions &amp; presets
      </PageTitle>

      <Section id="why-version" title="Why a policy set is versioned at all">
        <P>
          A result is only meaningful with the decisions that produced it. If the policies can
          change after a run, then a chart from last week is a chart of something nobody can
          reconstruct. So a saved policy set is a <em>version</em>: a fixed thing a run can point at.
        </P>
        <Key>
          The version is what makes “rerun exactly this” a question with an answer.
        </Key>
      </Section>

      <Section id="versions" title="Versions">
        <P>
          Saving the grid writes a version: every override, as it stood, with a fingerprint over the
          contents. Two versions with the same fingerprint are the same decisions, whatever they are
          called and whenever they were saved.
        </P>
        <P>
          Comparing two runs starts with comparing their versions. If the fingerprints match, the
          policies are not what changed — which is usually the first thing worth ruling out.
        </P>
      </Section>

      <Section id="presets" title="Presets">
        <P>
          A preset is a starting point rather than a record: a named set of decisions you can drop
          onto a new project so you are not filling in a blank grid. Applying one writes overrides
          exactly as if you had typed them, so nothing downstream can tell the difference — and
          nothing about the preset survives into the run's provenance except the values themselves.
        </P>
      </Section>

      <Callout tone="limit" title="These two tables are not yet described in the contract">
        <p>
          Everything else in this manual's reference sections is generated from a per-table
          description — every column, unit, constraint and substitution. <Term>policy_versions</Term>{" "}
          and <Term>policy_presets</Term> do not have one yet
          {owing.length > 0 ? `, and are deferred to WP ${owing.map((g) => g.wp).join(", ")}` : ""}.
        </p>
        <p>
          So this page describes the behaviour and not the columns, and there is no per-column
          reference to link you to. That is a gap in the documentation rather than in the feature:
          versions and presets work. We would rather say which half is missing than write a column
          list by hand, which is the failure the previous manual was.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="all-tables">All tables</DocLink>
        </P>
        <P>
          Saved from the policy grid at <AppLink to="/policies">/policies</AppLink>.
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it does and does not yet describe" />
    </>
  );
}
