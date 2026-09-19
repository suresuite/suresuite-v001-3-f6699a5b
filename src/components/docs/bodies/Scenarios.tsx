// §6.3 section 7 — scenarios.
//
// Three tables are named by §6.3 (`scenarios`, `sim_scenarios`,
// `scenario_templates`) and none is described in the contract. The page carries
// the behaviour and says which package owes the reference.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

const NAMED = ["scenarios", "sim_scenarios", "scenario_templates"];

export default function Scenarios() {
  const owing = [
    ...new Set(
      UNDESCRIBED.filter((g) => g.tables.some((t) => NAMED.includes(t.table))).map((g) => g.wp),
    ),
  ];
  const described = NAMED.filter((n) => !UNDESCRIBED.some((g) => g.tables.some((t) => t.table === n)));

  return (
    <>
      <PageTitle lead="Saving a set of conditions so two runs can differ in exactly one way.">
        Scenarios
      </PageTitle>

      <Section id="what-a-scenario-is" title="What a scenario is">
        <Key>
          The conditions a run happens under, separated from the model it happens to.
        </Key>
        <P>
          Your data describes the chain. Your <DocLink to="how-policies-work">policies</DocLink>{" "}
          describe how you run it. A scenario describes the world it is running in — how long the
          window is, what demand does, what goes wrong.
        </P>
        <P>
          Keeping the three apart is what makes a comparison mean something. If you change the
          scenario and the policies at once, the difference in the result is not attributable to
          either.
        </P>
      </Section>

      <Section id="templates" title="Templates">
        <P>
          A template is a scenario worth starting from rather than a scenario you ran. Applying one
          fills in the conditions; from that point it is an ordinary scenario and nothing downstream
          treats it differently.
        </P>
      </Section>

      <Callout tone="law" title="Change one thing at a time">
        <p>
          The discipline this feature exists to support: run a baseline, save it, then change
          exactly one condition and run again. Two runs that differ in one scenario setting produce
          a difference you can attribute. Two runs that differ in three produce a number.
        </p>
      </Callout>

      {described.length < NAMED.length && (
        <Callout tone="limit" title="These tables are not yet described in the contract">
          <p>
            {NAMED.filter((n) => !described.includes(n)).map((n, i) => (
              <span key={n}>
                {i > 0 && ", "}
                <Term>{n}</Term>
              </span>
            ))}{" "}
            have no per-column description
            {owing.length ? `, and are deferred to WP ${owing.join(", ")}` : ""}. So this page
            describes what a scenario does and links to no column reference — and will not write one
            by hand, which is the defect this manual was rebuilt to remove.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="simulation-lab">Simulation Lab</DocLink> ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink> ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="stress-tests">Stress tests</DocLink>
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it describes and what it does not" />
    </>
  );
}
