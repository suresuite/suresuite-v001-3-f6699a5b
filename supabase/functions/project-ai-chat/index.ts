// project-ai-chat — the single conversational surface (Layer A) plus the
// Stage 0 agent plumbing (ai-agents.md §9.1): telemetry, router seam,
// server-side capability re-check. The legacy non-tools mode (anonymized
// abstract chat) is REMOVED — every request must send mode:"tools".
// With AGENT_TELEMETRY_ENABLED / AGENT_ROUTER_ENABLED / CHAT_STORE_ENABLED
// unset, behavior is byte-identical to pre-Stage-0 Layer A (pinned by
// eval/golden_transcript_test.ts).

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { runChat, resolveModel, type ChatRunResult, type ChatTurn } from "./providers.ts";
import { makeToolContext, type ToolContext } from "./tools.ts";
import { canonicalJson, makeTelemetry, sha256Hex, telemetryEnabled } from "./telemetry.ts";
import {
  decideRoute,
  deploymentEnabledAgents,
  makeClassifier,
  OFFER_CHIP_TEXT,
  resolveRoutedUtterance,
} from "./router.ts";
// Importing agentTurn.ts registers the Stage 1 draft tools (draftTools.ts)
// into the shared executeTool registry (ai-agents.md §9.2).
import { buildWrapupMessage, mixedHandoffNote, runDataStewardTurn } from "./agentTurn.ts";
import {
  loadThreadSummary,
  refreshThreadSummary,
  shouldRefreshSummary,
  summariesEnabled,
} from "./summaries.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Client model id → ai_models.code, mirroring src/lib/capabilities.ts
// CHAT_MODEL_CODES (the server-side re-check speaks the DB vocabulary).
const CHAT_MODEL_CODES: Record<string, string> = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gpt-5': 'openai/gpt-5',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'deepseek-chat': 'deepseek/deepseek-chat',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse the request body up-front so any parse/validation failure can return a
  // structured 200 (supabase-js `invoke` discards the body of non-2xx responses,
  // which would collapse the real reason into the generic "Edge Function returned
  // a non-2xx status code" string).
  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: 'Invalid JSON body.', type: 'BAD_REQUEST' });
  }
  const { projectId, message, conversationHistory, userId, userEmail, mode, model, agentId, threadId } = body;

  if (!message || !userId || !userEmail) {
    return jsonResponse({
      error: 'Missing required parameters: message, userId, userEmail',
      type: 'BAD_REQUEST',
    });
  }

  // Stage 0 removes the legacy non-tools mode (ai-agents.md §2.5, §9.1): the
  // anonymized-abstract chat path is gone; tools mode is the only mode.
  if (mode !== 'tools') {
    return jsonResponse({
      error: 'This endpoint only supports mode:"tools" — the legacy chat mode has been removed.',
      type: 'BAD_REQUEST',
    });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Service-role client for internal tables (usage logs, telemetry, chat store).
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // --- AI usage logging helper (fire-and-forget; never throws) ---
    async function logAiUsage(input: {
      status: 'success' | 'error' | 'blocked';
      modelCode?: string;
      providerCode?: string;
      promptChars?: number;
      completionChars?: number;
      latencyMs?: number;
      errorCode?: string;
    }) {
      try {
        // Rough token estimate: ~4 chars per token. Real usage figures come with
        // Phase 2 (provider response parsing).
        const promptTokens = Math.ceil((input.promptChars ?? 0) / 4);
        const completionTokens = Math.ceil((input.completionChars ?? 0) / 4);
        const totalTokens = promptTokens + completionTokens;

        // Look up model + cost + user org
        let modelId: string | null = null;
        let inputCost = 0;
        let outputCost = 0;
        if (input.modelCode) {
          const { data: m } = await supabaseAdmin
            .from('ai_models')
            .select('id,input_cost_per_1k,output_cost_per_1k')
            .eq('code', input.modelCode)
            .maybeSingle();
          if (m) {
            modelId = (m as any).id;
            inputCost = Number((m as any).input_cost_per_1k) || 0;
            outputCost = Number((m as any).output_cost_per_1k) || 0;
          }
        }
        const costUsd =
          (promptTokens / 1000) * inputCost + (completionTokens / 1000) * outputCost;

        let orgId: string | null = null;
        if (userId) {
          const { data: u } = await supabaseAdmin
            .from('approved_users')
            .select('organization_id')
            .eq('id', userId)
            .maybeSingle();
          orgId = (u as any)?.organization_id ?? null;
        }

        await supabaseAdmin.from('ai_usage_logs').insert({
          user_id: userId ?? null,
          org_id: orgId,
          project_id: projectId ?? null,
          model_id: modelId,
          model_code: input.modelCode ?? null,
          provider_code: input.providerCode ?? null,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
          latency_ms: input.latencyMs ?? null,
          status: input.status,
          error_code: input.errorCode ?? null,
        });
      } catch (e) {
        console.warn('[usage-log] failed:', e);
      }
    }

    // Authorize when a project is attached; general chats skip project scoping.
    if (projectId) {
      const { error: accessErr } = await supabaseClient.rpc('get_project_dataset_counts', {
        p_project_id: projectId,
        p_user_id: userId,
        p_user_email: userEmail,
      });
      if (accessErr) {
        const m = (accessErr.message || '').toLowerCase();
        if (m.includes('forbidden') || m.includes('project_not_found')) {
          return jsonResponse({ error: "You don't have access to this project.", type: 'FORBIDDEN' });
        }
        console.error('access check error:', accessErr);
        return jsonResponse({ error: `Access check failed: ${accessErr.message}`, type: 'AI_ERROR' });
      }
    }

    // --- Server-side capability re-check (Stage 0, ai-agents.md §9.1 / §8 T5).
    // Mirrors the client gates in src/lib/capabilities.ts word for word. The
    // posture also mirrors the client fallback: a transient resolver failure
    // never wrongly blocks a legitimate call (fail open, log, proceed).
    const resolvedModel = resolveModel(model);
    let capFeatures: Record<string, boolean> = {};
    try {
      const { data: caps, error: capsErr } = await supabaseAdmin.rpc('get_my_capabilities', {
        _user_id: userId,
      });
      if (!capsErr && caps && typeof caps === 'object') {
        const c = caps as Record<string, any>;
        capFeatures = (c.features as Record<string, boolean>) ?? {};
        const isSuper = Boolean(c.is_super_admin);
        if (!isSuper) {
          if (c.features && c.features.ai_chat !== true) {
            return jsonResponse({
              error: "The AI assistant isn't enabled for your account. Contact an administrator.",
              type: 'FORBIDDEN',
            });
          }
          const models = c.models ?? {};
          const allowedCodes: string[] = Array.isArray(models.allowed_codes) ? models.allowed_codes : [];
          const code = CHAT_MODEL_CODES[resolvedModel.id] ?? resolvedModel.id;
          if (!models.all_allowed && !allowedCodes.includes(code)) {
            return jsonResponse({
              error: "This model isn't enabled for your account. Ask an administrator to grant access, or pick an allowed model.",
              type: 'FORBIDDEN',
            });
          }
          const b = c.budgets ?? {};
          const num = (v: unknown): number | null => (v == null ? null : Number(v));
          const monthly = num(b.monthly_usd), daily = num(b.daily_usd), rpd = num(b.rpd);
          const mtdCost = Number(b.mtd_cost_usd ?? 0), todayCost = Number(b.today_cost_usd ?? 0);
          const todayReqs = Number(b.today_requests ?? 0);
          if (monthly != null && mtdCost >= monthly) {
            return jsonResponse({
              error: `Monthly AI budget reached ($${mtdCost.toFixed(2)} of $${monthly.toFixed(2)}). Contact an administrator to raise it.`,
              type: 'BUDGET_EXCEEDED',
            });
          }
          if (daily != null && todayCost >= daily) {
            return jsonResponse({
              error: `Daily AI budget reached ($${todayCost.toFixed(2)} of $${daily.toFixed(2)}). Try again tomorrow or ask an administrator.`,
              type: 'BUDGET_EXCEEDED',
            });
          }
          if (rpd != null && todayReqs >= rpd) {
            return jsonResponse({
              error: `Daily request limit reached (${todayReqs} of ${rpd}). Try again tomorrow or ask an administrator.`,
              type: 'BUDGET_EXCEEDED',
            });
          }
        }
      } else if (capsErr) {
        console.warn('[capability-recheck] resolver failed, proceeding:', capsErr.message);
      }
    } catch (e) {
      console.warn('[capability-recheck] failed, proceeding:', e instanceof Error ? e.message : e);
    }

    const history = Array.isArray(conversationHistory)
      ? (conversationHistory as ChatTurn[]).filter(
          (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
      : [];
    const ctx = projectId ? makeToolContext(projectId, userId) : null;
    const promptText = String(message).slice(0, 4000);

    // --- Telemetry (ai-agents.md §7; AGENT_TELEMETRY_ENABLED, default off) ---
    const requestId = crypto.randomUUID();
    let orgId: string | null = null;
    if (telemetryEnabled()) {
      try {
        const { data: u } = await supabaseAdmin
          .from('approved_users').select('organization_id').eq('id', userId).maybeSingle();
        orgId = (u as any)?.organization_id ?? null;
      } catch { /* attribution only */ }
    }
    const telemetryBase = {
      user_id: userId ?? null,
      org_id: orgId,
      project_id: projectId ?? null,
      thread_id: typeof threadId === 'string' ? threadId : null,
      request_id: requestId,
      persona_id: agentId ?? null,
      model_code: resolvedModel.id,
      provider_code: resolvedModel.provider,
    };
    const telemetry = makeTelemetry(supabaseAdmin, telemetryBase);
    telemetry.emit('chat.request', {
      prompt_chars: promptText.length,
      history_len: history.length,
      has_project: Boolean(projectId),
    });

    // --- Router (ai-agents.md §6; AGENT_ROUTER_ENABLED=false ⇒ pure
    // passthrough, no LLM call). Effective agent set is computed server-side
    // (§13.2): deployment kill switch ∩ capability grants. Stage 1 wires the
    // live structured-output classifier; a bare "do it" follow-up re-routes
    // the prior utterance (§6.2 step 3).
    const enabledAgents = deploymentEnabledAgents().filter(
      (slug) => capFeatures['agent_' + slug.replace(/-/g, '_')] === true,
    );
    const routedUtterance = resolveRoutedUtterance(promptText, history);
    const routeDecision = await decideRoute(routedUtterance, {
      personaId: agentId ?? null,
      hasProject: Boolean(projectId),
      enabledAgents,
      modelId: resolvedModel.id,
    }, makeClassifier(resolvedModel));
    telemetry.emit('router.decision', {
      route: routeDecision.route,
      agent_id: routeDecision.agent_id,
      intent: routeDecision.intent,
      confidence: routeDecision.confidence,
      short_circuit: routeDecision.short_circuit,
    });

    // --- M1 rolling summary (§14.3, CHAT_SUMMARY_ENABLED default off):
    // persona turns receive the thread summary; agent turns never do.
    let threadSummary: string | null = null;
    let summaryUptoSeq = 0;
    const summariesOn = summariesEnabled();
    if (summariesOn && typeof threadId === 'string' && uuidRe.test(threadId)) {
      const s = await loadThreadSummary(supabaseAdmin, threadId, userId);
      if (s) {
        threadSummary = s.summary;
        summaryUptoSeq = s.summaryUptoSeq;
      }
    }

    const _t0 = Date.now();
    try {
      // §3.3 orchestration: agent turn → persona wrap-up → proposal part
      // attached mechanically. Per-request turn budget (§8 T5): ≤ 1 router
      // call + ≤ 1 agent turn + ≤ 1 persona turn.
      let result: ChatRunResult;
      let telemetryToolCalls: ChatRunResult['toolCalls'] = [];
      let proposalId: string | null = null;

      const stewardRouted =
        (routeDecision.route === 'artifact' || routeDecision.route === 'mixed') &&
        routeDecision.agent_id === 'data-steward' && ctx !== null;

      if (stewardRouted) {
        const agentUtterance = routeDecision.artifact_part ?? routedUtterance;
        const agentCtx: ToolContext = {
          ...(ctx as ToolContext),
          draft: {
            userEmail: userEmail ?? null,
            threadId: typeof threadId === 'string' ? threadId : null,
            modelCode: resolvedModel.id,
            providerCode: resolvedModel.provider,
            canProposals: capFeatures['agent_proposals'] === true,
            utterance: agentUtterance,
          },
        };
        const agentT0 = Date.now();
        const agent = await runDataStewardTurn({ modelId: model, utterance: agentUtterance, ctx: agentCtx });
        logAiUsage({
          status: agent.ok ? 'success' : 'error',
          modelCode: model,
          promptChars: agentUtterance.length,
          completionChars: agent.reply.length,
          latencyMs: Date.now() - agentT0,
          errorCode: agent.ok ? undefined : (agent.error ?? 'agent_turn_failed').slice(0, 200),
        });

        const agentTelemetry = makeTelemetry(supabaseAdmin, { ...telemetryBase, agent_id: 'data-steward' });
        for (const call of agent.toolCalls) {
          sha256Hex(canonicalJson(call.args ?? {})).then((argsSha) =>
            agentTelemetry.emit('tool.call', {
              tool: call.name,
              args_sha256: argsSha,
              ok: call.ok,
              row_count: call.row_count,
            })
          ).catch(() => { /* never blocks the reply */ });
        }
        const part = agent.proposalPart;
        if (part) {
          proposalId = part.data.proposal_id;
          if (!part.data.duplicate) {
            agentTelemetry.emit('proposal.created', {
              artifact_type: part.data.artifact_type,
              provenance: part.data.provenance,
            }, { proposal_id: proposalId });
          }
        }

        if (routeDecision.route === 'mixed' && routeDecision.advisory_part) {
          // §6.2 step 5: the persona answers the advisory part in a normal
          // Layer A turn; the handoff note + card join the same reply. The
          // advisory answer survives an agent failure.
          const persona = await runChat(
            model, routeDecision.advisory_part.slice(0, 4000), history, ctx, agentId,
            { summary: threadSummary },
          );
          telemetryToolCalls = persona.toolCalls ?? [];
          result = {
            ...persona,
            reply: `${persona.reply}\n\n${mixedHandoffNote(agent)}`.trim(),
            parts: [...(persona.parts ?? []), ...(part ? [part] : [])],
            toolCalls: [...(persona.toolCalls ?? []), ...agent.toolCalls],
          };
        } else if (agent.ok) {
          // §6.4: persona wrap-up turn — voice only (no tools), fed the
          // agent's report; the proposal part is attached mechanically.
          let wrapReply = '';
          try {
            const wrap = await runChat(
              model,
              buildWrapupMessage({ utterance: agentUtterance, agentReply: agent.reply, proposal: part?.data ?? null }),
              history, null, agentId, { summary: threadSummary },
            );
            wrapReply = wrap.reply ?? '';
          } catch (e) {
            console.warn('persona wrap-up failed, falling back to the agent report:',
              e instanceof Error ? e.message : e);
          }
          result = {
            reply: wrapReply || agent.reply ||
              'I drafted a proposal for this — review the card below and approve it before it applies.',
            parts: part ? [part] : [],
            toolCalls: agent.toolCalls,
            model: resolvedModel.label,
          };
        } else {
          // Agent turn failed outright: the advisory answer still returns,
          // with one sentence noting the draft failed and why (§6.2 step 5).
          const persona = await runChat(model, promptText, history, ctx, agentId, { summary: threadSummary });
          telemetryToolCalls = persona.toolCalls ?? [];
          result = {
            ...persona,
            reply: `${persona.reply}\n\nI tried to draft this for you but the drafting step failed` +
              `${agent.error ? ` (${agent.error})` : ''}. You can ask again or make the change manually.`,
          };
        }
      } else {
        result = await runChat(model, promptText, history, ctx, agentId, { summary: threadSummary });
        telemetryToolCalls = result.toolCalls ?? [];
        if (routeDecision.short_circuit === 'low_confidence') {
          // §6.2 step 3: below-threshold artifact asks stay advisory with one
          // plain-text offer chip.
          result = { ...result, reply: `${result.reply}\n\n${OFFER_CHIP_TEXT}` };
        }
      }

      const latencyMs = Date.now() - _t0;
      logAiUsage({
        status: 'success',
        modelCode: model,
        promptChars: promptText.length,
        completionChars: (result?.reply ?? '').length,
        latencyMs,
      });
      for (const call of telemetryToolCalls) {
        sha256Hex(canonicalJson(call.args ?? {})).then((argsSha) =>
          telemetry.emit('tool.call', {
            tool: call.name,
            args_sha256: argsSha,
            ok: call.ok,
            row_count: call.row_count,
          })
        ).catch(() => { /* never blocks the reply */ });
      }
      telemetry.emit('chat.reply', {
        reply_chars: (result?.reply ?? '').length,
        parts_kinds: (result.parts ?? []).map((p) => p.kind),
        blocked: Boolean(result.blocked),
      }, { latency_ms: latencyMs });

      // --- Chat store (workstream M0, CHAT_STORE_ENABLED default off): the
      // server appends the assistant message so history survives client
      // crashes (§14.7). The client owns the user-message append.
      let persisted = false;
      const storeEnabled = (Deno.env.get('CHAT_STORE_ENABLED') ?? '').trim().toLowerCase() === 'true';
      if (storeEnabled && typeof threadId === 'string' && uuidRe.test(threadId)) {
        try {
          const { data: seqData, error: appendErr } = await supabaseAdmin.rpc('append_chat_message', {
            p_user_id: userId,
            p_thread_id: threadId,
            p_role: 'assistant',
            p_content: result.reply ?? '',
            p_parts: result.parts ?? [],
            p_tool_calls: result.toolCalls ?? [],
            p_proposal_id: proposalId,
            p_model_code: resolvedModel.id,
          });
          persisted = !appendErr;
          if (appendErr) console.warn('[chat-store] append failed:', appendErr.message);

          // §14.3 trigger: after an assistant reply, if 24+ messages have
          // accumulated past the summarized prefix, queue a refresh
          // (fire-and-forget, same posture as logAiUsage).
          const maxSeq = Number(seqData ?? 0) || 0;
          if (persisted && summariesOn && shouldRefreshSummary(maxSeq, summaryUptoSeq)) {
            const refresh = refreshThreadSummary(supabaseAdmin, {
              threadId,
              userId,
              model: resolvedModel,
            });
            // deno-lint-ignore no-explicit-any
            const rt = (globalThis as any).EdgeRuntime;
            if (rt?.waitUntil) rt.waitUntil(refresh);
            else refresh.catch(() => { /* logged inside */ });
          }
        } catch (e) {
          console.warn('[chat-store] append failed:', e instanceof Error ? e.message : e);
        }
      }

      return jsonResponse(persisted ? { ...result, persisted: true } : result as unknown as Record<string, unknown>);
    } catch (innerErr) {
      logAiUsage({
        status: 'error',
        modelCode: model,
        promptChars: promptText.length,
        latencyMs: Date.now() - _t0,
        errorCode: innerErr instanceof Error ? innerErr.message.slice(0, 200) : 'unknown',
      });
      throw innerErr;
    }
  } catch (err) {
    console.error('project-ai-chat error:', err, 'model=', model);
    const msg = err instanceof Error ? err.message : 'AI request failed.';
    const isConfig = /not configured/i.test(msg);
    return jsonResponse({
      error: msg,
      type: isConfig ? 'SERVICE_UNAVAILABLE' : 'AI_ERROR',
    });
  }
});
