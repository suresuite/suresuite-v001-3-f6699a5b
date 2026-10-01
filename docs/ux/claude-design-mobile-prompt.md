> **Status: AUTHORED** · 2026-09-30 · A prompt to paste into Claude Design, derived from [`mobile-ux-audit-2026-09.md`](./mobile-ux-audit-2026-09.md).
> **Attach with it:** the screenshots in [`mobile-audit-shots/`](./mobile-audit-shots/). Mobile shots are numbered `01`–`41`; `D1`–`D4` are the desktop "must not change" references.

---

# Prompt for Claude Design

Copy everything below the line.

---

You are redesigning the **mobile (phone) experience** of **SuReSuite**, a supply-chain simulation web app (React + Tailwind + shadcn/Radix). Its users are supply-chain planners, modellers and company admins. On a phone they mostly **check, review and decide** rather than build: they look at a project's status, adjust a policy, start or read a simulation, ask the AI about a project, and, as admins, manage who belongs to which organization and project.

I've attached screenshots of the current app at 390 × 844 (numbered `01`–`41`) and four desktop screenshots (`D1`–`D4`).

## Non-negotiable constraints. Read these first.

1. **Super friendly to a phone user.** Design for one thumb and a glance:
   - every tap target ≥ 44 × 44 px (the visible element may be smaller if its hit area is 44);
   - one obvious primary action per screen, pinned above the tab bar;
   - **no sideways scrolling** of the page or of a table inside it;
   - nothing that only explains itself on hover;
   - the keyboard never opens before the user asks for it;
   - readable at 320 px wide.
2. **Mobile only.** Your designs apply **below 768 px**, plus phones in landscape (touch devices under 500 px tall). **The desktop version (≥ 768 px, mouse) must not change by a single pixel.** Screenshots `D1`–`D4` are the reference for that. When you specify how to build something, say how it stays off desktop:
   - a mobile-only component rendered behind `useIsMobile()`;
   - Tailwind base classes that are reset at `md:`;
   - or a component that already only exists on mobile (`MobileSheet`, `Panel`, `MobileActionBar`, `MobileTabBar`, `MobileNavDrawer`).
3. **No change in logic.** Design only presentation and interaction:
   - no new data, fields, API calls, permissions, validation, business rules or routes' behaviour;
   - every button you draw must map to an action the app already has (named per screen below);
   - you may regroup, reorder, collapse, defer to a sheet, rename labels and change what is shown first;
   - you may not invent a capability.

   If a screen seems to need new data, show the best design without it and list the idea separately under **"Ideas that would need logic"**.

## The existing mobile design system. Extend it, don't replace it.

The app already has a mobile "skin". Keep its language:

- **Canvas and panels.**
  - The canvas is 93% grey.
  - Content lives in **panels**: 1 px `#d4d4d4` frame, 4 px radius. The head is `#fafafa` with a mono 10 px uppercase label (letter-spacing 0.14em, `#525252`) and an optional counter on the right. The body is white, with rows divided by 1 px `#e8e8ea`.
  - At most **one** dark "primary" panel (`#18181b`) per screen.
- **Rows.** A row has an optional leading 6 px status dot, a label in Inter 500 at 13.5–15 px `#171717`, an optional mono 10–11 px sub-line `#525252`, an optional right-aligned value (mono, tabular), and a `›` chevron. Rows are never shorter than 44 px.
- **Type.** Five sizes only: micro 10–11 (mono), row 13.5–15, prose 14.5, title 17–21 (one per screen), stat 20–28. Sentence case. No uppercase headings or buttons, except the mono micro-labels.
- **Colour means something:**
  - `#bf2330` blocking or destructive;
  - `#e0930b` warning or derived;
  - `#14b8c4` healthy or running;
  - `#7c3aed` product level;
  - `#F8D448` "begin here" only.

  Colour appears only as a dot, a 2 px rule or a chip.
- **Chrome.**
  - Header ≈ 46 px: title plus at most 3 icon controls.
  - Bottom tab bar, 58 px: **Home · Policies · Lab · SC Intel · More** (landscape: 52 px).
  - Pinned action bar, 64 px: a primary button 46 px tall, `#18181b` fill.
  - Gutter 16 px at 390.
- **Sheets.** Bottom sheets have a 16 px top radius, a grab bar, drag to dismiss, max 76% of the height in portrait, stop above the tab bar and respect the safe area. The only shadow allowed in the app is under a sheet.
- **Never:** emoji (functional marks `▲▼›≈⚠→·` are fine), gradients, blur, `rounded-xl` cards, truncated or abbreviated numbers, and copy that differs from desktop in meaning.

Screenshots `01` (Home), `06` (Policies stage list), `09` (Simulation Lab), `19`/`22` (actions sheets) and `25` (Developer) show the skin working well. **Match them.**

## What to design, in priority order

For each screen, I give the problem the audit found, what the user is trying to do, and the existing actions your design must use. Nothing else.

