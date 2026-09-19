// §6.3 section 9 — project memory. Rewritten in WP 5.2j.
//
// ── THE PAGE WAS WRONG TWICE, AND BOTH WERE REASSURANCES ──────────────────
//
// (1) "A remembered note is not stamped with the version of the data it was
// true of … nothing marks it stale, because nothing anchors it in the first
// place." `project_memory.grounding` holds `{policy_hash, graph_hash}`,
// `isMemoryStale` compares them against the current ones, and a drifted memory
// is shown with "[stale — saved against older project data]". The anchor exists
// and the marker exists. What is true — and is the sharper warning — is that
// the marker is DISPLAY ONLY: a stale memory is still handed to the model.
//
// (2) "there is no path by which something remembered about one appears in a
// conversation about another." The assistant's read is project-scoped, so the
// conversation claim holds. The TABLE's read policy is `USING (true)` with
// SELECT granted to `anon` and `authenticated`, so the rows themselves are not
// project-scoped at all. A reassurance about who can see something has to be
// about the policy, not about the one query that happens to filter.
//
// The page also never said how a memory gets written, which is the thing a user
// most needs: only an explicit "remember …", or a chip you click.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { INTELLIGENCE } from "@/components/docs/generated/policy.generated";

const KIND: Record<string, string> = {
  fact: "something true about the project that is not in the data — why one plant is treated differently, what a code in your ids means.",
  preference: "how you want things done. Phrasing like “always”, “never”, “by default” or “going forward” lands here.",
  decision: "something you settled. “We decided”, “we're going with”, “from now on” lands here.",
};

