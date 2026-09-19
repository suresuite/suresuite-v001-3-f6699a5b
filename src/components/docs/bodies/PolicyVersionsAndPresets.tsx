// §6.3 section 5 — policy versions and presets.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { POLICY_PRESETS } from "@/components/docs/generated/policy.generated";
import { Badge } from "@/components/ui/badge";

/** What each measured project fact is, keyed by the name the derivations read.
 *  The LIST of facts is never written here — it is derived per preset. */
const CTX: Record<string, string> = {
  demand_mean_per_day: "your average daily demand",
  demand_cv: "how variable that demand is",
  supplier_lt_mean_days: "your suppliers' average lead time",
  supplier_lt_cv: "how variable those lead times are",
  top_supplier: "your highest-volume supplier, by name",
  supply_chain_model: "whether the project is modelled make-to-stock or make-to-order",
};

export default function PolicyVersionsAndPresets() {
  // `policy_versions` and `policy_presets` are deferred rather than described.
  // Which package owes them is a fact the contract holds; naming it here would
  // be a second authoring that goes stale the moment the deferral moves.
  const owing = UNDESCRIBED.filter((g) =>
    g.tables.some((t) => t.table === "policy_versions" || t.table === "policy_presets"),
  );

  const facts = [...new Set(POLICY_PRESETS.flatMap((p) => p.derivesFrom))].sort();

  return (
    <>
      <PageTitle lead="Saving a set of decisions, reusing it, comparing two — and why a preset is not a set of numbers.">
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

      <Section id="what-a-version-holds" title="What a version records beyond the values">
        <P>
          A version carries a <strong>label</strong> and free-text <strong>notes</strong>, the
          person who saved it by name and email, and a pointer to the version it was saved
          <em> from</em>. So a project's versions form a chain rather than a pile, and “what did
          this change” is answerable against its parent rather than against whichever version
          happens to be next to it in a list.
        </P>
        <P>
          It also stores the previous snapshot beside the new one. That is what makes the
          difference between two versions readable without re-deriving it, and it is what an
          automatic restore uses when an applied change has to be undone.
        </P>
        <P>
          Write the notes. The label tells you which version; the notes tell you why there is one,
          and six weeks later that is the whole value of the record.
        </P>
      </Section>

      <Section id="presets" title={`Presets — ${POLICY_PRESETS.length}, and none of them is a set of numbers`}>
        <Key>
          A preset is a recipe, not a saved configuration. It computes its values from your
          project's own measurements every time you open it.
        </Key>
        <P>
          Two projects applying <Term>{POLICY_PRESETS[POLICY_PRESETS.length - 1]?.name ?? "the same preset"}</Term>{" "}
          get different numbers, because the preset reads what their chains actually look like
          first. Between them the {POLICY_PRESETS.length} presets read {facts.length} measured
          facts:
        </P>
        <div className="flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <span
              key={f}
              className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {CTX[f] ?? f}
            </span>
          ))}
        </div>
        <P>
          <strong>Which means a preset applied to an empty project is not the preset.</strong> With
          no data loaded there is nothing to measure, and the dialog says so — it tells you the
          values shown are schema defaults rather than derived ones. Upload first, then apply.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {POLICY_PRESETS.map((p) => (
            <div key={p.slug} id={p.slug} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">{p.name}</span>
                {p.isSystem && (
                  <Badge variant="secondary" className="text-[10px]">supplied with the product</Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {p.description}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Sets {p.families.length} policy families. Derived from{" "}
                {p.derivesFrom.map((f) => CTX[f] ?? f).join(", ")}.
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="applying" title="Applying one is a review, not a button">
        <P>
          The dialog shows a <strong>diff</strong> before anything is written: every field the
          preset would change, its current value struck through beside the proposed one, grouped by
          policy family with a count on each.
        </P>
        <P>
          <strong>You choose which families to take.</strong> Each group has its own checkbox and
          the apply button counts what you selected — so taking a preset's inventory posture without
          its sourcing strategy is one click rather than an edit afterwards. A family already
          matching the preset does not appear at all.
        </P>
        <P>
          Every proposed value carries a reason, on the information icon beside it. That is where a
          derived number explains itself — “max(14, 2 × lead-time variability × lead time)” rather
          than “14 days” — and it is the only place the reasoning exists. It is not written to your
          project.
        </P>
        <Callout tone="limit" title="The reasoning does not survive the apply">
          <p>
            Applying writes overrides exactly as if you had typed them. Nothing downstream can tell
            a preset's value from one you chose, which is deliberate — a preset is not a third kind
            of provenance.
          </p>
          <p>
            But it means the <em>why</em> is gone the moment you click. If a derived value matters,
            put it in the version's notes before you save, because that is the only field on this
            page that keeps a sentence.
          </p>
        </Callout>
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

      <Provenance from="the preset modules' own derivations for what each one reads from your project, the apply dialog for the review it offers, and the policy_versions columns in the introspected schema for what a version records — the contract describes neither table" />
    </>
  );
}
