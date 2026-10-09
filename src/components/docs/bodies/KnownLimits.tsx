import { DocPageTitle, InShort, Section, P, Callout, Bullets, DocLink } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function Guide() { return <>
<DocPageTitle slug="known-limits" />
<InShort items={[
  "A result is evidence about the modeled chain and its assumptions, not a forecast of everything that can happen.",
  "Check the five limits below before recommending a response.",
  <>If a missing mechanism could reverse your decision, test assumptions or gather more evidence. Then use <DocLink to="reading-your-results">Reading your results</DocLink>.</>,
]} />
<Section id="why-at-the-front" title="Five limits to check first">
  <Bullets items={[
    "The engine works in weekly steps around one focal production stage. A detailed process graph does not mean every intermediate stage is simulated.",
    "Company relationships show the network you supplied; they do not automatically become simulated upstream dependencies.",
    "Some upload paths and historical records have less review or provenance (the record of where a value came from). Missing information is not zero.",
    "A saved policy (an operating rule) may not affect the calculation. Ordinary app runs do not report the Resilience Index, a combined stress-test measure.",
    "Source review identified incomplete caller authorization on the browser simulation endpoint. The documentation changes do not fix it.",
  ]} />
</Section>
<Section id="model-limits" title="Model fidelity">
  <span id="model" />
  <P>The engine uses weekly steps and aggregate quantities rather than tracking each individual item. It represents suppliers, materials, one focal production stage and customers. A bill of materials (BOM) lists component quantities; multi-level BOMs are flattened into total root-to-leaf material requirements for simulation.</P>
  <P>The engine can represent a product's production delay and work-in-progress (items started but not yet finished). It does not independently model intermediate inventories or subassembly capacities just because the process graph displays them. Timing within a week is outside this model.</P>
  <P>Company relationships in the deep-tier graph do not automatically become simulated upstream dependencies. Network centrality measures a node's structural position in the supplied graph; it is not measured loss or proof of how a disruption will spread.</P>
  <DocFigure id="trust-boundaries" />
</Section>
<Section id="data-limits" title="Data and mapping">
  <span id="data" />
  <P>Standard CSV uploads have staging (checked rows waiting for acceptance) and promotion (applying reviewed changes). Node-list and deep-tier bulk uploads are exceptions. Missing optional values can use defaults, and computed values can differ from original cells. Inspect the change preview and run conversion notes.</P>
  <P>Changing accepted inputs can make analyses and validation stale: they describe older data. Current execution reads saved input versions, but older runs and derived records may not carry complete versions.</P>
</Section>
<Section id="policies" title="Policy support and results">
  <P>A policy is a rule for running the chain. Some controls are stored or reserved without affecting the current engine. Use the field's stage reference and engine status rather than inferring support from its presence.</P>
  <P>Finished-goods inventory controls apply to make-to-stock products, which build ahead of orders. Make-to-order products start from orders and do not use that finished-goods stock policy.</P>
  <P>The Resilience Index is a combined stress-test measure in the engine library; ordinary application runs do not emit it. Unavailable fill rate (the share of demand served), recovery time or a time series is not zero. Check the measurement period and whether recovery was still incomplete when observation ended.</P>
</Section>
<Section id="security" title="Access-control and deployment limits">
  <Callout tone="limit" title="Known browser simulation authorization gap"><p>Source review identified incomplete caller authorization on the browser simulation endpoint. <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> distinguishes this from the scoped public API gateway. The documentation changes do not fix this issue, and no production bypass test was run.</p></Callout>
  <P>The reviewed source and a live deployment can differ. The tutorial's CSV validation and engine execution are local; hosted upload promotion and browser-to-worker execution remain unverified for the sample.</P>
</Section>
<Section id="documentation-limits" title="What the manual can establish">
  <P>Generated field references are checked against their source descriptions. Narrative guides still need review when behavior changes. A source check, a local example and a hosted run are different kinds of evidence; a page should say which it has.</P>
</Section>
<Section id="how-to-use" title="What to report with a decision">
  <span id="decision" />
  <P>State the model boundary, data coverage, important assumed values, completed replication count, measured period and the factor you changed. A replication is one repeat of the model with its own random draws.</P>
  <P>A confidence interval describes uncertainty in an estimated result across those repeats. It measures simulation precision conditional on the model's assumptions; it does not certify real-world validity.</P>
  <P>When a limitation can reverse the decision, collect the missing evidence or test alternative assumptions before recommending action. Next: <DocLink to="reading-your-results">Reading your results</DocLink> and <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink>.</P>
</Section>
</>; }
