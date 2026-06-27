# Chatbox UI Refresh

Scope: `src/components/chat/FloatingChatBubble.tsx` only (presentation). No logic, no provider/model/persistence changes.

## Problems today

- Header is a single cramped row mixing drag handle, project select, model picker, clear, close — no title, no identity.
- Header background is flat `bg-card`; doesn't read as a header.
- Body, composer and header all blur together; weak hierarchy and contrast.
- Suggestion / empty-state cards look like plain rows.

## New structure (two-row header + banded body + refined composer)

```text
┌───────────────────────────────────────────────┐
│  HEADER (gradient band, drag region)          │
│  ◉ mascot   SC Assistant            ⟲   ✕    │  ← row 1: title + actions, NO SUBtitle needed
│ ├───────────────────────────────────────────────┤
│  FILTER BAR (subtle muted strip)              │
│  [ Project ▾ ]              [ Model ▾ ]       │
├───────────────────────────────────────────────┤
│  BODY (bg-background)                         │
│   • empty state card                          │
│   • suggestion chips                          │
│   • messages                                  │
├───────────────────────────────────────────────┤
│  COMPOSER (bg-card, top border)               │
│  [ textarea …………………………… ]  [ ▶ ]              │
└───────────────────────────────────────────────┘
```

### Row 1 — Title header

- Height ~56px, `bg-gradient-to-r from-card to-muted/60`, bottom border.
- Whole row is the drag handle (cursor-move on grab area, but buttons keep pointer events).
- Left: 32px mascot in a rounded-md ring; stacked title "SC Assistant" (text-sm font-semibold) + subtitle "Supply chain copilot" (text-[11px] text-muted-foreground).
- Right: Clear (icon, only when messages exist) and Close (icon) ghost buttons.

### Row 2 — Filter bar

- Height ~44px, `bg-muted/40`, bottom border, px-3.
- Left: Project `Select` (flex-1, h-8, text-xs).
- Right: `ModelPicker` (compact).
- Removes today's cramming of 5 controls into one row.

### Body

- `bg-background`, `px-4 py-4`, `space-y-3`.
- Empty/intro card: `rounded-lg border bg-card/60 p-3` with clearer copy hierarchy (title line + helper line).
- Suggestion buttons restyled as soft chips: `rounded-lg border bg-card hover:bg-accent`, two-line safe.

### Composer

- `bg-card`, top border, `p-3`, `gap-2`.
- Textarea: `rounded-lg`, slightly taller default (min-h 40), same focus ring.
- Send button: `h-9 w-9 rounded-lg`.

## Contrast / tokens

- Uses existing semantic tokens only (`card`, `muted`, `border`, `background`, `foreground`, `accent`). No hardcoded colors.
- Three distinct background bands (header gradient → muted filter → background body → card composer) create clear vertical rhythm.

## Out of scope

- Drag/resize logic, z-index, message rendering, model/provider behavior, persistence — all unchanged.
- No changes to launcher button.