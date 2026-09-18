// §6.3 section 6 — the pre-run gate. W + G: the severity law is read from the
// grading module rather than restated, and the engine's required fields come
// from the registry.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { baseDataRequirements } from "@/lib/policies/registryAccess";

const SEVERITY: { level: string; what: string; blocks: boolean; why: string }[] = [
  {
    level: "block",
    blocks: true,
    what: "The run cannot start.",
    why:
      "Either the engine would fail outright, or a field it requires resolves to nothing at all. " +
      "There is no number we could put there that would not be an invention.",
  },
  {
    level: "warn",
    blocks: false,
    what: "The run will start, using a neutral constant.",
    why:
      "A value is missing and the fallback is a flat default — a price of 1.0, a lead time of two " +
      "weeks. It is not derived from anything you uploaded, so the result is a shape rather than a " +
      "quantity. You can acknowledge these and proceed.",
  },
  {
    level: "info",
    blocks: false,
    what: "The run will start, using something worked out from your data.",
    why:
      "A value is missing and the fallback is derived from what you did upload — the cheapest " +
      "inbound price, the demand your outbound arcs imply. Usually what you meant, and still worth " +
      "reading.",
  },
];

export default function VerifyYourInputs() {
  const required = baseDataRequirements();

  return (
    <>
      <PageTitle lead="What is checked before a run, what stops it, and how to clear each finding.">
        Verify your inputs
      </PageTitle>

      <Section id="what-it-checks" title="What verification actually asks">
        <Key>
          One question, per field the engine reads: does this resolve to your data, to a named
          substitution rule, or to nothing?
        </Key>
        <P>
          It is not a schema check — the upload already did that. This asks whether the model you
          have built can be simulated, and how much of it would be running on defaults if it were.
        </P>
        <P>
          Run it from <AppLink to="/policies">/policies</AppLink>, on the{" "}
          <Term>Run &amp; validate</Term> stage, before launching anything.
        </P>
      </Section>

      <Section id="severities" title="The three severities">
        <P>
          The grading follows the engine's own rule, so a finding here means the same thing it would
          mean to the simulation.
        </P>
        <div className="space-y-3">
          {SEVERITY.map((s) => (
            <div key={s.level} className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.blocks ? "destructive" : "outline"} className="font-mono text-[10px]">
                  {s.level}
                </Badge>
                <span className="text-sm font-semibold text-foreground">{s.what}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.why}</p>
            </div>
          ))}
        </div>
        <Callout title="The difference between warn and info is where the number came from">
          <p>
            Both mean “you left this out and we filled it in”. A <Term>warn</Term> was filled with a
            constant nothing in your project produced; an <Term>info</Term> was filled with
            something computed from data you did upload. That distinction is the whole difference
            between a model of your chain and a model of a chain.
          </p>
        </Callout>
      </Section>

      <Section id="clearing" title="Clearing a finding">
        <Steps
          steps={[
            {
              title: "Read which rows it names",
              where: "/policies",
              body: (
                <>
                  Every finding lists the entities it applies to, up to twenty-five of them. A
                  finding on two rows and a finding on two thousand need different responses.
                </>
              ),
            },
            {
              title: "Decide whether the fallback is wrong",
              body: (
                <>
                  An <Term>info</Term> finding is often correct — if the cheapest inbound price is
                  the price, there is nothing to fix.{" "}
                  <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> lists what
                  each substitution actually does.
                </>
              ),
            },
            {
              title: "Fix it where it belongs",
              body: (
                <>
                  A missing master value goes in the item-master file or the grid cell; a missing arc
                  goes in the logistics upload. Fixing it in the policy grid when it belongs in a
                  file means the next upload does not carry it.
                </>
              ),
            },
            {
              title: "Re-verify",
              body: <>The gate is recomputed from the data as it stands, not from what it said last time.</>,
            },
          ]}
        />
      </Section>

      <Section id="unsourced-bom" title="The one finding that always blocks">
        <P>
          A material in your bill of materials with no supplier that can deliver it cannot be
          simulated at any level of approximation — there is no chain. This blocks regardless of how
          it got there, and it is the most common reason a first run will not start.
        </P>
        <P>
          It is usually a mismatch rather than an omission: a <Term>material_id</Term> spelled one
          way in the BOM and another in the inbound file. Compare the two files before adding rows.
        </P>
      </Section>

      {required.length > 0 && (
        <Section id="engine-requires" title="What the engine asks for before any policy does">
          <P>
            {required.length} fields the simulation reads regardless of which policies you have
            chosen. A policy you enable can add more. Each carries the engine's own level and, where
            there is one, the rule that stands in when it is absent.
          </P>
          <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
            {required.map((r) => (
              <div key={r.field} className="p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[12px] font-semibold text-foreground">{r.field}</span>
                  <Badge
                    variant={r.level === "required" ? "destructive" : "outline"}
                    className="text-[10px]"
                  >
                    {r.level}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{r.reason}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  <span className="text-foreground">If nothing supplies it:</span>{" "}
                  {r.fallback ?? "nothing does — this is the blocking kind."}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="data-trust-report">Data Trust Report</DocLink> ·{" "}
          <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> ·{" "}
          <DocLink to="uploading-data">Uploading data</DocLink> ·{" "}
          <DocLink to="simulation-lab">Simulation Lab</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry's base data requirements and the shared grading module's severity law" />
    </>
  );
}
