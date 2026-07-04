## Problem

The floating chat bubble is still mounted globally in `src/App.tsx` (line 149) — it wasn't removed. It's rendering off-screen.

**Cause:** `FloatingChatBubble.tsx` loads the launcher position from `localStorage` (`projectChat.launcherPos`) via `loadPos()` **without clamping to the current viewport**. If the position was saved at a larger viewport (or you resized the window smaller / are on a different device), the launcher renders at coordinates outside the visible area. Current viewport is 1042×732, and a saved `x`/`y` from a bigger window puts the button beyond the right/bottom edge.

The existing `onResize` handler clamps correctly — but only fires on `window resize` events, never on initial mount, so the bubble stays off-screen until you resize the window.

The panel position (`projectChat.panelPos`) has the same bug.

## Fix

In `src/components/chat/FloatingChatBubble.tsx`:

1. Clamp the launcher position against the current viewport whenever it's loaded — both on initial state (`useState(() => …)`) and inside `loadPos` / `loadPosFrom`. Keep the launcher fully inside `[0, innerWidth - LAUNCHER_SIZE.w]` × `[0, innerHeight - LAUNCHER_SIZE.h]`.
2. Do the same for the panel position against `panelDims`.
3. Add a one-shot `useEffect` on mount that re-clamps `pos` and `panelPos` to today's viewport (defensive, covers the case where localStorage was written at a larger size in the same session).

No changes to behavior, styling, or the panel UI — just makes sure the launcher and panel land on-screen.

## Files touched

- `src/components/chat/FloatingChatBubble.tsx` (clamp logic only)
