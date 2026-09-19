// §6.3 section 14 — getting an API key.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { API_ROUTES } from "@/components/docs/generated/policy.generated";

export default function GettingAnApiKey() {
  const scopes = [...new Set(API_ROUTES.map((r) => r.scope))].sort();

  return (
    <>
      <PageTitle lead="Issuing, scoping and revoking a key.">Getting an API key</PageTitle>

      <Section id="what-a-key-is" title="What a key is">
        <Key>
          A key belongs to a project and an organization — not to a person.
        </Key>
        <P>
          That is the single most important thing to know about it, and it has a consequence people
          are usually surprised by, which is two sections down.
        </P>
        <P>
          Issue and revoke keys at <AppLink to="/developer">/developer</AppLink>. A key is shown
          once, when it is created; after that only its identity and its scopes are visible, which
          means a key you did not record is a key you replace rather than recover.
        </P>
      </Section>

      <Section id="scopes" title="Scopes">
        <P>
          A key carries scopes and every route requires one. A key with only read scopes cannot
          write however the request is formed, because the check happens before the handler rather
          than inside it.
        </P>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <span
              key={s}
              className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
        <P>
          {scopes.length} scopes across {API_ROUTES.length} routes.{" "}
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> lists which route
          needs which.
        </P>
        <P>
          Scope narrowly. A key that only reads runs cannot change a policy, and the day something
          goes wrong that distinction is the difference between an incident and a question.
        </P>
      </Section>

      <Callout tone="limit" title="A key has no person behind it, so the audit trail has no name">
        <p>
          Because a key belongs to a project rather than to somebody, a write made with it is
          recorded with <strong>no actor</strong>. The change is logged; who made it is not, because
          there is no "who" to log.
        </p>
        <p>
          Naming a fabricated user would be worse — an audit trail reading as though a person acted
          when none did. So the field is left empty and this is where we say so. If attribution
          matters for an automated process, the practical answer today is one key per process, named
          clearly, so the key itself carries the attribution.
        </p>
        <p>
          <DocLink to="audit-log">Audit log</DocLink> and{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> cover the full shape of
          this.
        </p>
      </Callout>

      <Callout title="Revoking is immediate and is itself recorded">
        <p>
          Revoking stops the key at the next request. Unlike most of what a key does, the revocation
          is recorded as an administrative action — so the one thing definitely in the log is the
          key being taken away.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> ·{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> ·{" "}
          <DocLink to="request-log">Request log</DocLink> ·{" "}
          <DocLink to="account-and-password">Account &amp; password</DocLink>
        </P>
      </Section>

      <Provenance from="the dispatcher's own route table, for the scopes it enforces" />
    </>
  );
}
