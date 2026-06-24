## Goal

Bring back the mascot launcher with comet trail and rebuild the floating chat panel so the header, message bubbles, and composer all look intentional — not the current cluttered single-row header with generic styling.

Scope: `src/components/chat/FloatingChatBubble.tsx`, `src/components/chat/AssistantMascot.tsx` (already exists), `src/components/chat/MessageBubble.tsx`, plus a new `CometTrail` styling. No backend or business-logic changes.

## 1. Restore the mascot launcher (with comet)

- Replace the current `MessageSquare + "AI Chat"` pill button with a round 60×60 launcher.
- Inside: `AssistantMascot` centered, with a comet/glow trail behind it (animated CSS halo + trailing particle arc, respects `prefers-reduced-motion`).
- Keep drag-to-move and stale-position clamping (don't regress the offscreen fix).
- `LAUNCHER_SIZE` back to `{w: 60, h: 60}`; clamping math updated accordingly.

## 2. Rebuild the chat panel header (declutter + add identity)

Two rows instead of one crammed row:

```text
┌────────────────────────────────────────────────┐
│ [mascot]  SC Assistant            [⚙] [✕]      │  row 1: identity + window controls
│           Analyzing {project name}             │
├────────────────────────────────────────────────┤
│ [Project selector ▾]    [Model ▾]      [🗑]    │  row 2: context controls
└────────────────────────────────────────────────┘
```

- Row 1: mascot avatar (drag handle), title "SC Assistant", subtitle = project name or "Ask anything about your supply chain". Right side: settings (future) + close.
- Row 2: project selector + model picker (left), clear-chat (right). Separated by a subtle border. Uses `header-background` / `header-border` tokens.
- Title uses `text-foreground` semibold; subtitle `text-muted-foreground text-xs`.

## 3. Restyle message bubbles

In `MessageBubble.tsx`:

- Assistant: no background (transparent), `text-foreground`, full width minus avatar gutter, with small mascot avatar on the left of the first message in a run.
- User: right-aligned, `bg-primary text-primary-foreground` rounded-2xl bubble, max-width 80%, comfortable padding (`px-3.5 py-2`).
- Timestamp/meta in `text-[11px] text-muted-foreground` under bubble, only on hover.
- Markdown via existing renderer; ensure code blocks, links, lists inherit readable contrast.

## 4. Rebuild composer

- Wrapper: `border-t border-border bg-background p-3` with a rounded inner container (`rounded-xl border border-border bg-muted/30 focus-within:border-primary`).
- Textarea: borderless, transparent, `min-h-[44px] max-h-40`, auto-grow, placeholder uses `text-muted-foreground`.
- Send button: fixed 36×36 icon button (`Send` icon), `bg-primary text-primary-foreground`, disabled state when empty/loading. Never stretches to textarea height.
- Suggestions: render as horizontally-scrollable chip row directly above the composer (only when `messages.length === 0`), pill-shaped, `border border-border hover:bg-muted`.

## 5. Preserve existing behavior

- Keep drag + resize for the panel, viewport clamping, localStorage persistence.
- Keep auth/route hiding (`hidden` check).
- Keep `useProjectChat`, `useGlobalProject`, `ModelPicker` integrations unchanged.

## Technical notes

- Comet trail: pure CSS — a rotating `conic-gradient` ring + a trailing pseudo-element with `filter: blur(6px)` and `animation: comet 2.4s linear infinite`. Add keyframes in `src/index.css` under a `.chat-launcher-comet` class. Disable animation under `@media (prefers-reduced-motion: reduce)`.
- All colors via semantic tokens (`--primary`, `--header-background`, `--header-border`, `--muted`, `--foreground`, `--primary-foreground`). No hardcoded hex.
- Verify with Playwright: launcher visible bottom-right with mascot + animated halo, click opens panel, header shows two rows with mascot/title/subtitle, bubbles render with correct contrast, composer send button is square and not stretched.

## Out of scope

- No changes to `useProjectChat`, edge functions, or model routing.
- No project-filter changes (separate complaint, handle in a follow-up).
