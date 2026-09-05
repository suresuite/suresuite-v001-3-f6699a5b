// project-ai-health — provider-registry health (ai-agents.md §3.2 bridge 6).
// Iterates MODEL_REGISTRY and probes every configured provider's reachability
// instead of the old OpenAI-only check with a hardcoded model string.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MODEL_REGISTRY, type ProviderId } from "../project-ai-chat/providers.ts";
import { cleanEnv } from "../_shared/env.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROVIDER_PROBES: Record<ProviderId, { envKey: string; probe: (key: string) => Promise<boolean> }> = {
  gemini: {
    envKey: 'GEMINI_API_KEY',
    probe: (key) => probeOk(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`),
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    probe: (key) => probeOk('https://api.openai.com/v1/models', key),
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    probe: (key) => probeOk('https://api.deepseek.com/v1/models', key),
  },
};

async function probeOk(url: string, bearer?: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      signal: controller.signal,
    });
    return res.ok;
  } catch (e) {
    console.log('provider probe failed:', e instanceof Error ? e.message : e);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // One probe per distinct provider in the registry; per-provider model list
    // reported so the health payload stays in lock-step with MODEL_REGISTRY.
    const providerIds = [...new Set(Object.values(MODEL_REGISTRY).map((m) => m.provider))];
    const entries = await Promise.all(providerIds.map(async (provider) => {
      const { envKey, probe } = PROVIDER_PROBES[provider];
      const key = cleanEnv(envKey);
      const configured = Boolean(key);
      const reachable = configured ? await probe(key as string) : false;
      const models = Object.values(MODEL_REGISTRY)
        .filter((m) => m.provider === provider)
        .map((m) => ({ id: m.id, label: m.label, apiModel: m.apiModel }));
      return [provider, { configured, reachable, models }] as const;
    }));

    const providers = Object.fromEntries(entries);
    const healthy = entries.some(([, s]) => s.configured && s.reachable);

    return new Response(JSON.stringify({
      functionUp: true,
      healthy,
      providers,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Health check error:', error);
    return new Response(JSON.stringify({
      functionUp: false,
      healthy: false,
      providers: {},
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
