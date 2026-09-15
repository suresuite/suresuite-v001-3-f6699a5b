import { PageTitle, Section, P, Key, Callout, Defs, DocLink } from "@/components/docs/prose";

export default function WhatHappensToYourData() {
  return (
    <>
      <PageTitle lead="Five commitments, in the words they would have to be judged in.">
        What happens to your data
      </PageTitle>

      <Section id="why-this-page" title="Why this page exists">
        <P>
          Uploading your supply chain to someone else's software is not a small act. It is the map
          of who you buy from, what it costs you and where you would hurt — and you are handing it
          over on the strength of a promise.
        </P>
        <P>
          So the promises are written here, in plain language, along with what each one means you
          can actually go and check. A commitment you cannot test is a marketing sentence.
        </P>
      </Section>

      <Section id="t1" title="1. No number without a source">
        <Key>Every value you see resolves to your data, a named rule, or a stated default.</Key>
        <P>
          There is no fourth option. If a figure on a screen is not something you supplied, it is
          either derived by a rule that has a name, or it is a default that is declared in advance.
          It is never a number the software decided was reasonable.
        </P>
        <P>
          You can check this: any displayed value can be traced back to the rows it came from, and
          anything that is not raw data carries a marker saying what kind of value it is.
        </P>
      </Section>

      <Section id="t2" title="2. Substitution is always visible">
        <Key>
          When we fill in something you did not give us, we say so where you are looking — not in a
          log.
        </Key>
        <P>
          Supply chain data always has holes. A supplier with no stated capacity, a material with no
          holding cost. The software can often derive a sensible value, and it will. What it will
          not do is present that value as though you had provided it.
        </P>
        <P>
          The mechanism behind this is unusually strict: every substitution the software is allowed
          to make is declared in the data contract, and a fallback that is not declared there
          cannot exist in the code. The build fails on one that is not. So the list of substitutions
          on <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> is complete by
          construction, not by someone remembering to update it.
        </P>
      </Section>

      <Section id="t3" title="3. We publish our own blind spots">
        <Key>Every report states the limits of its own computation.</Key>
        <P>
          The temptation in any modelling tool is to present the output and let the reader assume
          the model covered everything. This one does the opposite:{" "}
          <DocLink to="known-limits">Known limits</DocLink> is near the front of the manual rather
          than in an appendix, and reports carry their own caveats rather than relying on you having
          read a page months ago.
        </P>
      </Section>

      <Section id="t4" title="4. Reproducible or not published">
        <Key>
          Any figure that leaves the system carries the data, policy, scenario and engine version
          that produced it.
        </Key>
        <P>
          This is what makes an export arguable. A number in a slide deck with no provenance can
          only be believed or disbelieved. A number that names the exact inputs it came from can be
          rerun by the person who doubts it — which is a far stronger position to be in than being
          trusted.
        </P>
      </Section>

      <Section id="t5" title="5. Transparency survives handover">
        <Key>The guarantees are generated and checked automatically, not maintained by hand.</Key>
        <P>
          Every commitment above is enforced by something that runs on every change: the
          documentation is generated from the same description the software reads, undeclared
          substitutions fail the build, and a table nobody has described fails it too.
        </P>
        <P>
          The reason is unglamorous. The people who wrote these promises will eventually move on,
          and a promise that depends on their diligence expires quietly when they do. A promise
          wired to a build gate does not.
        </P>
      </Section>

      <Section id="ownership" title="Where your data sits, and who can reach it">
        <Defs
          items={[
            {
              term: "It stays in your organization",
              def: "Every project, dataset and result belongs to exactly one organization, and that boundary is enforced by the database itself rather than by application code remembering to filter. A query that forgets returns nothing, instead of returning someone else's rows.",
            },
            {
              term: "It is not used to train anything",
              def: "Your data is used to run your models. It is not pooled, resold, or used as training material.",
            },
            {
              term: "You can take it out",
              def: "Everything you uploaded and everything computed from it can be exported, in formats that can be read without this software.",
            },
            {
              term: "You can have it deleted",
              def: "Deleting a project removes its data along with the results derived from it.",
            },
          ]}
        />
        <Callout title="The honest version">
          <p>
            The audit trail today covers administrative actions — who changed a role, who changed an
            account. It does not yet record every movement of data between tiers. That work is
            scheduled and, until it lands, the record says so rather than implying a completeness it
            does not have. <DocLink to="audit-log">Audit log</DocLink> covers what is recorded now.
          </p>
        </Callout>
      </Section>

      <Section id="next" title="Where to go next">
        <P>
          <DocLink to="system-boundary">System boundary</DocLink> is the technical version of this
          page — what runs where, and what crosses each line.{" "}
          <DocLink to="known-limits">Known limits</DocLink> is the list of things the model does not
          do.
        </P>
      </Section>
    </>
  );
}
