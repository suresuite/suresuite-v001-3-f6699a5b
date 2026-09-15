import { PageTitle, Section, P, Key, Callout, Defs, Bullets, DocLink, Term, AppLink } from "@/components/docs/prose";

export default function UploadingData() {
  return (
    <>
      <PageTitle lead="How a CSV becomes part of your project, what is checked on the way, and what gets sent back.">
        Uploading data
      </PageTitle>

      <Section id="where" title="Where uploading happens">
        <P>
          All uploading is done from{" "}
          <AppLink to="/project-manager">Project Manager</AppLink>, against a project you have
          already created. You pick a dataset, download its template if you want one, choose a file,
          and the wizard takes it from there.
        </P>
        <Key>
          One dataset per file. The wizard does not guess which dataset a file is — you tell it, and
          it checks the file against what that dataset should contain.
        </Key>
      </Section>

      <Section id="start-with-the-template" title="Start with the template">
        <P>
          Every dataset offers a template with the exact headers it expects. Downloading it first is
          worth the thirty seconds: header names are checked exactly, and a mismatched header is the
          single most common reason an upload is rejected.
        </P>
        <Callout title="The header is the name that matters">
          <p>
            The name you type in a CSV header and the name the simulation engine uses internally are
            sometimes different words for the same quantity. Everything you interact with — the
            template, the wizard, the findings, and the reference pages in this manual — uses the
            header name, the one you type. The engine's own vocabulary appears only where it is
            genuinely needed, and is labelled as such.
          </p>
          <p>
            This was not always true, and the previous version of this manual led with the engine's
            names. A planner holding a products file could not find one of their own column headers
            in the documentation. That is the defect the reference section was rebuilt to close.
          </p>
        </Callout>
      </Section>

      <Section id="what-you-can-upload" title="What you can upload">
        <P>
          The datasets fall into four groups, and which ones you are offered depends on how the
          project is configured:
        </P>
        <Defs
          items={[
            {
              term: "The bill of materials",
              def: "Single-level or multi-level, depending on the project's BOM level. Only the shape the project uses is offered.",
            },
            {
              term: "The lanes",
              def: "Inbound logistics — which supplier delivers which material — and outbound logistics, which customer buys which product. These carry volumes, prices and lead times, and they are where most of a chain's economics actually live.",
            },
            {
              term: "The masters",
              def: "Materials, products and suppliers: one row per thing, carrying the attributes that are not about a particular lane.",
            },
            {
              term: "The network",
              def: "Node locations, and — for projects with deep tier enabled — tier-2 and tier-3 suppliers, deep-tier nodes and the edges between them. The deep-tier network can also be supplied as JSON.",
            },
          ]}
        />
        <P>
          Each dataset has a reference page of its own in the input tables section, covering every
          column, its unit and its constraints. <DocLink to="data-model">The data model at a glance</DocLink>{" "}
          lists them all.
        </P>
      </Section>

      <Section id="what-is-checked" title="What is checked">
        <P>The file is checked in three passes, and it stops at the first one that fails.</P>
        <Defs
          items={[
            {
              term: "1. Is it a file we can read?",
              def: "CSV, with the exception of the deep-tier network, which also accepts JSON. A spreadsheet saved as .xlsx is rejected here — export it as CSV first.",
            },
            {
              term: "2. Are the required headers present?",
              def: "Missing columns are reported together, by name, so you can fix them in one pass rather than discovering them one at a time.",
            },
            {
              term: "3. Does each row make sense?",
              def: "Row by row, with the row number as it appears in your spreadsheet: required values present, numbers actually numeric, quantities not negative where negative is meaningless, and units drawn from the list the system recognises.",
            },
          ]}
        />
        <Callout title="Units are checked against one list">
          <p>
            A lead time given in <Term>week</Term>, <Term>weeks</Term>, <Term>wk</Term> or{" "}
            <Term>w</Term> is understood as the same thing. The list of accepted spellings is
            defined in one place and shared by the upload check, the database and the engine, so a
            unit the wizard accepts cannot be a unit something downstream does not understand.
          </p>
          <p>
            The units themselves, and the difference between a lane's time unit and its lead time,
            are covered on <DocLink to="units-and-time-periods">Units and time periods</DocLink>.
          </p>
        </Callout>
      </Section>

      <Section id="what-happens-after" title="What happens after the file is accepted">
        <P>
          The rows become part of your project and the derived layer is rebuilt from them — sourcing
          shares, effective arcs, network structure. The project's completion status is updated, and
          if this was the dataset it was waiting for, it becomes ready to simulate.
        </P>
        <P>
          Accepted is not the same as correct. The wizard's checks are about whether the file can be
          read and whether the values are possible. Whether the model they describe is a sensible
          one is a separate question, and it is what{" "}
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> is for — findings graded{" "}
          <Term>block</Term>, <Term>warn</Term> and <Term>info</Term> against the project as a
          whole rather than against one file.
        </P>
      </Section>

      <Section id="common-rejections" title="The five rejections worth knowing about">
        <Bullets
          items={[
            <>
              <strong className="text-foreground">Missing required columns.</strong> Almost always a
              renamed header or an extra space. Compare against the template.
            </>,
            <>
              <strong className="text-foreground">A unit we do not recognise.</strong> The message
              lists the spellings that are accepted.
            </>,
            <>
              <strong className="text-foreground">A negative volume or price.</strong> Usually a
              stray minus sign or a column misaligned by one.
            </>,
            <>
              <strong className="text-foreground">A consumption rate of zero or less.</strong> A
              bill-of-materials line that consumes nothing is not a line.
            </>,
            <>
              <strong className="text-foreground">A file that is not CSV.</strong> Save as CSV
              rather than renaming the extension — a renamed spreadsheet is still a spreadsheet.
            </>,
          ]}
        />
      </Section>

      <Section id="uploading-twice" title="Uploading the same dataset twice">
        <Callout tone="limit" title="Check this before you re-upload">
          <p>
            For the lane and bill-of-materials datasets, uploading a corrected file on top of an
            existing one currently <strong className="text-foreground">adds</strong> the rows rather
            than replacing the ones it matches. Volumes double, and the model quietly becomes twice
            the chain it should be.
          </p>
          <p>
            Until this is fixed, replace the dataset rather than uploading over it. It is listed with
            the other open defects on <DocLink to="known-limits">Known limits</DocLink>.
          </p>
        </Callout>
      </Section>
    </>
  );
}
