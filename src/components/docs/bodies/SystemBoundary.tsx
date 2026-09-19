import { PageTitle, Section, P, Key, Callout, Defs, DocLink, Term } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { SystemBoundaryFigure } from "@/components/docs/figures";

export default function SystemBoundary() {
  return (
    <>
      <PageTitle lead="What runs where, what crosses each line, and what never leaves.">
        System boundary
      </PageTitle>

      <Section id="who-this-is-for" title="Who this page is for">
        <P>
          Someone has to approve this tool before anyone uses it. That person usually needs four
          answers — where the data sits, what reaches it, what leaves, and what happens when a
          component is compromised — and they need them without reading the rest of a user manual.
          This page is those four answers.
        </P>
      </Section>

      <Section id="the-layers" title="The four layers">
        <DocFigure id="boundary" fallback={<SystemBoundaryFigure />} />
        <Defs
          items={[
            {
              term: "Your browser",
              def: "A React application. It renders the interface and holds nothing durable — no copy of your data survives a closed tab beyond ordinary browser caching. It never connects to a database directly.",
            },
            {
              term: "Supabase",
              def: "A managed PostgreSQL database plus a set of small server functions. Your files, your data, your policies and your results live here. So do the rules about who may read them, expressed as database policies rather than as application code.",
            },
            {
              term: "Simulation worker",
              def: "A long-running process on Fly.io. It takes a job from a queue, runs it, reports progress, and writes the result back. It holds no state of its own between jobs.",
            },
            {
              term: "Engine",
              def: "The model itself, a Python library. It receives parameters and returns results. It has no database credentials and no network access of its own — it cannot read anything it was not handed.",
            },
          ]}
        />
      </Section>

      <Section id="what-crosses" title="What crosses each line">
        <Defs
          items={[
            {
              term: "Browser to Supabase",
              def: "Authenticated requests only. Every request carries the caller's identity, and the database decides what that identity may see. A request that asks for another organization's rows does not get an error — it gets nothing back, which is the correct answer to a question the caller was not entitled to ask.",
            },
            {
              term: "Supabase to the queue",
              def: "A job: which project, which scenario, which policy set, which engine version. Not the data itself — a reference to it.",
            },
            {
              term: "Queue to the worker",
              def: "The worker picks up the job and fetches exactly the project data that job needs.",
            },
            {
              term: "Worker to engine",
              def: "Parameters in, results out. The engine is a pure computation at this boundary: same inputs, same outputs, no side effects.",
            },
            {
              term: "Worker back to Supabase",
              def: "The result rows, and progress messages that the browser receives live over a subscription so a long run shows movement rather than a spinner.",
            },
          ]}
        />
      </Section>

      <Section id="the-honest-parts" title="The parts worth asking about">
        <Callout title="The worker runs with elevated database access">
          <p>
            The simulation worker authenticates with a service credential, which bypasses the
            per-user access rules — it has to, because it acts on behalf of a job rather than a
            person, and the person may well have closed their browser. The isolation at that layer
            therefore comes from the worker's own code being narrow, not from the database refusing
            it. This is the sharpest edge in the architecture and it is stated here rather than
            left to be discovered.
          </p>
        </Callout>
        <Callout title="Audit today covers the administrative plane">
          <p>
            Changes to accounts, roles and organizations are recorded with the actor who made them.
            Movements of data between tiers are not yet recorded to the same standard. If your
            approval process requires a complete data-plane audit trail, that is a gap today and is
            listed on <DocLink to="known-limits">Known limits</DocLink>.
          </p>
        </Callout>
        <Key>
          Both of these are scheduled work, not design decisions. They are on this page because a
          boundary description that omits its own weak points is not a boundary description.
        </Key>
      </Section>

      <Section id="what-never-leaves" title="What never leaves">
        <P>
          Your data is not sent to any third party as part of normal operation. It is not pooled
          across customers and it is not used as training material. Where the assistant is used, the
          scope of what it can see is described on{" "}
          <DocLink to="ai-assistant">The AI assistant</DocLink> — it is bounded by the same access
          rules as any other reader, not exempt from them.
        </P>
        <P>
          Exports leave when you export them, in formats that can be read without this software.
          Deleting a project removes its data and the results derived from it.
        </P>
      </Section>

      <Section id="verifying" title="Verifying any of this">
        <P>
          The access rules are generated from a written description of every table — which
          capability is needed to read it, which to write it, and what the minimum project role is.
          That description is in the repository and the database rules are produced from it, so the
          two cannot disagree. <Term>npm run contract:check</Term> is the command that asserts it.
        </P>
        <P>
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> covers the same ground
          from the user's side rather than the architecture's.
        </P>
      </Section>
    </>
  );
}
