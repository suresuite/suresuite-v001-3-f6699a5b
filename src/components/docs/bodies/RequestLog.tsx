// §6.3 section 14 — the request log.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, Provenance } from "@/components/docs/prose";
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
      </Section>

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
