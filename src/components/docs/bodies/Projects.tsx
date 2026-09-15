import { PageTitle, Section, P, Key, Callout, Defs, DocLink, AppLink } from "@/components/docs/prose";

export default function Projects() {
  return (
    <>
      <PageTitle lead="The container everything else belongs to — and the decisions you make once, at the start.">
        Projects
      </PageTitle>

      <Section id="what-a-project-is" title="What a project is">
        <P>
          A project is one supply chain around one plant: the suppliers feeding it, the materials
          they supply, the products it makes, and the customers it serves. Every dataset you upload,
          every policy you set and every result you produce belongs to exactly one project.
        </P>
        <Key>
          A project is also a boundary. Nothing in one project reads anything in another, so you can
          keep a real chain and an experiment side by side without either contaminating the other.
        </Key>
        <P>
          Projects live at <AppLink to="/project-manager">Project Manager</AppLink>.
        </P>
      </Section>

      <Section id="the-fields" title="The fields you set when you create one">
        <Defs
          items={[
            {
              term: "Name",
              def: "The project's title, as you type it. Names are not identifiers here — renaming a project breaks nothing, because everything else refers to it by a stable internal reference rather than by its name.",
            },
            {
              term: "Plant name",
              def: "The plant this project models. It is more than a label: the lane and bill-of-materials tables carry the same plant name, and it is how their rows are matched to this project. Changing it after uploading data is not a cosmetic edit.",
            },
            {
              term: "Supply chain model",
              def: "Make-to-stock or make-to-order. Make-to-stock builds finished goods against a forecast and serves demand from inventory; make-to-order starts production when an order arrives. It changes what the simulation is doing at the plant, so it is worth getting right before you run anything.",
            },
            {
              term: "BOM level",
              def: "Whether the project uses a single-level bill of materials (products consume materials directly) or a multi-level one (materials consume other materials, to any depth). This decides which bill-of-materials dataset is read and which uploader you are offered. Start single-level unless you genuinely need the depth.",
            },
            {
              term: "Simulation window",
              def: "The first and last day of the horizon the project simulates. Optional at creation and editable later.",
            },
            {
              term: "Deep tier",
              def: "Whether the project models tier-2 and tier-3 suppliers as well as your direct ones. Leaving it off keeps the model to the chain you have contracts with; turning it on unlocks the deep-tier datasets and the firm-level network view.",
            },
          ]}
        />
        <Callout title="Two of these are hard to change later">
          <p>
            The plant name and the BOM level both determine how uploaded data is matched and read.
            Changing either after you have uploaded datasets will usually mean re-uploading them.
            The rest can be edited freely.
          </p>
        </Callout>
      </Section>

      <Section id="completion" title="Completion">
        <P>
          A project is marked complete when it has the datasets it needs to simulate. You do not set
          this — it is maintained for you as data arrives, and it is what the simulation screen
          checks before offering to run anything.
        </P>
        <P>
          An incomplete project is not a broken one. It means something a run would need is not
          there yet, and the project screen will tell you which dataset it is waiting for.
        </P>
      </Section>

      <Section id="ownership" title="Ownership and access">
        <P>
          A project has an owner — the person who created it — and belongs to one organization.
          Those two facts decide who can read it and who can change it: the organization decides
          who can see it at all, and ownership decides who can edit it, alongside administrators.
        </P>
        <P>
          <DocLink to="organizations-and-members">Organizations and members</DocLink> covers the
          organization side, and <DocLink to="who-can-see-your-data">Who can see your data</DocLink>{" "}
          answers the question directly.
        </P>
      </Section>

      <Section id="demonstration-projects" title="Demonstration projects">
        <P>
          A project records whether its data was uploaded by a person or generated for
          demonstration. It is worth checking which kind you are looking at before drawing a
          conclusion from it — a synthetic project is there to show how the tool behaves, not to
          describe anyone's real chain.
        </P>
      </Section>

      <Section id="next" title="Where to go next">
        <P>
          With a project created, the next step is{" "}
          <DocLink to="uploading-data">Uploading data</DocLink>. If you want the whole sequence in
          one page, <DocLink to="your-first-project">Your first project</DocLink> walks it end to
          end.
        </P>
      </Section>
    </>
  );
}