### P0-1 · Admin → a user's access page (`/admin/users/:id`) — shots `17`, `17a`
- **Problems:**
  - Organization rows collapse to about 100 px, so names and details wrap one word per line and the Owner/Admin/Member switch overlaps the text.
  - The page is about 6 000 px long: organizations, projects, add-to-project form, page access, features, AI models, budgets, then a preview.
- **Task:** see and change which organizations and projects one person belongs to, their role in each, which is their **default** organization (★, where every sign-in lands), their page and feature rights, AI models, and budgets.
- **Existing actions:**
  - organization: add to one; change role (owner/admin/member); set or clear default; remove;
  - project: add with role (owner/editor/analyst/viewer) and optional end date plus reason; change role; remove;
  - rights: toggle page and feature access (allow / deny / inherit), choose allowed, default and fallback AI models;
  - budgets: save monthly and daily budgets and limits;
  - show or hide the preview.
- **Direction:** a **hub**. A short identity header, then one panel of summary rows ("Organizations · 3 · default Fabrikam", "Projects · 3", "Pages · 9 of 11", "Features · 6 of 7", "AI models · 2", "Budget · $1.44 of $25"), each opening its own sheet. Organization rows: name on line 1; role, default, members and projects on line 2. The role switch lives in the row's sheet, not in the list. Budget edits have a pinned "Save budgets & limits".

### P0-2 · Admin → Users → "Organizations" sheet — shot `16`
- **Problem:** the sheet is wider than the phone. Its title runs under the ✕, and the "current" badge and each row's ★ and ✕ are cut off. It also has a 4-line explanation above the form.
- **Existing actions:** set or clear default ★; remove from organization; add to organization with role; Done.
- **Direction:** a full-width list. Name on line 1; "owner · default · current" on line 2; ★ and remove as 44 px targets on the right. The explanation becomes one line plus "What's the default?", which opens a small sheet. The add form is behind "Add to organization".

### P0-3 · Phone held sideways — shots `35`, `36`
- **Problem:** at 844 × 390 the app shows the **desktop** layout: icon sidebar, desktop header, a credit footer over the content, and the AI bubble over the grid.
- **Direction:** show how each main screen (Home, Policies, Lab, Admin users) looks in the **mobile shell in landscape**: 52 px bars, a two-column list where it helps, the action bar merged into the header where the height is tight. (The switch itself is a one-line change to the mobile detection. You only design the result.)

### P1-1 · A confirmation sheet for every destructive action
- **Problem:** delete project, remove a member, remove from an organization, delete a version or scenario, and cancel a run all use the browser's grey `confirm()` box, with the URL as its title.
- **Direction:** one reusable **ConfirmSheet**:
  - a title naming the object ("Delete Lyon Stamping Plant — FY27 resilience study?");
  - a bullet list of consequences taken from the existing message text;
  - a red primary action and a Cancel;
  - for the two typed-name deletions (organization, user), the name field **does not auto-focus**.

  Show it for 3 cases: delete project, remove a person from an organization, delete a policy version.

### P1-2 · Admin lists (Users, Projects, Organizations) — shots `14`, `19`, `22`
- **Problems:**
  - Each user needs two rows, the person plus a separate "Actions" row.
  - The sub-line truncates, so the **default organization, other organizations, platform role, plan, validity and limits** never show on a phone.
  - A "SUPER ADMIN · tap to switch section" panel costs about 190 px on every admin page.
  - Search is squeezed beside "Add user".
- **Direction:**
  - one row per record with up to **two** sub-lines (e.g. "modeler · ★ Fabrikam · +2 orgs" / "$1.44 of $25 this month"); tapping the row opens its actions sheet;
  - the admin section switcher moves into the header title ("Users ▾");
  - search goes full width, with "Add user" as a header icon or the pinned primary action;
  - the Organizations actions sheet folds its four "Valid for 1 week / month / quarter / year" rows into one "Access period…" row that opens a picker.

### P1-3 · Members & access (a project) — shot `20`
- **Problems:**
  - A two-line title and a four-line paragraph fill the first screen.
  - A 5-field add form comes before the member list.
  - The ✕ is an oversized boxed button over the title.
  - The body scrolls inside a sheet that also scrolls.
  - Each person shows 6–8 ✓/⊘ capability chips.
- **Existing actions:** add a member (person, role, optional end date, reason); change role; remove; and a read-only role legend.
- **Direction:**
  - member list first, one row each: "Name · Editor · until 31 Dec" / "5 of 6 rights · via Northwind";
  - tap → a sheet with the full rights, change role, remove;
  - "Add member" as a secondary action that opens its own sheet;
  - "What each role grants" as a link to a legend sheet, not a table.

### P1-4 · My profile (`/profile`, 4 tabs) — shots `12`, `13`
- **Problems:**
  - It uses the desktop card styling.
  - The 4-tab strip scrolls sideways, so "Change password" is cut off.
  - It is one very long form with the Save button at the very bottom.
  - The **organization switcher exists only here**.
  - My Organization repeats the rights chips for every person.
