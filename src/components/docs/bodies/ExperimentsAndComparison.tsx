// §6.3 section 7 — experiments and comparison. Rewritten in WP 5.2j.
//
// ── THE SECOND INSTANCE OF D111'S CLASS, AND IT MAKES IT A CLASS (D115) ───
//
// The page described synergy decomposition, a portfolio breadth ladder, and
// ST-1/ST-2 ranking suppliers. All three are ENGINE LIBRARY MODULES:
// `scsim/scsim/synergy/` is imported by two of the engine's own tests and
// nothing else, exactly like `scsim/scsim/stress/`. It also sent the reader to
// "previews", a Simulation Lab mode that does not exist.
//
// Meanwhile `ExperimentDesigner.tsx` — a full factorial / Latin-hypercube
// design-of-experiments screen over the `experiments` table — is imported by
// NOTHING. No route mounts it. So the one thing in this product that is
// literally called an experiment is unreachable, and the page did not say so.
//
// What a user can actually do is stage 5 of Simulation Lab: pick two scenarios
// with results and read a paired comparison, which refuses to show a number
// until four conditions hold. None of that was on the page. It is now the page.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function ExperimentsAndComparison() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "experiments"));

  return (
    <>
      <PageTitle lead="Reading two scenarios against each other — the four conditions the comparison insists on, and why it refuses rather than showing you a difference.">
        Experiments &amp; comparison
      </PageTitle>

      <Section id="what-an-experiment-is" title="What an experiment is">
        <Key>
          A set of runs designed to be compared, rather than a set of runs that happen to exist.
        </Key>
        <P>
          The difference is control. An experiment holds everything fixed except the thing under
          test, runs each variant against the <em>same</em> random world, and pairs the results —
          so the difference you read is the difference the strategy made, not the difference the
          seeds made.
        </P>
        <P>
          In this product that is stage 5 of <DocLink to="simulation-lab">Simulation Lab</DocLink>:
          two pickers, A and B, over the scenarios that have completed runs. It is deliberately
          strict, and the strictness is the feature.
        </P>
      </Section>

      <Section id="the-four-conditions" title="The four conditions, and what each refusal means">
        <P>
          The panel checks the pair before it computes anything. If any condition fails you get the
          reason instead of a table — which is the right behaviour and is easy to read as a bug the
          first time you meet it.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              Both scenarios must have common random numbers on
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Without it the two runs saw different dice as well as different settings, and no
              amount of arithmetic separates the two causes. Turn it on and re-run; there is no way
              to repair an un-paired comparison after the fact.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              They must share a seed
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Common random numbers is the mechanism; the same seed is what makes it the same
              sequence. The refusal names both numbers, so a scenario you duplicated and then
              re-seeded is easy to spot.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              They must differ in exactly one of policies or world — not zero, not both
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Two runs under the same policy version on the same data have nothing to compare, and
              the panel says so rather than drawing a table of zeroes. Two runs that differ in{" "}
              <em>both</em> are the mistake this whole screen exists to prevent: the difference is
              real and it is not attributable, and no chart can make it so. Isolate one component
              and run again.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              They must have run on the same engine version
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              An old result and a new one are not comparable even if everything else matches,
              because the model itself moved between them. The refusal names both versions and the
              fix is to re-run the older side.
            </p>
          </div>
        </div>
        <P>
          Before any of that, the panel needs two scenarios <em>with results</em>, and it counts
          them for you when there are not enough. A scenario you configured and never ran does not
          appear in either picker.
        </P>
      </Section>

      <Section id="reading-the-table" title="Reading the table">
        <P>
          One row per measure both runs produced, with A's value and interval, B's value and
          interval, and the signed difference. The arrow of improvement is per measure — a lower
          lead time is better and a lower fill rate is not — so the table marks which side won
          rather than leaving you to remember the direction.
        </P>
        <Key>
          A row whose two intervals overlap is marked, and a marked row is not a finding.
        </Key>
        <P>
          Overlap means the difference is smaller than the uncertainty on either side. B may still
          be better; this run cannot show it. The two honest responses are to add replications until
          the intervals separate, or to report the comparison as inconclusive — and the second is a
          real result rather than a failure.{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is how many you would need.
        </P>
        <P>
          Rows appear only for measures <strong>both</strong> runs carry. A measure present on one
          side and missing on the other is silently absent from the comparison rather than shown as
          a change — which matters because the results screen already shows fewer measures than its
          own vocabulary suggests (<DocLink to="reading-your-results">Reading your results</DocLink>).
        </P>
      </Section>

      <Callout tone="limit" title="The design-of-experiments screen is in the code and no route opens it">
        <p>
          This product contains a built experiment designer — full factorial and Latin-hypercube
          designs over replications, horizon, warm-up and recovery playbook, writing to an{" "}
          <Term>experiments</Term> table with its own results panel.{" "}
          <strong>Nothing imports it.</strong> There is no menu item, no route and no link, so there
          is no way to reach it from the application.
        </p>
        <p>
          We are telling you because the table exists and you may meet it in an export or a schema
          listing, and because a manual that described the designer as a feature would be sending
          you to look for a screen that is not there. Everything on this page above this box is
          about the pairwise comparison, which is reachable.
        </p>
        <p>
          <strong>If you want a designed sweep today, you build it by hand</strong>: duplicate the
          baseline once per cell, change one factor in each, run them, and compare them two at a
          time here.
        </p>
      </Callout>

      <Callout tone="limit" title="Synergy and portfolio breadth are engine library functions, not product features">
        <p>
          The simulation engine can decompose a portfolio's effect into the parts contributed by
          each strategy and the interaction between them, and it can report how the effect changes
          as a portfolio widens. <strong>Nothing in this product calls either.</strong> They are
          importable from the <Term>scsim</Term> Python package by somebody running the engine
          directly, and they are reachable from no screen, endpoint or job here.
        </p>
        <p>
          The idea is still worth having while you compare by hand, because it names the thing to
          look for: two strategies that each help alone and help <em>less</em> together are fixing
          the same bottleneck, and you have bought the same protection twice. That is usually the
          most useful thing a comparison tells you, and here you have to notice it yourself.
        </p>
        <p>
          The same is true of the engine's supplier-ranking sweeps —{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> has the full picture of what is a
          library and what is a product feature.
        </p>
      </Callout>

      <Callout tone="law" title="Change one thing, and let the intervals decide">
        <p>
          The whole discipline in two sentences. Duplicate the baseline, change exactly one thing,
          run both with common random numbers on and the same seed. Then read the overlap column
          before the difference column, because a difference inside the noise is a number and not a
          finding.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>experiments</Term> has no per-column description and is deferred to WP {owing.wp}
            , so there is no column reference to link you to. Given that nothing mounts its screen,
            the deferral is the honest state rather than an oversight.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="simulation-lab">Simulation Lab</DocLink> stage 5 is this screen ·{" "}
          <DocLink to="scenarios">Scenarios</DocLink> is where common random numbers and the seed
          are set ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is what the overlap column means ·{" "}
          <DocLink to="recovery-playbooks">Recovery playbooks</DocLink> is the usual thing being
          compared · <DocLink to="reading-your-results">Reading your results</DocLink> is why a
          measure may be missing from a row.
        </P>
        <P>
          Compare at <AppLink to="/simulation-lab">/simulation-lab</AppLink>, stage 5.
        </P>
      </Section>

      <Provenance from="CompareScenariosPanel's own comparability rules and overlap marking, read from the component; the reachability claims are import scans over src/ and scsim/" />
    </>
  );
}
