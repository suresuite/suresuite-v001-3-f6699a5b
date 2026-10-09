import { DocPageTitle, InShort, Section, P, Callout, Defs, DocLink } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function SystemBoundary() { return <>
<DocPageTitle slug="system-boundary" />
<InShort items={[
  "You review data in the browser; hosted services store the model and execute server runs.",
  "The simulation engine, the software that calculates outcomes, receives prepared inputs rather than database access keys.",
  <>Check access gaps and optional AI processing before uploading sensitive data. Then read <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink>.</>,
]} />
<Section id="who-this-is-for" title="Before you approve the tool">
  <P>This page explains where data is stored and which services handle it. The six data tiers describe stages in its life; the components below describe where work happens. A deployment is the running version of the application; it must be checked separately from a source-code description.</P>
</Section>
<Section id="the-layers" title="The four components">
  <DocFigure id="boundary" />
  <Defs items={[
    {term:"Your browser",def:"Displays the app, prepares edits and sends requests. Unsaved edits can be lost on refresh. The app also supports running the Python engine in the browser for validation and local execution; do not assume all computation happens on a server."},
    {term:"Supabase",def:"The hosted database, file storage and server functions. Accepted inputs, saved policies, versions and run records live here. Database rules and request handlers govern access, with gaps noted below."},
    {term:"Simulation worker",def:"A server process hosted on Fly.io. It receives a queued job, loads the run's saved input and policy versions, calculates outcomes and saves results. Some worker paths retain project data in memory between requests."},
    {term:"scsim engine",def:"The Python library that calculates a weekly supply-chain simulation. It receives prepared model inputs. It does not need database credentials to perform that calculation."},
  ]} />
</Section>
<Section id="what-crosses" title="What moves between them">
  <Defs items={[
    {term:"Browser → Supabase",def:"Uploaded files, saved edits and requests to read or run a project. Some paths carry an application-asserted identity rather than an authenticated Supabase user; access must be checked for the operation, not inferred from a sign-in screen."},
    {term:"Request service → queue",def:"A job naming the project, scenario and saved versions. A queue holds work until a worker picks it up; it is not the permanent record of your model."},
    {term:"Queue → worker → engine",def:"The worker loads saved versions and translates them into engine inputs. The engine returns calculated outcomes to the worker."},
    {term:"Worker → storage → browser",def:"Saved result records and progress messages. The browser reads the result. Detailed series may use separate result-file storage, so storage is not limited to database rows."},
  ]} />
</Section>
<Section id="the-honest-parts" title="Access and temporary copies">
  <Callout title="The worker has elevated database access"><p>The worker uses a service credential that bypasses per-user database rules. Its request and execution code therefore matters to isolation. Hiding an action in the interface is not proof that the server refuses it.</p></Callout>
  <Callout title="Some worker paths keep data in memory"><p>The worker's graph cache can retain project graphs and effective policies between uses. Its idle timer drops cached data after ten minutes by default. A current version-bound experiment reads frozen copies (saved for that run), rather than using later edits to the live project.</p></Callout>
  <P>Source review identified incomplete caller authorization on the browser simulation endpoint. This path does not establish the caller's project role before dispatch. The documentation changes do not fix the issue, and no production bypass test was run. Read <DocLink to="roles-and-capabilities">the full access finding</DocLink> before treating the interface as a security boundary.</P>
  <P>The <DocLink to="audit-log">Audit log</DocLink> describes administrative, data-change and access events, including coverage and identity limits. A recorded identity is not always independently verified.</P>
</Section>
<Section id="what-never-leaves" title="Optional processing, exports and deletion">
  <P>Hosted storage and execution involve the configured service providers. If you use the AI assistant, prompts and relevant project context can also be sent to the configured model provider. Review <DocLink to="ai-assistant">The AI assistant</DocLink> and your deployment's provider arrangements; this page does not establish those providers' retention or training terms.</P>
  <P>Exports leave the system when you download or share them. Project deletion removes project data through the supported deletion path, with exceptions for some files and account records. Read <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink> before assuming every copy disappears.</P>
</Section>
<Section id="verifying" title="What to check next">
  <P>For an IT review, check the deployed services and credentials alongside <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink>. For a modeling decision, read <DocLink to="known-limits">Known limits</DocLink>. For the data path, return to <DocLink to="how-your-data-flows">How your data flows</DocLink>.</P>
</Section>
</>; }