- **Existing content:**
  - Profile: avatar colour, user id (copy), read-only first and last name, editable user name and phone, read-only email, role, current organization, "Your organizations" with **Switch**, plan validity, and user and project counts, with Save;
  - My Access (read-only);
  - My Organization (read-only members and projects, with a project picker);
  - Change password.
- **Direction:**
  - the panel skin;
  - the tabs become a list of sections, or a 2 × 2 segmented control that fits 320 px;
  - editable fields grouped in one panel with a **pinned Save**;
  - read-only facts as rows;
  - "Your organizations" as rows with a Switch action.
- **Also:** put **the current organization and a "Switch organization" row into the More menu's account area** (shot `02`), calling the same switch action.

### P1-5 · Project Manager → View data — shots `04b`, `04`, `04c`
- **Problem:** "View data" opens *inline* at the bottom of the page. The table sits in a 256 px box that scrolls both ways. The tab strip (BOM / Inbound / Outbound / Node list / deep-tier) is cut off, and the rows selector and icon buttons are 24–28 px.
- **Existing actions:** switch dataset; choose rows per page; refresh; download CSV; close.
- **Direction:**
  - a full-height sheet: dataset chips that fit or scroll with a fade edge; a "142 records" counter; Download as the pinned action;
  - each record as a card of label/value pairs, or a table with a frozen first column **inside the sheet only**;
  - never a page-level sideways scroll.

### P1-6 · Dense reference tables: Data map, role legend — shots `08`, `13`
- **Problem:** desktop tables 700–950 px wide.
- **Direction:** a summary on screen (counts per status: "changes the run 24 · ignored 3 · …") and the full list in a sheet, one card per column/row. Rule: defer, never truncate.

### P1-7 · About and Docs — shots `26`, `27`
- **Problem:** neither page has the tab bar, so a signed-in user is stranded. About offers only "Get started" (the login page), even to a signed-in user.
- **Direction:** keep the tab bar, and give signed-in users "Open app". Docs: one header, not two; the section tree as a sheet rather than a push-down.

### P1-8 · Touch-target and label pass (app-wide)
Header icon buttons are 32 × 32 (Refresh, profile avatar, Back), and the project chip is 26 px tall. Among the smallest targets:
- 28 px Export buttons (`07`);
- 20 px Data map tabs (`08`);
- 16 px checkboxes in Create API key (`41`);
- 10 px "edit" links on version notes.

Truncated segmented labels: Developer "API k… / Quickst…" (`25`), Audit "Sign-ins & exports" (wraps at 320, `32`), Lab "Compare" (clipped at 320). Specify the fixed components and shorter mobile labels.

### P2 · Consistency
- **One sheet style.** Today there are two: the skin's sheet and a restyled dialog that covers the tab bar, has no grab bar, centres its title and uses a 12 px radius (`07`, `20`, `41`). Specify one.
- **Toasts.** Sit above the tab bar, never on it (`11`), and use a 44 px close target.
- **One name for the AI area.** The tab says "SC Intel", the page title says "SC Intelligences" and the menu says "Project Intelligence".
- **Project Manager naming.** It is "Project Manager" in the menu but "Your Projects" on the page.
- **Policies stage list.** Show how the multi-level **BOM tree** and **Qty/assy** read in `MobileStagePolicyList` (`06`), using the same rows.
- **Hover-only reasons.** Explanations that only exist on hover today (why Delete is disabled, data freshness, result credibility) become a visible 12 px line.

## What to deliver

1. **A mobile system delta.** The components you add or change, each with states (default, pressed, disabled with a visible reason, loading, error, empty) and its mobile-only mechanism:
   - list row v2 (two sub-lines);
   - ConfirmSheet;
   - DataTableSheet;
   - the unified bottom sheet;
   - the admin header title-switcher;
   - the rights summary ("5 of 6 rights");
   - the More-menu account block with the organization switcher.
2. **Redesigned screens at 390 × 844 and 320 × 568** for P0-1 … P1-7, plus **844 × 390 landscape** for Home, Policies, Lab and Admin users.
3. **For each screen, a one-line mapping** of every button to the existing action it calls, and a note saying *"desktop unchanged"*.
4. **Empty, loading and error states** for the admin lists, View data and Members & access.
5. **Ideas that would need logic.** A short separate list, clearly marked as out of scope.

## Acceptance checklist (your designs must pass all of these)

- [ ] At 1280 px, nothing differs from `D1`–`D4`.
- [ ] No new data, API call, permission, validation or route behaviour; every control maps to an existing action.
- [ ] Every change is scoped below 768 px, or to a touch device under 500 px tall in landscape.
- [ ] No page-level or in-panel sideways scroll at 320 px; nothing is cut off at the right edge.
- [ ] Every tap target is ≥ 44 × 44 px, including icon buttons, chips, checkboxes and links.
- [ ] One primary action per screen, pinned above the tab bar.
- [ ] No input receives focus when a sheet opens.
- [ ] Destructive actions go through ConfirmSheet, never `confirm()`.
- [ ] Nothing explains itself only on hover.
- [ ] Numbers are never truncated, rounded for display or abbreviated.
- [ ] No emoji, gradients, blur, large radii or decorative shadows.
