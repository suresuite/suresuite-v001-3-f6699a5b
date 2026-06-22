## Goal
Polish the sidebar profile avatar dropdown so it behaves consistently and pleasantly when the navigation bar is collapsed or expanded.

## Current state
- `src/components/Navbar.tsx` renders two separate `DropdownMenu` implementations: one for `isCollapsed` and one for expanded.
- They differ in width, anchor side, label, and hit area. The collapsed version is just a 28×28 avatar; the expanded one is a full-width row.
- Both use unstyled trigger buttons and bare avatars, with no focus ring / hover state.

## Changes
1. **Unified account trigger** — extract a single `AccountTrigger` component that accepts `isCollapsed` and renders either the compact avatar or the expanded row.
   - Add hover/focus ring, press scale, and tooltip/aria clarity.
2. **Single dropdown menu** — use one `DropdownMenuContent` definition with:
   - `side={isCollapsed ? "right" : "top"}` and `align="start"`.
   - Consistent width (`w-52`), same items, and a clear account label.
3. **Visual polish** — consistent padding, rounded avatar ring matching the app accent, and keyboard-friendly focus states.
4. **No behavior change** — items stay: My Profile, Help, Logout.

## Files
- `src/components/Navbar.tsx` only. No backend, no new dependencies.

## Verification
- Build and preview the sidebar in collapsed and expanded states.
- Click the profile icon to confirm the dropdown opens on the correct side with consistent content.
- Verify keyboard focus and hover states.