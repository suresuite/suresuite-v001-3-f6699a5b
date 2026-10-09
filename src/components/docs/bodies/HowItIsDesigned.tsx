import { DocPageTitle, InShort, Section, P, Callout, Defs, Bullets, DocLink, Term } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function Guide() { return <>
<DocPageTitle slug="how-suresuite-is-designed" />
<InShort items={[
  "Your upload, accepted inputs, decisions and results have separate places in the system.",
  "This separation lets you review changes and compare runs made from saved versions.",
  <>Follow the six tiers (stages in your data's life) below, then read <DocLink to="how-your-data-flows">one row's journey</DocLink>.</>,
]} />
<Section id="the-journey" title="Six tiers: from your file to your result">
  <P>A tier is a stage in the life of your data. These numbers describe data responsibilities, not supplier tiers or separate servers. A bill of materials (BOM) lists the material quantities needed for one product. A lane connects a supplier to a material, or a product to a customer.</P>
  <DocFigure id="tiers" />
  <Defs items={[
    {term:"Tier 0 · Landing",def:"Keep the file as received. You can distinguish an original cell from the value later accepted by the model."},
    {term:"Tier 1 · Staging",def:"Prepare rows for review. Staged means checked but not yet accepted: an upload can have valid rows and held rows without changing your model."},
    {term:"Tier 2 · Accepted inputs (canonical)",def:"Canonical means the accepted working data, with consistent units and identifiers. Promotion is the step that applies reviewed rows here. This is where you correct the facts of your chain."},
    {term:"Tier 3 · Computed views (derived)",def:"Build lanes, graphs and network measurements from inputs. Derived means calculated rather than supplied. After editing inputs, refresh or rerun the affected calculation."},
    {term:"Tier 4 · Decisions",def:"Save policies and scenarios. A policy is an operating rule, such as how much to reorder. A scenario describes the conditions to test, including a disruption. Saved versions record the choices for a run."},
    {term:"Tier 5 · Results",def:"Keep the outcome with the versions it used. Frozen means saved for that run, so later project edits do not silently change its inputs. Read the versions and completed run status before comparing outcomes."},
  ]} />
</Section>
<Section id="laws" title="The three laws, and why they matter">
  <Bullets items={[
    <><strong>External data never lands below staging.</strong> Review an import before it becomes accepted input. Standard CSV uploads (spreadsheet-style text files) follow this path; node-list and deep-tier bulk uploads remain exceptions.</>,
    <><strong>Computed data is always rebuildable.</strong> A graph or measurement should be calculated again from its inputs, rather than repaired by typing a new output. Historical measurements can lack the saved inputs needed to reproduce them.</>,
    <><strong>Every decision remembers the data it was made on.</strong> A saved run uses identified input and policy versions. Check whether a saved validation still applies after editing the project. Older records can have incomplete version information.</>,
  ]} />
  <P>These are the design rules. <DocLink to="known-limits">Known limits</DocLink> explains where current or historical paths fall short; the diagram alone is not proof that every path follows them.</P>
</Section>
<Section id="one-source" title="We never change your numbers silently">
  <P>That is the rule you should be able to check. Review the proposed changes before accepting an upload. On supported columns, rates and durations are converted to consistent units during promotion; keep the original units visible when checking the accepted value.</P>
  <P>A number may come from your data, a calculation, or a default. A default is a stated value used when an input is missing. A substitution should be marked where you read it. Inspect <DocLink to="where-a-number-came-from">where a number came from</DocLink> and the run's conversion notes before relying on it.</P>
  <P>One written data description supplies the generated field references and upload rules. Automated checks catch some disagreements; explanatory pages still need review. A version identifies the inputs used, not whether your assumptions describe the real chain.</P>
</Section>
<Section id="components" title="Where those stages run">
  <P>The browser is your workspace for uploading and reviewing data. Supabase is the hosted storage and request service. A simulation worker runs jobs on a server. The Python engine, scsim, calculates the outcomes. The app also has a browser execution path; <DocLink to="system-boundary">System boundary</DocLink> explains what crosses between these components.</P>
  <DocFigure id="system-components" />
</Section>
<Section id="limits" title="The limits to read before adopting the tool">
  <P>A stored version does not prove model validity or deployment parity. Not all ingestion paths use staging, and historical records can have incomplete provenance (the record of where a value came from).</P>
  <Callout tone="limit" title="Known browser simulation authorization gap">
    <p>Source review identified incomplete caller authorization on the browser simulation endpoint. This path does not establish the caller's project role before dispatch. Interface restrictions must not be treated as a complete security boundary. The documentation changes do not fix this issue, and no production bypass test was run. See <DocLink to="roles-and-capabilities">roles and capabilities</DocLink>.</p>
  </Callout>
</Section>
<Section id="next" title="Choose your next page">
  <P>New to the tool? Read <DocLink to="how-your-data-flows">How your data flows</DocLink>. Ready to try it? Follow <DocLink to="your-first-project">Your first project</DocLink>. Reviewing a decision? Start with <DocLink to="reading-your-results">Reading your results</DocLink>. Looking for a table? Use the <DocLink to="data-model">data model reference</DocLink>.</P>
</Section>
<Section id="engineer" title="For engineers: developer setup">
  <P>Read the repository's README and CLAUDE.md. Install the lockfile dependencies with <Term>npm ci</Term> and start Vite with <Term>npm run dev</Term>. This serves the frontend; it does not create a local Supabase database or a Fly worker.</P>
  <P>The current Supabase client has project configuration in its source. Do not assume an arbitrary .env file redirects the application into an isolated backend. Arrange a dedicated backend before exercising writes from the full app.</P>
  <P>For an offline simulation check, install the Python dependencies and run <Term>python scripts/verify-manual-example.py</Term>. This checks the downloadable frozen-input example locally; it does not verify hosted upload promotion or browser-to-worker execution.</P>
  <P>For documentation changes, run <Term>npm test -- src/components/docs</Term>, <Term>npm run typecheck</Term>, <Term>npm run check:docs</Term>, <Term>npm run lint</Term> and <Term>npm run build</Term>. Edit source metadata or generators rather than generated references.</P>
  <P>Next: <DocLink to="system-boundary">review the system boundaries</DocLink> or <DocLink to="getting-an-api-key">set up scoped API access</DocLink>.</P>
</Section>
</>; }
