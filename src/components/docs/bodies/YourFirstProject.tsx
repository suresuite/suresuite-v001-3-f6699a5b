import { PageTitle, Section, P, Key, Callout, Steps, Bullets, DocLink, Term, AppLink, Defs } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

const samples = [
  ["suppliers.csv", "Suppliers Master", "2 suppliers"],
  ["materials.csv", "Materials Master", "2 materials"],
  ["products.csv", "Products Master", "1 product"],
  ["customers.csv", "Customers Master", "1 customer"],
  ["bom_single_level.csv", "BOM Single Level", "2 consumption relationships"],
  ["inbound_logistic.csv", "Inbound Logistics", "2 supply lanes"],
  ["outbound_logistic.csv", "Outbound Logistics", "1 demand lane"],
];

export default function YourFirstProject() {
  return <>
    <PageTitle lead="Build a small control-kit supply chain, interrupt its board supplier, and compare the same model with a larger inventory buffer.">Your first project</PageTitle>
    <Section id="before-you-start" title="Before you start">
      <P>Use a new, disposable project. You need permission to create it, promote uploaded rows, edit its policies, and run simulations. These are separate actions: being able to open a project does not mean you can change or run it. If a control is unavailable, ask the project owner or administrator to check your access; see <DocLink to="project-access">Project access</DocLink>.</P>
      <P>The example uses two suppliers, two materials, one product and one customer. All names, quantities and prices are synthetic. It is deliberately small enough to reconcile by hand. Do not upload it into a project containing real data: matching identifiers can update existing rows.</P>
      <DocFigure id="first-project-checkpoints" />
    </Section>
    <Section id="example" title="The control-kit example">
      <P>One <Term>P-KIT</Term> consumes one <Term>M-BOARD</Term> and two <Term>M-CASE</Term>. Customer <Term>C-SHOP</Term> requests 10 kits per week, so planned material consumption at that demand is 10 boards and 20 housing halves per week. These are arithmetic checks on the inputs, not simulation results.</P>
      <DocFigure id="control-kit-chain" />
      <Defs items={[
        {term: "Units and economics", def: "Count kits, boards and housing halves in units. Rates are per week; inbound lead times are explicitly one week. Use one illustrative currency throughout: board 20, housing half 5, kit selling price 60. The uploaded annual holding-cost fraction is 0.2 (20%)."},
        {term: "Capacity and starting stock", def: "The plant can produce 15 kits per week. S-BOARD can supply 20 boards per week; S-CASE can supply 40 housing halves. Opening material stock is 30 boards and 60 halves. Capacity exceeds the example's mean demand but does not guarantee uninterrupted service."},
        {term: "Deliberately simple assumptions", def: "Demand and lead times are deterministic and supplier reliability is 1. There is one production stage, no substitute material, and no backup supplier. The example teaches configuration and comparison; it cannot establish a real business case."},
      ]} />
      <P>Download all seven CSVs. The download name and the wizard's dataset name differ for some files; use the mapping below. Upload in this order to make the identifier dependencies easy to check.</P>
      <Defs items={samples.map(([file, dataset, count]) => ({
        term: <a href={`/examples/control-kit/${file}`} download className="text-primary underline underline-offset-2">{file}</a>,
        def: <>{dataset} — {count}.</>,
      }))} />
      <P><a href="/examples/control-kit/README.md" download className="text-primary underline">Download the assumptions and verification notes</a> with the files. Keep the identifiers exactly as written. A material name is a label; the matching material ID connects its BOM row, supplier lane and master row.</P>
    </Section>
    <Section id="the-six-steps" title="Create, load and check the model">
      <Steps steps={[
        {title: "Create Control kit tutorial", where: "/project-manager", body: <>In <AppLink to="/project-manager">Project Manager</AppLink>, enter <strong>Project Name</strong> as Control kit tutorial and <strong>Plant</strong> as KIT-PLANT. Choose <strong>Curated data</strong>, <strong>Make-To-Order</strong> and <strong>Single Level BOM</strong>. Leave <strong>Enable Deep Tier Network Analysis</strong> off. Select <strong>Create Project</strong>. Check that the new project is selected before uploading.</>},
        {title: "Upload, review, then promote each file", where: "/project-manager", body: <>Choose the dataset named beside the download. Select its CSV and check the preview and findings. Select <strong>Upload</strong>; this lands the described CSV for review. Check the new, changed, unchanged and held-back counts, then select <strong>Promote … rows</strong>. On this empty project, expect the row counts listed above and no held-back rows. A staged file has not yet changed the accepted project inputs. Repeat for all seven files.</>},
        {title: "Check accepted data and derived structure", where: "/project-manager", body: <>Confirm the review says <strong>promoted</strong> and the project contains the intended rows. If prompted after completing the core datasets, select <strong>Refresh Data</strong>. The project badge becoming ready means BOM, inbound and outbound data are present; it is not a model-validation verdict. Follow <DocLink to="verify-your-inputs">Verify your inputs</DocLink> to resolve blocking findings and review warnings.</>},
        {title: "Reconcile the product network", where: "/network/product-level", body: <>Find P-KIT, M-BOARD and M-CASE. Check that both materials feed the kit, S-BOARD supplies the board, S-CASE supplies the housing halves, and the customer is attached to the kit. If a relationship is missing, compare IDs in the accepted rows before editing policies. This example has no deep-tier company evidence and no multi-stage production routing to display.</>},
        {title: "Save a baseline policy version", where: "/policies", body: <>Open the Supplier stage and inspect the material rows. Keep min-max replenishment and set <strong>Safety stock</strong> (days) to 7 for both materials; avoid absolute s/S overrides for this exercise because those set the material's levels directly. Save changes, then save a policy version named Tutorial — 7 days. Record the version identifier. Saving a draft grid is not the same as selecting a saved version for a run.</>},
        {title: "Record validation evidence", where: "/policies", body: <>Open <DocLink to="model-validation">Run &amp; Validate</DocLink>. In Verification, select <strong>Run checks</strong> and clear blockers. In Run simulation, select <strong>Multiple runs</strong>, set <strong>Simulation time (weeks)</strong> to 52 and use 30 automatic seeds for this teaching exercise. Select <strong>Run replications</strong> and wait for completed output. In Warm-up detection, select <strong>Auto-detect</strong>, review the traces and use <strong>Apply to validation</strong>. This synthetic example has no empirical series: record an honest <strong>Face-validation statement</strong> describing your BOM, demand and baseline checks, rather than claiming statistical validation. Enter a <strong>Model name</strong>, select the <strong>Planning period</strong> this model is for, inspect the readiness checklist, then select <strong>Save Validated Model</strong> when enabled. Retain its protocol, evidence run and version identifiers.</>},
      ]} />
    </Section>
    <Section id="run-and-compare" title="Run a baseline, an outage and a response">
      <P>In <AppLink to="/simulation-lab">Simulation Lab</AppLink>, select this project and its saved model/policy version. Use the scenario controls described in <DocLink to="scenarios">Scenarios</DocLink>. The interface uses weeks: set Planning horizon to 52 (364 days), Steady state starts at to 4 (28 days), Warm-up detection to manual, and seed to 42; enable Common random numbers. Use the saved model’s recommended replication count consistently across the comparison and review any protocol-deviation notice. These are teaching settings, not a generally sufficient validation protocol. The downloadable local fixture uses only 2 replications to check the mapping quickly and reports that limitation explicitly. Review and acknowledge only warnings you understand.</P>
      <Defs items={[
        {term: "A · Baseline", def: "Use the 7-day policy version and no disruptions. Wait for completed status and check the actual replication count, conversion notes and weekly series before proceeding."},
        {term: "B · Board outage", def: "Keep A's inputs, policy, horizon, warm-up and seed settings. Add a supplier disruption targeting S-BOARD, starting at week 12 (day 84), lasting 4 weeks (28 days), with Capacity lost set to 100%. Save the scenario and run it. Check that the conversion notes did not skip or move the event."},
        {term: "C · Larger buffer", def: "Keep B's event and settings. In the Supplier policy stage change only M-BOARD's Safety stock (days) from 7 to 28. Save changes and a new policy version, repeat the validation workflow to save a model using that version, then select that model for B's scenario. Leave M-CASE at 7. This is a preventive inventory policy, not a claim that the Recovery playbook's safety-stock control is equivalent."},
      ]} />
      <P>Open <strong>Compare</strong> and select the completed runs. Compare A with B to measure the disruption's effect, and B with C to assess the buffer. Check the provenance: the intended policy difference should be identifiable while data, engine, scenario settings and replication design stay aligned. If the app offers a reused result, inspect its recorded identity rather than counting it as a new replication.</P>
    </Section>
    <Section id="reading-the-first-result" title="What would justify a conclusion?">
      <Bullets items={[
        <>Compare fill rate and lost-sales value alongside average on-hand inventory value. A buffer may protect service while tying up more inventory. Do not call it better solely because one service number improves.</>,
        <>Inspect the weekly trace around the outage. Starting stock and replenishment can postpone the shortage. No immediate service drop does not prove that a disruption was ignored; the conversion notes and time series answer different questions.</>,
        <>Check the actual replication count and confidence interval. Deterministic inputs can produce identical replications and a zero-width interval. That says nothing about whether the assumptions represent a real chain.</>,
        <>Treat a missing metric as unavailable, not zero. If a run failed, read its failure reason and fix the input or settings before retrying. Never compare a partial result with a completed baseline as though both measured the same experiment.</>,
      ]} />
      <Key>Success is three completed, traceable runs and an explanation of the service–inventory trade-off. A green status alone is not evidence that the model describes your business.</Key>
      <Callout title="Verification boundary"><p>The downloadable files are checked locally with the current CSV validator and worker-to-engine path. The local fixture’s observed numbers and conversion notes are available in the downloadable verification notes. Local execution does not verify database promotion, live permissions, queue dispatch or production persistence. See the downloadable notes for the exact checks and limits.</p></Callout>
    </Section>
    <Section id="what-to-do-next" title="Move from the example to a decision">
      <P>Replace one assumption at a time with measured data, beginning with demand, lead times, capacities and costs. Keep the tutorial intact as a reference. Read <DocLink to="reading-your-results">Reading your results</DocLink> for result checks, <DocLink to="experiments-and-comparison">Experiments and comparison</DocLink> for controlled experiments, and <DocLink to="known-limits">Known limits</DocLink> before presenting a recommendation.</P>
    </Section>
  </>;
}
