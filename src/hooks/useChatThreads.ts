import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/hooks/useProjectChat";

/**
 * Global chat thread store backed by localStorage.
 *
 * Storage layout (v2):
 *  - `projectChat.threads.v2`      -> Thread[]
 *  - `projectChat.activeThread.v2` -> string (thread id)
 *
 * Threads carry an optional `projectId` (null = unattached / general chat)
 * and an optional `agentId` (which persona seeded the thread).
 * Legacy per-project keys `projectChat.threads.<projectId>` are migrated
 * into the global store on first read.
 */

export const QUICK_THREAD_ID = "quick";

const KEY_THREADS = "projectChat.threads.v2";
const KEY_ACTIVE = "projectChat.activeThread.v2";
const KEY_MIGRATED = "projectChat.migrated.v2";

export interface Thread {
  id: string;
  projectId: string | null;
  agentId?: string | null;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
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

export function useChatThreads() {
  const [threads, setThreads] = useState<Thread[]>(() => sortThreads(ensureQuickThread(migrateLegacy())));
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(() => readActive());

  // Cross-tab sync.
  useEffect(() => {
    if (!canUseStorage()) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_THREADS) setThreads(sortThreads(ensureQuickThread(readAll())));
      else if (e.key === KEY_ACTIVE) setActiveThreadIdState(readActive());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((updater: (prev: Thread[]) => Thread[]) => {
    setThreads((prev) => {
      const next = sortThreads(updater(prev));
      writeAll(next);
      return next;
    });
  }, []);

  const setActiveThread = useCallback((id: string | null) => {
    setActiveThreadIdState(id);
    writeActive(id);
  }, []);

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
      persist((prev) => [thread, ...prev]);
      setActiveThread(id);
      return id;
    },
    [persist, setActiveThread],
  );

  const deleteThread = useCallback(
    (id: string) => {
      if (id === QUICK_THREAD_ID) return;
      persist((prev) => prev.filter((t) => t.id !== id));
      setActiveThreadIdState((cur) => {
        if (cur !== id) return cur;
        writeActive(null);
        return null;
      });
    },
    [persist],
  );

  const updateThread = useCallback(
    (id: string, patch: Partial<Pick<Thread, "title" | "projectId" | "agentId">>) => {
      persist((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)));
    },
    [persist],
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
    });
  }, [persist]);

  const clearThread = useCallback((id: string) => setThreadMessages(id, []), [setThreadMessages]);

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
  };
}
