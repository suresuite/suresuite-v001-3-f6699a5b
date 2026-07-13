import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/useProjectChat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
import {
  isUuid,
  quickThreadServerId,
  serializeThreadsForImport,
} from "@/lib/chat/localThreadImport";

/**
 * Global chat thread store (workstream M0, ai-agents.md §14.1/§14.7).
 *
 * Source of truth depends on the `chat_history_sync` capability:
 *  - OFF (default): localStorage-only, byte-identical to the pre-M0 behavior.
 *  - ON: the server chat store (chat_folders/chat_threads/chat_messages via
 *    SECURITY DEFINER RPCs) is the source of truth; localStorage is demoted to
 *    a cache. Writes are optimistic: local state first, RPC in the background.
 *    A one-time idempotent import (`import_local_threads`) migrates existing
 *    local threads on first sync; the permanent Quick thread maps to the
 *    deterministic per-user id from chat_quick_thread_id.
 *
 * Storage layout (unchanged, now cache when sync is on):
 *  - `projectChat.threads.v2`      -> Thread[]
 *  - `projectChat.activeThread.v2` -> string (thread id)
 */

export const QUICK_THREAD_ID = "quick";

const KEY_THREADS = "projectChat.threads.v2";
const KEY_ACTIVE = "projectChat.activeThread.v2";
const KEY_MIGRATED = "projectChat.migrated.v2";
const KEY_SERVER_IMPORT = "projectChat.serverImport.v1"; // + `.${userId}`
const EVT_THREADS = "projectChat:threadsUpdated";

export interface Thread {
  id: string;
  projectId: string | null;
  agentId?: string | null;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  // M0 organizing fields (§14.2) — absent in sync-off threads.
  pinned?: boolean;
  archived?: boolean;
  folderId?: string | null;
  // M1 rolling summary (§14.3) — server-maintained; user-deletable via
  // clearThreadSummary ("What the assistant remembers about this conversation").
  summary?: string | null;
  // §15 interaction mode — 'review' when absent (the DEFAULT; 'auto' does not
  // exist, §10 Q23). Server-enforced; this field is the client's view of it.
  mode?: "ask" | "review";
}

export interface ChatFolder {
  id: string;
  name: string;
  position: number;
}

export interface ChatSearchHit {
  threadId: string;
  threadTitle: string;
  projectId: string | null;
  messageId: string;
  seq: number;
  role: string;
  snippet: string;
  createdAt: string;
}

const canUseStorage = () => typeof window !== "undefined";

function readAll(): Thread[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY_THREADS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Thread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: Thread[]) {
  if (!canUseStorage()) return;
  try { window.localStorage.setItem(KEY_THREADS, JSON.stringify(list)); } catch { /* ignore */ }
}

function readActive(): string | null {
  if (!canUseStorage()) return null;
  try { return window.localStorage.getItem(KEY_ACTIVE); } catch { return null; }
}

function writeActive(id: string | null) {
  if (!canUseStorage()) return;
  try {
    if (id) window.localStorage.setItem(KEY_ACTIVE, id);
    else window.localStorage.removeItem(KEY_ACTIVE);
  } catch { /* ignore */ }
}

function migrateLegacy(): Thread[] {
  if (!canUseStorage()) return [];
  if (window.localStorage.getItem(KEY_MIGRATED) === "1") return readAll();
  const merged: Thread[] = readAll();
  const seen = new Set(merged.map((t) => t.id));
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("projectChat.threads.")) continue;
      if (key === KEY_THREADS) continue;
      const projectId = key.substring("projectChat.threads.".length);
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw) as Thread[];
        if (!Array.isArray(arr)) continue;
        for (const t of arr) {
          if (!t?.id || seen.has(t.id)) continue;
          merged.push({ ...t, projectId: t.projectId ?? projectId });
          seen.add(t.id);
        }
      } catch { /* ignore malformed */ }
    }
  } catch { /* ignore */ }
  writeAll(merged);
  try { window.localStorage.setItem(KEY_MIGRATED, "1"); } catch { /* ignore */ }
  return merged;
}

