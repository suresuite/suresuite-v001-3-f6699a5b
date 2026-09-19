// §6.3 section 7 — scenarios. Deepened in WP 5.2j.
//
// Three tables are named by §6.3 (`scenarios`, `sim_scenarios`,
// `scenario_templates`) and none is described in the contract, so the page had
// no settings reference and wrote none — correctly, and at 299 rendered words
// for the screen a user spends most of their configuration time on.
//
// The settings ARE declared, twice, next to each other: `ScenarioSetupForm`
// gives each field its label, its unit and the default key it compares against,
// and `useScenarios` gives that default's value. `deriveScenarioSetup` joins
// them, so the reader's name leads and the stored name is translation (§6.1
// rule 1) without inventing a sidecar the contract has not agreed to.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { SCENARIO_SETUP } from "@/components/docs/generated/policy.generated";

const NAMED = ["scenarios", "sim_scenarios", "scenario_templates"];

/** Plain-language defaults, keyed by the stored name so they cannot drift onto
 *  the wrong row. The VALUE is never written here — it is rendered from the
 *  derivation beside this text. */
const WHAT_IT_DOES: Record<string, string> = {
  horizon_days:
    "How long the simulated window is. Everything the run reports is measured inside it, so a horizon shorter than your longest lead time measures a chain that never finished replenishing.",
  warmup_days:
    "The point at which the model stops filling its pipes and starts counting. Weeks before it are simulated and excluded from every measure — which is why a result can look nothing like the first ten weeks of its own chart.",
  warmup_mode:
    "On auto, the engine detects where the model settled and reports the week it chose. On manual you fix it yourself, and typing a warm-up switches this to manual for you rather than silently overriding your number.",
  time_step:
    "The engine's clock. Day is the tested path; the chain's physics are weekly regardless, so this changes resolution rather than behaviour.",
  replications:
    "How many times the same world is run with different random draws. This is the single biggest lever on how much you can trust a difference between two scenarios.",
  crn:
    "Common random numbers: two scenarios get the SAME sequence of random draws, so a difference between them is the change you made rather than the dice. Leave it on. Turning it off makes every comparison noisier for no benefit you can see from here.",
  seed:
    "Where the random draws start. The same seed reproduces the same run exactly — which is what makes a result you can hand to somebody else. Change it deliberately, to check a finding is not one seed's accident.",
  stopping_rule:
    "Run the fixed number of replications, or keep going until the confidence interval is narrow enough. The second costs an unpredictable amount of compute and gives a stated precision.",
  primary_kpi:
    "What the run is optimising toward in your reading of it. It picks the banded row in the results table and the measure the convergence plot draws — and four of the five choices name a measure the engine does not write.",
};

