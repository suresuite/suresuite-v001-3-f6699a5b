// §6.3 section 14 — getting an API key. Deepened in WP 5.2j.
//
// The page was 410 rendered words and described a key in the abstract. What it
// omitted was the screen: `/developer` has three tabs, keys come in two
// environments with different ceilings, expiry is a choice made at creation,
// and the third tab hands you a ready-to-run notebook with your own project's
// ids already in it — which no page of the manual mentioned (§4 D110).
//
// The scope list, the environment ceilings and the notebook path are all
// derived. Nothing here types a scope name or a rate limit.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { FROZEN_CELL } from "@/components/shared/frozenCell";
import { API_LIMITS, API_NOTEBOOK, API_ROUTES } from "@/components/docs/generated/policy.generated";

export default function GettingAnApiKey() {
  const scopes = [...new Set(API_ROUTES.map((r) => r.scope))].sort();
  const test = API_LIMITS.envs.find((e) => e.env === "test");
  const live = API_LIMITS.envs.find((e) => e.env === "live");

  return (
    <>
      <PageTitle lead="Issuing, scoping and revoking a key — and the notebook that runs against it without you writing a client.">
        Getting an API key
      </PageTitle>

      <Section id="what-a-key-is" title="What a key is">
        <Key>
          A key belongs to a project and an organization — not to a person.
        </Key>
        <P>
          That is the single most important thing to know about it, and it has a consequence people
          are usually surprised by, which is further down this page.
        </P>
        <P>
          Issue and revoke keys at <AppLink to="/developer">Developer API</AppLink>, on the{" "}
          <strong>API keys</strong> tab. A key's secret is shown <strong>once</strong>, in the
          dialog that creates it; afterwards the screen shows only its prefix, its scopes, its
          request count over the last 30 days and when it was last used. A key you did not record is
          a key you replace, not one you recover.
        </P>
      </Section>

      <Section id="creating-one" title="Creating one">
        <Steps
          steps={[
            {
              title: "Name it after the thing that will use it",
              where: "/developer → API keys → New key",
              body: (
                <>
                  The field suggests “CI pipeline” or “analyst notebook”, and that is the right
                  shape. The name is the only attribution a write through this key will ever carry,
                  for the reason two sections down, so “test” is a name you will regret.
                </>
              ),
            },
            {
              title: "Choose the environment",
              body: (
                <>
                  <Term>test</Term> or <Term>live</Term>. It is fixed at creation and it is visible
                  in the key itself — a key begins <Term>sk_test_</Term> or <Term>sk_live_</Term>,
                  so a key pasted into the wrong config is identifiable on sight. The two carry
                  different ceilings; see below.
                </>
              ),
            },
            {
              title: "Tick only the scopes the job needs",
              body: (
                <>
                  Every route requires one, and the check happens before the handler rather than
                  inside it — so a read-only key cannot write however the request is formed.
                </>
              ),
            },
            {
              title: "Set an expiry",
              body: (
                <>
                  Never, 30 days, 90 days or a year. An expired key fails with{" "}
                  <Term>expired_key</Term> rather than degrading quietly, so an expiry is a
                  reminder that arrives as a clear error rather than as wrong results.
                </>
              ),
            },
            {
              title: "Copy the secret before you close the dialog",
              body: <>The dialog will not show it again, and there is no route that will.</>,
            },
          ]}
        />
      </Section>

      <Section id="environments" title="test and live are not the same key with a different label">
        <P>
          The environment sets what the key is allowed to do per minute, per day, and at once. A
          client developed against a test key and moved to production without re-reading these
          numbers is a client that starts failing on throughput it never met in development.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className={`px-4 py-2 font-medium ${FROZEN_CELL}`}>Environment</th>
                <th className="px-4 py-2 font-medium">Requests / minute</th>
                <th className="px-4 py-2 font-medium">Requests / day</th>
                <th className="px-4 py-2 font-medium">Runs at once</th>
              </tr>
            </thead>
            <tbody>
              {API_LIMITS.envs.map((e) => (
                <tr key={e.env} className="border-b border-border last:border-0">
                  <td className={`px-4 py-2 font-mono text-[12px] text-foreground ${FROZEN_CELL}`}>
                    sk_{e.env}_…
                  </td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.rpm}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.rpd}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.maxConcurrentRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          {test && live && (
            <>
              A test key is deliberately narrow: {test.rpd} requests a day against {live.rpd}, and{" "}
              {test.maxConcurrentRuns} simulation{test.maxConcurrentRuns === 1 ? "" : "s"} at a time
              against {live.maxConcurrentRuns}.{" "}
            </>
          )}
          These are defaults. An administrator can raise either ceiling for one key or for the whole
          organization without a deploy, so treat the table as the floor you can assume rather than
          a statement about your key.{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> is how
          you read what your key actually has.
        </P>
      </Section>

      <Section id="scopes" title="Scopes">
        <P>
          {scopes.length} scopes across {API_ROUTES.length} routes. The pattern is{" "}
          <Term>read:</Term> or <Term>write:</Term> over the four things the API touches — data,
          policies, runs and keys.
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
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> lists which route
          needs which. Scope narrowly: a key that only reads runs cannot change a policy, and the
          day something goes wrong that distinction is the difference between an incident and a
          question.
        </P>
        <P>
          <Term>admin:keys</Term> is the one worth thinking twice about. It lets a key list and
          revoke other keys, which is a kill switch worth having in an incident and a very poor
          thing to leave on a key that only needed to read results.
        </P>
      </Section>

      <Section id="notebook" title="The quickstart notebook">
        <Key>
          The Notebook tab hands you a working client with your own project's ids already filled in.
        </Key>
        <P>
          You do not have to write one to try the API. Pick a project on{" "}
          <AppLink to="/developer">Developer API</AppLink> → <strong>Notebook</strong>, and the
          screen shows the exact configuration block the notebook will start with — the base URL,
          your project id, a scenario id and a policy version id, chosen from the ones that project
          actually has. The tab lists your scenarios, policy versions and dataset versions beside
          it, so you can pick different ids rather than go hunting for them.
        </P>
        <P>
          <strong>Download</strong> is the button that carries those ids: it patches the
          configuration cell as it saves, and names the file after your project. It works whether or
          not you can see this application's source repository.
        </P>
        <P>
          <strong>Open in Colab</strong> loads the same notebook from GitHub instead, which means it
          works only if you have access to that repository, and it gives you the{" "}
          <em>unpatched</em> copy — the configuration cell is a blank template you fill in yourself.
          If Colab shows you a “notebook not found” page, that is what happened; download it and
          upload it to Colab instead.
        </P>
        <P>
          The notebook is thirteen worked sections, in the order a real integration goes: connect
          and list projects, freeze a dataset version, read the engine's policy catalog, edit a
          policy family, snapshot a policy version, create a scenario, dispatch a run and poll it to
          completion, read aggregate KPIs and per-replication rows, check the credibility status,
          compare two policy variants, and run a disruption experiment. It asks for your key with a
          hidden prompt rather than storing it in a cell.
        </P>
        <P className="text-[13px] text-muted-foreground">
          The file itself is <Term>{API_NOTEBOOK}</Term>, shipped with the application.
        </P>
        <Callout tone="limit" title="The notebook's disruption sections have the same targeting trap as the presets">
          <p>
            Its experiment cells suggest a material code as a disruption target. The engine resolves
            a target against your supplier ids or the plant and drops anything else, so a material
            code produces a run that completes with the disruption silently absent.{" "}
            <DocLink to="stress-tests">Stress tests</DocLink> has the full rule and what a
            resolvable target looks like.
          </p>
        </Callout>
      </Section>

      <Callout tone="limit" title="A key has no person behind it, so the audit trail has no name">
        <p>
          Because a key belongs to a project rather than to somebody, a write made with it is
          recorded with <strong>no actor</strong>. The change is logged; who made it is not, because
          there is no “who” to log.
        </p>
        <p>
          Naming a fabricated user would be worse — an audit trail reading as though a person acted
          when none did. So the field is left empty and this is where we say so. If attribution
          matters for an automated process, the practical answer today is one key per process, named
          for the process, so the key's own name carries what the actor field cannot.
        </p>
        <p>
          <DocLink to="audit-log">Audit log</DocLink> and{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> cover the full shape of
          this.
        </p>
      </Callout>

      <Section id="losing-one" title="If a key leaks">
        <P>
          Revoke it. Revocation stops the key at its next request, and unlike most of what a key
          does it is recorded as an administrative action — so the one thing definitely in the audit
          log is the key being taken away.
        </P>
        <P>
          Rotating is the same operation with a replacement issued in the same step, which is what
          you want for a key a running system depends on: create the new one, deploy it, then revoke
          the old one rather than the other way around.
        </P>
        <P>
          A key cannot reach a project it was not issued for, and a request for someone else's
          project answers <Term>project_not_found</Term> rather than a refusal — so a leaked key
          cannot even be used to discover what else exists.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> is what the key can
          call ·{" "}
          <DocLink to="rate-limits-and-idempotency">Rate limits &amp; idempotency</DocLink> is how
          hard it may call · <DocLink to="request-log">Request log</DocLink> is what it did ·{" "}
          <DocLink to="account-and-password">Account &amp; password</DocLink> is the human
          equivalent of this page.
        </P>
      </Section>

      <Provenance from="the dispatcher's own route table and DEFAULT_LIMITS literal for the scopes and ceilings, and /developer's own notebook href — all read as source, never typed" />
    </>
  );
}
