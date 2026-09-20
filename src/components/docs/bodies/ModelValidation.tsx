// §6.3 section 6 — model validation. Rewritten in WP 5.2j.
//
// ── THE PAGE SAID THE BINDING DOES NOT EXIST, AND IT DOES ─────────────────
//
// "The thing that would make a validation fully trustworthy is a binding
// between the verdict and the four things that decided it: the dataset, the
// policy set, the scenario and the engine version. That binding — the
// reproducibility record — is not built yet."
//
// `model_validations` carries `dataset_version_id` + `graph_hash`,
// `policy_version_id` + `policy_hash`, `scenario_hash` + `scenario_fingerprint`,
// `engine_fingerprint` and `evidence_run_id`. The four-way binding is on this
// one table, and `deriveCredibility` compares all four live to produce the
// badge every run carries. So this page was telling readers that the one place
// `result-binding` already holds does not hold.
//
// The page's underlying point survives and is narrower: the binding exists HERE,
// per validation card, and not as a general property of every result. That is
// what the Reproducibility record page is owed for, and the two pages now say
// the same thing as each other.
//
// The card was also described as "a record rather than a computation", which
// leaves out what it is FOR: it adopts a warm-up length and a replication count
// that every scenario created under it inherits.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { Badge } from "@/components/ui/badge";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { VALIDATION_CARD } from "@/components/docs/generated/policy.generated";

const COMPONENT: Record<string, string> = {
  dataset: "the data it ran on, by version and by fingerprint",
  policy: "the policy set, by version and by fingerprint",
  scenario: "the scenario's conditions, fingerprinted",
  engine: "the engine build that produced the evidence",
};

