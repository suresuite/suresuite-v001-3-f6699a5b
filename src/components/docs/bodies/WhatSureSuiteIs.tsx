import { Badge } from "@/components/ui/badge";
import { PageTitle, Section, P, Key, Bullets, Callout, Defs, DocLink } from "@/components/docs/prose";

export default function WhatSureSuiteIs() {
  return (
    <>
      <PageTitle lead="A supply chain you can run experiments on, instead of arguing about.">
        What SuReSuite is
      </PageTitle>

      <Section id="the-problem" title="The problem it solves">
        <P>
          Every supply chain team already knows where its chain is fragile, in the way you know a
          floorboard is loose — from experience, in fragments, and never in a form you can put in
          front of someone who controls a budget. The question that stops the conversation is always
          the same one: <em>how much worse would it actually be?</em>
        </P>
        <P>
          Answering it by hand means holding a network, a bill of materials, a set of lead times and
          a demand pattern in your head at once, and then imagining all of them going wrong together.
          Spreadsheets cannot do it, because the interesting part is the interaction. Intuition
          cannot do it, because the interesting part is the arithmetic.
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
              def: "Built from files you already keep — suppliers, materials, products, the bill of materials, inbound and outbound lanes. Not a drawing: a structure the simulation reads.",
            },
            {
              term: "A structural read on it",
              def: "Which materials everything depends on, which suppliers have no alternative, and where a single failure reaches furthest.",
            },
            {
              term: "Answers to what-if",
              def: "A supplier goes down for sixty days. A route closes. Demand doubles. You get a distribution of outcomes with a confidence interval, not one number that looks more certain than it is.",
            },
            {
              term: "A comparison between responses",
              def: "Holding more stock, qualifying a second supplier, expediting — each costs something and buys something. The comparison is the point; the simulation is how you get one.",
            },
            {
              term: "A figure you can defend",
              def: "Every result carries the data, the policies, the scenario and the engine version that produced it, so someone else can rerun it and get the same answer.",
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
          It is not a planning system and it does not place orders. It holds no live connection to
          your production environment, and nothing it computes is pushed anywhere. It is a place to
          ask questions about a chain, get numbers back, and see exactly where each number came
          from.
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
          SuReSuite is developed as part of the ACCURATE project, funded under Horizon Europe. Three
          industrial pilots — in aerospace, automotive and electronics — ground the stress-test
          scenarios and keep the architecture honest against chains nobody on the project team gets
          to simplify.
        </P>
        <P>
          That origin shows up in the product as a bias towards evidence: assumptions are written
          down, substitutions are visible at the point of display, and a result that cannot be
          reproduced is treated as a result that should not have been published.
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
