import { Badge } from "@/components/ui/badge";
import { DocPageTitle, InShort, Section, P, Key, Bullets, Callout, Defs, DocLink } from "@/components/docs/prose";

export default function WhatSureSuiteIs() {
  return (
    <>
      <DocPageTitle slug="what-suresuite-is" />
      <InShort items={[
        "Model your supply chain, test a disruption, and compare cost and service under different responses.",
        "The results depend on your data and assumptions; the tool does not place orders or predict every real-world event.",
        <>Read <DocLink to="how-suresuite-is-designed">how it is designed</DocLink>, or try <DocLink to="your-first-project">the worked example</DocLink>.</>,
      ]} />

      <Section id="the-problem" title="The problem it solves">
        <P>
          If a supplier loses capacity for four weeks, how much demand could you miss?
          Would more stock or a backup source reduce that loss enough to justify its cost?
          SuReSuite lets you compare those choices on the same modeled chain.
        </P>
        <P>
          Build a supply-chain model from suppliers, materials, products, demand and a bill of
          materials (BOM): the quantities of materials needed for one product.
          A policy is a rule for operating the chain, such as when to reorder.
          A scenario is the situation you test, including any disruption.
        </P>
        <Key>
          SuReSuite builds a working model of your chain from the data you already have, then lets
          you break it on purpose and measure what happens.
        </Key>
      </Section>

      <Section id="what-it-produces" title="What it produces">
        <Defs
          items={[
            {
              term: "A model of your chain",
              def: "Built from files you already keep — suppliers, materials, products, the bill of materials, inbound and outbound lanes. Lanes connect suppliers to materials and products to customers. The simulation reads the modeled inputs; a graph can also contain relationships it does not simulate.",
            },
            {
              term: "A structural read on it",
              def: "Inspect connections and single-source exposure in the supplied network. Structural importance helps choose what to investigate; it is not proof of disruption losses.",
            },
            {
              term: "Answers to what-if",
              def: "Test a supplier capacity loss or another supported change. Repeated runs show variation in outcomes. A confidence interval describes uncertainty in an estimated result across those repeats, conditional on the model assumptions.",
            },
            {
              term: "A comparison between responses",
              def: "Holding more stock, qualifying a second supplier, expediting — each costs something and buys something. The comparison is the point; the simulation is how you get one.",
            },
            {
              term: "A figure you can defend",
              def: "Current version-bound runs identify the inputs, policies, scenario and engine build used. Keep those saved versions and run settings for reproduction; older records may be incomplete.",
            },
          ]}
        />
      </Section>

      <Section id="who-it-is-for" title="Who it is for">
        <Bullets
          items={[
            <>
              <strong className="text-foreground">Planners</strong>, who need to know which of this
              week's exposures is the one worth acting on.
            </>,
            <>
              <strong className="text-foreground">Supply chain managers</strong>, who have to justify
              the cost of resilience to people who see only the cost.
            </>,
            <>
              <strong className="text-foreground">Researchers</strong>, who need a model whose
              assumptions are written down and whose runs can be reproduced.
            </>,
            <>
              <strong className="text-foreground">The people who approve the tool</strong>, who want
              to know what runs where and what leaves the building before anyone uploads anything.
              That is <DocLink to="system-boundary">System boundary</DocLink>.
            </>,
          ]}
        />
      </Section>

      <Section id="what-it-is-not" title="What it is not">
        <P>
          SuReSuite supports experiments and decision review. It does not place operational orders.
          The engine advances in weekly steps around one focal production stage; it does not
          simulate every upstream company or individual factory operation shown in a graph. The engine is the software that calculates outcomes.
          Optional connectors can import data from business systems, so check how your project is connected.
        </P>
        <Callout tone="limit" title="Read this before you rely on a number">
          <p>
            Every model leaves things out, and a manual that does not say which things is asking for
            a trust it has not earned. The omissions are listed on{" "}
            <DocLink to="known-limits">Known limits</DocLink> — one page, near the front, on
            purpose.
          </p>
        </Callout>
      </Section>

      <Section id="accurate" title="Where it comes from">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Horizon Europe</Badge>
          <Badge variant="outline">Grant 101138269</Badge>
          <Badge variant="secondary">ACCURATE</Badge>
        </div>
        <P>
          SuReSuite is developed in part within the ACCURATE project, funded under Horizon Europe. Three
          industrial pilots — in aerospace, automotive and electronics — ground the stress-test
          scenarios and keep the architecture honest against chains nobody on the project team gets
          to simplify.
        </P>
        <P>
          That origin informs the transparency commitments: write down assumptions, mark
          substitutions where they are displayed, and publish results with the information needed
          to repeat them. <DocLink to="what-happens-to-your-data">What happens to your data</DocLink> explains
          those commitments and the gaps you should check today.
        </P>
      </Section>

      <Section id="where-next" title="Where to go next">
        <Bullets
          items={[
            <>
              <DocLink to="how-suresuite-is-designed">How SuReSuite is designed</DocLink> — the
              architecture, and why it is shaped the way it is.
            </>,
            <>
              <DocLink to="your-first-project">Your first project</DocLink> — the end-to-end
              walkthrough, if you would rather start by doing.
            </>,
            <>
              <DocLink to="known-limits">Known limits</DocLink> — what this tool does not model.
            </>,
          ]}
        />
      </Section>
    </>
  );
}
