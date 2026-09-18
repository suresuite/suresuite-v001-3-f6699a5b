// §6.3 section 14 — endpoints. Marked G.
//
// Read from the dispatcher's own `routes` table rather than written, so an
// endpoint added, removed or re-scoped changes this page with nobody editing
// it. An endpoint list that drifts from the server is D21 and D22 pointed at an
// API instead of at a table.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { API_ROUTES } from "@/components/docs/generated/policy.generated";

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

      <Callout tone="limit" title="There is no request or response schema on this page yet">
        <p>
          The routes and their scopes are read from the dispatcher. The <em>bodies</em> — what a POST
          accepts and what a GET returns — are not declared anywhere a generator can read, so this
          page would have to describe them by hand, and a hand-written schema drifts from its server
          exactly the way a hand-written column list drifts from its table.
        </p>
        <p>
          We would rather ship an accurate list of endpoints with no schemas than a complete-looking
          page that is wrong in six months. A machine-readable schema is what would close it.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="getting-an-api-key">Getting an API key</DocLink> ·{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> ·{" "}
          <DocLink to="request-log">Request log</DocLink>
        </P>
      </Section>

      <Provenance from="the dispatcher's own routes table in the public API function — a parse of the literal it matches against, which is the strongest declaration that exists for this surface" />
    </>
  );
}
