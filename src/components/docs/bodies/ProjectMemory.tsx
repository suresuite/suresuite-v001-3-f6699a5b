// §6.3 section 9 — project memory.
//
// `project_memory` is not in the contract: the coverage register puts the AI
// control plane outside the data spine because it carries no simulation input.
// So this page describes behaviour and says which register holds the table,
// rather than writing a column list.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function ProjectMemory() {
  const group = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "project_memory"));

  return (
    <>
      <PageTitle lead="What the assistant remembers between conversations, and what it does not.">
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

      <Section id="scope" title="It is scoped to the project">
        <P>
          Memory belongs to a project, not to you and not to your organization. Two projects do not
          share it, and there is no path by which something remembered about one appears in a
          conversation about another.
        </P>
      </Section>

      <Callout tone="limit" title="It is not provenance, and it does not age">
        <p>
          A remembered note is not stamped with the version of the data it was true of. If you
          re-upload and the shape of your chain changes, what was remembered about the old shape is
          still remembered — nothing marks it stale, because nothing anchors it in the first place.
        </p>
        <p>
          So treat it as context rather than as record. Anything that has to be right is in your
          data, your policies or a run, all three of which carry the version they came from.
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
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="ai-assistant">The AI assistant</DocLink> ·{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="all-tables">All tables</DocLink>
        </P>
      </Section>

      <Provenance from="the data contract's coverage register, for what it describes and what it deliberately does not" />
    </>
  );
}