export default function ModelValidation() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "model_validations"));
  const v = VALIDATION_CARD;

  return (
    <>
      <PageTitle lead="Checking the model against what actually happened — and the badge every run carries because of it.">
        Model validation
      </PageTitle>

      <Section id="what-it-is" title="What validation means here">
        <Key>
          A model that reproduces last quarter is a model you can argue about next quarter with.
        </Key>
        <P>
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> asks whether the model is
          complete. This asks whether it is <em>right</em> — whether, run over a period you already
          know the outcome of, it produces something close to what you observed.
        </P>
        <P>
          The two are independent. A model can be fully populated, pass every gate, and still be
          wrong about your chain, because nothing in the input data says whether your assumptions
          about behaviour are correct.
        </P>
        <P>
          It happens on <AppLink to="/policies">Policies</AppLink> → Run &amp; validate, and what it
          produces is a <strong>card</strong>.
        </P>
      </Section>

      <Section id="what-a-card-adopts" title="A card is not just a verdict — it adopts two numbers">
        <Key>
          The warm-up length and the replication count a validation settles on become the defaults
          every scenario created under it inherits.
        </Key>
        <P>
          This is the part that changes your work rather than recording it. Validating a model
          decides how long it takes to reach steady state and how many replications the statistics
          need, and a scenario created afterwards starts with both already set —{" "}
          <DocLink to="scenarios">marked as inherited</DocLink> until you change one.
        </P>
        <P>
          The warm-up is found by one of {v.warmupMethods.length} methods, and the card records
          which:{" "}
          {v.warmupMethods.map((m, i) => (
            <span key={m}>
              {i > 0 && i === v.warmupMethods.length - 1 ? " or " : i > 0 ? ", " : ""}
              <Term>{m}</Term>
            </span>
          ))}
          . Two different methods can settle on two different weeks for the same model, so the
          method is part of the claim rather than an implementation detail.
        </P>
      </Section>

      <Section id="the-binding" title="A verdict is bound to what produced it">
        <DocFigure id="validation-binding" />
        <Key>
          This is the one place in the product where a stored conclusion names all four of the
          things that decided it.
        </Key>
        <P>
          A card records the {v.binding.length} components below, each by identity{" "}
          <em>and</em> by fingerprint. Identity says which one; the fingerprint says whether that one
          has since changed.
          {v.hasEvidenceRun && (
            <> It also names the run that was the evidence, so the verdict points at a result rather than standing alone.</>
          )}
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {v.binding.map((b) => (
            <div key={b.component} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold capitalize text-foreground">
                  {b.component}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {b.columns.join(" · ")}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {COMPONENT[b.component]
                  ? COMPONENT[b.component].charAt(0).toUpperCase() + COMPONENT[b.component].slice(1)
                  : b.component}
                .
              </p>
            </div>
          ))}
        </div>
        <P>
          That binding is what makes the credibility badge possible, and the badge is the reason
          this page matters to somebody who will never open the validation screen.
        </P>
      </Section>

      <Section id="the-badge" title="The badge on every run and every scenario">
        <P>
          Wherever you see a credibility badge — beside a scenario in the list, on a run's results —
          it is this card being compared against your project as it is now. Three states, and the
          middle one is the useful one.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <Badge variant="outline" className="text-[10px]">unvalidated</Badge>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              No active card for the policy version you are on. Not a criticism of the model — it
              means nobody has checked this particular version of the decisions.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <Badge variant="secondary" className="text-[10px]">validated</Badge>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A card exists for this policy version, its verdict is positive, and none of the
              fingerprints has moved.
            </p>
          </div>
          <div className="rounded-sm border border-destructive/40 bg-card p-4 shadow-xs">
            <Badge variant="outline" className="text-[10px] text-destructive">stale</Badge>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A card exists and something underneath it has changed. The badge names <em>which</em>{" "}
              — policy, data, scenario or engine — so “the validation no longer applies” is
              actionable rather than a warning to dismiss. Unsaved policy edits count as drift
              immediately, before you save anything.
            </p>
          </div>
        </div>
        <P>
          The engine component is checked only <em>after</em> a run, because it compares the build
          that produced a result against the build that produced the evidence. A live screen cannot
          know it yet, and does not pretend to.
        </P>
      </Section>

      <Section id="verdicts" title="What a verdict can say, and what a card can become">
        <P>
          A verdict is {v.verdicts.map((x, i) => (
            <span key={x}>
              {i > 0 ? " or " : ""}
              <Term>{x}</Term>
            </span>
          ))}
          , on one of {v.bases.length} bases:{" "}
          {v.bases.map((x, i) => (
            <span key={x}>
              {i > 0 ? " or " : ""}
              <Term>{x}</Term>
            </span>
          ))}
          . A statistical basis is a comparison against observed outcomes; a face basis is a
          knowledgeable person judging the behaviour reasonable. <strong>Both are recorded as what
          they are</strong>, which matters when somebody later asks how hard the check was.
        </P>
        <P>
          A card is {v.statuses.map((x, i) => (
            <span key={x}>
              {i > 0 && i === v.statuses.length - 1 ? " or " : i > 0 ? ", " : ""}
              <Term>{x}</Term>
            </span>
          ))}
          . Superseding points at the card that replaced it, and revoking is a status change rather
          than a delete — so a validation that turned out to be wrong leaves a record that it was
          made and withdrawn, which is the whole reason to store one.
        </P>
        <P>
          The card also keeps the tests that were run and the findings as they stood at the time. A
          verdict given while a model had known gaps records those gaps beside itself rather than
          leaving a reader to reconstruct them.
        </P>
      </Section>

      <Callout tone="limit" title="The binding is on this card, not on every result">
        <p>
          A validation names its dataset, policy set, scenario and engine. An ordinary{" "}
          <DocLink to="reading-your-results">run's results</DocLink> do not yet leave the system as
          one artifact carrying the same four — that is the reproducibility record, and it is owed.
        </p>
        <p>
          So the honest reading is: <strong>a validated model is reproducible; an arbitrary figure
          is not yet.</strong>{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> says exactly what is
          in place and what is missing.
        </p>
      </Callout>

      <Callout tone="limit" title="This table is not yet described in the contract">
        <p>
          <Term>model_validations</Term> has no per-column description
          {owing ? `, and is deferred to WP ${owing.wp}` : ""}. So this page has no column reference
          to link you to, and will not invent one. What it does state — the four bound components,
          the verdicts, the bases, the statuses and the warm-up methods — is read from the table's
          own CHECK constraints and columns, which is a weaker source than a sidecar and the one
          that exists.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> is the other question ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is where the adopted replication count comes from ·{" "}
          <DocLink to="scenarios">Scenarios</DocLink> is what inherits it ·{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink>.
        </P>
        <P>
          Validate at <AppLink to="/policies">/policies</AppLink>, under Run &amp; validate.
        </P>
      </Section>

      <Provenance from="the CHECK constraints and columns of model_validations in the introspected schema for the binding, the verdicts, the bases, the statuses and the warm-up methods, and the credibility derivation for the three badge states — the contract describes this table nowhere" />
    </>
  );
}
