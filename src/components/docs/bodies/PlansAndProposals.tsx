// §6.3 section 9 — plans and proposals.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { ASSISTANT, INTELLIGENCE } from "@/components/docs/generated/policy.generated";

/** What each artifact class actually is, keyed by the stored name so a label
 *  cannot drift onto the wrong row. The LIST is never written here. */
const ARTIFACT: Record<string, string> = {
  item_master_diff: "changes to the economics on your materials, products or suppliers — a cost, a lead-time shape, a capacity",
  policy_bundle_diff: "changes to your policy defaults and overrides, the same values you would type into the grid",
  model_card_draft: "a validation card — a warm-up length and replication count, with the evidence for them",
  experiment_spec: "a design for a set of runs: what varies, over what range, measured against what",
  trace_explanation: "an answer to “why did the model do that?”, cited to the recorded decisions behind it",
  decision_report: "a report to render as a document and a data pack",
  parameter_estimate: "an estimated value for economics your data does not carry, with its method and an interval",
  network_map_diff: "an extension to the deep-tier graph, cited to the documents it was read from",
  risk_alert: "a sized risk alert for a disruption event, corroborated against the feeds it was sensed on",
};

const PROVENANCE: Record<string, string> = {
  deterministic:
    "computed by named code. The model packaged the result and did not choose the numbers, so the values are as checkable as anything else the product computes.",
  llm_drafted:
    "the model selected or derived this content. It is the class that needs your eyes: the card says so on its face rather than leaving you to assume.",
  user_supplied:
    "the values came from your own message, verbatim. The proposal is a way of applying what you already said, not a suggestion.",
};

