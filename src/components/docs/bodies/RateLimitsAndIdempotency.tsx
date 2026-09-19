// §6.3 section 14 — rate limits and idempotency.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function RateLimitsAndIdempotency() {
  const owing = UNDESCRIBED.find((g) =>
    g.tables.some((t) => t.table === "api_rate_limits" || t.table === "api_idempotency"),
  );

  return (
    <>
      <PageTitle lead="How often you may call, and how to retry without doing something twice.">
        Rate limits &amp; idempotency
      </PageTitle>

      <Section id="limits" title="Limits">
        <Key>
          Every response tells you where you stand, so a well-behaved client never has to guess.
        </Key>
        <Defs
          items={[
            { term: <Term>X-RateLimit-Limit</Term>, def: <>What your key is allowed, per minute.</> },
            { term: <Term>X-RateLimit-Remaining</Term>, def: <>What is left in the current window.</> },
            { term: <Term>X-RateLimit-Reset</Term>, def: <>When the window rolls over.</> },
            {
              term: <Term>Retry-After</Term>,
              def: <>On a refusal, how long to wait. Honour it rather than backing off by guess.</>,
            },
          ]}
        />
        <P>
          Limits are per key, with an organization-level setting behind them and a default if
          neither is configured. A key that needs a higher limit is an administrator's decision
          rather than something a client can negotiate.
        </P>
      </Section>

      <Callout tone="law" title="If the limiter is unavailable, requests are refused">
        <p>
          A rate limiter that cannot be reached could fail either way: let everything through, or
          let nothing. This one refuses — a 503 rather than an unmetered window.
        </p>
        <p>
          It is the less convenient choice and it is the correct one. A limiter that opens under its
          own failure is a limiter that is absent exactly when something is going wrong.
        </p>
      </Callout>

      <Section id="idempotency" title="Idempotency">
        <P>
          Starting a run is the call you must not accidentally make twice, because the second one
          costs real compute and produces a second result that looks like a disagreement.
        </P>
        <P>
          Send an <Term>Idempotency-Key</Term> header with it. If a request with that key already
          started a run, the original run is returned rather than a new one being started — so a
          retry after a timeout you are not sure about is safe.
        </P>
        <Callout title="Use a key that means something">
          <p>
            Derive it from what the request is <em>about</em> — the project, the policy version, the
            scenario — rather than from a fresh random value per attempt. A key generated per attempt
            makes every retry a new request, which is precisely what the header exists to prevent.
          </p>
        </Callout>
      </Section>

      <Callout tone="limit" title="Idempotency covers starting a run, and not every write">
        <p>
          The guarantee is on the call where a duplicate is expensive. Other writes are not
          de-duplicated, so a retried policy save applies twice — harmlessly, because it is the same
          values, but it is not the same guarantee and should not be relied on as one.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="These tables are not described in the contract, on purpose">
          <p>
            <Term>api_rate_limits</Term> and <Term>api_idempotency</Term> are in the register of
            tables the data contract does not describe, under WP {owing.wp}: they carry no
            simulation input and no engine-read field, so a data-contract description would document
            machinery rather than your data.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="getting-an-api-key">Getting an API key</DocLink> ·{" "}
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> ·{" "}
          <DocLink to="request-log">Request log</DocLink>
        </P>
      </Section>

      <Provenance from="the public API's own limiter and idempotency handling, and the contract's coverage register" />
    </>
  );
}
