// §6.3 section 7 — stress tests. REWRITTEN in WP 5.2j to close §4 D111.
//
// ── THE PAGE THAT DOCUMENTED THE WRONG ARTIFACT ───────────────────────────
//
// WP 5.2d read `scsim/scsim/stress/battery.py`'s `ST_DEFINITIONS` and published
// it as "the standing battery". The reading was careful and the artifact was
// wrong: `run_st1`/`run_st2` are imported by exactly two files, the engine's own
// test and `scsim/__init__.py`. Nothing in `src/`, `sim-worker/` or
// `supabase/functions/` reaches them, and the only "ST-1" a user could ever
// find was on this page. Meanwhile the seven presets they actually click —
// `StressTestCard.tsx`'s `STRESS_TESTS` — had no page at all, and the screen
// offered "Demand surge" while this page said ST-5 Demand surge was not
// implemented.
//
// So the page now leads with the presets and keeps the battery, demoted and
// framed as what it is: a library API for somebody importing scsim.
//
// ── AND THE PRESETS DO NOT DO WHAT THEIR LABELS SAY ───────────────────────
//
// Confirming "each preset runs end to end" before saying so found that six of
// the seven do not. Their targets are fixed placeholders — `supplier:primary`,
// `material:critical`, `customer:all` — and `project_map.py`'s `_map_events`
// resolves a target against the project's own supplier ids or the focal plant
// and skips everything else with a mapping warning. Only `node:plant` resolves
// on every project.
//
// `reachesEngine` and each event's `resolves` are DERIVED in `chains.mjs`,
// against pinned anchors in the mapper's source, so this page cannot go on
// claiming a preset works after the mapper stops accepting it — and cannot go
// on claiming one is broken after the mapper learns to accept it.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { STRESS_PRESETS, STRESS_TESTS } from "@/components/docs/generated/policy.generated";

/** One event as the drawer prints it, with the units the drawer leaves implicit. */
function EventLine({ e }: { e: (typeof STRESS_PRESETS)[number]["events"][number] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
      <span className="text-foreground">{e.target}</span>
      <span>starts day {e.startDay}</span>
      <span>lasts {e.durationDays} days</span>
      <span>{e.magnitudePct}%</span>
      {e.resolves === "plant" && (
        <Badge variant="secondary" className="text-[10px]">reaches the engine</Badge>
      )}
      {e.resolves === "resolved-at-launch" && (
        <Badge variant="secondary" className="text-[10px]">resolved at launch to your top-volume supplier</Badge>
      )}
      {e.resolves === "supplier-id" && (
        <Badge variant="outline" className="text-[10px]">only if your project has a supplier with this exact id</Badge>
      )}
      {e.resolves === "unsupported" && (
        <Badge variant="outline" className="text-[10px] text-destructive">preset disabled — the engine cannot hit this target yet</Badge>
      )}
    </div>
  );
}

