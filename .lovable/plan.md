# AI Assist Chatbox — UI cleanup plan

Scope: only `src/components/chat/FloatingChatBubble.tsx`, `src/components/chat/ModelPicker.tsx`, and (minor) `src/components/shared/ProjectSelector.tsx`. No business logic, hooks, or backend changes.

## 1. Standardize the project filter (match Supply Chain Policies)

Reference (ProjectPolicies.tsx):
```tsx
<SelectTrigger className="w-[200px] h-9">
  <SelectValue placeholder="Select project" />
</SelectTrigger>
<SelectContent>
  {projects.map(p => <SelectItem value={p.id}>{p.name}</SelectItem>)}
</SelectContent>
```

In the chatbox header, stop using the badge-heavy `ProjectSelector` component. Inline a plain shadcn `Select` identical to the policies page:
- Trigger: `h-9`, flex-1 (so it fills the available header width instead of fixed 200px), default border, `text-sm` (not text-xs).
- Items: project name only — no `Badge`, no completed checkmark, no plant subtitle. Matches the attached screenshot exactly.
- Placeholder: `"Select project"`.

This removes the inconsistent dense look and matches the rest of the app.

## 2. Header layout — clean, high contrast, single row

Replace the current 294–333 header with a calm, standard row:

```text
[mascot drag] [ Project select ........... ▼ ] [ Model ▼ ]  [🗑]  [✕]
```

Rules:
- Container: `h-12 px-3 border-b border-border bg-card` (solid `bg-card` instead of `bg-background` gives a clear contrast strip against the body, fixes the "washed out" feel).
- All controls `h-9` so heights line up (project select, model picker, icon buttons).
- Drag handle: 32×32 ghost button with mascot at `h-5 w-5`, `cursor-move`, tooltip "Drag".
- Project select: `flex-1 min-w-0 h-9 text-sm` (truncates long names).
- Model picker: bump trigger to `h-9 text-sm`, keep compact width (`w-auto`).
- Trash + Close: `Button variant="ghost" size="icon" className="h-9 w-9"`, icons `h-4 w-4`.
- Remove the leftover blank lines (335–337) and the gradient/background variants from earlier iterations.

## 3. Body + composer polish (contrast only, no structure change)

- Body wrapper: keep `bg-background`, increase padding to `px-4 py-4`, message gap `space-y-4`.
- Empty-state info card: change `bg-muted/40` → `bg-muted` with `border border-border` so it reads clearly in both themes.
- Suggestion buttons: `hover:bg-accent hover:text-accent-foreground` (semantic tokens) instead of `hover:bg-muted`.
- Composer bar: `bg-card border-t border-border p-3`; textarea uses `border-input bg-background` (unchanged) but `text-sm leading-relaxed`; send button `size="icon"` `h-9 w-9` to match header.
- Panel shell: keep `rounded-2xl border border-border shadow-2xl`, switch to `bg-background` body with `bg-card` header/footer strips for clean banded contrast.

## 4. Fix the "sometimes doesn't show on click" z-index bug

Findings from the code scan:
- Sidebar `Navbar` uses `z-[60]` (and a `z-[70]` submenu).
- Launcher + panel currently use `z-[80]`.
- Select dropdowns inside the panel use `z-[100]`.
- Toasts use `z-[100]`.

Problem: when the chat panel is positioned near the sidebar/submenu, the panel sits above sidebar, but the launcher click can be intercepted by overlays from other portals (e.g. closing a Select leaves a transient overlay at z 100). Also resize/drag children inside the panel have no explicit stacking, and on some routes a page-level sticky header (no z set) ends up above due to stacking context from `transform`.

Fix:
- Introduce a clear scale (in the file, as constants/classes):
  - Launcher: `z-[90]`
  - Panel:    `z-[95]`
  - Panel internals (resize grip): keep `z-10` (inside panel stacking context — fine).
  - Keep Select dropdowns at `z-[110]` so they always render above the panel: bump `ModelPicker` and the new inline project select `SelectContent` to `z-[110]`.
- Ensure the panel root creates its own stacking context: it already does via `fixed` + `z`; also add `isolate` to be safe.
- Remove the lingering `ProjectSelector` `z-[100]` from inside the panel (no longer used there — leave the component itself untouched for other pages).
- Verify launcher click handler isn't swallowed: keep `onPointerDown` for drag but only call `setOpen(true)` in `onClick` when `dragState.current?.moved` is false (already correct) — no change needed beyond z.

## 5. Out of scope

- No changes to `useProjectChat`, providers, tools, suggestions list, or persistence.
- Launcher button visual (neon ring) stays as-is — user only asked about the box chat.
- ProjectSelector component is left intact for other pages that depend on its badge layout.

## Files touched

- `src/components/chat/FloatingChatBubble.tsx` — header rewrite, body/composer token cleanup, z-index bump, inline Select replacing ProjectSelector inside the panel.
- `src/components/chat/ModelPicker.tsx` — trigger to `h-9 text-sm`, `SelectContent` z to `z-[110]`.

## Visual result

- Single tidy header strip matching the Policies page filter style.
- Strong contrast: `bg-card` header/footer vs `bg-background` body.
- Project + Model selectors share the same height/typography as the rest of the app.
- Panel reliably appears on top of sidebars, submenus, and stale portal overlays.
