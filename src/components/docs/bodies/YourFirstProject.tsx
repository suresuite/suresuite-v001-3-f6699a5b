import { PageTitle, Section, P, Key, Callout, Steps, Bullets, DocLink, Term, AppLink } from "@/components/docs/prose";

export default function YourFirstProject() {
  return (
    <>
      <PageTitle lead="From an empty account to a result you can defend, in six steps.">
        Your first project
      </PageTitle>

      <Section id="before-you-start" title="Before you start">
        <P>
          You will need, at minimum, a list of the materials you buy, the products you make, and the
          bill of materials connecting them. Everything else can be added later — the software will
          tell you what is missing rather than failing silently.
        </P>
        <Callout title="You do not need perfect data">
          <p>
            Start with what you have. Where a value is missing the software will either derive one
            or tell you it cannot, and in both cases it will show you which numbers are yours and
            which are not. A model built from partial data with the gaps marked is far more useful
            than no model — and considerably more honest than a complete-looking one built from
            guesses.
          </p>
        </Callout>
      </Section>

      <Section id="the-six-steps" title="The six steps">
        <Steps
          steps={[
            {
              title: "Create the project",
              where: "/project-manager",
              body: (
                <>
                  Name it, name the plant it models, and say whether the chain is make-to-stock or
                  make-to-order. The project is the container everything else hangs off —{" "}
                  <DocLink to="projects">Projects</DocLink> covers each field and why it matters.
                </>
              ),
            },
            {
              title: "Upload your data",
              where: "/project-manager",
              body: (
                <>
                  One dataset at a time, each from a CSV. Download the template for a dataset before
                  you fill it in: the headers are checked, and a template saves you a round trip.{" "}
                  <DocLink to="uploading-data">Uploading data</DocLink> covers what is validated and
                  what gets rejected.
                </>
              ),
            },
            {
              title: "Check what came back",
              where: "/project-manager",
              body: (
                <>
                  Findings are graded <Term>block</Term>, <Term>warn</Term> and <Term>info</Term>.
                  Clear every block — those stop a simulation. Read the warnings; most are worth
                  fixing and some are genuinely fine. See{" "}
                  <DocLink to="verify-your-inputs">Verify your inputs</DocLink>.
                </>
              ),
            },
            {
              title: "Look at the structure",
              where: "/network/product-level",
              body: (
                <>
                  Before simulating anything, look at the chain you have just described. The network
                  views show which materials everything depends on and which suppliers have no
                  alternative. This is also the fastest way to spot a data error: a node that should
                  not be isolated usually means a mistyped identifier.
                </>
              ),
            },
            {
              title: "Set your policies",
              where: "/policies",
              body: (
                <>
                  The defaults are drawn from your data, so the grid is already populated. Change
                  what you know to be different. Each value carries a marker showing whether it came
                  from your data, was derived, or is a default —{" "}
                  <DocLink to="how-policies-work">How policies work</DocLink> explains the model.
                </>
              ),
            },
            {
              title: "Run a simulation",
              where: "/simulation-lab",
              body: (
                <>
                  Start with a baseline run and no disruption, so you know what normal looks like.
                  Then add a scenario — a supplier down for sixty days is the usual first question —
                  and compare. The result is a range with a confidence interval, not a single
                  number.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="reading-the-first-result" title="Reading your first result">
        <P>
          Two things surprise most people on their first run, and neither is a fault:
        </P>
        <Bullets
          items={[
            <>
              <strong className="text-foreground">The answer is a range.</strong> The model runs many
              times with different random draws, because a chain with variable demand and variable
              lead times does not have one outcome. A range with a stated confidence is the honest
              form of the answer; a single number would be the same information with the
              uncertainty hidden.
            </>,
            <>
              <strong className="text-foreground">The baseline is not perfect either.</strong> A
              chain with realistic variability misses some demand even with nothing going wrong.
              That is the point of the baseline: the cost of a disruption is the difference from
              it, not the distance from a hundred per cent.
            </>,
          ]}
        />
        <Key>
          The number worth taking away from a first session is the gap between baseline and
          disrupted — not either figure on its own.
        </Key>
      </Section>

      <Section id="what-to-do-next" title="What to do next">
        <Bullets
          items={[
            <>
              Try a second response — more safety stock, or a backup supplier — and compare the two.
              The comparison is what the tool is for.
            </>,
            <>
              Read <DocLink to="known-limits">Known limits</DocLink> before you show a result to
              anyone. It takes two minutes and tells you which questions this model answers well.
            </>,
            <>
              When you want to know exactly what a column means, the reference section has a page per
              table — start at <DocLink to="data-model">The data model at a glance</DocLink>.
            </>,
          ]}
        />
        <P>
          If you would rather look at the product first, the project screen is at{" "}
          <AppLink to="/project-manager">Project Manager</AppLink>.
        </P>
      </Section>
    </>
  );
}
