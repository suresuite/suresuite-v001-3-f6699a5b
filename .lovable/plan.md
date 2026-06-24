## Fix chatbox header to match the app's standard PageHeader pattern

The chatbox is missing a real header and uses non-standard, shrunken (`h-8 text-xs`) controls that look nothing like the rest of the app. We will rebuild the chat panel header so it mirrors the standard `PageHeader` used on every page (e.g. `ProjectIntelligence.tsx`): clear title + subtitle on the left, standard-sized `ProjectSelector` + `ModelPicker` + actions on the right, on the same `bg-header-background` / `border-header-border` surface.

### File to edit
`src/components/chat/FloatingChatBubble.tsx` — only the header block (lines ~293–337).

### New header structure (single block, replaces lines 293–337)

```text
┌──────────────────────────────────────────────────────────────┐
│  [mascot]  Agent                          [Project ▾] [Model ▾] [⟲] [✕] │
│            Ask anything about your supply chain                          │
└──────────────────────────────────────────────────────────────┘
```

- Container: `flex items-center justify-between gap-4 border-b border-header-border bg-header-background px-4 py-3`.
- Left side (`min-w-0`):
  - Drag handle button (`h-8 w-8 rounded-md hover:bg-muted cursor-move`) wrapping `<AssistantMascot className="h-5 w-5" />`. Keeps `onPointerDown={startPanelDrag}`.
  - Text block:
    - Title: `<h2 className="text-[15px] font-semibold tracking-tight text-foreground leading-tight truncate">Agent</h2>`
    - Subtitle: `<p className="text-[12px] text-muted-foreground mt-0.5 truncate">Ask anything about your supply chain</p>` (or current project name when one is selected).
- Right side (`flex items-center gap-2 shrink-0`):
  - `ProjectSelector` with **standard sizing** — drop `h-8 text-xs`, use `className="min-w-[200px]"` exactly like `ProjectIntelligence.tsx`.
  - `ModelPicker` — same default sizing (no shrunken overrides; if `ModelPicker` currently forces `h-7 text-[11px]`, remove those overrides so it matches the `ProjectSelector` trigger height).
  - Clear button: `variant="outline" size="sm" className="h-8 px-2.5"` with `Trash2 h-4 w-4`, only when `messages.length > 0`.
  - Close button: `variant="ghost" size="sm" className="h-8 px-2.5"` with `X h-4 w-4`.

### Why this fixes the complaints
- **Missing header / no contrast** → restored real `PageHeader`-style bar with title + subtitle on `bg-header-background border-header-border`, the same surface every page uses, so the chatbox visually reads as a proper panel against the page.
- **Non-standard project filter** → `ProjectSelector` rendered with the exact same props/classes as the rest of the app (`min-w-[200px]`, default trigger height), not the shrunken `h-8 text-xs` variant.
- **Inconsistent controls** → all right-side controls share `h-8` sizing and standard shadcn variants (`outline` / `ghost`, `size="sm"`), matching `PageHeader`'s action row.

### Out of scope
No changes to chat body, message bubbles, composer, streaming logic, model list, or backend. Pure header re-skin in one file.
