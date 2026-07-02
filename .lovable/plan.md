## Goal
Make `/project-intelligence` feel like Claude: project-optional chats, agent presets replacing generic suggestions, a compact composer with model picker beside Send, per-thread three-dot menu, and independent scrolling panels.

## 1. Decouple threads from project (new chat = no project required)

**`src/hooks/useChatThreads.ts`**
- Add a global store keyed under `projectChat.threads.__global__` alongside existing per-project stores. Threads carry `projectId: string | null`.
- New chats start with `projectId = null`. "Attach to project" mutates the thread's `projectId` and moves it into that project's store (or keep single store and filter — simpler: **single global store** `projectChat.threads.v2` and filter by project in views).
- Refactor to single store: `projectChat.threads.v2` = `Thread[]`, `projectChat.activeThread` = string. Keep `QUICK_THREAD_ID` reserved (bubble). Migrate old per-project keys on first read.

**`src/pages/ProjectIntelligence.tsx`**
- Sidebar always shows all threads (independent of selected project). Selecting a project no longer filters the thread list — it just sets the target project for the *active* chat if the thread has none, or is shown as a chip.
- "New chat" creates a thread with `projectId: null` and navigates to it. Sending a message without a project either (a) is allowed if the agent doesn't require project data, or (b) prompts inline to attach one via the composer "+".

## 2. Composer redesign (Claude-style)

Rebuild the composer used in both empty and active states:

```
┌───────────────────────────────────────────────┐
│  textarea …                                    │
│                                                │
│  [+ Project ▾]              [Model ▾] [ ↑ ]   │
└───────────────────────────────────────────────┘
```

- **Left of footer**: `+` button → popover listing projects → attaches project to current thread (shows as pill "● Project name ✕" once selected).
- **Right of footer**: `ModelPicker` (compact, icon+short label) then a circular icon-only Send button (arrow-up, no "Send" text). Loading state shows spinner in same button.
- Remove the redundant model-label text on the second composer variant. One composer component used in both states.

New file: `src/components/intelligence/ChatComposer.tsx` — encapsulates textarea + footer with `onSubmit`, `projectId`, `onAttachProject`, `model`, `onModelChange`, `loading`.
New file: `src/components/intelligence/AttachProjectButton.tsx` — `+` popover for project selection (uses shadcn Popover + Command).

## 3. Agent presets replace generic suggestions

Replace the 4 SC-risk questions with an **Agent picker** on the empty state:

```
Choose an agent to start with
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 🛡  Risk      │ │ 🧪 Simulation│ │ 📦 Inventory │
│  Analyst     │ │  Modeler     │ │  Strategist  │
└──────────────┘ ┌──────────────┐ ┌──────────────┐
                 │ 🚚 Logistics │ │ 💬 General   │
                 │  Planner     │ │  Assistant   │
                 └──────────────┘ └──────────────┘
```

New file: `src/lib/chat/agents.ts` — export `AGENTS: { id, name, icon, blurb, systemPrompt, starterPrompt? }[]`.
- Risk Analyst, Simulation Modeler, Inventory Strategist, Logistics Planner, General Assistant.

Selecting an agent seeds `thread.agentId` (extend `Thread` type) and injects the agent's system prompt on send (pass `agentId` through `useProjectChat.send` → edge function body; edge function reads `agentId` and prepends the matching system prompt — small update to `supabase/functions/project-ai-chat/index.ts`).

The active agent shows as a subtle chip above the composer ("🛡 Risk Analyst · change"). Clicking change reopens the picker.

## 4. Thread row: three-dot menu

**`src/components/intelligence/ChatSidebar.tsx`**
- Replace trash button with a `MoreHorizontal` trigger opening a `DropdownMenu`:
  - **Rename** (inline editable input in the row)
  - **Attach to project** / **Change project** (submenu with project list)
  - **Remove from project** (only if attached)
  - divider
  - **Delete** (destructive)
- Fix the nested-button issue by making the row a `div` with two sibling buttons (title button + menu trigger).

## 5. Independent panels

**`src/pages/ProjectIntelligence.tsx`**
- Grid keeps `[280px_1fr]` but ensure both columns are `h-full min-h-0 overflow-hidden`, and each internal `ScrollArea`/scroll container owns its own overflow. Sidebar body already uses `ScrollArea`; verify main workspace uses `flex-1 overflow-y-auto` inside its own column so the sidebar doesn't grow with a long thread list.
- Add sidebar width resize affordance later (out of scope unless requested).

## Technical notes

- Storage migration: on first mount of `useChatThreads`, if `projectChat.threads.v2` missing, read all legacy `projectChat.threads.<pid>` keys, merge into a single array (preserving `projectId`), write v2, leave legacy keys for one release.
- `useProjectChat` signature becomes `useProjectChat(threadId)` — project comes from the thread record. The floating bubble keeps its behavior by binding to `QUICK_THREAD_ID` and passing the currently selected global project as its default attach.
- Edge function: accept optional `agentId`, look up system prompt, allow `projectId: null` (skip project-scoped tool calls, respond generically).
- Send button: circular `h-9 w-9 rounded-full` with `ArrowUp` icon, disabled state greyed.

## Out of scope
- Starring, pinning beyond Quick chat, folder organization, bulk actions.
- Backend (Supabase) persistence — stays localStorage.

## Files touched
- `src/hooks/useChatThreads.ts` (refactor to single global store, add `projectId`/`agentId`, migration)
- `src/hooks/useProjectChat.ts` (derive project from thread, pass agentId)
- `src/pages/ProjectIntelligence.tsx` (independent panels, no project filter on sidebar)
- `src/components/intelligence/ChatSidebar.tsx` (three-dot menu, no project select)
- `src/components/intelligence/ChatWorkspace.tsx` (agent picker empty state, new composer)
- `src/components/intelligence/ChatComposer.tsx` (new)
- `src/components/intelligence/AttachProjectButton.tsx` (new)
- `src/components/intelligence/AgentPicker.tsx` (new)
- `src/lib/chat/agents.ts` (new)
- `src/components/chat/FloatingChatBubble.tsx` (adapt to new hook signature)
- `supabase/functions/project-ai-chat/index.ts` (accept agentId + null projectId)
