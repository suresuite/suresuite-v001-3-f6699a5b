import { DocPageTitle, InShort, Section, P, Key, Callout, DocLink } from "@/components/docs/prose";

export default function WhatHappensToYourData() { return <>
<DocPageTitle slug="what-happens-to-your-data" />
<InShort items={[
  "You should be able to tell whether a number came from your data, a calculation or a default.",
  "Saved versions make results checkable; published limits explain what those results cannot establish.",
  <>Before sharing a result, check its sources and versions. <DocLink to="known-limits">Known limits</DocLink> records the gaps.</>,
]} />
<Section id="why-this-page" title="What makes a number worth using">
  <P>A simulation result is useful when you can explain its inputs and assumptions. These five commitments describe the standard SuReSuite aims to meet, and what you can check before making a decision.</P>
</Section>
<Section id="t1" title="1. No number without a source">
  <Key>A value should resolve to supplied data, a named calculation or an explicit default.</Key>
  <P>For example, a material requirement can come from demand multiplied by its bill-of-materials quantity. A default is a stated value used when an input is missing. Follow the value's source marker and read the run's conversion notes; do not present an assumed value as a measurement.</P>
  <P>See <DocLink to="where-a-number-came-from">Where a number came from</DocLink>. Historical derived records can have incomplete provenance, meaning the record of their source.</P>
</Section>
<Section id="t2" title="2. Substitution is always visible">
  <Key>If a missing input is replaced, the replacement should be marked where you read it.</Key>
  <P>The data contract is the shared written description of field meanings, units and allowed substitutions. Generated references use it, and automated checks reject undeclared fallback rules in the paths they cover. Read <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> before accepting an assumption.</P>
</Section>
<Section id="t3" title="3. We publish our own blind spots">
  <Key>A report should state the limits of its own computation.</Key>
  <P>Read <DocLink to="known-limits">Known limits</DocLink> alongside the result. A company graph does not mean every upstream dependency is simulated. Missing measurements should be reported as unavailable, rather than as zero.</P>
</Section>
<Section id="t4" title="4. Reproducible or not published">
  <Key>A shared figure should name the data, policy, scenario and engine versions that produced it.</Key>
  <P>A policy is an operating rule; a scenario is the situation tested; the engine is the calculation software. Their saved versions let another reader repeat a calculation on the same inputs. Keep the random seeds (settings for repeating random draws) and run settings too.</P>
  <P>Use the <DocLink to="reproducibility-record">Reproducibility record</DocLink> and <DocLink to="verifiable-exports">verifiable exports</DocLink>. Older records can lack these bindings; if you cannot recover the inputs, say the figure cannot be fully reproduced.</P>
</Section>
<Section id="t5" title="5. Transparency survives handover">
  <Key>Field definitions and automated checks should keep agreeing after the team changes.</Key>
  <P>Table references are generated from the data contract; engine references come from the engine's own definitions. Build checks detect drift in those generated views. Explanatory prose and live deployment behavior still need review: passing a build is not proof that every promise holds in production.</P>
</Section>
<Section id="ownership" title="Your data, access and removal">
  <P>Projects belong to an organization, and access depends on your account and project rights. These rights differ by operation. <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> documents the known browser simulation authorization gap; do not assume the organization label alone guarantees isolation.</P>
  <P>Hosted storage and simulation services handle your data. When you use the AI assistant, project context can be sent to the configured model provider. Review <DocLink to="system-boundary">System boundary</DocLink> before uploading sensitive information.</P>
  <P>Exports cover model inputs, decisions and results, rather than every record the system holds. Deleting a project also has retention exceptions. See <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink> for the practical scope.</P>
  <Callout title="What you can check today"><p>The <DocLink to="audit-log">Audit log</DocLink> records administrative, data-change and access events, with coverage limits and the identity presented by the request. An audit row is useful evidence of a change; it does not by itself prove the caller's identity.</p></Callout>
</Section>
<Section id="next" title="Where to go next">
  <P>Review <DocLink to="system-boundary">what runs where</DocLink>, read <DocLink to="known-limits">the limits</DocLink>, or follow <DocLink to="your-first-project">Your first project</DocLink>.</P>
</Section>
</>; }
