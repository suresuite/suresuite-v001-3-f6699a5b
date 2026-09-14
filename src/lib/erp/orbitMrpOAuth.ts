// OAuth 2.1 + PKCE client for connecting a SuReSuite project to an orbit-mrp
// company, per docs/design/erp-mrp-integration-plan.md §6b/§6c.
//
// This deliberately does NOT hardcode orbit-mrp's authorize/token endpoints:
// its own docs (docs/agent-access.md in that repo) describe dynamic client
// registration, so we discover everything from its
// /.well-known/oauth-authorization-server document, register a client if
// none is configured yet, and run a standard PKCE redirect. That is also
// what makes §5 Phase 3 ("multi-ERP adapters") cheap — a second ERP with the
// same OAuth 2.1 + discovery shape needs zero changes here.
//
// The token this flow produces is used exactly once, client-side, to prove
// company membership to the erp-sync-orbit-mrp Edge Function's `link`
// action (plan §6b rule 2) — it is never stored in the browser beyond that
// single call; the Edge Function is what persists it, into Vault, keyed by
// a per-link reference.

const SESSION_KEY = "orbit_mrp_oauth_pending";

interface PendingOAuth {
  projectId: string;
  codeVerifier: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Kicks off the "Connect a data source" flow from /project-manager: discovers
 *  orbit-mrp's OAuth server, registers a client if needed, and redirects the
 *  browser to its consent screen. Resumes in handleOrbitMrpCallback(). */
export async function startOrbitMrpConnect(orbitMrpBaseUrl: string, projectId: string) {
  const discoveryRes = await fetch(`${orbitMrpBaseUrl}/.well-known/oauth-authorization-server`);
  if (!discoveryRes.ok) {
    throw new Error("orbit-mrp did not expose an OAuth authorization server (see docs/agent-access.md step 2)");
  }
  const discovery = await discoveryRes.json();

  const redirectUri = `${window.location.origin}/integrations/orbit-mrp/callback`;
  let clientId = localStorage.getItem("orbit_mrp_client_id");

  if (!clientId && discovery.registration_endpoint) {
    const reg = await fetch(discovery.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "SuReSuite ERP connector",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!reg.ok) throw new Error("orbit-mrp dynamic client registration failed");
    const client = await reg.json();
    clientId = client.client_id;
    localStorage.setItem("orbit_mrp_client_id", clientId!);
  }
  if (!clientId) throw new Error("no client_id and orbit-mrp does not support dynamic registration");

  const codeVerifier = randomVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const pending: PendingOAuth = {
    projectId,
    codeVerifier,
    tokenEndpoint: discovery.token_endpoint,
    clientId,
    redirectUri,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(pending));

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  window.location.href = authorizeUrl.toString();
}

/** Exchanges the ?code= on /integrations/orbit-mrp/callback for an access
 *  token, using the verifier stashed by startOrbitMrpConnect. Returns the
 *  token plus the project_id the connect was started from, so the caller
 *  can immediately call list_companies and then link. Never persists the
 *  token itself — that is the Edge Function's job (into Vault). */
export async function handleOrbitMrpCallback(code: string): Promise<{ projectId: string; accessToken: string }> {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) throw new Error("no pending orbit-mrp connection in this browser session");
  const pending: PendingOAuth = JSON.parse(raw);
  sessionStorage.removeItem(SESSION_KEY);

  const res = await fetch(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`orbit-mrp token exchange failed: ${res.status}`);
  const token = await res.json();
  return { projectId: pending.projectId, accessToken: token.access_token };
}
