// §6.3 section 14 — endpoints. Marked G.
//
// Read from the dispatcher's own `routes` table rather than written, so an
// endpoint added, removed or re-scoped changes this page with nobody editing
// it. An endpoint list that drifts from the server is D21 and D22 pointed at an
// API instead of at a table.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { API_ERRORS, API_LIMITS, API_ROUTES } from "@/components/docs/generated/policy.generated";

/** Group by the first path segment after the version, which is the resource. */
function byResource() {
  const groups = new Map<string, typeof API_ROUTES>();
  for (const r of API_ROUTES) {
    const key = r.path.split("/")[2] ?? "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()].sort();
}

export default function EndpointsAndSchemas() {
  const groups = byResource();

  return (
    <>
      <PageTitle lead="Every endpoint, the scope it requires, and how the surface is shaped.">
        Endpoints &amp; schemas
      </PageTitle>

      <Section id="the-shape" title="The shape of the surface">
        <Key>
          {API_ROUTES.length} routes, under <Term>/v1</Term>, over three resources: projects and
          what hangs off them, runs, and keys.
        </Key>
        <P>
          Everything is scoped to a project by its id, and the id is checked against your key's
          organization before any handler runs. A key cannot reach a project it was not issued for,
          whatever the path says.
        </P>
      </Section>

      <Section id="the-routes" title="The routes">
        {groups.map(([resource, rows]) => (
          <div key={resource} className="space-y-2">
            <h4 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              /{resource}
            </h4>
            <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
              {rows.map((r) => (
                <div key={`${r.method}-${r.path}`} className="flex flex-wrap items-baseline gap-2 p-3">
                  <Badge
                    variant={r.method === "GET" ? "outline" : "secondary"}
                    className="font-mono text-[10px]"
                  >
                    {r.method}
                  </Badge>
                  <span className="font-mono text-[12px] text-foreground">{r.path}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {r.scope}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Callout title="A colon in a path is an action, not a resource">
        <p>
          Routes like <Term>:freeze</Term>, <Term>:cancel</Term> and <Term>:revoke</Term> are things
          you do rather than things you fetch. They are always POST, and they are named that way so
          that a URL cannot be mistaken for something you can GET.
        </p>
      </Callout>

      <Section id="paging" title="Reading a list">
        <P>
          Lists are cursor-paged, not offset-paged. A list response carries its rows under{" "}
          <Term>data</Term> and a <Term>next_cursor</Term> beside them; pass that value back as{" "}
          <Term>?cursor=</Term> to get the following page, and stop when it comes back null.
        </P>
        <P>
          <Term>?limit=</Term> takes {API_LIMITS.defaultPageSize} by default and{" "}
          {API_LIMITS.maxPageSize} at most. A larger number is clamped rather than refused, so a
          client asking for a thousand rows gets {API_LIMITS.maxPageSize} and a cursor, not an
          error — which is worth knowing, because a loop that stops when it receives fewer rows
          than it asked for will stop on the first page.
        </P>
        <P>
          A cursor is a position, not a snapshot. Rows created while you are paging can appear or
          shift, so for anything you intend to reconcile later, freeze a dataset version first and
          read against that.
        </P>
      </Section>

      <Section id="errors" title="Every error this API can return">
        <P>
          Failures carry a <strong>stable machine code</strong> beside the HTTP status, and the code
          is what a client should branch on: statuses are shared — four different things return 429
          — and only the code says which. {API_ERRORS.length} codes exist, and they are read from
          the dispatcher's own throw sites rather than listed by hand, so one that stops being
          thrown leaves this page.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">What it means</th>
              </tr>
            </thead>
            <tbody>
              {API_ERRORS.map((e) => (
                <tr key={e.code} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 font-mono text-[12px] tabular-nums text-muted-foreground">
                    {e.status}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-foreground">{e.code}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {/* Through `Prose`: the dispatcher writes its messages in
                        markdown code spans, and printing the backticks would
                        read as a typo in text whose whole point is that it was
                        not retyped. */}
                    <Prose text={e.message} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          <Term>{"${...}"}</Term> in a message is a value filled in at the time — the scope you were
          missing, the route you asked for. The shape is shown rather than an example, because the
          example would be the one that is never yours.
        </P>
      </Section>

      <Callout tone="law" title="Everything that can fail, fails closed">
        <p>
          The 503s in that table are not ordinary outages. Authentication, authorization, the rate
          limiter and the compute quota each <strong>refuse</strong> when their backend is
          unreachable, rather than letting the request through unchecked.
        </p>
        <p>
          It is the less convenient behaviour and it is the correct one: a permission check that
          opens under its own failure is a permission check that is absent exactly when something is
          already going wrong. Treat a 503 as retryable and never as a reason to skip the check
          client-side.
        </p>
      </Callout>

      <Callout tone="limit" title="A project you cannot see answers 404, not 403">
        <p>
          A request naming another organization's project is answered{" "}
          <Term>project_not_found</Term> — the same answer as a project id that does not exist at
          all. That is deliberate: a 403 would confirm the project is real, which turns the API into
          a way of discovering what other organizations have.
        </p>
        <p>
          So when you get <Term>project_not_found</Term> for a project you are certain exists, check
          which organization the key belongs to before you check the id.
        </p>
      </Callout>

      <Callout tone="limit" title="There is no request or response schema on this page yet">
        <p>
          The routes, their scopes and every error code are read from the dispatcher. The{" "}
          <em>bodies</em> — the fields a POST accepts and the shape a GET returns — are validated
          against schemas that live in the same file and are not exported anywhere a generator can
          reach, so this page would have to describe them by hand, and a hand-written schema drifts
          from its server exactly the way a hand-written column list drifts from its table.
        </p>
        <p>
          We would rather ship an accurate list of endpoints with no bodies than a complete-looking
          page that is wrong in six months. A machine-readable schema is what would close it, and
          the <DocLink to="getting-an-api-key">notebook</DocLink> is the practical substitute
          meanwhile: every call on this page appears in it, with a real body.
        </p>
      </Callout>

      <Callout tone="limit" title="One body the API will not accept, that the application creates">
        <p>
          A scenario's disruption schedule is capped at <strong>100%</strong> magnitude through this
          API. The stress-test preset named “Lead-time shock” writes <strong>200%</strong>, so a
          scenario the application will create for you is one this API refuses with{" "}
          <Term>invalid_request</Term>.
        </p>
        <p>
          The engine treats anything at or above 100% as a full outage, so nothing is lost by
          sending 100 — but a client copying a schedule out of the application and posting it back
          will be rejected, and the reason is not obvious from the error.{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> explains what the number does.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="getting-an-api-key">Getting an API key</DocLink> ·{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> ·{" "}
          <DocLink to="request-log">Request log</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink>
        </P>
      </Section>

      <Provenance from="the dispatcher's own routes table, its ApiError throw sites and its paging clamp in the public API function — a parse of the literal it matches against, which is the strongest declaration that exists for this surface" />
    </>
  );
}
