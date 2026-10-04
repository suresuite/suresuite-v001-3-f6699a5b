import { PageTitle, Section, P, Key, Callout, DocLink, Term, Defs } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function HowYourDataFlows() {
  return <>
    <PageTitle lead="Follow a file into accepted inputs, derived views, saved versions and a simulation result—and check each boundary.">How your data flows</PageTitle>
    <Section id="the-shape" title="A lifecycle with separate decisions">
      <P>A downloaded template, a staged upload and a saved model are different objects. You can have a valid CSV that has never been promoted, or new accepted data alongside a validated model that still names older versions. Knowing which object you are looking at prevents an apparent update from becoming an unexplained result.</P>
      <DocFigure id="flow" />
      <Callout title="Scope of this diagram"><p>This is the described CSV path used by BOMs, logistics, forecasts and item masters. Node List and deep-tier network bulk uploads do not pass through every illustrated step. ERP sync has its own review behavior; see <DocLink to="csv-vs-connector">CSV versus connector</DocLink>.</p></Callout>
    </Section>
    <Section id="upload" title="1. Preview and original file">
      <P>Selecting a CSV sends a parse request that returns rows and findings without landing an ingestion run. Selecting <strong>Upload</strong> on the described path retains the original file and its hash and creates the ingestion record. The original bytes answer “what was supplied?”; they do not tell you which rows later became accepted inputs.</P>
      <P>For the control-kit example, the inbound file says 10 boards per week with a one-week lead time. Keep that file when checking a later number. The file's hash identifies its bytes, not a guarantee that the supplied demand or relationship is true.</P>
    </Section>
    <Section id="check" title="2. Typed rows, findings and a comparison">
      <P>The parser and dataset rules check CSV structure, required fields, numbers and supported units. Typed staged rows carry findings and a comparison with current project data. Inspect new, changed, unchanged, superseded and held-back counts. CSV findings use <Term>error</Term>, <Term>warn</Term> and <Term>info</Term>; do not confuse these with the later model gate.</P>
      <Key>A clean staging result means the file passed those checks. It does not prove that every ID connects correctly across datasets or that the model is adequate for a decision.</Key>
    </Section>
    <Section id="promote" title="3. Promotion changes accepted inputs">
      <P><strong>Promote … rows</strong> writes eligible staged rows into the dataset. The described path matches the table's natural keys and upserts values; rows missing from the upload are not a deletion request. It recomputes the comparison when promotion occurs. This does not lock the values you saw earlier: if the project may have changed, use Re-compare with current data and review again before promoting.</P>
      <P>Declared rates and durations are normalized at promotion. A 14-day inbound lead time becomes two weeks. Some downstream readers still convert older unit representations, so the accurate statement is that declared promoted values are canonical—not that downstream conversion never occurs. The original file, staged values and accepted values can therefore differ for a legitimate reason.</P>
      <P>A matching key is dataset-specific. A material master matches a material ID; a lane is identified by its own combination of key fields. Read the relevant <DocLink to="data-model">table reference</DocLink> and inspect the actual diff before assuming a repeat upload is harmless.</P>
    </Section>
    <Section id="compute" title="4. Derived data describes a computation">
      <P>Combining accepted BOM and logistics data builds views used to inspect the chain. Network analyses may calculate additional metrics. These are outputs of transformations, not further observations of real trade. A line drawn between two nodes is only as well-supported as the source relationship that created it.</P>
      <P>Wait for rebuilding to finish and investigate combine failures. A visible graph may still reflect earlier derived data. Check freshness and provenance where available rather than assuming every displayed metric refreshes immediately. With the example, reconcile the 1-board and 2-housing-half consumption rates against the accepted BOM before interpreting centrality or running a scenario.</P>
    </Section>
    <Section id="decide" title="5. Policies add decisions to data">
      <P>Item masters and lanes describe the chain; policies describe choices such as replenishment and how shortages are handled. Save changes before making a version. A draft cell, an effective value shown in the grid and a field actually read by the engine are not interchangeable.</P>
      <P>Resolution is field-specific. For example, a Supplier-stage material override can change opening stock, while a similarly named value on another stage need not do so. Absolute replenishment levels and safety-stock days also interact differently. Use <DocLink to="how-policies-work">How policies work</DocLink> and the <DocLink to="field-index">field reference</DocLink> to inspect a particular value; do not infer one precedence rule for all columns.</P>
    </Section>
    <Section id="one-source" title="Which saved object answers which question?">
      <Defs items={[
        {term: "Current project data", def: "What is accepted now? Useful for correcting inputs and exploratory work. It can change after an earlier run."},
        {term: "Dataset version", def: "Which stored dataset snapshot was bound to the work? Check the recorded scope and identifier; a file hash and a dataset-version identifier describe different things."},
        {term: "Policy version", def: "Which saved settings and overrides were selected? Saving another version does not rewrite an earlier run's identity."},
        {term: "Validated model", def: "Which data and policy versions have validation evidence attached? Inspect the verdict and freshness. A stored model is not a declaration that all future inputs are valid."},
        {term: "Run record", def: "What was executed, with which scenario, engine and replication settings? Compare recorded inputs, completion status and actual outputs before interpreting a KPI."},
      ]} />
      <P>For the tutorial, A and B intentionally share data and policy versions while the disruption changes. C intentionally changes the board's safety-stock policy. If other identities differ, establish why before attributing the KPI difference to the buffer.</P>
    </Section>
    <Section id="simulate" title="6. Mapping and execution can still change the effective setup">
      <P>The worker mapping builds the engine model from stored rows and policies. Conversion notes record substitutions, unsupported settings and time conversions. Multi-level BOM dependencies can be flattened into effective material requirements; viewing intermediate assemblies does not prove that each has separate simulated stock, capacity and processing time.</P>
      <P>Read those notes even after validation passes. In the local control-kit check, a 364-day horizon becomes 52 weeks but the analysis window is 39 weeks. A total revenue figure therefore cannot be reconciled simply by multiplying weekly demand by 52. See <DocLink to="units-and-conventions">Units and conventions</DocLink> and <DocLink to="reading-your-results">Reading your results</DocLink> for the relevant output definitions.</P>
    </Section>
    <Section id="stamp" title="7. Keep evidence with the conclusion">
      <P>Record the run IDs, data and policy versions, scenario, engine version, actual replication count and conversion notes. Export the available provenance with the results. Where a historical run lacks a field, mark that limitation instead of inferring the missing identity from today's project.</P>
      <Key>Traceability lets you investigate how a number was obtained. It does not certify the truth of the original data, eliminate model assumptions or guarantee that every historical result can be reproduced.</Key>
      <P>Continue with <DocLink to="dataset-versions">Dataset versions</DocLink> and <DocLink to="reproducibility-record">The reproducibility record</DocLink> when preparing a comparison for someone else to review.</P>
    </Section>
  </>;
}
