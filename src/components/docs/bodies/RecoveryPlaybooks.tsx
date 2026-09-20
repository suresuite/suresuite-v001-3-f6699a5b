// §6.3 section 7 — recovery playbooks. Rewritten in WP 5.2j.
//
// ── THE PAGE ARGUED A DISTINCTION AND NAMED NO CONTROL ────────────────────
//
// 283 rendered words, the thinnest page in the manual, for a pane offering six
// strategies with their own parameters, a playbook picker with system and
// project playbooks, a save/reset cycle and a master switch. None of it was
// named, so a reader who had turned two toggles on had nothing to read about
// what they had turned on.
//
// ── AND TWO OF THE SIX DO NOTHING (D114) ──────────────────────────────────
//
// `project_map.py` turns a recovery response into an engine plugin. It has a
// branch for `dual_source_activate`, `capacity_flex`, `mode_shift`/`reroute`,
// `early_warning` and `allocate_materials`. It has NO branch for
// `safety_stock_drawdown` or `demand_shaping` — which are two of the six this
// pane offers, and are set by six of the built-in policy presets.
//
// The /policies grid already knows: `MULTI_SELECT_OPTIONS.response` in
// `schemas.ts` carries the comment "Restricted to the responses the scsim
// engine maps to policies" and lists a different six. So one screen was
// corrected and the other was not, and nothing compares them.
//
// `deriveRecoveryLevers` joins all three — the pane, the mapper and the grid —
// so each lever's line disappears the day the engine grows a branch for it.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { RECOVERY_LEVERS } from "@/components/docs/generated/policy.generated";
import { policyCatalog } from "@/lib/policies/registryAccess";
import { DocFigure } from "@/components/docs/DocFigure";

