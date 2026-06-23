## Goal
Tighten the floating AI chatbox header so the project and model selectors live in a single compact subheader row — matching the simple filter style used elsewhere — and free up vertical space.

## Changes (scope: `src/components/chat/FloatingChatBubble.tsx` + `src/components/chat/ModelPicker.tsx` only)

### 1. New compact subheader row
Replace today's two-row header (title block + separate "Project" row with `ProjectSelector`) with:

- **Row 1 (title bar)** — drag handle area: mascot/icon, "SC assistant" title, and the right-side action buttons (Clear, Close). Remove `ModelPicker` from this row. Remove the truncated "Project: …" subtitle (now redundant).
- **Row 2 (subheader filter bar)** — a single thin strip directly under the title, visually similar to page subheaders:
  - Left: standard `ProjectSelector` (h-8, flex-1, same trigger style as other pages — no custom label prefix).
  - Right: `ModelPicker` (h-8, compact, aligned).
  - Both controls share the same height/typography and sit on a subtle `bg-muted/30` strip with a bottom border, so it reads as a unified subheader.

### 2. Simplify `ModelPicker`
- Drop the bespoke `h-7` / `text-[11px]` styling; align to `h-8 text-xs` to match `ProjectSelector` and other page filters.
- Keep the same models list + storage helpers; no behavior change.

### 3. Remove redundancy
- Delete the standalone "Project" label + selector block (old lines ~335–344).
- Empty-state body copy stays, but the "switch projects from the selector above" wording remains accurate (selector is still above).

### 4. No behavior changes
- Drag/resize, model persistence, project sync, messages, suggestions, composer — all unchanged.
- No new dependencies, no backend work.

## Result
- Chatbox gains ~28–36px of vertical space.
- Filter row matches the rest of the app's subheader pattern (single clean row, no label prefix, consistent control sizing).
- Model + Project selectors sit side-by-side in one predictable place.
