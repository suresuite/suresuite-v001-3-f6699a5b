Paste this into Claude Code from the root of the SuReSuite repo, with this folder copied in as `design_handoff_mobile_redesign/`:

---

Read `design_handoff_mobile_redesign/README.md` in full. You are implementing a **mobile-only, presentation-only** redesign of SuReSuite (React + Tailwind + shadcn/Radix).

Hard rules:
- At ≥ 768 px with a mouse, the app must render **pixel-identical** to today.
- Scope every change with `useIsMobile()`, Tailwind classes reset at `md:`, or the existing mobile-only components (`MobileSheet`, `Panel`, `MobileActionBar`, `MobileTabBar`, `MobileNavDrawer`, `MobileStagePolicyList`).
- **Do not change logic**: no new data, fields, API calls, permissions, validation or route behaviour. Every new control calls a handler that already exists. If something seems to need logic, stop and list it instead.

Start by:
1. Locating the existing mobile skin: `useIsMobile`, `MobileSheet`, `Panel`, `MobileActionBar`, `MobileTabBar`, `MobileNavDrawer`, `MobileStagePolicyList`. Also locate the pages for admin users / user access / projects / organizations, `ProjectMembersDialog`, `Profile`, Project Manager view data, the Data map, About and Help. Report the file paths.
2. Grepping all `window.confirm(` / `confirm(` call sites, and every shadcn `Dialog` / `AlertDialog` used on mobile.
3. Proposing a short plan that follows README §7, one PR per step.

Then implement step 1 (the mobile detection change in README §0) and stop for review. After each step:
- run the existing tests and type-check;
- confirm the desktop at 1280 px is unchanged;
- confirm 320 px has no horizontal overflow (`document.documentElement.scrollWidth <= 320`);
- confirm every interactive element in the changed views is ≥ 44 × 44.

`Mobile Redesign.dc.html` (open it in a browser, next to `support.js`) is the visual reference for every screen. It is a design mock, not code to copy.