export default function ProjectMemory() {
  const group = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "project_memory"));
  const { memory } = INTELLIGENCE;

  return (
    <>
      <PageTitle lead="What the assistant remembers between conversations, how a memory gets written, and who can read one.">
        Project memory
      </PageTitle>

      <Section id="what-it-is" title="What memory is here">
        <Key>
          Context about the project that survives a conversation ending — not a copy of your data,
          and not a record of your results.
        </Key>
        <P>
          Without it, every conversation starts from nothing and you spend the first three messages
          re-explaining which plant you care about and why the numbers for one product are odd. With
          it, that context persists and the assistant opens further along.
        </P>
      </Section>

      <Section id="how-one-is-written" title="Nothing is remembered unless you say so">
        <Key>
          The model is never in the loop that decides to save. Two paths, both yours.
        </Key>
        <Steps
          steps={[
            {
              title: "Say “remember …”",
              body: (
                <>
                  A message beginning <Term>remember</Term> — with or without “please”, “that” or a
                  colon — saves what follows it, verbatim. That phrasing is the consent, and it is
                  matched by a fixed pattern rather than judged by the model.
                </>
              ),
            },
            {
              title: "Or click the chip it offers",
              body: (
                <>
                  A message that sounds like a decision — “we decided”, “we're going with”, “from
                  now on” — produces an <em>offer</em>, not a write. Nothing is saved until you
                  click it.
                </>
              ),
            },
            {
              title: "Or add one yourself",
              where: "/project-intelligence → Project memory",
              body: <>Typing it into the sidebar panel is the consent, in the same way.</>,
            },
          ]}
        />
        <P>
          A memory is capped at <strong>{memory.contentCap} characters</strong> and is stored as
          typed. Longer than that is truncated rather than refused, so a very long “remember …”
          keeps its beginning and loses its end — say the important part first.
        </P>
        <P>
          The whole feature is behind a deployment setting. Where it is off, nothing is written and
          nothing is recalled.
        </P>
      </Section>

      <Section id="kinds" title={`The ${memory.kinds.length} kinds, and how one is chosen`}>
        <P>
          The kind is classified from the words you used, not asked for. It is a label for reading
          the list back, and it changes nothing about how the memory is used.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {memory.kinds.map((k) => (
            <div key={k} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12px] font-semibold text-foreground">{k}</span>
                {k === "fact" && <Badge variant="outline" className="text-[10px]">the default</Badge>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {KIND[k] ? KIND[k].charAt(0).toUpperCase() + KIND[k].slice(1) : (
                  <span className="text-destructive">Not described on this page.</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="staleness" title="A memory can go stale, and it is still used">
        <P>
          A memory saved while your project had a known policy and data fingerprint carries both. If
          either moves — you re-upload, you change a policy — the memory is shown marked{" "}
          <Term>[stale — saved against older project data]</Term>.
        </P>
        <Callout tone="limit" title="The marker is a label, not a filter">
          <p>
            A stale memory is <strong>still handed to the assistant</strong>, with the marker text
            attached. It is told the note may be out of date; it is not prevented from using it.
          </p>
          <p>
            So a stale memory can still shape an answer. If something you asked it to remember is no
            longer true, <strong>archive it</strong> rather than relying on the marker — that is what
            the archive control on each row is for, and archiving is the only thing that takes a
            memory out of the conversation.
          </p>
        </Callout>
        <P>
          A memory saved when no fingerprint was available carries none, and can never be marked
          stale — because nothing anchors it. Those are the ones to re-read yourself.
        </P>
        <P>
          Memories are handed over newest first up to a fixed budget, so a long list is truncated
          rather than summarised: the oldest entries simply stop being included. Archiving what no
          longer matters is what keeps the ones that do inside the budget.
        </P>
      </Section>

      <Section id="scope" title="Scope, and who can read one">
        <P>
          Memory belongs to a project. The assistant reads only the memories of the project you are
          in, so nothing remembered about one project appears in a conversation about another.
        </P>
        <Callout tone="limit" title="The rows themselves are not project-scoped at read time">
          <p>
            That project scoping is done by the <em>query</em>. The table's own read rule permits any
            signed-in client to select any row, so a memory is not private to your project the way
            your uploaded data is — it is private to the extent that the surfaces reading it filter.
          </p>
          <p>
            Write it as though a colleague elsewhere in your organization could read it, because
            architecturally they can. <DocLink to="who-can-see-your-data">Who can see your
            data</DocLink> is the rest of that picture, and it is the page that explains why we
            state this rather than smoothing it.
          </p>
        </Callout>
        <P>
          Writes go the other way: there is no direct write path at all. Every memory is created and
          archived through a single server function, so the consent check cannot be bypassed by
          talking to the table.
        </P>
      </Section>

      <Callout tone="law" title="It is context, not record">
        <p>
          Nothing in memory is evidence. It carries no run, no engine version and no result. Anything
          that has to be right is in your data, your policies or a run — all three of which carry the
          version they came from.
        </p>
      </Callout>

      {group && (
        <Callout title="This table is deliberately outside the data contract">
          <p>
            <Term>project_memory</Term> is in the register of tables the contract does not describe,
            under WP {group.wp}, and the reason is a positive one rather than a backlog: it carries
            no simulation input and no engine-read field, so describing it in the data contract
            would document machinery rather than your data. If it ever starts carrying a value a
            simulation reads, that is the test for bringing it in.
          </p>
          <p>
            What this page states about it — the {memory.kinds.length} kinds, the{" "}
            {memory.contentCap}-character cap, the two statuses — is read from the CHECK constraints
            on the table itself rather than from a sidecar, which is a weaker source and the one
            that exists.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="ai-assistant">The AI assistant</DocLink> is what reads it ·{" "}
          <DocLink to="plans-and-proposals">Plans and proposals</DocLink> is the other thing it
          keeps between turns ·{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="all-tables">All tables</DocLink>.
        </P>
        <P>
          The panel is in the sidebar at{" "}
          <AppLink to="/project-intelligence">/project-intelligence</AppLink>.
        </P>
      </Section>

      <Provenance from="the CHECK constraints on project_memory in the introspected schema for the kinds, the cap and the statuses; the assistant's own memory module for the consent patterns, the staleness rule and the context budget; and 20260717000003's read policy for who can select a row" />
    </>
  );
}
