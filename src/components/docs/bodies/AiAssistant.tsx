// §6.3 section 9 — the AI assistant. Deepened in WP 5.2j.
//
// 344 rendered words, and the one thing a reader of the picker most needs was
// missing: a PERSONA IS A PROMPT PREAMBLE AND NOTHING ELSE. All five share one
// tool surface, one model and one prompt body, and the specialist agents that
// actually do the work are chosen by a router from what you asked — never from
// what you picked. `src/lib/chat/agents.ts` says so in its own header; no page
// said it to a user.
//
// The chat tables are deferred in the contract, which is why this page had
// nothing generated to render. The three vocabularies that ARE declared —
// personas, modes, the router's roster — are now derived, including the
// disabled Auto mode's unlock conditions verbatim, because a commitment about
// when software may change things on its own is not a thing to paraphrase.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { ReadsFrom } from "@/components/docs/lineage";
import { ASSISTANT } from "@/components/docs/generated/policy.generated";

export default function AiAssistant() {
  const { personas, modes, autoTooltip, defaultMode, agents } = ASSISTANT;
  const dflt = modes.find((m) => m.id === defaultMode);

  return (
    <>
      <PageTitle lead="What it can see, what it can do, what the picker actually changes, and what it cannot do without you.">
        The AI assistant
      </PageTitle>

      <Section id="what-it-is" title="What it is for">
        <P>
          A conversation about your project, with the project in front of it. You can ask what your
          data says, what a policy would change, or what a result means, without leaving the tool
          and without knowing which screen holds the answer.
        </P>
        <Key>
          It can read and it can propose. It cannot change your project on its own — every change it
          suggests arrives as something you approve or discard.
        </Key>
      </Section>

      <Section id="modes" title="The two modes, and the third one that is switched off">
        <P>
          Beside the model picker is a mode switch. It is per thread, and it decides whether the
          assistant may draft a change at all.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {modes.map((m) => (
            <div key={m.id} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">{m.label}</span>
                {m.id === defaultMode && (
                  <Badge variant="secondary" className="text-[10px]">default</Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{m.hint}</p>
            </div>
          ))}
          <div className="p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold text-muted-foreground">Auto</span>
              <Badge variant="outline" className="text-[10px]">disabled</Badge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Visible and not selectable. Its tooltip states the conditions under which it could
              ever unlock, and they are reproduced word for word below rather than summarised.
            </p>
          </div>
        </div>
        <Callout tone="law" title="What would have to be true before anything runs unattended">
          <p className="italic">{autoTooltip}</p>
          <p>
            Quoted exactly. A commitment about when software may act without a person is the last
            thing a manual should paraphrase, and the point of printing it is that you can hold the
            product to it.
          </p>
        </Callout>
        <P>
          A new thread starts in <Term>{dflt?.label ?? defaultMode}</Term>. The mode switch is
          behind a deployment setting, so where it is not turned on you will not see it and every
          thread behaves as {dflt?.label ?? defaultMode} — the server enforces the mode regardless
          of what the control shows.
        </P>
      </Section>

      <Section id="personas" title={`The ${personas.length} personas — and what picking one actually changes`}>
        <Key>
          A persona is a sentence added to the prompt. It is not a different assistant.
        </Key>
        <P>
          All {personas.length} share one tool surface, one model and one prompt body. The only
          difference is a preference — <em>prefer the risk tools first</em> — so a question the
          Risk Analyst can answer is a question the Logistics Planner can answer, slightly less
          eagerly. <strong>Pick one to steer, not to unlock.</strong>
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {personas.map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">{p.name}</span>
                {!p.requiresProject && (
                  <Badge variant="outline" className="text-[10px]">no project needed</Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p.blurb}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="agents" title={`The ${agents.length} specialists, which you do not choose`}>
        <P>
          Behind the conversation is a router. It reads what you asked and hands the work to one of{" "}
          {agents.length} specialists, each with its own prompt, its own narrowed set of tools and
          its own kind of proposal. <strong>None of them is in the picker</strong>, and the picker's
          names map onto none of these — so the way to reach the policy configurator is to ask about
          a policy, not to select a persona.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {agents.map((a) => (
            <div key={a.slug} className="p-4">
              <div className="font-mono text-[12px] font-semibold text-foreground">{a.slug}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {a.mission.charAt(0).toUpperCase() + a.mission.slice(1)}.
              </p>
            </div>
          ))}
        </div>
        <P>
          The order above is the tie-break order, and it encodes a rule worth knowing: when two
          specialists could both answer, <strong>your own data beats an estimate, an estimate beats
          mined external structure, and mined structure beats a sensed event.</strong> Internal
          ground truth always outranks something read off the internet.
        </P>
        <P>
          Which specialists a deployment runs at all is an administrator's setting, and the router
          itself can be switched off — with it off, every question is answered advisorily and
          nothing drafts a change.
        </P>
      </Section>

      <Callout tone="law" title="Nothing it says is a result">
        <p>
          An answer from the assistant is a reading of your data, not a number with a run behind it.
          It carries no dataset fingerprint, no policy version and no engine version, so it cannot
          be reproduced and it should not be quoted as a finding.
        </p>
        <p>
          When you need a figure that survives being asked about, run the simulation and take it
          from there. <DocLink to="reproducibility-record">Reproducibility record</DocLink> is what
          that difference is called.
        </p>
      </Callout>

      <Section id="conversations" title="Conversations and folders">
        <P>
          Threads are kept, so a line of enquiry can be picked up later, and can be organised into
          folders when there are enough of them to need it. A thread belongs to a project — asking
          the assistant about one project from inside another is not something the tool lets you do
          by accident.
        </P>
        <P>
          The mode is a property of the <em>thread</em>, not of your account. A thread you started
          in Ask stays in Ask, which is the right way to keep a read-only line of enquiry read-only.
        </P>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProjectIntelligence.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="plans-and-proposals">Plans and proposals</DocLink> is what Review mode
          produces · <DocLink to="project-memory">Project memory</DocLink> is what it remembers
          between threads ·{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink> is which model
          answers and what it costs ·{" "}
          <DocLink to="reports-and-files">Reports &amp; files</DocLink> is what the report builder
          produces · <DocLink to="who-can-see-your-data">Who can see your data</DocLink>.
        </P>
        <P>
          Open it at <AppLink to="/project-intelligence">/project-intelligence</AppLink>.
        </P>
      </Section>

      <Provenance from="src/lib/chat/agents.ts for the personas, ModeSwitch.tsx for the modes and the Auto unlock conditions verbatim, and project-ai-chat/router.ts's AGENT_ROSTER for the specialists — the chat tables themselves are deferred in the contract. Plus WP 5.1's confirmed table-grain lineage for the reads block" />
    </>
  );
}
