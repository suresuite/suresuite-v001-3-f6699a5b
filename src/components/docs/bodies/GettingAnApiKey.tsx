import { PageTitle, Section, P, Key, Callout, Bullets, Steps, Defs, DocLink, AppLink, Term } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { ExampleDownloads } from "@/components/docs/ExampleDownloads";

export default function Guide() { return <>
<PageTitle lead="Create a scoped key, make a read-only request, and then submit and retrieve a run.">Getting an API key</PageTitle>
<span id="environments" />
<span id="losing-one" />
<span id="notebook" />
<span id="personal-keys" />
<span id="related" />
<span id="scopes" />
<span id="what-a-key-is" />
<span id="who-can-create" />
<Section id="creating-one" title="Create a key for the intended integration"><P>Open <AppLink to="/developer">Developer API</AppLink> → <strong>API keys</strong> → <strong>New key</strong>. This requires key-management access. Give it a purpose-specific name, select test or live, restrict it to the required projects and scopes, and choose an expiry. Copy the secret while it is shown; later views show a prefix rather than the recoverable secret.</P><P>Keys carry an organization and optional project restrictions. Their effective access also depends on the owner's current eligibility; a stored scope list is not a permanent entitlement. The test/live label controls limits and is not proof that the key points at a separate database. Start with a read-only request.</P><DocFigure id="api-request" /></Section>
<Section id="first-request" title="Make the first request"><P>Use the gateway base URL for your deployment, ending in <Term>/functions/v1/api/v1</Term>. Set SURESUITE_API_BASE and SURESUITE_API_KEY in your local environment without committing the secret. The first request requires <Term>read:data</Term>.</P><pre className="overflow-x-auto rounded-sm bg-muted p-4 text-xs"><code>{`curl --fail-with-body \
  -H "Authorization: Bearer $SURESUITE_API_KEY" \
  "$SURESUITE_API_BASE/projects?limit=10"`}</code></pre><P>A successful response has a data array and next_cursor. For example, an authorized key with no visible projects can receive this valid empty page:</P><pre className="overflow-x-auto rounded-sm bg-muted p-4 text-xs"><code>{JSON.stringify({data:[],next_cursor:null},null,2)}</code></pre><P>Follow next_cursor until it is null. An empty data array is not a simulation result. The request shape and response envelope are checked against the current handler; this guide does not claim a live authenticated request was executed.</P></Section>
<Section id="submit" title="Submit work after the read succeeds"><P>Use <Term>read:policies</Term> to list saved policy versions and <Term>read:runs</Term> to list scenarios. Use actual IDs from the authorized project. Creating a scenario or submitting a run requires <Term>write:runs</Term>. Do not copy illustrative UUIDs into a production request.</P><P>POST to <Term>/projects/PROJECT_ID/runs</Term> with JSON containing scenario_id and policy_version_id. The strict schema also accepts acknowledge_warnings and force_rerun; leave both false unless their consequences are intended. Set a unique <Term>Idempotency-Key</Term> for this intended submission and reuse it only for a retry of that same request.</P><pre className="overflow-x-auto rounded-sm bg-muted p-4 text-xs"><code>{JSON.stringify({scenario_id:"UUID_FROM_SCENARIO_LIST",policy_version_id:"UUID_FROM_POLICY_VERSION_LIST",acknowledge_warnings:false,force_rerun:false},null,2)}</code></pre><P>A successful submission returns a run_id and status; acceptance is not completion. Poll <Term>GET /runs/RUN_ID</Term> with read:runs, and retrieve <Term>GET /runs/RUN_ID/replications</Term> for replication evidence. Inspect status, versions, counts and conversion notes before using the output.</P></Section>
<Section id="errors" title="Common failures and safe recovery"><Defs items={[
{term:"401",def:"Missing, malformed, expired or revoked key. Check the error code and replace the credential through Developer API when needed; do not paste it into a support message."},
{term:"403 / 404",def:"Missing scope or an inaccessible project/run. Verify scopes and project restrictions. A 404 can intentionally conceal an inaccessible resource."},
{term:"400 / validation response",def:"Check the exact error body for malformed IDs, unsupported fields or invalid input. Run-readiness findings require fixing the model, not changing the authentication header."},
{term:"409 reuse_available",def:"A compatible result is available for reuse. Inspect the returned details; force a rerun only when fresh computation is intended."},
{term:"429 / 503",def:"Quota, rate limit or unavailable supporting service. Respect retry information where supplied, use bounded retries, and preserve the same idempotency key for one intended submission."}
]} /><P>Keep the response's <Term>X-Request-Id</Term> and error code for diagnosis. See <DocLink to="endpoints-and-schemas">Endpoints &amp; schemas</DocLink> and <DocLink to="rate-limits-and-idempotency">rate limits and idempotency</DocLink> for the detailed reference.</P></Section>
</>; }