export default function Scenarios() {
  const owing = [
    ...new Set(
      UNDESCRIBED.filter((g) => g.tables.some((t) => NAMED.includes(t.table))).map((g) => g.wp),
    ),
  ];
  const described = NAMED.filter((n) => !UNDESCRIBED.some((g) => g.tables.some((t) => t.table === n)));

  return (
    <>
      <PageTitle lead="Saving a set of conditions so two runs can differ in exactly one way — and every setting that makes one up.">
        Scenarios
      </PageTitle>

      <Section id="what-a-scenario-is" title="What a scenario is">
        <Key>
          The conditions a run happens under, separated from the model it happens to.
        </Key>
        <P>
          Your data describes the chain. Your <DocLink to="how-policies-work">policies</DocLink>{" "}
          describe how you run it. A scenario describes the world it is running in — how long the
          window is, how precisely you want to measure, and what goes wrong.
        </P>
        <P>
          Keeping the three apart is what makes a comparison mean something. If you change the
          scenario and the policies at once, the difference in the result is not attributable to
          either.
        </P>
      </Section>

      <Section id="the-settings" title="Every setting, and what it starts as">
        <DocFigure id="scenario-window" />
        <P>
          Stage 1 of <DocLink to="simulation-lab">Simulation Lab</DocLink>, in three groups. The
          value in the right-hand column is what a brand-new scenario carries before you touch
          anything — so a setting you have never opened is that one.
        </P>
        {SCENARIO_SETUP.map((g) => (
          <div key={g.name} className="space-y-2">
            <h4 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.name}
            </h4>
            <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
              {g.fields.map((f) => (
                <div key={f.key} id={f.key} className="scroll-mt-20 p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{f.label}</span>
                    {f.unit && <span className="text-[11px] text-muted-foreground">{f.unit}</span>}
                    <span className="ml-auto font-mono text-[11.5px] text-foreground">
                      {f.default}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {WHAT_IT_DOES[f.key] ?? (
                      <span className="text-destructive">
                        Not described on this page. The setting exists in the form and this page has
                        no sentence for it — a blind spot, printed rather than filled with a guess.
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Stored as <Term>{f.key}</Term>.
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Callout tone="limit" title="Two settings are stored in days and shown in whatever unit you chose">
        <p>
          The horizon and the warm-up are days underneath, always. The bar above the form switches
          the display between days, weeks and months, and the form converts as you type — so a
          horizon reading “13” in weeks is 91 days, and the footer under the card prints both.
        </p>
        <p>
          <strong>Rounding happens on the way in.</strong> Typing 13 weeks stores 91 days; switching
          the display to months then shows 3, because a month here is 30 days and 91 is not three of
          them. The stored number has not changed. Read the footer, which always prints days, when
          the number matters.
        </p>
        <p>
          <strong>The unit is your browser's, not the project's.</strong> It is remembered locally,
          per project, on the machine you set it on — so a colleague opening the same scenario may
          be reading it in days while you are reading it in weeks. Quote days when you quote a
          horizon to somebody.
        </p>
      </Callout>

      <Callout title="Warm-up and replications can be inherited, and editing either breaks the inheritance">
        <p>
          A scenario created under a validated model picks up the warm-up length and replication
          count that validation adopted, and the Precision card is marked{" "}
          <Term>from model validation</Term> while that holds.
        </p>
        <p>
          Change either by hand and the mark disappears: the scenario is now yours rather than the
          validation's, and the credibility badge beside it in the list changes to say so. That is
          deliberate — divergence from a validated setting is made explicit rather than carried
          silently. <DocLink to="model-validation">Model validation</DocLink> is where the numbers
          came from.
        </p>
      </Callout>

      <Section id="templates" title="Templates and the saved library">
        <P>
          A template is a scenario worth starting from rather than a scenario you ran. Applying one
          fills in the conditions and drops you on the disruption editor; from that point it is an
          ordinary scenario and nothing downstream treats it differently.
        </P>
        <P>
          Duplicating one of your own scenarios copies its settings and <strong>not</strong> its
          runs, which is the right way to test one change: duplicate, change the one thing, run
          both, compare.
        </P>
      </Section>

      <Callout tone="law" title="Change one thing at a time">
        <p>
          The discipline this feature exists to support: run a baseline, save it, then change
          exactly one condition and run again. Two runs that differ in one scenario setting produce
          a difference you can attribute. Two runs that differ in three produce a number.
        </p>
        <p>
          Leave <Term>Common random numbers</Term> on while you do it. Without it the two runs also
          differ in every random draw, and the difference you measure includes noise you did not ask
          for.
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
            {owing.length ? `, and are deferred to WP ${owing.join(", ")}` : ""}. The settings above
            are read from the setup form and the defaults literal it compares against — a weaker
            source than a sidecar, and the one that exists. There is no column reference to link
            you to, and this page will not write one by hand.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="simulation-lab">Simulation Lab</DocLink> is where these settings live ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is why the Precision group matters most ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink> is the other half of a scenario ·{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> is a scenario made for you ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> is what
          two scenarios are for.
        </P>
        <P>
          Edit them at <AppLink to="/simulation-lab">/simulation-lab</AppLink>, stage 1.
        </P>
      </Section>

      <Provenance from="ScenarioSetupForm's own field labels joined to useScenarios' SCENARIO_ENGINE_DEFAULTS through the comparison the form itself declares, plus the contract's coverage register for what it does not describe" />
    </>
  );
}
