## Goal

Turn `/project-intelligence` into a Claude-style chat workspace tied to the active project, and add a quick "expand to full page" jump from the floating SC Assistant bubble.

Storage for v1: **localStorage only**. Hook boundary designed so a future swap to Supabase tables is a drop-in replacement (documented at bottom).

---

## 1. Floating chat: "Expand to full page" button

File: `src/components/chat/FloatingChatBubble.tsx`

- Add an icon button (`Maximize2` from lucide-react) in the header row, positioned to the LEFT of the existing close (X) button, right of the Trash/Clear.
- Tooltip / aria-label: "Open in Project Intelligence".
- On click:
  - `setOpen(false)` (collapse panel).
  - `navigate("/project-intelligence?thread=quick")` using `useNavigate` from `react-router-dom`.
- Style matches Clear/Close (ghost, `h-8 w-8`, white/10 hover on black header).

## 2. Project Intelligence header cleanup

File: `src/pages/ProjectIntelligence.tsx`

- Remove `<ProjectSelector />` from `PageHeader.rightContent` in BOTH the "no project" branch and the main return.
- Keep title + subtitle. Project switching now lives inside the new left sidebar.
- If no project is selected, render an inline empty state in the main pane ("Pick a project from the sidebar to start chatting").

## 3. Claude-style workspace on `/project-intelligence`

Reference: uploaded Claude screenshots — left sidebar (New chat, search, Recents), main area with big centered composer + quick-action chips on empty state, transcript + pinned composer on active state.

### Layout

```text
+-----------------------------------------------------------+
| PageHeader: Project Intelligence                          |
+-------------------+---------------------------------------+
| Sidebar (280px)   | Main pane                             |
|                   |                                       |
| [+ New chat]      |  Empty: greeting + suggestion chips   |
| [Search]          |         + large centered composer     |
|                   |                                       |
| Project: [Select] |  Active: transcript (MessageBubble)   |
|                   |          + sticky bottom composer     |
| Recents           |                                       |
|   Today           |                                       |
|   · Thread A      |                                       |
|   Previous 7 days |                                       |
|   · Thread B      |                                       |
|   Older           |                                       |
|   · Thread C      |                                       |
+-------------------+---------------------------------------+
```

### New components

- `src/components/intelligence/ChatSidebar.tsx`
  - "New chat" button → creates thread, sets active, clears composer, focuses input.
  - Search input → client-side filter on thread title.
  - Project switcher: same shadcn `<Select>` pattern as `/policies`, compact.
  - Recents grouped by `updatedAt` (Today / Previous 7 days / Older).
  - Row = non-button container with a select button + separate hover-visible delete button (avoid nested `<button>`).
- `src/components/intelligence/ChatWorkspace.tsx`
  - Empty state: centered greeting ("Good afternoon, {firstName}"), suggestion chips (reuse `SUGGESTIONS` from floating bubble + any `safeQuestions` returned by the backend), big composer.
  - Active state: scrollable transcript using existing `MessageBubble` from `src/components/chat/MessageBubble.tsx`, sticky composer at bottom.
  - Composer autofocuses on mount, after send, and after thread switch.

### Thread + history model (localStorage)

New hook: `src/hooks/useChatThreads.ts`

Shape:
```ts
type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: unknown;
  toolCalls?: unknown;
  createdAt: number;
};
type Thread = {
  id: string;            // uuid
  projectId: string;
  title: string;         // auto = first user message (60ch)
  updatedAt: number;
  messages: StoredMessage[];
};
```

Storage key: `projectChat.threads.<projectId>` → `Thread[]`. Active thread id per project: `projectChat.activeThread.<projectId>`.

API: `threads, activeThread, activeThreadId, setActiveThread(id), newThread(), deleteThread(id), appendMessage(msg), clearActive()`.

Rules from the chat-agent UI contract:
- Idempotent bootstrap guarded by `typeof window !== "undefined"`. Do NOT create the first thread inside a `useEffect` (StrictMode dupes).
- Persist updates inside the same state update that mutates `threads`.
- Sync across tabs / floating bubble via a `storage` event listener.

### Wiring the transcript

`useProjectChat` currently holds messages in component state and resets on project change. Refactor minimally so it optionally binds to a thread:

- Accept `{ threadId }` alongside `projectId`.
- On mount / thread change, hydrate `messages` from the thread's stored messages.
- On every `send` and every assistant reply, call `useChatThreads.appendMessage` so the thread persists.
- `clear()` calls `clearActive()` which empties the thread's messages (doesn't delete the thread).

### Floating bubble ↔ full page connection

- Both surfaces already share `useGlobalProject` → project stays consistent.
- Floating bubble binds to a reserved thread id: `"quick"` (per project). It appears in the Recents list as **"Quick chat"** and is never deleted, only cleared.
- The Expand button navigates to `?thread=quick`, so the full page opens the exact same conversation the user was just having.
- New threads created from the full-page sidebar are separate and only visible there (still project-scoped).

### Routing

- Keep the existing `/project-intelligence` route.
- Use a `?thread=<id>` query param for the active thread. On mount, read the param and call `setActiveThread`. On thread switch, `navigate("?thread=<id>", { replace: true })`. Reload restores the thread.

### Removed / simplified

- Drop the current 3 right-rail cards (AI Health, Project Details, Suggested Questions) to match the clean Claude aesthetic.
- Move AI Health check to a small icon button in the sidebar footer.

## 4. Files touched

- Edit `src/components/chat/FloatingChatBubble.tsx` — add Maximize button + navigate; on send, persist into `quick` thread.
- Edit `src/pages/ProjectIntelligence.tsx` — remove header project selector, adopt new layout.
- New `src/components/intelligence/ChatSidebar.tsx`
- New `src/components/intelligence/ChatWorkspace.tsx`
- New `src/hooks/useChatThreads.ts`
- Edit `src/hooks/useProjectChat.ts` — optional `threadId` binding + persistence hooks.

## 5. Future migration to database (not built now)

When we later want cross-device history, the swap is contained to `useChatThreads.ts` and the persistence calls in `useProjectChat`:

- Two tables: `chat_threads(id, project_id, user_id, title, updated_at)` and `chat_messages(id uuid, thread_id, role, content, parts jsonb, created_at)` with RLS scoped to `auth.uid()` and the standard GRANT block.
- Replace localStorage reads/writes in `useChatThreads` with Supabase queries; keep the same hook API so component code doesn't change.
- One-time migration: read `projectChat.threads.*` from localStorage on first load and upsert into the tables.

No DB work in this iteration.
