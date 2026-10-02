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
import { API_LIMITS, API_NOTEBOOKS, API_ROUTES } from "@/components/docs/generated/policy.generated";

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

      <Section id="notebook" title="The notebook series">
        <Key>
          Six Python notebooks do what you do in the application — with your own project's ids
          already filled in, or with no key at all in demo mode.
        </Key>
        <P>
          You do not have to write a client to try the API. Pick a project on{" "}
          <AppLink to="/developer">Developer API</AppLink> → <strong>Notebook</strong>, and the
          screen shows the exact configuration block every notebook starts with — the base URL, your
          project id, a baseline scenario id and a policy version id, chosen from the ones that
          project actually has. The tab lists your scenarios, policy versions and dataset versions
          beside it, so you can pick different ids rather than go hunting for them.
        </P>
        <P>
          Each notebook mirrors one workflow: <strong>00</strong> sets up, runs and reads a
          simulation; <strong>01</strong> changes a policy, snapshots it and compares A with B
          replication by replication; <strong>02</strong> runs stress tests and reads survival and
          recovery times; <strong>03</strong> produces a material shortage through a sole-source
          supplier outage and compares lost sales with backorders; <strong>04</strong> exports a
          run's results workbook with its reproducibility record; <strong>05</strong> pulls a dataset
          and a policy version and runs the simulation engine on your own machine — reproducing a
          platform run exactly, then sweeping twenty scenarios at no cost to your quota. A notebook that changes your
          policies puts them back when its block ends, even if a run fails.
        </P>
        <P>
          <strong>Without a key</strong> a notebook runs in <em>demo mode</em>: it replays engine
          output recorded for the Example project (one product, two materials, three suppliers), and
          every cell behaves as it would against the API. A request it has no recording for is
          refused, never answered with an invented number. <strong>With a key</strong> — from
          Colab's Secrets panel or the <Term>SURESUITE_API_KEY</Term> environment variable — the
          same cells work on your project.
        </P>
        <P>
          <strong>Download</strong> carries your ids: it patches the configuration cell as it saves,
          and names the file after your project. <strong>Open in Colab</strong> saves the same
          pre-filled copy and opens Colab in a new tab; choose <strong>File → Upload notebook</strong>{" "}
          there and pick the file you just saved. Colab never reads the notebook from anywhere but
          your own download.
        </P>
        <P className="text-[13px] text-muted-foreground">
          The files are {API_NOTEBOOKS.map((n, i) => (
            <span key={n}>
              {i > 0 ? (i === API_NOTEBOOKS.length - 1 ? " and " : ", ") : ""}
              <Term>{n}</Term>
            </span>
          ))}, shipped with the application.
        </P>
        <Callout tone="limit" title="The API accepts disruption targets the engine skips">
          <p>
            The notebooks disrupt only what the engine can: a supplier of your project, or the
            plant. The API itself accepts any target string, and the engine resolves a target
            against your supplier ids or the plant and drops anything else — so a material code
            sent through the API produces a run with the disruption absent. The pre-run gate
            answers such a run with a warning you must acknowledge, and the notebooks check every
            stress run for the recovery measures a real disruption leaves.{" "}
            <DocLink to="stress-tests">Stress tests</DocLink> has the full rule.
          </p>
        </Callout>
      </Section>

      <Section id="personal-keys" title="Personal keys and organization keys">
        <Key>
          A personal key acts as you: it stops working if you leave the organization, and every
          request it makes is logged under your name.
        </Key>
        <P>
          When you create a key you choose what it acts as. A <strong>personal</strong> key — the
          default — is bound to you. It reaches what you can see in the application, it stops the
          moment your account is deactivated or moves to another organization, and the request log
          names you on everything it does. Only you can rotate it; an administrator can revoke it but
          not rotate it, because rotating hands over a secret that would act as you.
        </P>
        <P>
          An <strong>organization</strong> key acts for the organization and names no person. Use it
          for a shared service that should keep working whoever leaves.
        </P>
      </Section>

      <Section id="who-can-create" title="Who can create a key">
        <Key>
          Everyone with an active account can create a personal key. Without an admin or modeler
          role it is read-only.
        </Key>
        <P>
          A viewer or any other user can create a <strong>personal</strong> key and use it to pull
          the projects, dataset versions, policy versions and runs they can already see in the
          application, install the engine, and simulate on their own machine. The create dialog
          offers them only the read scopes, and they see, rotate and revoke only their own keys.
        </P>
        <P>
          Writing through the API and organization keys stay with admins and modelers. The rule holds
          when the key is <em>used</em>, not only when it is made: if a modeler later becomes a plain
          user, their personal keys keep reading and stop writing on the next request.
        </P>
      </Section>

      <Callout tone="limit" title="Writes through the API still record no person">
        <p>
          A personal key's requests name you in the request log. The changes it WRITES — a frozen
          dataset, a saved policy, a dispatched run — are still recorded with <strong>no actor</strong>,
          as they are for an organization key. Naming the person in a write turns on the per-user
          permission checks the application applies, and those arrive together with writing data
          back through the API, not before.
        </p>
        <p>
          Naming a fabricated user would be worse — an audit trail reading as though a person acted
          when none did. For an organization key the practical answer remains one key per process,
          named for the process, so the key's own name carries what the actor field cannot.
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
