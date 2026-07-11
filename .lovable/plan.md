## Goal
Add an easy-to-see close button to every toast popup like the one in the screenshot.

## Current state
- Toasts are rendered by `src/components/ui/toaster.tsx` using `src/components/ui/toast.tsx`.
- `ToastClose` already exists and contains an `X` icon, but it is hidden by default (`opacity-0`) and only appears on hover/focus.
- The screenshot matches this toast style.

## Changes
1. **`src/components/ui/toast.tsx`**
   - Update `ToastClose` styles so the close button is always visible instead of only on hover/focus.
   - Keep it small and positioned at the top-right corner (`absolute right-2 top-2`).
   - Preserve destructive-variant colors and focus ring.

2. **`src/components/ui/toaster.tsx`**
   - Ensure `<ToastClose />` is still rendered inside every `<Toast>` (it already is).

## Out of scope
- No changes to toast content, duration, positioning, or the `sonner.tsx` toast system unless requested.
- No backend or business-logic changes.

## Verification
- Build/typecheck the project.
- Trigger a toast in the preview and confirm the `X` close button is visible and clickable.