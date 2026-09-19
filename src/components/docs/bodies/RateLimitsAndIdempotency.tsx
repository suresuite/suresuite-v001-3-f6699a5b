// §6.3 section 14 — rate limits and idempotency.

import { PageTitle, Section, P, Key, Callout, Defs, Term, DocLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";
import { API_LIMITS } from "@/components/docs/generated/policy.generated";

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
          Read the headers rather than assuming the numbers. A limit is resolved per request from
          three places, in order: a row for <strong>your key</strong>, then a row for{" "}
          <strong>your organization</strong>, then the default for the key's environment. So two
          keys in the same organization can have different ceilings, and neither has to match the
          table below.
        </P>
        <div className="overflow-x-auto rounded-sm border border-border bg-card shadow-xs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">If nothing is configured</th>
                <th className="px-4 py-2 font-medium">Per minute</th>
                <th className="px-4 py-2 font-medium">Per day</th>
                <th className="px-4 py-2 font-medium">Runs at once</th>
              </tr>
            </thead>
            <tbody>
              {API_LIMITS.envs.map((e) => (
                <tr key={e.env} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-[12px] text-foreground">sk_{e.env}_…</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.rpm}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.rpd}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.maxConcurrentRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Raising either is an administrator's decision rather than something a client can
          negotiate. It takes effect on the next request — there is no deploy behind it.
        </P>
      </Section>

      <Section id="the-other-three" title="Three more ceilings that are not requests per minute">
        <P>
          The per-minute limit is the one everybody meets first and the one least likely to stop a
          real integration. These three are the ones that do.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              Simulations running at once, per organization
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Counted across everything your organization has queued or running — the API, the
              application, everyone's browser tab. Exceeding it answers{" "}
              <Term>concurrent_runs_exceeded</Term> with a <Term>Retry-After</Term> of 60 seconds,
              and the message tells you how many are active. This is the limit a batch script hits,
              and the fix is to finish a run before dispatching the next rather than to raise the
              ceiling.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              Replications per run, where your organization sets one
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A scenario asking for more than your organization allows is refused with{" "}
              <Term>replications_exceeded</Term> <em>before</em> any compute starts — a 403, not a
              truncation, so you never receive a run quietly shorter than the one you asked for.
              Under that there is a hard global clamp at 200.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              {API_LIMITS.maxBodyKb} KB per request body
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Over it is <Term>payload_too_large</Term>. There are no bulk endpoints, so the only
              way to approach this is a very large policy document; a request that hits it is
              usually a loop that meant to send one override and sent every override.
            </p>
          </div>
        </div>
      </Section>

      <Callout tone="limit" title="Failed authentication is throttled by address, not by key">
        <p>
          {API_LIMITS.failedAuthsPerMinutePerIp} failed authentications a minute from one address
          answers <Term>too_many_failed_auths</Term> — a 429, for what is really a 401. It exists to
          make key-guessing expensive.
        </p>
        <p>
          It catches an honest client too: a deployment that rolls out a revoked key to several
          workers behind one address will trip it, and the 429 will look like a rate limit rather
          than the authentication failure it is. Check the code, not the status.
        </p>
      </Callout>

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
          Send an <Term>Idempotency-Key</Term> header with it. If a request carrying that key
          already started a run, the original run is returned rather than a new one started — so a
          retry after a timeout you are not sure about is safe.
        </P>
        <P>
          You can tell the two apart: a replayed request comes back with{" "}
          <Term>Idempotency-Replayed: true</Term>, and the body is the original run's id and current
          status rather than a freshly queued one. A client that wants to know whether it actually
          caused the run should read that header.
        </P>
        <P>
          The record lasts <strong>{API_LIMITS.idempotencyTtlHours} hours</strong>, and the key is
          scoped to <strong>your API key</strong>. After that window the same header starts a new
          run, and two keys using the same string never collide with each other.
        </P>
        <Callout title="Use a key that means something">
          <p>
            Derive it from what the request is <em>about</em> — the project, the policy version, the
            scenario — rather than from a fresh random value per attempt. A key generated per attempt
            makes every retry a new request, which is precisely what the header exists to prevent.
          </p>
        </Callout>
      </Section>

      <Callout title="The other protection against a duplicate run costs you nothing to ignore">
        <p>
          Dispatching a run whose inputs, policy version and scenario exactly match a completed run
          answers <Term>reuse_available</Term> — a 409 — instead of computing it again. It is not an
          error: it is the API telling you the answer already exists and where to read it.
        </p>
        <p>
          Send <Term>force_rerun</Term> if you genuinely want the compute repeated. Reuse is always
          the caller's choice, never something done silently on your behalf, because a result you
          did not run is a result you should have agreed to.
        </p>
      </Callout>

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

      <Provenance from="the dispatcher's DEFAULT_LIMITS literal, its idempotency window and its throttle constants — read as source — and the contract's coverage register" />
    </>
  );
}
