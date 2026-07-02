import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/hooks/useProjectChat";

/**
 * Per-project chat thread store backed by localStorage.
 *
 * Storage layout:
 *  - `projectChat.threads.<projectId>`      -> Thread[]
 *  - `projectChat.activeThread.<projectId>` -> string (thread id)
 *
 * The hook API is intentionally shaped so a future swap to Supabase-backed
 * storage is a drop-in replacement without touching component code.
 */

export const QUICK_THREAD_ID = "quick";

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const threadsKey = (projectId: string) => `projectChat.threads.${projectId}`;
const activeKey = (projectId: string) => `projectChat.activeThread.${projectId}`;

const canUseStorage = () => typeof window !== "undefined";

function readThreads(projectId: string): Thread[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(threadsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Thread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeThreads(projectId: string, threads: Thread[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(threadsKey(projectId), JSON.stringify(threads));
  } catch {
    /* quota / private mode — ignore */
  }
}

function readActive(projectId: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(activeKey(projectId));
  } catch {
    return null;
  }
}

function writeActive(projectId: string, id: string | null) {
  if (!canUseStorage()) return;
  try {
    if (id) window.localStorage.setItem(activeKey(projectId), id);
    else window.localStorage.removeItem(activeKey(projectId));
  } catch { /* ignore */ }
}

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 12);
};

function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}

function ensureQuickThread(list: Thread[], projectId: string): Thread[] {
  if (list.some((t) => t.id === QUICK_THREAD_ID)) return list;
  const quick: Thread = {
    id: QUICK_THREAD_ID,
    projectId,
    title: "Quick chat",
    updatedAt: 0,
    messages: [],
  };
  return [quick, ...list];
}

export function useChatThreads(projectId: string | null) {
  // Idempotent bootstrap: read (and seed the Quick thread) synchronously on
  // initial state — never inside useEffect, per the chat-agent UI contract.
  const [threads, setThreads] = useState<Thread[]>(() => {
    if (!projectId) return [];
    return ensureQuickThread(readThreads(projectId), projectId);
  });
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(() => {
    if (!projectId) return null;
    return readActive(projectId) ?? null;
  });

  // When the project changes, hydrate fresh state from storage for that project.
  useEffect(() => {
    if (!projectId) {
      setThreads([]);
      setActiveThreadIdState(null);
      return;
    }
    const next = ensureQuickThread(readThreads(projectId), projectId);
    setThreads(next);
    // Seed Quick thread in storage if we just added it, so other tabs see it.
    writeThreads(projectId, next);
    setActiveThreadIdState(readActive(projectId));
  }, [projectId]);

  // Cross-tab / cross-surface sync: react to storage events from other
  // browser tabs OR from the floating bubble writing to the same keys.
  useEffect(() => {
    if (!projectId || !canUseStorage()) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === threadsKey(projectId)) {
        setThreads(ensureQuickThread(readThreads(projectId), projectId));
      } else if (e.key === activeKey(projectId)) {
        setActiveThreadIdState(readActive(projectId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  const persistThreads = useCallback(
    (updater: (prev: Thread[]) => Thread[]) => {
      setThreads((prev) => {
        const next = updater(prev);
        if (projectId) writeThreads(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const setActiveThread = useCallback(
    (id: string | null) => {
      setActiveThreadIdState(id);
      if (projectId) writeActive(projectId, id);
    },
    [projectId],
  );

  const newThread = useCallback((): string | null => {
    if (!projectId) return null;
    const id = newId();
    const thread: Thread = {
      id,
      projectId,
      title: "New chat",
      updatedAt: Date.now(),
      messages: [],
    };
    persistThreads((prev) => [thread, ...prev]);
    setActiveThread(id);
    return id;
  }, [persistThreads, projectId, setActiveThread]);

  const deleteThread = useCallback(
    (id: string) => {
      if (id === QUICK_THREAD_ID) return; // Quick chat is permanent
      persistThreads((prev) => prev.filter((t) => t.id !== id));
      setActiveThreadIdState((cur) => {
        if (cur !== id) return cur;
        if (projectId) writeActive(projectId, null);
        return null;
      });
    },
    [persistThreads, projectId],
  );

  const setThreadMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      persistThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) {
          if (!projectId) return prev;
          // Auto-create if missing (e.g. quick thread on a new project).
          const seed: Thread = {
            id,
            projectId,
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
          existing.title === "New chat" && firstUser
            ? titleFromMessage(firstUser.content)
            : existing.title;
        const next = [...prev];
        next[idx] = {
          ...existing,
          title: nextTitle,
          updatedAt: messages.length ? Date.now() : existing.updatedAt,
          messages,
        };
        // Keep list sorted by updatedAt desc, but always keep Quick at top.
        next.sort((a, b) => {
          if (a.id === QUICK_THREAD_ID) return -1;
          if (b.id === QUICK_THREAD_ID) return 1;
          return b.updatedAt - a.updatedAt;
        });
        return next;
      });
    },
    [persistThreads, projectId],
  );

  const clearThread = useCallback(
    (id: string) => setThreadMessages(id, []),
    [setThreadMessages],
  );

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
    setThreadMessages,
    clearThread,
  };
}
