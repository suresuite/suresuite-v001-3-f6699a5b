// §6.3 section 3 — Demand Forecast (PLAN.md §24 WP 14.2). Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function DemandForecasts() {
  const t = refTable("demand_forecasts");

  return (
    <>
      <PageTitle lead="The forecast per customer × product, per week or per month — the centre the run draws demand around.">
        Demand Forecast
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per <em>bucket</em>: from <Term>period_start</Term>, for one week or one calendar
          month, this customer is expected to take <Term>quantity</Term> of this product. A row's
          buckets in date order are its forecast series.
        </P>
        <Key>The plan reads the forecast. The simulated world draws actual demand around it.</Key>
        <P>
          A forecast is the <em>centre</em> of the row's demand, week by week. The row's
          distribution and variation — set on <DocLink to="outbound-logistics">Outbound
          Logistics</DocLink> or on the Customer stage at <AppLink to="/policies">/policies</AppLink> —
          decide how far actual demand strays from it. With no distribution, the row's demand is
          exactly its forecast.
        </P>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            time_unit: (
              <>
                The bucket's <strong>length</strong>: <Term>week</Term> or <Term>month</Term>; blank
                means a week. Unlike a lane's <Term>time_unit</Term> it is kept as you typed it.
              </>
            ),
            quantity: (
              <>
                The quantity over the <strong>whole</strong> bucket — 1 000 for a month is 1 000
                over that month.
              </>
            ),
          }}
        />
      </Section>

      <Section id="spread" title="A month is spread evenly over its weeks">
        <P>
          When the file is promoted, each bucket's quantity is spread evenly over its own days and
          stored as a weekly rate: 1 000 over a 30-day November is 233.33 a week, over a 31-day
          December 225.81. The review screen of the upload says so.
        </P>
        <P>
          The run lays every row's buckets on one calendar: <strong>week 0 starts on the
          project's earliest <Term>period_start</Term></strong>, and each simulated week takes the
          days it shares with each bucket — so a week that straddles two months takes some of
          each. A day no bucket covers counts as zero demand, and the pre-run check warns about it.
        </P>
      </Section>

      <Callout tone="limit" title="Past the end of the series">
        <p>
          A forecast shorter than the run is used to its end; after that the row plans on its{" "}
          <Term>demand_mean</Term> if it has one, else on the forecast's last value. The pre-run
          check warns before the run and the run itself says which it used. Setting the row's{" "}
          <em>Demand mode</em> to <Term>model</Term> on the Customer stage sets the series aside.
        </p>
      </Callout>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink>. Column order does
          not matter; the parser binds by header name. A date is written <Term>YYYY-MM-DD</Term> —
          a date in any other form is reported, not guessed.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="customer-stage">Customer stage</DocLink> ·{" "}
          <DocLink to="units-and-time-periods">Units and time periods</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/demand_forecasts.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