export default function StressTests() {
  const reach = STRESS_PRESETS.filter((p) => p.reachesEngine);
  const skipped = STRESS_PRESETS.filter((p) => !p.reachesEngine);
  const runnableBattery = STRESS_TESTS.filter((t) => t.runnable);

  return (
    <>
      <PageTitle lead="Seven one-click scenarios — what each one fills in, and which of them your engine will actually act on.">
        Stress tests
      </PageTitle>

      <Callout tone="limit" title={`Read this first: ${skipped.length} of the ${STRESS_PRESETS.length} presets cannot reach the engine yet, and the drawer says so`}>
        <p>
          The engine disrupts <strong>suppliers and the plant</strong> — not materials, customers
          or lanes. A preset whose schedule names one of those (<Term>material:critical</Term>,{" "}
          <Term>customer:all</Term>, <Term>edge:inbound</Term>, <Term>node:nexus</Term>) is{" "}
          <strong>disabled in the drawer with this reason</strong> rather than launchable: a run
          whose event was dropped would report the undisrupted baseline under a stress-test name.{" "}
          <Term>supplier:primary</Term> is different — it is a placeholder the{" "}
          <strong>launch resolves</strong> to the supplier carrying the largest share of your
          weekly inbound volume (the resolution is written into the scenario's description), and a
          project with no inbound lanes gets a refusal, not a hollow scenario.
        </p>
        <p>
          A hand-edited schedule can still name an unresolvable target. The engine{" "}
          <strong>drops</strong> it and says so in the run's mapping warnings —{" "}
          <Term>…targets cannot be disrupted yet (land later in M7) — event skipped</Term> for a
          target kind it does not support, or{" "}
          <Term>no supplier or plant named '…' in this project's data — event skipped</Term> for a
          supplier id the project does not have — and that line is the difference between a stress
          test and an expensive repeat of your baseline.
        </p>
        <p>
          <strong>Read the mapping warnings on every stress run before you read its KPIs.</strong>{" "}
          A preset whose event was dropped produces results that look fine, because they are the
          results of nothing happening.
        </p>
      </Callout>

      <Section id="what-the-button-does" title="What clicking a preset does">
        <Key>
          A preset does not run anything. It creates a scenario with the disruption already filled
          in, and leaves you on the editor for it.
        </Key>
        <P>
          Open <AppLink to="/simulation-lab">Simulation Lab</AppLink> and expand the stress-test
          drawer above the scenario list. Clicking one creates a new scenario named after the
          preset — they all begin <Term>[Stress]</Term>, so they sort together in your list — writes
          the preset's schedule into it, selects it, and opens its Disruption &amp; recovery pane.
          You then run it like any other scenario.
        </P>
        <P>
          The new scenario inherits the warm-up length and replication count from your model
          validation, the same as a scenario you create by hand: a disruption is excluded from the
          run fingerprint, so a stress scenario shares the baseline's world rather than starting a
          new one. That is what makes the comparison meaningful — see{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>.
        </P>
      </Section>

      <Section id="the-presets" title={`The ${STRESS_PRESETS.length} presets`}>
        <P>
          Each row below is exactly what the preset writes into the scenario. There is no prose
          behind it — the schedule <em>is</em> the description, so it is printed rather than
          summarised. <strong>Day numbers count from the start of the simulated window</strong>,
          warm-up included.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {STRESS_PRESETS.map((p) => (
            <div key={p.id} id={p.id} className="scroll-mt-20 space-y-2 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">{p.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{p.id}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{p.description}</p>
              <div className="space-y-1">
                {p.events.map((e, i) => (
                  <EventLine key={i} e={e} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <P>
          {reach.length === 1
            ? `One of them — ${reach[0].label} — resolves on every project, because "plant" is a name the engine knows without being told which plant you mean.`
            : `${reach.length} of them resolve on every project.`}{" "}
          The rest need their target replaced with something from your own data before the
          simulation will act on them.
        </P>
      </Section>

      <Section id="making-one-real" title="Making a preset actually bite">
        <P>
          Click the preset, then edit the target in the scenario's Disruption &amp; recovery pane
          before you run it. Two kinds of target resolve today:
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">A supplier id from your own data</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Exactly as it appears in <DocLink to="suppliers">Suppliers</DocLink> or in the{" "}
              <Term>supplier_id</Term> column of{" "}
              <DocLink to="inbound-logistics">Inbound Logistics</DocLink>. A{" "}
              <Term>supplier:</Term> prefix is optional — everything before the last colon is
              discarded, so <Term>supplier:ACME-01</Term> and <Term>ACME-01</Term> are the same
              target. It must match the id character for character; there is no fuzzy matching and
              no lookup by supplier name.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">The plant</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Written <Term>plant</Term>, <Term>node:plant</Term> or <Term>plant:</Term> anything.
              A project models one focal plant, so the engine does not need to be told which.
            </p>
          </div>
        </div>
        <P>
          Materials, customers and lanes are <strong>not</strong> targetable yet. A schedule
          naming one is accepted by the editor, saved to the scenario and dropped at run time —
          which is why the warning line matters more here than anywhere else in the product.
        </P>
      </Section>

      <Section id="what-the-numbers-mean" title="What the three numbers actually do">
        <P>
          The editor takes days and the engine runs in weeks, so each number is converted on the
          way in, and the conversion is worth knowing before you tune one.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">Start day → a whole week, rounded</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Day 30 becomes week 4, and so does day 28. Moving a start by a day or two usually
              changes nothing at all; moving it by four days can move it a whole week. The earliest
              a disruption can start is week 1.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">Duration → whole weeks, 1 to 52</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              14 days is two weeks; 21 days is three. Anything under about four days rounds to the
              minimum of one week rather than to nothing, and anything past a year is clamped to 52.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              Magnitude → a capacity cut below 100%, a full outage at 100% or above
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Under 100% the target keeps that share of its capacity — 40% means it loses 40% and
              keeps 60%. <strong>At 100% or above it becomes a full outage instead</strong>, so the
              Lead-time shock preset's 200% is not “twice the lead time”: it is a total loss of that
              target for the window. A partial cut also needs the target to have a finite capacity
              to cut — a supplier with a blank <Term>capacity_per_week</Term> is unlimited, so the
              engine turns the partial cut into a full outage and says so in the warnings.
            </p>
          </div>
        </div>
      </Section>

      <Callout tone="limit" title="Five events per scenario, and the sixth is dropped">
        <p>
          A scenario's schedule is read up to five events. A sixth is discarded with a warning
          naming how many were dropped. Only <Term>Multi-hit (compound)</Term> ships more than one
          event, so you will meet this limit only if you build a schedule by hand.
        </p>
        <p>
          Two events on the <em>same</em> target do not add up either — the engine keeps the harsher
          of the two capacity cuts and the later event's window. To model a failure that worsens,
          use one event at the severity you mean.
        </p>
      </Callout>

      <Section id="what-a-sweep-would-be" title="What these are not: a sweep">
        <P>
          Each preset is <strong>one</strong> disruption at <strong>one</strong> severity for{" "}
          <strong>one</strong> duration. It answers “what happens to this chain if that fails”. It
          does not answer “which failure matters most”, which needs the same run repeated across
          every supplier, or every severity, and the results ranked.
        </P>
        <P>
          There is no sweep in the product. Comparing a handful of stress scenarios side by side in{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> is the
          nearest thing, and it is a manual one: you create the scenarios, you run them, you read
          the table.
        </P>
      </Section>

      <Section id="the-engine-battery" title="The engine's own battery — a library, not a feature">
        <P>
          The simulation engine ships a separate stress module declaring{" "}
          {STRESS_TESTS.length} sweeps, ST-1 to ST-{STRESS_TESTS.length}, of which{" "}
          {runnableBattery.length} have implementations. <strong>Nothing in this product calls
          them.</strong> They are importable from the <Term>scsim</Term> Python package by a
          researcher running the engine themselves, and there is no screen, endpoint or job that
          reaches them — so you will not find ST-1 anywhere in the application.
        </P>
        <P>
          They are listed here because the engine is open to anyone who wants to run it directly,
          and because an earlier version of this page presented them as the product's stress
          feature. If you are reading this to plan work inside SuReSuite, the seven presets above
          are the whole of what exists.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {STRESS_TESTS.map((t) => (
            <div key={t.id} id={t.id} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-foreground">{t.id}</span>
                <Badge variant={t.runnable ? "secondary" : "outline"} className="text-[10px]">
                  {t.runnable ? "implemented in the library" : "declared, no implementation"}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="disruptions">Disruptions</DocLink> is the schedule editor these presets
          write into, and the two table-based disruption models beside it ·{" "}
          <DocLink to="simulation-lab">Simulation Lab</DocLink> is where the drawer lives ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> is how you
          read several stress scenarios against one baseline ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink> is where the mapping
          warnings appear.
        </P>
      </Section>

      <Provenance from="src/components/sim/StressTestCard.tsx's STRESS_TESTS for the presets, and scsim/scsim/io/project_map.py's _map_events for whether each target resolves — both read as source, the weakest of the three declaration doors, and pinned so they go red rather than quiet. The engine battery is scsim/scsim/stress/battery.py's ST_DEFINITIONS" />
    </>
  );
}
