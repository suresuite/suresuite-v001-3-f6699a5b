// §6.3 section 5 — How policies work. Written once; the resolver's order is
// read from the generated module rather than described, because ORDER IS THE
// WHOLE MEANING and a prose ordering drifts the first time a branch moves.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { RESOLUTION_ORDER, RESOLUTION_ORDER_SOURCE, CHAIN_COUNT, BROKEN_COUNT } from "@/components/docs/generated/policy.generated";
import { STAGES } from "@/lib/policies/stages";

export default function HowPoliciesWork() {
  const stages = STAGES.filter((s) => s.key !== "run_validate");

  return (
    <>
      <PageTitle lead="Stages, scope, and what wins when two things say different numbers.">
        How policies work
      </PageTitle>

      <Section id="what-a-policy-is" title="What a policy is">
        <P>
          A policy is a decision about how the chain should behave — how much stock to hold, who to
          buy from when the first choice fails, how to treat an order you cannot fill. Your{" "}
          <DocLink to="inbound-logistics">uploads</DocLink> describe the chain as it is; policies
          describe how you want it run.
        </P>
        <Key>
          They are kept apart on purpose. Re-uploading your data does not change your decisions, and
          changing a decision does not touch your data.
        </Key>
      </Section>

      <Section id="stages" title="The three stages">
        <P>
          The grid at <AppLink to="/policies">/policies</AppLink> is split into stages, each a
          different grain of decision.
        </P>
        <div className="space-y-3">
          {stages.map((s) => (
            <div key={s.key} className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">{s.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.role}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Families:{" "}
                {s.families.map((f, i) => (
                  <span key={f}>
                    {i > 0 && ", "}
                    <Term>{f}</Term>
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
        <P>
          Each has its own page:{" "}
          <DocLink to="supplier-stage">Supplier stage</DocLink> ·{" "}
          <DocLink to="plant-stage">Plant stage</DocLink> ·{" "}
          <DocLink to="customer-stage">Customer stage</DocLink>.
        </P>
      </Section>

      <Section id="defaults-and-overrides" title="Defaults and overrides">
        <P>
          Every project starts with a <em>bundle</em> of defaults — one per policy family, filled in
          for you so a new project can be simulated immediately. You never have to set anything to
          get a result.
        </P>
        <P>
          When you change a cell, that change is saved as an <em>override</em>: a patch on top of
          the bundle, remembered for that one row. The bundle is not edited. So an override can be
          removed and the default comes back, and two rows can disagree without either one changing
          the project's baseline.
        </P>
      </Section>

      <Section id="precedence" title="What wins — the order, exactly">
        <Key>
          The first rule below that has an answer wins. Nothing further down is consulted.
        </Key>
        <P>
          This order is the whole meaning of the grid: a number reachable two ways is decided here
          and nowhere else. It is read from the resolver rather than described, so this page cannot
          fall behind the code.
        </P>
        <ol className="space-y-2">
          {RESOLUTION_ORDER.map((r, i) => (
            <li key={r.step} className="flex gap-3 rounded-sm border border-border bg-card p-3 shadow-xs">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[12px] font-semibold text-foreground">{r.step}</span>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  <Prose text={r.meaning} />
                </p>
              </div>
            </li>
          ))}
        </ol>
        <P className="text-[12px]">
          Transcribed from <Term>{RESOLUTION_ORDER_SOURCE}</Term>, and checked against it by a test
          that fails if a branch moves.
        </P>
      </Section>

      <Callout title="The surprising one: your row beats the bundle">
        <p>
          A value that lives on the stage <em>row</em> is consulted before the policy bundle. That
          means re-uploading your data refreshes a row-level value and does <em>not</em> refresh one
          that only exists in the bundle — which is why a policy set on old data can quietly survive
          a new upload. <DocLink to="data-trust-report">Data Trust Report</DocLink> is where that
          shows up.
        </p>
      </Callout>

      <Section id="what-reaches-the-engine" title="Not every cell changes a run">
        <P>
          The grid has {CHAIN_COUNT} editable fields and {BROKEN_COUNT} of them do not reach the
          simulation. They are stored, versioned and shown back to you, and the run ignores them.
        </P>
        <P>
          Each is marked on its stage page with what is actually happening — read only by a frozen
          engine, recomputed by the engine and ignored, an application routing hint, or read by
          nothing at all. We would rather tell you than have you find out by changing one.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="where-a-number-came-from">Where a number came from</DocLink> ·{" "}
          <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> ·{" "}
          <DocLink to="policy-types">Policy types</DocLink> ·{" "}
          <DocLink to="policy-versions-and-presets">Policy versions &amp; presets</DocLink>
        </P>
      </Section>

      <Provenance from="the resolver's own branch order and the derived resolution chains" />
    </>
  );
}
