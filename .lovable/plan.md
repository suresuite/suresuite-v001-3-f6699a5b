## Chatbox UI refinements

### Goal
Tighten the visual hierarchy of the floating assistant panel so the header owns attention, the mascot feels alive, and the panel frame reads as one crisp box.

### Changes
1. **Header background black**
   - In `src/components/chat/FloatingChatBubble.tsx`, set the title header row to `bg-black` and the title text to `text-white` so it remains readable.
   - Keep the existing drag cursor and close/clear actions; make their icons `text-white/90` to match.

2. **Panel border black**
   - Set the outer panel container to `border border-black` (replacing the subtle `border-border`) so the chatbox edges are sharp and consistent with the user's other black-border cards.

3. **Mascot bigger and unboxed**
   - Remove the rounded `ring-1 ring-border bg-background` box currently wrapping the mascot in the header.
   - Render the `AssistantMascot` directly in the header with a larger size (e.g., `h-9 w-9`) so it becomes the focal mark.
   - Leave the existing bob/blink/antenna CSS animations untouched — they already provide liveliness — but make the element itself more prominent through scale.

### Files modified
- `src/components/chat/FloatingChatBubble.tsx`
- (optionally) `src/components/chat/AssistantMascot.tsx` only if we need to scale the SVG viewBox cleanly; likely the className size change is enough.

### Verification
- Open the assistant in the preview and confirm the header is black, the title is white, the mascot is unboxed and larger, and the panel has a visible black border.