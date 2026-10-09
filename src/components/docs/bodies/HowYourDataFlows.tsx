import { DocPageTitle, InShort, Section, P, Key, Callout, DocLink } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function Guide() { return <>
<DocPageTitle slug="how-your-data-flows" />
<InShort items={[
  "Uploading a file does not immediately make it simulation input.",
  "Review and accept its rows, compute the views, then save decisions and run a scenario.",
  "The result records the versions used so you can inspect or repeat that comparison.",
]} />
<Section id="the-shape" title="Follow one bill-of-materials row">
  <P>A bill of materials (BOM) states how much material a product consumes. In the tutorial, P-CONTROL → M-CASE with consumption 2 means one control unit needs two housings. Follow that same row through the seven steps below.</P>
  <DocFigure id="flow" />
</Section>
<Section id="upload" title="1. Upload: keep the original file">
  <P>For standard CSV uploads, SuReSuite records the file as received. CSV is a spreadsheet-style text file with one record per line. The original cells remain distinct from the values prepared for your model.</P>
</Section>
<Section id="check" title="2. Check: prepare rows for review">
  <P>Rows are staged: parsed and checked, but not yet accepted into the working model. The review shows new, changed, unchanged and held rows. A non-numeric consumption value can hold the BOM row while other valid rows remain eligible.</P>
  <P>File findings use error, warn and info. The simulation-readiness check uses block, warn and info. A file that can be read is not necessarily a model that can run: the product and material identifiers must also exist. See <DocLink to="uploading-data">Uploading data</DocLink>.</P>
</Section>
<Section id="promote" title="3. Accept: apply the reviewed changes">
  <P>Promotion means accepting eligible staged rows into the canonical data: the project's accepted working inputs. A natural key is the combination of identifiers that distinguishes one record. Here, the product/material pair identifies the BOM line.</P>
  <Key>Uploading P-CONTROL → M-CASE again with consumption 3 proposes a change from two to three housings, rather than a second independent requirement.</Key>
  <P>Inspect the change preview before choosing Promote. The system checks the changes again against current inputs when accepting them. Rates and durations on supported columns convert to consistent units here. Some readers still convert older data, so check the accepted value and keep units explicit.</P>
</Section>
<Section id="compute" title="4. Compute: build views from the inputs">
  <P>The accepted BOM line helps build supply-chain lanes and graphs. Derived means calculated from inputs. With demand of 100 control units per week, consumption 2 implies a requirement of 200 housings per week. This arithmetic is a requirement, not proof that the supplier can deliver it.</P>
  <P>Refresh affected views or rerun analyses after an input change. Check freshness and provenance, meaning the record of where a value came from. Older derived measurements can lack that record.</P>
  <Callout title="Some uploads follow another path"><p>Node-list and deep-tier bulk uploads do not share all the staging and original-file behavior above. A firm relationship drawn on a graph is supplied data, not a relationship proved by the drawing.</p></Callout>
</Section>
<Section id="decide" title="5. Decide: save how the chain will operate">
  <P>A policy is a rule for operating the chain, such as when to reorder or which supplier to use. Save your choices as a policy version. A scenario describes the conditions to test, such as a supplier losing capacity for four weeks.</P>
  <P>A dataset version is a saved copy of relevant model inputs. Frozen means that saved copy is fixed for a run; later edits to the project do not silently replace it. Keep the same input and policy versions when comparing a baseline with a disruption.</P>
</Section>
<Section id="freeze" title="6. Simulate: run the saved combination">
  <P>The run binds the dataset and policy versions to the scenario and engine build. The engine is the calculation software. The current worker reads the frozen input and policy copies; an earlier run remains evidence about its earlier inputs.</P>
  <P>Validation checks model behavior under chosen settings; it does not certify a forecast. If inputs change, check whether the saved validation is stale, meaning it no longer covers the current model. Wait for a completed run before using its results.</P>
</Section>
<Section id="stamp" title="7. Stamp: keep the evidence with the result">
  <P>The run record identifies the data, decisions, scenario and engine used. Replications are repeats with different random draws. Check the completed count, measurement period and conversion notes when reading an outcome.</P>
  <P>A hash is a content fingerprint used to identify a version. It cannot supply missing historical data or prove which build a live deployment ran. For handover, retain the input and policy exports, scenario, random seeds (the settings used to repeat draws), engine build and completed count.</P>
</Section>
<Section id="next" title="Where to go next">
  <P>Try the <DocLink to="your-first-project">worked tutorial</DocLink>, learn about <DocLink to="dataset-versions">dataset versions</DocLink> and <DocLink to="policy-versions-and-presets">policy versions</DocLink>, or prepare <DocLink to="verifiable-exports">verifiable exports</DocLink>.</P>
</Section>
</>; }
