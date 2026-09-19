// §6.3 section 14 — the request log.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function RequestLog() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "api_request_logs"));

  return (
    <>
      <PageTitle lead="What your key did, and when.">Request log</PageTitle>

      <Section id="what-is-recorded" title="What each request records">
        <Key>
          Every request, successful or not, whether or not it reached a handler.
        </Key>
        <Defs
          items={[
            { term: "Which key", def: <>And which organization it belongs to.</> },
            { term: "Method and route", def: <>What was asked for.</> },
            { term: "Status and error code", def: <>What came back, and why if it failed.</> },
            { term: "Scope used", def: <>Which permission the route required.</> },
            { term: "Latency and bytes", def: <>How long it took and how much came back.</> },
            {
              term: "Request id",
              def: (
                <>
                  Returned in <Term>X-Request-Id</Term> on every response — quote it when asking
                  about a particular call.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="what-it-is-for" title="What it is for">
        <P>
          Two things, and they are different. Debugging: your client says the call failed and this
          says what the server saw. And review: which keys are active, what they are doing, and
          whether a key is being used for something it was not issued for.
        </P>
        <P>
          The <strong>API keys</strong> tab of <AppLink to="/developer">Developer API</AppLink> is
          where the second one is answered without reading rows: each key shows its request count
          over the last 30 days and when it was last used. A key with no traffic for months is a key
          to revoke, and a key with traffic nobody can account for is the question this log exists
          to answer.
        </P>
      </Section>

      <Section id="reading-a-failure" title="Reading a failed call">
        <P>
          Three fields together tell you what happened, and reading only one of them is how a
          debugging session goes wrong.
        </P>
        <Defs
          items={[
            {
              term: "Status",
              def: (
                <>
                  Not enough on its own. Four different failures answer 429, and three of them are
                  not rate limits.
                </>
              ),
            },
            {
              term: "Error code",
              def: (
                <>
                  The stable name, and the one to branch on.{" "}
                  <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> lists every
                  one the server can produce.
                </>
              ),
            },
            {
              term: "Scope used",
              def: (
                <>
                  Which permission the route demanded. On a <Term>missing_scope</Term> refusal this
                  is the field that says what to add, and it is recorded even though the call never
                  reached a handler.
                </>
              ),
            },
          ]}
        />
        <P>
          Set your own <Term>X-Request-Id</Term> on a request and it is kept rather than replaced,
          so a request id you generated in your own logs is the same string here. Send none and one
          is generated and returned to you. Either way the response carries it, so the id in your
          client's log is the id to quote.
        </P>
      </Section>

      <Callout tone="limit" title="Nothing you send in a request body is recorded here">
        <p>
          The log holds the method, the route, the status, the size of the response and the timing.
          It does not hold what you sent or what came back, and it never records the{" "}
          <Term>Authorization</Term> header.
        </p>
        <p>
          That is right for a log that will outlive the request, and it means this log cannot answer
          “what did that call change”. For that you want{" "}
          <DocLink to="audit-log">the audit log</DocLink>, which records the change rather than the
          call.
        </p>
      </Callout>

      <Callout title="Logging never delays or fails your request">
        <p>
          The row is written after the response has been handed back, and a write that fails is
          reported to the server's own logs rather than to you. So a successful call is never turned
          into an error by its own bookkeeping — and, in exchange, the log is best-effort rather
          than a guaranteed record of every request.
        </p>
      </Callout>

      <Callout tone="limit" title="This is not the audit log">
        <p>
          The request log records that a call happened. <DocLink to="audit-log">The audit log</DocLink>{" "}
          records that data changed. A write through the API appears in both — as a request here and
          as a change there, with no actor on the change, because a key is not a person.
        </p>
        <p>
          So reconstructing "who changed this" from an API write means joining the two by time and
          key, which is possible and is not the same as the record naming somebody.{" "}
          <DocLink to="getting-an-api-key">Getting an API key</DocLink> covers why.
        </p>
      </Callout>

      <Callout title="A rejected request is logged too">
        <p>
          A call refused for a missing scope, an unknown route or a rate limit still produces a row.
          That is the useful half for debugging — a request that never reached a handler is the one
          a client author most needs evidence of.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="This table is not described in the contract, on purpose">
          <p>
            <Term>api_request_logs</Term> is in the register of tables the data contract does not
            describe, under WP {owing.wp}: it is the public-API control plane and carries no value a
            simulation reads.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="getting-an-api-key">Getting an API key</DocLink> ·{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink> ·{" "}
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink>
        </P>
      </Section>

      <Provenance from="the public API's own request logging, and the contract's coverage register" />
    </>
  );
}