export default function PlansAndProposals() {
  const { proposal, plan } = INTELLIGENCE;
  const missions = new Map(ASSISTANT.agents.map((a) => [a.slug, a.mission]));
  return (
    <>
      <PageTitle lead="Review before apply — nothing changes because a model suggested it.">
        Plans and proposals
      </PageTitle>

      <Section id="the-shape" title="The shape of it">
        <Key>
          The assistant proposes; you apply. Those are two separate events, and the second one is
          always yours.
        </Key>
        <P>
          A <em>plan</em> is what the assistant intends to do, written out before it does any of
          it. A <em>proposal</em> is a specific change waiting for your decision. Neither touches
          your project until you say so, and a proposal you never look at simply stays a proposal.
        </P>
      </Section>

      <Section id="how-it-goes" title="How it goes">
        <Steps
          steps={[
            {
              title: "You ask for something",
              body: <>“Set safety stock to four weeks on everything from this supplier.”</>,
            },
            {
              title: "It writes a plan",
              body: (
                <>
                  What it would change, on which rows, and why. You can read the plan and stop
                  there.
                </>
              ),
            },
            {
              title: "It proposes the change",
              body: (
                <>
                  The concrete edit, as values. It is stored as a proposal, against the state of the
                  project it was computed from.
                </>
              ),
            },
            {
              title: "You apply it — or you do not",
              body: (
                <>
                  Applying writes the same overrides you would have typed, through the same path.
                  Nothing downstream can tell the difference, which is deliberate: an applied
                  proposal is your decision, not a third kind of provenance.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="artifacts" title={`The ${proposal.pairs.length} kinds of change, and who may file each`}>
        <Key>
          One specialist, one kind of artifact. The pairing is enforced by the database, not by
          convention.
        </Key>
        <P>
          A proposal names both the agent that drafted it and the class of change it is, and the two
          are checked against each other when it is stored — so a tool with a bug cannot file a
          policy change under the data steward's name. There is no agent that can propose anything
          it likes.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {proposal.pairs.map((p) => (
            <div key={p.artifact} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12px] font-semibold text-foreground">
                  {p.artifact}
                </span>
                <span className="text-[11px] text-muted-foreground">{p.agent}</span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {ARTIFACT[p.artifact] ? (
                  <>{ARTIFACT[p.artifact].charAt(0).toUpperCase() + ARTIFACT[p.artifact].slice(1)}.</>
                ) : (
                  <span className="text-destructive">
                    Not described on this page — a blind spot, printed rather than guessed at.
                  </span>
                )}
                {missions.get(p.agent) && (
                  <span className="block text-[12px]">
                    The agent behind it {missions.get(p.agent)}.
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="provenance" title={`Every proposal declares one of ${proposal.provenance.length} provenances`}>
        <P>
          The card says on its face where its values came from, and this is the first thing to read
          on one. It is not a confidence score — it is a statement about who chose the numbers.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {proposal.provenance.map((k) => (
            <div key={k} className="p-4">
              <span className="font-mono text-[12px] font-semibold text-foreground">{k}</span>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {PROVENANCE[k] ?? (
                  <span className="text-destructive">Not described on this page.</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="lifecycle" title="The states a proposal moves through">
        <div className="flex flex-wrap gap-1.5">
          {proposal.statuses.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-[11px]">
              {s}
            </Badge>
          ))}
        </div>
        <P>
          A card arrives <Term>proposed</Term>. You approve it, it becomes <Term>approved</Term>,
          and applying moves it to <Term>applied</Term>. Rejecting it moves it to{" "}
          <Term>rejected</Term> — and <strong>a rejected card stays in the thread</strong>, faded
          rather than removed, because the record that you said no is the point.
        </P>
        <P>
          <strong>A proposal expires after {proposal.expiresAfter ?? "a fixed window"}</strong> if
          nothing happens to it. That is not a nag: a change computed against a project you have
          since edited is a change that should be redrafted rather than applied late.
        </P>
        <P>
          Asking twice for the same thing does not stack two cards. A re-drafted identical request
          converges on the card that already exists, so a conversation that went round the houses
          leaves one decision to make rather than four.
        </P>
        <P>
          An apply that fails shows you the server's reason and offers a retry, rather than
          disappearing. Where an apply half-succeeded and then hit a blocker, the previous policy
          version is restored — so the failure leaves your project where it was, and the attempt
          stays in the history.
        </P>
      </Section>

      <Section id="plans" title="Plans are the other half, and they have states too">
        <P>
          A plan is the sequence the assistant intends to work through, kept so a long piece of work
          can be picked up rather than restarted. It is{" "}
          {plan.statuses.map((s, i) => (
            <span key={s}>
              {i > 0 && i === plan.statuses.length - 1 ? " or " : i > 0 ? ", " : ""}
              <Term>{s}</Term>
            </span>
          ))}
          , and like a proposal it expires after {plan.expiresAfter ?? "a fixed window"}.
        </P>
        <P>
          <Term>abandoned</Term> and <Term>failed</Term> are different states on purpose: one is you
          changing direction and one is the work not working. Both stay visible, which is what makes
          a plan an account of what happened rather than a to-do list that quietly empties.
        </P>
      </Section>

      <Callout tone="law" title="A proposal knows which data it was computed from">
        <p>
          A proposal is grounded on a version of your project. If the data moves underneath it —
          you re-upload, or an analysis recomputes — the proposal is marked as describing a state
          that no longer holds, rather than silently applying to a world it never saw.
        </p>
        <p>
          That is the same anchor <DocLink to="dataset-versions">Dataset Versions</DocLink>{" "}
          describes, used to stop an old suggestion looking current.
        </p>
      </Callout>

      <Callout tone="limit" title="Applying is as reversible as any other edit, and no more">
        <p>
          An applied proposal becomes ordinary policy overrides. You can change them back the way
          you change any override, and <strong>there is no “undo this proposal” button</strong> that
          reaches into your project and lifts it out.
        </p>
        <p>
          The <em>before</em> state is stored on the proposal, and the automatic restore above is the
          one place it is used — a failure compensating for itself. It is not offered to you as an
          action. If a proposal is large, saving a{" "}
          <DocLink to="policy-versions-and-presets">policy version</DocLink> first is what gives you
          a point to return to, and a policy apply creates one anyway.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="ai-assistant">The AI assistant</DocLink> ·{" "}
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink> ·{" "}
          <DocLink to="policy-versions-and-presets">Policy versions &amp; presets</DocLink>
        </P>
      </Section>

      <Provenance from="the CHECK constraints on the proposals and chat_plans tables in the introspected schema — which agent may file which artifact, the six statuses, the three provenances and the expiry — read from the replayed migrations rather than from the migration that first wrote them, because that pairing has grown from five pairs to nine" />
    </>
  );
}
