Plan: Improve Navbar layout and contrast

1. Contrast direction
- Keep the sidebar as a light surface (`bg-background` in light tokens ≈ #fafafa) so it pops against the main content.
- Wrap the main content area in `dark` (Tailwind `darkMode: "class"` is already enabled) so the canvas becomes dark (#0f0f0f) while the sidebar stays light.
- Update `PageLayout.tsx` so the content wrapper carries the `dark` class and the margin-left matches the new navbar widths.

2. Layout / density
- Tighten the sidebar:
  - Collapsed width: `w-14` (56px)
  - Expanded width: `w-48` (192px)
  - Header height: `h-10` with smaller logo and a single right-aligned collapse chevron
  - Nav item padding: `p-2` with `gap-2` and `text-xs` labels
  - Section spacing: `mt-4` with a subtle top border or `Separator`
- Update `Footer.tsx` margin-left to match the new collapsed width (56px instead of 60px).

3. Active state / rail marker
- In `NavItem.tsx`, make the link `relative`.
- Add a left rail marker only when active: `before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-primary`.
- Active background: a subtle `bg-muted/80` with `text-foreground font-medium`.
- Hover: `hover:bg-muted/50`.

4. Section hierarchy
- Add a `SidebarGroupLabel`-style section label or use `Separator` between sections in `Navbar.tsx`.
- Keep the existing access-filtered `visibleSections` logic.

5. Tooltip & account area
- Remove the hardcoded `text-white bg-black` from the collapsed tooltip in `NavItem.tsx`; rely on the default tooltip styling.
- Keep the account dropdown at the bottom, but make it tighter and use consistent hover tokens.

6. Tokens / theme
- No new custom color classes; continue using semantic tokens (`bg-background`, `text-foreground`, `bg-muted`, etc.).
- Light sidebar remains outside the `dark` wrapper and therefore uses the default light tokens.
- If any descendant page hardcodes light/dark colors, update them to tokens in the same pass.

7. Verification
- Verify the preview shows a light sidebar against a dark canvas.
- Confirm collapsed/expanded toggle, active rail marker, section labels, tooltips, and account dropdown all render correctly.
- Check that the content area is still scrollable and the footer does not overlap content.

Files to modify:
- `src/components/Navbar.tsx`
- `src/components/NavItem.tsx`
- `src/components/shared/PageLayout.tsx`
- `src/components/Footer.tsx` (margin-left only)
- `src/index.css` if a `.light` override is needed for explicit sidebar isolation
