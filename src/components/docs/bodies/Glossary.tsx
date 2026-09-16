// Mined from docs/archive/legacy-help-site/docBodies.tsx (§6.6 names the
// glossary as narrative worth carrying forward), then GROUNDED: every term kept
// below was traced to code, the contract or the engine registry before it was
// kept. Three were not groundable and are listed under "Terms we do not use"
// rather than defined — see the §16 WP 5.2h entry for the traces.
//
// This is not pedantry. A glossary is the one page a reader trusts absolutely,
// because they arrive at it already unsure. Carrying a definition forward
// because it was in the old site is how the old site became wrong.

import { Badge } from "@/components/ui/badge";
import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink } from "@/components/docs/prose";

export default function Glossary() {
  return (
    <>
      <PageTitle lead="Plain-language definitions for the words this product uses, and an honest note about three it does not.">
        Glossary
      </PageTitle>

      <Section id="how-this-was-built" title="How this page was built">
        <P>
          The definitions are carried over from the previous documentation site, which is
          archived in this repository. Carrying them over was not the same as trusting them:
          every term below was traced to the code, the data contract or the engine's own
          reference before it was kept.
        </P>
        <Key>
          Three terms did not survive that check. They are listed at the foot of this page as
          terms the product does not use, rather than quietly defined as though it did.
        </Key>
      </Section>

      <Section id="supply-chain" title="Supply chain and resilience">
        <Defs
          items={[
            { term: "Bill of materials (BOM)", def: "The list of materials, and how much of each, needed to make one unit of a product. Single-level means products consume materials directly; multi-level means materials consume other materials, to any depth." },
            { term: "Lead time", def: "Elapsed time between placing an order and receiving it. Given in any of the units on Units & conventions, and converted once, on the way in." },
            { term: "MOQ", def: "Minimum order quantity — the smallest amount a supplier will accept on one order. Ordering less is not possible, so a small requirement becomes a larger delivery." },
            { term: "Safety stock", def: "Inventory held deliberately above expected need, to absorb variation in demand and supply. The buffer between a late delivery and a missed order." },
            { term: "Fill rate", def: "The share of demand met on time from stock. The primary service measure, and the one most scenarios move." },
            { term: "Backup supplier", def: "A pre-qualified alternative source that can be activated when the primary one is disrupted. Having one is a policy decision with a standing cost and a payoff only under disruption." },
            { term: "Expediting", def: "Accelerating an order already placed — faster transport or faster production — at extra cost. A lever the simulation can pull when a shortage appears." },
            { term: "Nexus material", def: "A material whose position in the network makes its disruption matter far more than its spend suggests. The reason a cheap part can stop a line, and the reason structural analysis is worth doing before cost analysis." },
            { term: "Single-source exposure", def: "A material with exactly one qualified supplier. No redundancy, so the supplier's problems become yours immediately." },
            { term: "Cost of resilience", def: "What being resilient actually costs, totalled across holding cost, backup premium, expediting, overtime and lost sales. Computed per run, so two strategies can be compared on one number." },
            { term: "Make-to-stock / make-to-order", def: "Whether the plant builds finished goods against a forecast and serves demand from inventory, or starts production when an order arrives. Set per project; it changes what the plant does every week." },
          ]}
        />
      </Section>

      <Section id="simulation" title="Simulation and modelling">
        <Defs
          items={[
            { term: "Replication", def: "One complete run of the model with its own random draws. A single replication tells you almost nothing; the spread across many is the answer." },
            { term: "Monte Carlo", def: "Running the model many times with different random draws to get a distribution of outcomes rather than one figure." },
            { term: "Confidence interval", def: "The range the true value is likely to fall in, given how many replications were run. A narrow one means more replications, not a better chain." },
            { term: "Warm-up", def: "The opening stretch of a run, discarded before measuring. A chain starting from an arbitrary state is not yet behaving like itself, and including that stretch would bias every number." },
            { term: "Steady state", def: "The regime a chain settles into once the warm-up is past, where results stop being dominated by where the model happened to start. This tool measures shocks against steady state — which is also why it is the wrong tool for long-range forecasting." },
            { term: "MSER-5 and Conway's rule", def: "Two procedures for deciding automatically where warm-up ends. Both are computed and both are reported; the later of the two is adopted, which is the conservative choice." },
            { term: "Disruption scenario", def: "A defined what-if: which supplier or route fails, when, and for how long. The thing you compare against a baseline." },
            { term: "The weekly cycle", def: "The engine advances one week at a time, and each week runs a fixed, named sequence of phases — forecast, order, produce, ship, account. The sequence is versioned, so two runs of the same version did the same things in the same order." },
          ]}
        />
      </Section>

      <Section id="network-science" title="Network science">
        <Defs
          items={[
            { term: "Degree centrality", def: "How many direct connections a node has. A supplier with high degree feeds many materials; losing it touches many things at once." },
            { term: "Betweenness centrality", def: "How often a node sits on the shortest path between two others. High betweenness means flow passes through it, so it is a chokepoint even if it has few connections." },
            { term: "Eigenvector centrality", def: "Influence weighted by the influence of your neighbours. Being connected to important nodes makes you important." },
            { term: "Closeness centrality", def: "How near a node is to everything else on average. High closeness means a disruption starting there spreads quickly." },
            { term: "Multi-tier network", def: "The chain modelled past your direct suppliers — your suppliers' suppliers, and further. Where most unpleasant surprises actually live." },
          ]}
        />
      </Section>

      <Section id="platform" title="Platform and IT">
        <Defs
          items={[
            { term: "Row-level security (RLS)", def: "The database deciding, per row, whether the caller may see it. Access is enforced where the data is, not by application code remembering to filter." },
            { term: "Service role", def: "A privileged credential that bypasses row-level security. Held by the simulation worker, never by a browser. Named on System boundary because it is the sharpest edge in the architecture." },
            { term: "Edge function", def: "A small server-side function running next to the database, used for work the browser must not be trusted with." },
            { term: "Realtime", def: "The channel that pushes progress from a running simulation back to your browser, so a long run shows movement rather than a spinner." },
            { term: "Graph cache", def: "The worker keeping the network graph for an active project in memory between jobs, so a second run on the same data does not rebuild it." },
            { term: "Data contract", def: "The written description of every table and column — meaning, unit, CSV header, what happens when a value is missing. This manual's reference section is generated from it, which is why the two cannot disagree." },
            { term: "ACCURATE / MaaS", def: "The Horizon Europe project this platform is developed under, and its marketplace layer for finding alternative suppliers. See What SuReSuite is." },
          ]}
        />
      </Section>

      <Section id="terms-we-do-not-use" title="Terms we do not use">
        <P>
          These three appear in the archived glossary. Each was traced and none of them describes
          this product, so they are corrected here rather than repeated.
        </P>

        <Callout tone="limit" title="OTIF is not a measure this system reports">
          <p>
            The archive lists on-time-in-full as a headline KPI. The engine computes no such
            figure: what a run returns is fill rate, revenue, lost sales, backlog, capacity
            utilisation, cost of resilience and the Resilience Index. Fill rate is the service
            measure to reach for. If you need OTIF, it is not available today — which is a
            different and more useful answer than a definition.
          </p>
        </Callout>

        <Callout tone="limit" title="The engine is not a discrete-event simulation, and does not use SimPy">
          <p>
            The archive describes a discrete-event model built on the SimPy library. The engine
            that runs your experiments advances in fixed weekly steps through a versioned phase
            sequence — there is no event queue and no event clock. SimPy is installed as a
            dependency of an older worker path that is frozen and adds no capability. The
            distinction matters when you reason about what the model can represent: anything
            that turns on sub-weekly timing is outside it.
          </p>
        </Callout>

        <Callout tone="limit" title="ABC-XYZ classification is half-implemented">
          <p>
            The archive defines a two-axis scheme: ABC by value, XYZ by demand variability. Only
            the first axis exists — a revenue-based ranking used when sizing finished-goods
            safety stock. There is no XYZ axis anywhere, so there is no ABC-XYZ class to set a
            policy against. Treat any reference to one as aspirational.
          </p>
        </Callout>
      </Section>

      <Section id="where-else" title="Where else to look">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            docs/archive/legacy-help-site/
          </Badge>
          <Badge variant="secondary" className="text-[10px]">archived, not deleted</Badge>
        </div>
        <P>
          For a field rather than a word, <DocLink to="field-index">Field index</DocLink> lists
          every one alphabetically and <DocLink to="all-tables">All tables</DocLink> gives each
          its full entry. Policy and KPI vocabulary is generated from the engine's own registry
          and lives with the engine reference rather than being copied here — copying it is
          exactly how the previous glossary drifted. Unit spellings are on{" "}
          <DocLink to="units-and-conventions">Units &amp; conventions</DocLink>, read from{" "}
          <Term>UNIT_DAYS</Term> itself.
        </P>
      </Section>
    </>
  );
}
