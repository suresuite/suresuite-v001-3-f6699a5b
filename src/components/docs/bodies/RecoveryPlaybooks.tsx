// §6.3 section 7 — recovery playbooks.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { policyCatalog } from "@/lib/policies/registryAccess";

export default function RecoveryPlaybooks() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "recovery_playbooks"));
  // The catalog knows whether the recovery policy is implemented. Reading it
  // beats asserting it: a page that said "planned" would be wrong on the day it
  // ships, and one that said "available" would be wrong today.
  const policy = policyCatalog().find((p) => p.id === "recovery_playbook");

  return (
    <>
      <PageTitle lead="What the chain does once something has already gone wrong.">
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
      </Section>

      {policy && (
        <Callout
          tone={policy.status === "implemented" ? "note" : "limit"}
          title={
            policy.status === "implemented"
              ? "The engine implements this"
              : "The engine declares this and does not implement it yet"
          }
        >
          <p>
            <Term>{policy.catalog_ref ?? policy.id}</Term> is{" "}
            <Term>{policy.status}</Term> in the engine's own catalog.
            {policy.summary ? ` ${policy.summary}` : ""}
          </p>
          {policy.status !== "implemented" && (
            <p>
              So a playbook can be recorded and does not yet change what a simulation does. That is
              read from the catalog rather than stated here, so this paragraph changes on the day the
              engine does. <DocLink to="policy-catalog">The policy catalog</DocLink> lists every
              policy's status the same way.
            </p>
          )}
        </Callout>
      )}

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>recovery_playbooks</Term> has no per-column description and is deferred to WP{" "}
            {owing.wp}, so there is no column reference to link you to and this page will not write
            one by hand.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="disruptions">Disruptions</DocLink> ·{" "}
          <DocLink to="policy-catalog">The policy catalog</DocLink> ·{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> ·{" "}
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry's catalog entry for the recovery policy, and the contract's coverage register" />
    </>
  );
}