export default function RecoveryPlaybooks() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "recovery_playbooks"));
  const policy = policyCatalog().find((p) => p.id === "recovery_playbook");
  const { levers, engineOnly } = RECOVERY_LEVERS;
  const live = levers.filter((l) => l.plugin);
  const inert = levers.filter((l) => !l.plugin);
  const shared = [...new Set(live.map((l) => l.plugin))].filter(
    (p) => live.filter((l) => l.plugin === p).length > 1,
  );

  return (
    <>
      <PageTitle lead="What the chain does once something has already gone wrong — the six levers, which of them reach the engine, and how a playbook is reused.">
        Recovery playbooks
      </PageTitle>

      <Section id="what-it-is" title="Recovery is a different question from resilience">
        <Key>
          A resilient chain absorbs a shock. A recovery playbook is what you do when it did not.
        </Key>
        <P>
          Most policy decisions are about standing posture — how much stock, how many suppliers, how
          much slack. A playbook is conditional: <em>if this happens, do that</em>. It costs nothing
          while nothing is wrong, which is exactly why it is easy to leave un-thought-through.
        </P>
        <P>
          A playbook lives on stage 2 of <DocLink to="simulation-lab">Simulation Lab</DocLink>,
          beside the disruption schedule it responds to. The master switch above the strategies
          turns the whole thing off: with it off, disruptions hit raw and nothing mitigates.
        </P>
      </Section>

      {inert.length > 0 && (
        <Callout tone="limit" title={`${inert.length} of the ${levers.length} strategies do not reach the engine`}>
          <p>
            <strong>{inert.map((l) => l.label).join(" and ")}</strong> can be switched on, can carry
            parameters, are saved with the scenario and are shown as enabled — and the model mapper
            has no branch for {inert.length === 1 ? "it" : "them"}, so{" "}
            {inert.length === 1 ? "it changes" : "they change"} no number in the run.
          </p>
          <p>
            This is not a guess about implementation depth: the same list on the policy grid was
            already narrowed to what the engine maps, and{" "}
            {inert.every((l) => !l.inGrid) ? "neither of these is on it" : "these are not on it"}.
            Two screens, two lists, and nothing comparing them until this page did.
          </p>
          <p>
            <strong>Several of the built-in policy presets turn{" "}
            {inert.map((l) => l.label).join(" or ")} on.</strong> A preset is not wrong for doing
            so — the intent is recorded — but a run under one of them is not running the lever the
            preset's note describes.
          </p>
        </Callout>
      )}

      <Section id="the-levers" title={`The ${levers.length} strategies`}>
        <DocFigure id="lever-map" />
        <P>
          Each one is a switch, and turning it on reveals its own parameters. The parameters are
          what the strategy costs or how fast it works — they are not thresholds for when it fires,
          which is the trigger block above them.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {levers.map((l) => (
            <div key={l.key} id={l.key} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">{l.label}</span>
                {l.plugin ? (
                  <Badge variant="secondary" className="text-[10px]">reaches the engine</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-destructive">
                    saved, not simulated
                  </Badge>
                )}
              </div>
              {l.description && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {l.description}.
                </p>
              )}
              {l.params.length > 0 && (
                <div className="mt-2 space-y-1">
                  {l.params.map((p) => (
                    <p key={p.key} className="text-[12.5px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">{p.label}</span>{" "}
                      <span className="text-[11px]">{p.unit}</span>
                      <span className="font-mono text-[11.5px]"> · starts at {p.default}</span>
                      {p.hint && <span className="block text-[12px]">{p.hint}</span>}
                    </p>
                  ))}
                </div>
              )}
              {l.params.length === 0 && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  No parameters — it is on or it is off.
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {shared.length > 0 && (
        <Callout tone="limit" title="Two of the switches are the same switch">
          <p>
            {live
              .filter((l) => shared.includes(l.plugin))
              .map((l) => l.label)
              .join(" and ")}{" "}
            both map to the <em>same</em> engine behaviour — expediting what is already in transit.
            Their descriptions read as two different responses and the run cannot tell them apart.
          </p>
          <p>
            So turning both on is not two levers, and a result that improved under one will improve
            identically under the other. Pick whichever name describes your intent; the number will
            be the same.
          </p>
        </Callout>
      )}

      {engineOnly.length > 0 && (
        <Callout tone="limit" title={`${engineOnly.length} responses the engine honours are not offered here`}>
          <p>
            The engine also acts on{" "}
            {engineOnly.map((e) => <Term key={e.key}>{e.key}</Term>).reduce((a, b) => (
              <>
                {a}, {b}
              </>
            ))}{" "}
            — early failover on a detected disruption, and a revenue-maximising material allocation.
            Neither is a switch on this pane.
          </p>
          <p>
            They are on the <DocLink to="how-policies-work">policy grid's</DocLink> own recovery
            response list, which is the place to set them. Two lists for one field is the situation;
            the grid's is the one aligned with the engine.
          </p>
        </Callout>
      )}

      <Section id="playbooks" title="Saving one as a playbook">
        <P>
          The set of strategies and their parameters is a <strong>playbook</strong>, and a playbook
          is reusable across scenarios. The picker above the strategies offers system playbooks —
          supplied with the product, not editable — and your project's own.
        </P>
        <P>
          Once a scenario is linked to a playbook, the picker tracks whether the scenario still
          matches it and marks it <Term>modified</Term> when it does not. From there you can{" "}
          <strong>save the changes back</strong> into a playbook you own, <strong>save as</strong> a
          new one, or <strong>reset</strong> the scenario to the playbook. Somebody else's playbook,
          and every system one, is read-only: you save a copy rather than editing theirs.
        </P>
        <P>
          Project-level recovery settings sit underneath all of this. A scenario's settings are
          overlaid on the project's, so a scenario that has never been touched inherits the
          project's posture rather than starting empty — and the stage rail's lever count is the
          count of the <em>merged</em> result, not of the scenario's own overrides.
        </P>
      </Section>

      {policy && (
        <Callout
          tone={policy.status === "implemented" ? "note" : "limit"}
          title={
            policy.status === "implemented"
              ? "The engine implements the playbook policy itself"
              : "The engine declares the playbook policy and does not implement it yet"
          }
        >
          <p>
            <Term>{policy.catalog_ref ?? policy.id}</Term> is <Term>{policy.status}</Term> in the
            engine's own catalog.
            {policy.summary ? ` ${policy.summary}` : ""}
          </p>
          {policy.status !== "implemented" && (
            <p>
              That is a separate question from the {live.length} strategies above, which do reach
              the engine through their own plugins. It is read from the catalog rather than stated
              here, so this paragraph changes on the day the engine does.{" "}
              <DocLink to="policy-catalog">The policy catalog</DocLink> lists every policy's status
              the same way.
            </p>
          )}
        </Callout>
      )}

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>recovery_playbooks</Term> has no per-column description and is deferred to WP{" "}
            {owing.wp}, so there is no column reference to link you to and this page will not write
            one by hand. The strategies above are read from the pane that offers them, joined to the
            mapper that consumes them — a weaker source than a sidecar, and the one that exists.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="disruptions">Disruptions</DocLink> is what a playbook responds to ·{" "}
          <DocLink to="simulation-lab">Simulation Lab</DocLink> stage 2 is where both live ·{" "}
          <DocLink to="how-policies-work">How policies work</DocLink> is the other recovery list ·{" "}
          <DocLink to="policy-catalog">The policy catalog</DocLink> has every policy's status ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> is how to
          tell whether a playbook helped.
        </P>
        <P>
          Edit one at <AppLink to="/simulation-lab">/simulation-lab</AppLink>, stage 2.
        </P>
      </Section>

      <Provenance from="DisruptionRecoveryPane's own strategy list, labels and parameters, joined to project_map.py's response-to-plugin branches and to schemas.ts's already-narrowed grid list — plus the engine registry's catalog entry for the recovery policy" />
    </>
  );
}