function ensureQuickThread(list: Thread[]): Thread[] {
  if (list.some((t) => t.id === QUICK_THREAD_ID)) return list;
  const quick: Thread = {
    id: QUICK_THREAD_ID,
    projectId: null,
    title: "Quick chat",
    updatedAt: 0,
    messages: [],
  };
  return [quick, ...list];
}

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 12);
};

function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}

function sortThreads(list: Thread[]): Thread[] {
  return [...list].sort((a, b) => {
    if (a.id === QUICK_THREAD_ID) return -1;
    if (b.id === QUICK_THREAD_ID) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

// ── server-store adapters (sync on) ──────────────────────────────────────────

// The chat-store tables/RPCs postdate the generated DB types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

interface ServerThreadRow {
  id: string;
  folder_id: string | null;
  project_id: string | null;
  persona_id: string | null;
  title: string;
  pinned: boolean;
  archived: boolean;
  summary: string | null;
  last_message_at: string | null;
  created_at: string;
  /** §15 — absent on databases without the 20260721000001 migration. */
  mode?: "ask" | "review" | null;
}

interface ServerMessageRow {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  parts: unknown[];
  tool_calls: unknown[];
  model_code: string | null;
  created_at: string;
}

function serverRowToThread(row: ServerThreadRow, quickServerId: string, cached?: Thread): Thread {
  const isQuick = row.id === quickServerId;
  return {
    id: isQuick ? QUICK_THREAD_ID : row.id,
    projectId: row.project_id,
    agentId: row.persona_id,
    title: isQuick ? "Quick chat" : row.title,
    updatedAt: row.last_message_at
      ? Date.parse(row.last_message_at)
      : (isQuick ? 0 : Date.parse(row.created_at) || 0),
    pinned: row.pinned,
    archived: row.archived,
    folderId: row.folder_id,
    summary: row.summary ?? null,
    mode: row.mode === "ask" ? "ask" : "review",
    messages: cached?.messages ?? [],
  };
}

function serverRowToMessage(row: ServerMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    parts: Array.isArray(row.parts) && row.parts.length > 0
      ? (row.parts as ChatMessage["parts"])
      : undefined,
    toolCalls: Array.isArray(row.tool_calls) && row.tool_calls.length > 0
      ? (row.tool_calls as ChatMessage["toolCalls"])
      : undefined,
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

// One bootstrap (import + first fetch) per user per tab, shared across hook
// instances so every mounted sidebar/composer doesn't re-import.
const bootstrapPromises = new Map<string, Promise<void>>();

function notifySameTab() {
  if (canUseStorage()) window.dispatchEvent(new Event(EVT_THREADS));
}

export function useChatThreads() {
  const { user } = useAuth();
  const { canFeature } = useCapabilities();
  const syncEnabled = Boolean(user?.id) && canFeature("chat_history_sync");

  const [threads, setThreads] = useState<Thread[]>(() => sortThreads(ensureQuickThread(migrateLegacy())));
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(() => readActive());
  const quickIdRef = useRef<string | null>(null);
  const loadedMessagesRef = useRef<Set<string>>(new Set());

  // Cross-tab sync (storage events) + same-tab sync (custom event, sync mode).
  useEffect(() => {
    if (!canUseStorage()) return;
    const reload = () => setThreads(sortThreads(ensureQuickThread(readAll())));
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_THREADS) reload();
      else if (e.key === KEY_ACTIVE) setActiveThreadIdState(readActive());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVT_THREADS, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVT_THREADS, reload);
    };
  }, []);

  const persist = useCallback((updater: (prev: Thread[]) => Thread[], notify = false) => {
    setThreads((prev) => {
      const next = sortThreads(updater(prev));
      writeAll(next);
      if (notify) notifySameTab();
      return next;
    });
  }, []);

  const serverThreadIdFor = useCallback((id: string): string | null => {
    if (!syncEnabled) return null;
    if (id === QUICK_THREAD_ID) return quickIdRef.current;
    return isUuid(id) ? id : null;
  }, [syncEnabled]);

  const refreshFolders = useCallback(async () => {
    if (!syncEnabled || !user?.id) return;
    const { data, error } = await rpc("list_chat_folders", { p_user_id: user.id });
    if (!error && Array.isArray(data)) {
      setFolders(data.map((f: { id: string; name: string; position: number }) => ({
        id: f.id, name: f.name, position: f.position,
      })));
    }
  }, [syncEnabled, user?.id]);

  const refreshThreads = useCallback(async () => {
    if (!syncEnabled || !user?.id || !quickIdRef.current) return;
    const quickServerId = quickIdRef.current;
    const { data, error } = await rpc("list_chat_threads", { p_user_id: user.id });
    if (error || !Array.isArray(data)) return;
    persist((prev) => {
      const byId = new Map(prev.map((t) => [t.id, t]));
      const serverThreads = (data as ServerThreadRow[]).map((row) => {
        const localId = row.id === quickServerId ? QUICK_THREAD_ID : row.id;
        return serverRowToThread(row, quickServerId, byId.get(localId));
      });
      const serverIds = new Set(serverThreads.map((t) => t.id));
      // Threads only known locally (e.g. created while the RPC was down) stay.
      const localOnly = prev.filter((t) => !serverIds.has(t.id));
      return ensureQuickThread([...serverThreads, ...localOnly]);
    }, true);
  }, [syncEnabled, user?.id, persist]);

  const loadMessages = useCallback(async (threadId: string) => {
    if (!syncEnabled || !user?.id) return;
    const serverId = serverThreadIdFor(threadId);
    if (!serverId || loadedMessagesRef.current.has(threadId)) return;
    loadedMessagesRef.current.add(threadId);
    const { data, error } = await rpc("list_chat_messages", { p_thread_id: serverId, p_user_id: user.id });
    if (error || !Array.isArray(data)) {
      loadedMessagesRef.current.delete(threadId);
      return;
    }
    const messages = (data as ServerMessageRow[]).map(serverRowToMessage);
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, messages } : t)), true);
  }, [syncEnabled, user?.id, serverThreadIdFor, persist]);

  // Bootstrap the server store: one-time idempotent localStorage import, then
  // hydrate threads/folders from the server (localStorage becomes a cache).
  useEffect(() => {
    if (!syncEnabled || !user?.id) return;
    const userId = user.id;
    let cancelled = false;

    const run = async () => {
      const quickServerId = await quickThreadServerId(userId);
      if (cancelled) return;
      quickIdRef.current = quickServerId;

      const importFlag = `${KEY_SERVER_IMPORT}.${userId}`;
      const alreadyImported = canUseStorage() && window.localStorage.getItem(importFlag) === "done";
      if (!alreadyImported) {
        const local = readAll();
        const payload = serializeThreadsForImport(local.filter((t) => t.messages.length > 0 || t.id !== QUICK_THREAD_ID));
        const { data, error } = await rpc("import_local_threads", { p_user_id: userId, p_threads: payload });
        if (!error) {
          try { window.localStorage.setItem(importFlag, "done"); } catch { /* ignore */ }
          // Re-key legacy (non-uuid) local ids to their server ids so the
          // cache and the store speak one id language from here on.
          const mappings: Array<{ local_id: string; server_id: string }> = (data?.mappings ?? []) as Array<{ local_id: string; server_id: string }>;
          const rekey = new Map(mappings
            .filter((m) => m.local_id !== QUICK_THREAD_ID && m.local_id !== m.server_id)
            .map((m) => [m.local_id, m.server_id]));
          if (rekey.size > 0) {
            persist((prev) => prev.map((t) => (rekey.has(t.id) ? { ...t, id: rekey.get(t.id)! } : t)));
          }
        } else {
          console.warn("[chat-store] import failed (will retry next mount):", error.message);
        }
      }

      // Make sure the permanent Quick thread exists server-side.
      const { data: threadRows } = await rpc("list_chat_threads", { p_user_id: userId });
      const hasQuick = Array.isArray(threadRows) && (threadRows as ServerThreadRow[]).some((r) => r.id === quickServerId);
      if (!hasQuick) {
        await rpc("upsert_chat_thread", { p_user_id: userId, p_id: quickServerId, p_title: "Quick chat" });
      }
    };

    let promise = bootstrapPromises.get(userId);
    if (!promise) {
      promise = run().catch((e) => {
        bootstrapPromises.delete(userId);
        console.warn("[chat-store] bootstrap failed:", e instanceof Error ? e.message : e);
      }) as Promise<void>;
      bootstrapPromises.set(userId, promise);
    } else {
      // Later instances still need the quick-thread id.
      quickThreadServerId(userId).then((id) => { if (!cancelled) quickIdRef.current = id; });
    }
    promise.then(() => {
      if (cancelled) return;
      refreshThreads();
      refreshFolders();
    });

    return () => { cancelled = true; };
  }, [syncEnabled, user?.id, persist, refreshThreads, refreshFolders]);

  // Lazily hydrate the active thread's messages from the store.
  useEffect(() => {
    if (activeThreadId) loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  const setActiveThread = useCallback((id: string | null) => {
    setActiveThreadIdState(id);
    writeActive(id);
    if (id) loadMessages(id);
  }, [loadMessages]);

  const newThread = useCallback(
    (opts?: { projectId?: string | null; agentId?: string | null }): string => {
      const id = newId();
      const thread: Thread = {
        id,
        projectId: opts?.projectId ?? null,
        agentId: opts?.agentId ?? null,
        title: "New chat",
        updatedAt: Date.now(),
        messages: [],
      };
      persist((prev) => [thread, ...prev], syncEnabled);
      setActiveThread(id);
      if (syncEnabled && user?.id && isUuid(id)) {
        loadedMessagesRef.current.add(id); // brand-new: nothing to fetch
        rpc("upsert_chat_thread", {
          p_user_id: user.id,
          p_id: id,
          p_title: "New chat",
          p_project_id: opts?.projectId ?? null,
          p_set_project: opts?.projectId != null,
          p_persona_id: opts?.agentId ?? null,
        }).then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] thread create failed:", error.message);
        });
      }
      return id;
    },
    [persist, setActiveThread, syncEnabled, user?.id],
  );

  const deleteThread = useCallback(
    (id: string) => {
      if (id === QUICK_THREAD_ID) return;
      persist((prev) => prev.filter((t) => t.id !== id), syncEnabled);
      setActiveThreadIdState((cur) => {
        if (cur !== id) return cur;
        writeActive(null);
        return null;
      });
      const serverId = serverThreadIdFor(id);
      if (serverId && user?.id) {
        rpc("delete_chat_thread", { p_thread_id: serverId, p_user_id: user.id })
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.warn("[chat-store] thread delete failed:", error.message);
          });
      }
    },
    [persist, syncEnabled, serverThreadIdFor, user?.id],
  );

  const updateThread = useCallback(
    (id: string, patch: Partial<Pick<Thread, "title" | "projectId" | "agentId">>) => {
      persist((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)), syncEnabled);
      const serverId = serverThreadIdFor(id);
      if (serverId && user?.id) {
        rpc("upsert_chat_thread", {
          p_user_id: user.id,
          p_id: serverId,
          p_title: patch.title ?? null,
          p_project_id: patch.projectId ?? null,
          p_set_project: "projectId" in patch,
          p_persona_id: patch.agentId ?? null,
        }).then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] thread update failed:", error.message);
        });
      }
    },
    [persist, syncEnabled, serverThreadIdFor, user?.id],
  );

  const setThreadMessages = useCallback((id: string, messages: ChatMessage[]) => {
    persist((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) {
        const seed: Thread = {
          id,
          projectId: null,
          title:
            id === QUICK_THREAD_ID
              ? "Quick chat"
              : titleFromMessage(messages.find((m) => m.role === "user")?.content ?? ""),
          updatedAt: Date.now(),
          messages,
        };
        return [seed, ...prev];
      }
      const existing = prev[idx];
      const firstUser = messages.find((m) => m.role === "user");
      const nextTitle =
        existing.title === "New chat" && firstUser ? titleFromMessage(firstUser.content) : existing.title;
      const next = [...prev];
      next[idx] = {
        ...existing,
        title: nextTitle,
        updatedAt: messages.length ? Date.now() : existing.updatedAt,
        messages,
      };
      return next;
    }, syncEnabled);
  }, [persist, syncEnabled]);

  const clearThread = useCallback((id: string) => {
    setThreadMessages(id, []);
    const serverId = serverThreadIdFor(id);
    if (serverId && user?.id) {
      const current = threads.find((t) => t.id === id);
      // No truncate RPC exists: hard-delete (cascades messages) and recreate
      // the same id so the thread row survives with an empty history.
      rpc("delete_chat_thread", { p_thread_id: serverId, p_user_id: user.id })
        .then(() => rpc("upsert_chat_thread", {
          p_user_id: user.id,
          p_id: serverId,
          p_title: id === QUICK_THREAD_ID ? "Quick chat" : current?.title ?? null,
          p_project_id: current?.projectId ?? null,
          p_set_project: true,
          p_persona_id: current?.agentId ?? null,
        }))
        .catch((e: unknown) => console.warn("[chat-store] clear failed:", e));
    }
  }, [setThreadMessages, serverThreadIdFor, user?.id, threads]);

  /** Persist one message to the server store (sync on; no-op otherwise). */
  const appendMessageToStore = useCallback(async (threadId: string, message: ChatMessage) => {
    const serverId = serverThreadIdFor(threadId);
    if (!serverId || !user?.id) return;
    loadedMessagesRef.current.add(threadId); // local copy is authoritative now
    const { error } = await rpc("append_chat_message", {
      p_user_id: user.id,
      p_thread_id: serverId,
      p_role: message.role,
      p_content: message.content,
      p_parts: message.parts ?? [],
      p_tool_calls: message.toolCalls ?? [],
      p_created_at: new Date(message.createdAt).toISOString(),
    });
    if (error) console.warn("[chat-store] message append failed:", error.message);
  }, [serverThreadIdFor, user?.id]);

  // ── folders / flags / search (§14.2) ────────────────────────────────────────

  const createFolder = useCallback(async (name: string) => {
    if (!syncEnabled || !user?.id) return;
    const { error } = await rpc("create_chat_folder", { p_user_id: user.id, p_name: name, p_position: folders.length });
    if (error) console.warn("[chat-store] folder create failed:", error.message);
    await refreshFolders();
  }, [syncEnabled, user?.id, folders.length, refreshFolders]);

  const deleteFolder = useCallback(async (folderId: string) => {
    if (!syncEnabled || !user?.id) return;
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    persist((prev) => prev.map((t) => (t.folderId === folderId ? { ...t, folderId: null } : t)), true);
    const { error } = await rpc("delete_chat_folder", { p_folder_id: folderId, p_user_id: user.id });
    if (error) console.warn("[chat-store] folder delete failed:", error.message);
  }, [syncEnabled, user?.id, persist]);

  const moveThreadToFolder = useCallback((threadId: string, folderId: string | null) => {
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, folderId } : t)), true);
    const serverId = serverThreadIdFor(threadId);
    if (serverId && user?.id) {
      rpc("move_chat_thread", { p_thread_id: serverId, p_folder_id: folderId, p_user_id: user.id })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] move failed:", error.message);
        });
    }
  }, [persist, serverThreadIdFor, user?.id]);

  const setPinned = useCallback((threadId: string, pinned: boolean) => {
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, pinned } : t)), true);
    const serverId = serverThreadIdFor(threadId);
    if (serverId && user?.id) {
      rpc("set_thread_flags", { p_thread_id: serverId, p_pinned: pinned, p_archived: null, p_user_id: user.id })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] pin failed:", error.message);
        });
    }
  }, [persist, serverThreadIdFor, user?.id]);

  const setArchived = useCallback((threadId: string, archived: boolean) => {
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, archived } : t)), true);
    const serverId = serverThreadIdFor(threadId);
    if (serverId && user?.id) {
      rpc("set_thread_flags", { p_thread_id: serverId, p_pinned: null, p_archived: archived, p_user_id: user.id })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] archive failed:", error.message);
        });
    }
  }, [persist, serverThreadIdFor, user?.id]);

  /** §15: flip a thread's interaction mode (Ask ↔ Review). Local state first,
   * then the server row (which is what the server actually enforces at
   * checkpoint 2) and the mode.changed telemetry event — both fire-and-forget
   * so a missing migration never blocks the switch UI. */
  const setThreadMode = useCallback((threadId: string, mode: "ask" | "review") => {
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, mode } : t)), true);
    const serverId = serverThreadIdFor(threadId);
    if (serverId && user?.id) {
      rpc("upsert_chat_thread", { p_user_id: user.id, p_id: serverId, p_mode: mode })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[chat-store] mode update failed:", error.message);
        });
    }
    if (user?.id) {
      const thread = threads.find((t) => t.id === threadId);
      rpc("record_chat_ui_event", {
        p_kind: "mode.changed",
        p_user_id: user.id,
        p_project_id: thread?.projectId ?? null,
        p_thread_id: serverId ?? threadId,
        p_payload: { mode },
      }).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("[chat-store] mode event failed:", error.message);
      });
    }
  }, [persist, serverThreadIdFor, user?.id, threads]);

  /** M1 (§14.3): delete the rolling summary — the user's right over what the
   * assistant remembers. Server clears summary and resets summary_upto_seq. */
  const clearThreadSummary = useCallback((threadId: string) => {
    persist((prev) => prev.map((t) => (t.id === threadId ? { ...t, summary: null } : t)), true);
    const serverId = serverThreadIdFor(threadId);
    if (serverId && user?.id) {
      rpc("set_thread_summary", {
        p_thread_id: serverId,
        p_user_id: user.id,
        p_summary: null,
        p_upto_seq: 0,
      }).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("[chat-store] summary delete failed:", error.message);
      });
    }
  }, [persist, serverThreadIdFor, user?.id]);

  /** Global FTS over the caller's own messages (§14.5); ≤ 50 hits. */
  const searchMessages = useCallback(async (query: string, projectId?: string | null): Promise<ChatSearchHit[]> => {
    if (!syncEnabled || !user?.id || !query.trim()) return [];
    const { data, error } = await rpc("search_chat_messages", {
      p_user_id: user.id,
      p_query: query.trim(),
      p_project_id: projectId ?? null,
    });
    if (error || !Array.isArray(data)) return [];
    const quickServerId = quickIdRef.current;
    return data.map((r: Record<string, unknown>) => ({
      threadId: r.thread_id === quickServerId ? QUICK_THREAD_ID : String(r.thread_id),
      threadTitle: String(r.thread_title ?? ""),
      projectId: (r.project_id as string) ?? null,
      messageId: String(r.message_id),
      seq: Number(r.seq),
      role: String(r.role),
      snippet: String(r.snippet ?? ""),
      createdAt: String(r.created_at ?? ""),
    }));
  }, [syncEnabled, user?.id]);

  const getServerThreadId = serverThreadIdFor;

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  return {
    threads,
    activeThread,
    activeThreadId,
    setActiveThread,
    newThread,
    deleteThread,
    updateThread,
    setThreadMessages,
    clearThread,
    // M0 server-store surface (all no-ops / empty when chat_history_sync off):
    syncEnabled,
    folders,
    createFolder,
    deleteFolder,
    moveThreadToFolder,
    setPinned,
    setArchived,
    searchMessages,
    getServerThreadId,
    appendMessageToStore,
    // M1 (§14.3): rolling-summary visibility + deletion.
    clearThreadSummary,
    // §15: per-thread interaction mode.
    setThreadMode,
  };
}
