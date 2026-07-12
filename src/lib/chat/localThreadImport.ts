// Pure helpers for the one-time localStorage → chat-store migration
// (ai-agents.md §14.7 M0). Deliberately dependency-free: the Deno eval tier
// imports this file directly to pin TS↔SQL parity (quick-thread id derivation,
// import payload shape) without a bundler.

export interface LocalChatMessageLike {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: unknown[];
  toolCalls?: unknown[];
  createdAt: number;
}

export interface LocalThreadLike {
  id: string;
  projectId: string | null;
  agentId?: string | null;
  title: string;
  updatedAt: number;
  messages: LocalChatMessageLike[];
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string | null | undefined): boolean {
  return typeof s === "string" && UUID_RE.test(s);
}

/**
 * Deterministic server id for the permanent "Quick chat" thread — MUST match
 * public.chat_quick_thread_id(p_user_id) exactly:
 *   encode(substring(digest('suresuite.quick.'||uid,'sha256') from 1 for 16),'hex')::uuid
 * (sha256 of 'suresuite.quick.<uuid>', first 16 bytes, formatted 8-4-4-4-12).
 */
export async function quickThreadServerId(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`suresuite.quick.${userId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Serialize local threads into the import_local_threads(p_threads) payload.
 * The RPC is idempotent by (mapped) thread id; free-text and typed parts ride
 * along verbatim so the import is content-lossless.
 */
export function serializeThreadsForImport(threads: LocalThreadLike[]): unknown[] {
  return threads
    .filter((t) => t && typeof t.id === "string" && t.id.length > 0)
    .map((t) => ({
      id: t.id,
      projectId: t.projectId ?? null,
      agentId: t.agentId ?? null,
      title: t.title ?? "",
      updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : null,
      messages: (Array.isArray(t.messages) ? t.messages : [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          parts: Array.isArray(m.parts) ? m.parts : [],
          toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls : [],
          createdAt: Number.isFinite(m.createdAt) ? m.createdAt : null,
        })),
    }));
}
