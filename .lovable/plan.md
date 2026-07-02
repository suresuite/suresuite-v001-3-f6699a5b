## What's happening

On `/project-intelligence`, clicking a suggestion tile in the empty state calls `useProjectChat.send()` → `supabase.functions.invoke("project-ai-chat")`. `supabase-js` swallows the body of any non-2xx response and only exposes the generic string **"Edge Function returned a non-2xx status code"**, so we can't tell whether the failure was auth, missing API key, RPC access denied, or an upstream model error.

Two paths in `supabase/functions/project-ai-chat/index.ts` still return non-2xx:

1. **Outer catch (line 306)** returns `500` for any error thrown before the `mode === "tools"` block — most importantly the `throw new Error('Missing required parameters …')` at line 57 and any `req.json()` failure.
2. The initial JSON-parse also has no CORS-safe fallback, so preflight-adjacent failures also read as generic non-2xx in the client.

The `tools` branch itself already returns 200 with `{ error, type }`, but the outer path does not, and the client hook only surfaces `invokeError.message` (which is the generic string).

## Fix plan

### 1. Edge function — never return non-2xx from the tools branch
`supabase/functions/project-ai-chat/index.ts`
- Wrap the request parsing (`await req.json()`) and the parameter guard in the same try/catch that already covers the tools branch, so validation errors return `200 { error, type: 'BAD_REQUEST' }` with CORS headers instead of hitting the outer 500 catch.
- Change the outer catch to also return `200 { error: err.message, type: 'AI_ERROR' }` when the request declared `mode: "tools"`, matching the inner branch. Non-tools legacy paths keep their current 500 for backward compatibility.
- Log `console.error` with the resolved provider + model id when `runChat` throws so future failures show up in edge logs.

### 2. Client hook — surface the real error instead of the generic string
`src/hooks/useProjectChat.ts`
- When `supabase.functions.invoke` returns an `invokeError` (i.e., the function did emit non-2xx), call the function again with plain `fetch` using `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` so we can read the response body, and throw `new Error(body.error ?? invokeError.message)`.
- Small helper `readInvokeError(response)` to keep the fallback tidy; no behavioural change on the happy path.

### 3. Empty-state pill UX
`src/components/intelligence/ChatWorkspace.tsx`
- Disable the suggestion pills while `loading` is true (they already gate on `projectId`) so a mis-click can't fire a second request over a still-streaming one.
- When `error` is set, render a small inline banner above the composer with the real message, plus a "Try again" button that re-sends the last user turn — instead of a silent toast users don't notice.

### Out of scope
No changes to providers, tool registry, RLS, or the `mode !== "tools"` legacy path. No new components; no schema changes.

## Verification
- Trigger the flow from `/project-intelligence` with a suggestion pill on a project the current user owns → expect a streamed reply.
- Force-fail by temporarily rotating `GEMINI_API_KEY` off the model in `providers.ts` and re-clicking a pill → expect the inline banner to read the real "GEMINI_API_KEY is not configured" text, not the generic string.
- `curl` the function with a missing `userEmail` field → expect `200 { error: "Missing required parameters…", type: "BAD_REQUEST" }`.
