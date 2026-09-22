// `delete-project` — the Project Manager's "Delete project" (§4 D170).
//
// THIS FUNCTION USED TO DO THE DELETION ITSELF, AND THAT WAS THE DEFECT. It answered
// `202 Deletion started` before touching anything, then deleted table by table in
// 200-row batches through a service-role client inside `EdgeRuntime.waitUntil`.
// Production ran a 2026-03-17 build of it (§4 D168) that still deleted
// `product_code_map`, a table `20260916000003` dropped, so every deletion failed in
// the background — AFTER removing some of the project's rows, with no actor on any
// audit row, and with the person told it had worked (§15 run `35790886083` (7): six
// attempts on one project, six `PGRST205` errors, the project still present).
//
// Now it authorizes nothing and deletes nothing by hand. It calls
// `public.delete_project` (`20260922000002`), which does the whole deletion in ONE
// transaction — all of it or none of it — names the actor on every audit row, and
// decides who may delete. This function waits for the answer and relays it, so a
// refusal or a failure reaches the person who clicked instead of a server log.
//
// It stays an edge function rather than a browser RPC for one reason: the browser
// calls as `anon`, whose statement timeout is seconds, and the largest project in
// production holds thousands of rows behind statement-level triggers. The service
// role has the headroom; the decision is still the database's.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// SQLSTATE → HTTP, so the page can tell "not allowed" from "not there" from "broken".
function statusFor(code: string | undefined): number {
  if (code === '42501') return 403;   // insufficient_privilege
  if (code === 'P0002') return 404;   // no_data_found
  if (code === '22004') return 400;   // null_value_not_allowed
  return 500;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, userId, userEmail } = await req.json();
    if (!projectId || !userId) {
      return json({ success: false, error: 'Missing projectId or userId.' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    console.log('[delete-project] start', { projectId, userId });
    const { error } = await admin.rpc('delete_project', {
      p_project_id: projectId,
      p_user_id: userId,
      p_user_email: userEmail ?? '',
    });

    if (error) {
      console.error('[delete-project] refused or failed; nothing was deleted', error);
      return json({ success: false, error: error.message, code: error.code }, statusFor(error.code));
    }

    console.log('[delete-project] deleted', { projectId });
    return json({ success: true, message: 'Project deleted.' }, 200);
  } catch (e) {
    console.error('[delete-project] handler error', e);
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
