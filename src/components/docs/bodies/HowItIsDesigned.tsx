import { PageTitle, Section, P, Key, Callout, Defs, DocLink, Term } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { TierJourney } from "@/components/docs/figures";

export default function HowItIsDesigned() {
  return (
    <>
      <PageTitle lead="Your data moves through six stages, and the software is organised around that journey rather than around its own internals.">
        How SuReSuite is designed
      </PageTitle>

      <Section id="the-journey" title="The journey your data takes">
        <P>
          Most systems are described by their components — this service, that database, this queue.
          That description is useless to the person who wants to know whether a number on a screen
          can be trusted. So this one is described by what happens to your data, in order.
        </P>
        <DocFigure id="tiers" fallback={<TierJourney />} />
        <Defs
          items={[
            {
              term: "Tier 0 — Landing",
              def: "The file exactly as you sent it. Nothing has been interpreted yet. This tier exists so that if a later stage gets something wrong, the original is still there to check against.",
            },
            {
              term: "Tier 1 — Staging",
              def: "Parsed and checked, but not yet yours. Findings are raised here: missing columns, values that cannot be read, references to things that do not exist. Nothing downstream can see this tier.",
            },
            {
              term: "Tier 2 — Canonical",
              def: "Your data. This is the only tier a person edits, and everything the simulation reads traces back to it. Units are normalised on the way in, once, so nothing further down ever converts anything.",
            },
            {
              term: "Tier 3 — Derived",
              def: "What we worked out from tier 2 — sourcing shares, expanded supply paths, network summaries. Never edited, always rebuildable. If it were ever lost, recomputing it would produce exactly what was there before.",
            },
            {
              term: "Tier 4 — Decisions",
              def: "Your policies: the project-wide defaults and the per-node patches on top of them. These are choices, not data, which is why they live in their own tier rather than being mixed into it.",
            },
            {
              term: "Tier 5 — Results",
              def: "What a run produced, pinned to the exact data, policies, scenario and engine version it ran against.",
            },
          ]}
        />
        <P>
          Governance — who you are, what you may touch, and what was recorded — is not a stage in
          that sequence. It applies across all of them, which is why it is drawn as a band
          underneath rather than a seventh box.
        </P>
      </Section>

      <Section id="the-three-laws" title="The three laws">
        <P>
          Three rules hold across every tier. They are not aspirations written in a document
          somewhere; each one is checked automatically, and a change that breaks one fails before it
          can be released.
        </P>

        <Callout tone="law" title="External data never lands below staging">
          <p>
            Anything that arrives from outside — an uploaded file, a connector sync, an API write —
            enters at tier 0 and is checked at tier 1. Nothing external is written straight into
            your data. It means a malformed file cannot quietly corrupt a project: it fails where it
            can still be looked at, next to the original, before anything has been changed.
          </p>
        </Callout>

        <Callout tone="law" title="Computed data is always rebuildable">
          <p>
            Everything in tier 3 is a pure function of tier 2. It is never hand-edited, and it can
            be deleted and recomputed at any time without loss. That is what lets you trust a
            derived figure: it is not a stored opinion from six months ago, it is a restatement of
            your current data.
          </p>
        </Callout>

        <Callout tone="law" title="Every decision remembers the data it was made on">
          <p>
            A result is meaningless without the inputs that produced it. So a run records the
            dataset version, the policy set, the scenario and the engine version — together, as one
            stamp. Change any of them and you get a different stamp, which is how you can tell two
            results apart six months later.
          </p>
        </Callout>
      </Section>

      <Section id="what-this-buys-you" title="What the design buys you">
        <P>
          The tiers are not an internal filing convention. Each one exists to make a specific
          promise checkable:
        </P>
        <Defs
          items={[
            {
              term: "We never change your numbers silently",
              def: "Where the software has to substitute a value you did not give it, the substitution is declared up front and shown at the point the number is displayed — not written to a log nobody reads. A substitution that is not declared cannot exist in the code; that is enforced, not trusted.",
            },
            {
              term: "Your units are converted once",
              def: "Lead times and rates are normalised as data is promoted into tier 2. Nothing below that point converts anything, so a figure cannot be converted twice — the failure that turns a week into a month and looks entirely plausible on screen.",
            },
            {
              term: "Uploading the same file twice does not double your data",
              def: "Each table has a natural key — the combination of fields that identifies one real thing — and ingestion updates the matching row rather than adding another. (This one is still being rolled out; see Known limits.)",
            },
            {
              term: "Every figure can be traced",
              def: "Each derived row carries the hash of the inputs it came from, so any number on any screen can be walked back to the rows that produced it.",
            },
            {
              term: "Every table declares who may read and write it",
              def: "Access is not decided by whichever query happens to run. Each table states its required capability and minimum project role, and the database rules are generated from that statement.",
            },
          ]}
        />
        <Key>
          Each of those is a promise that either holds mechanically or fails a build. That is the
          difference between a design and a claim.
        </Key>
      </Section>

      <Section id="one-source" title="One source for every fact">
        <P>
          There is a fourth rule, and it is the reason this manual can be trusted at all: every fact
          about the data is written down exactly once, and everything else is generated from it.
        </P>
        <P>
          The column list on a table's reference page, the validation rules the upload wizard
          applies, the database's own access rules and the page you are reading all come from the
          same description. There is no second copy to fall out of step, because there is no second
          copy. Where a page is generated, it says so in its footer and names the exact version it
          came from.
        </P>
        <P>
          The practical consequence: if this manual is wrong about a column, the software is wrong
          about it too — and the build fails. Documentation that can be wrong on its own is
          documentation nobody can rely on, and it is what the previous version of this manual
          became. See <Term>npm run contract:check</Term> if you want to watch the check run.
        </P>
      </Section>

      <Section id="next" title="Where to go next">
        <P>
          <DocLink to="data-model">The data model at a glance</DocLink> lists every table in the
          system, grouped by the tier it belongs to.{" "}
          <DocLink to="how-your-data-flows">How your data flows</DocLink> follows a single file
          through all six stages.
        </P>
      </Section>
    </>
  );
}
