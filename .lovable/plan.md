Revert the recent color inversion. Restore the sidebar to white, make the footer black, and set the page/header canvas to gray.

## Changes

1. **`src/components/Navbar.tsx`**
   - Change wrapper class from `dark fixed left-0 top-0 h-full ...` back to `light fixed left-0 top-0 h-full ...` (white sidebar).
   - Change account dropdown `DropdownMenuContent` className from `dark w-52 z-[70]` back to `light w-52 z-[70]`.

2. **`src/components/Footer.tsx`**
   - Change the inner div classes from `bg-background ... text-muted-foreground` to `bg-black text-white` (black footer, white text). Keep the `ml-14` / `ml-0 sm:ml-48` responsive offsets and border.

3. **`src/components/shared/PageLayout.tsx`**
   - Keep the content wrapper on a gray canvas: `bg-[hsl(var(--surface-sunken))]` stays (light gray `#fafafa`-ish). No `dark` wrapper.
   - Outer wrapper stays `bg-background`.
   - Net result: header/page area reads as gray against the white sidebar and black footer.

No token changes in `src/index.css`, no API changes.

## Result

- Sidebar: white (as before the inversion).
- Page/header canvas: light gray.
- Footer: black with white text.
