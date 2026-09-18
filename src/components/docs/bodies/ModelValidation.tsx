// §6.3 section 6 — model validation.
//
// `model_validations` is deferred rather than described, so this page carries
// the behaviour and says the column reference is missing rather than writing
// one by hand. Which package owes it is read from the coverage register.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function ModelValidation() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "model_validations"));

  return (
    <>
      <PageTitle lead="Checking the model against what actually happened.">Model validation</PageTitle>

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
      </Section>

      <Section id="a-validation-card" title="What a validation records">
        <P>
          A validation is kept as a card: what was compared, over what period, and what the verdict
          was. It is a record rather than a computation — the point of storing it is that somebody
          can come back and ask what this model was last checked against.
        </P>
      </Section>

      <Callout tone="limit" title="A verdict is not yet bound to what produced it">
        <p>
          The thing that would make a validation fully trustworthy is a binding between the verdict
          and the four things that decided it: the dataset, the policy set, the scenario and the
          engine version. That binding — the reproducibility record — is not built yet.
        </p>
        <p>
          Until it is, a stored verdict tells you that somebody checked, and it does not let a
          second person rerun exactly what was checked.{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> is the page that
          will describe it, and says plainly today that it is owed.
        </p>
      </Callout>

      <Callout tone="limit" title="This table is not yet described in the contract">
        <p>
          <Term>model_validations</Term> has no per-column description
          {owing ? `, and is deferred to WP ${owing.wp}` : ""}. So this page has no column reference
          to link you to, and will not invent one — a hand-written column list is the defect this
          manual was rebuilt to remove.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="data-trust-report">Data Trust Report</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink>
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it does and does not yet describe" />
    </>
  );
}
