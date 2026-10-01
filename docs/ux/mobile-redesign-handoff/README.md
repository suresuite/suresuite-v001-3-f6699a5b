# Handoff: SuReSuite mobile redesign (phone, below 768 px + phone landscape)

## Overview
A presentation-only redesign of the SuReSuite **phone** experience. It fixes the mobile audit findings: admin pages that overflow the screen, the browser's `confirm()` dialogs, inline tables that scroll sideways, a stranded About/Docs, a desktop layout when the phone is held sideways, tap targets under 44 px, and two clashing sheet styles.

**Three hard rules. Every PR must keep them:**
1. **Desktop does not change by a single pixel.** At ≥ 768 px with a mouse, the `D1`–`D4` screenshots must stay identical. Every change sits behind one of these:
   - `useIsMobile()`;
   - Tailwind base classes reset at `md:`;
   - a component that only exists on mobile (`MobileSheet`, `Panel`, `MobileActionBar`, `MobileTabBar`, `MobileNavDrawer`).
2. **No change in logic.** No new data, fields, API calls, permissions, validation, business rules or route behaviour. Every control calls a handler that already exists. You may only:
   - regroup, reorder or collapse;
   - defer to a sheet;
   - rename labels, keeping the meaning the same as desktop.
3. **Phone-friendly.**
   - every hit area ≥ 44 × 44 px;
   - one primary action per screen, pinned above the tab bar;
   - no sideways scroll of the page or inside a panel;
   - nothing that explains itself only on hover;
   - no input focuses when a sheet opens;
   - readable at 320 px wide.

## About the design files
`Mobile Redesign.dc.html` is a **design reference built in HTML**. It is a spec canvas, not production code. Open it in a browser; `support.js` must sit next to it. The task is to **recreate these designs inside the existing SuReSuite codebase** (React + Tailwind + shadcn/Radix), using its existing mobile skin components and patterns. Do not copy the HTML.

- The canvas shows every screen at 390 × 844.
- Screens that have small-screen variants also render at 320 × 568. Turn this on with the `show320` prop or the Tweaks panel.
- Landscape screens render at 844 × 390.
- Under each screen is a "Control → existing action" box: the contract for which handler each button calls.
- All sample data in the frames is in the logic class (`data()` method) of the `.dc.html` file. Read it for exact copy.

**Audit screenshots** (`01`–`41`, `D1`–`D4`) are the "before" reference. They live in the design project under `uploads/SuReSuite Mobile Audit/shots/` and are not in this bundle. Ask for them if you need them.

## Fidelity
**High-fidelity** for layout, sizes, type, colour and copy structure. It extends the existing mobile skin, so reuse the existing skin components and change only what is listed here.

Sample values in the frames are illustrative. Always render real data. Wording that **must come from existing app strings, not the mock**:
- ConfirmSheet bullets: split the existing `confirm()` message text;
- Data map counts;
- rights counts.

---

## 0. Mobile detection: one change, done first
Extend the mobile detection hook (`useIsMobile` and whatever sets the mobile shell) so the mobile shell also renders on phones held sideways:

```ts
const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)';
```

- A mouse desktop at any width ≥ 768 never matches, so desktop is unchanged.
- Expose `isLandscapePhone = matchMedia('(pointer: coarse) and (max-height: 500px) and (orientation: landscape)')` for the landscape tweaks in §5.
- Tailwind `md:` resets cover width only. Anything that must also apply to landscape phones has to go through `useIsMobile()`, not `md:` classes. Add a custom Tailwind variant `phone-land:` with `@media (pointer: coarse) and (max-height: 500px)` if convenient.

## 1. The existing skin: keep it exactly
| Element | Spec |
|---|---|
| Canvas | 93% grey (`#ededed`) |
| Panel | 1 px `#d4d4d4` border; 4 px radius; `overflow:hidden` |
| Panel head | `#fafafa`; min-height 32; padding 7 × 12; mono 10 px uppercase, letter-spacing 0.14em, `#525252`; optional counter on the right (letter-spacing 0.04em, no uppercase, tabular-nums) |
| Panel body | white; rows divided by 1 px `#e8e8ea` |
| Dark primary panel | max **one** per screen; border and head `#18181b`; head text `#fff` |
| Header | 46 px (44 px in landscape); title 19 px / 600 (17 px at 320 and in landscape), letter-spacing −0.019em; ≤ 3 icon controls, each a **44 × 44** hit area |
| Tab bar | 58 px (52 px in landscape, where icon and label sit side by side, gap 6); white; top border `#dcdcdc`; tabs **Home · Policies · Lab · Intelligence · More**; active `#171717` / 600, inactive `#8a8a8a` / 500; label 11 px; icon 20 px |
| Pinned action bar | white; top border `#dcdcdc`; padding 9 px × gutter; primary 46 px tall, `#18181b`, radius 4, 15 px / 600 white; optional secondary (outline `#d4d4d4`, 15 px / 500) on its left at equal flex; optional 12 px `#525252` reason line above the buttons |
| Gutter | 16 px (12 px at ≤ 320) |
| Type | 5 sizes only: micro 10–11 mono · row 13.5–15 · prose 14.5 · title 17–21 (one per screen) · stat 20–28. Sentence case. |
| Colour (as dot, 2 px rule or chip only) | `#bf2330` blocking / destructive · `#e0930b` warning / derived · `#14b8c4` healthy / running · `#7c3aed` product · `#F8D448` "begin here" only · neutral dot `#d4d4d4` |
| Never | emoji, gradients, blur, radius > 8 (except the sheet's 16 px top), truncated or abbreviated numbers, decorative shadows |

Fonts: Inter for UI; JetBrains Mono for micro-labels, ids, sub-lines and values (`tabular-nums`).

---

## 2. System delta: new and changed components

### 2.1 `MobileRow` (list row v2)
Used in every mobile Panel. Mobile-only, because it renders inside `Panel`.

Layout: `flex; align-items:center; gap:10px; padding:7px 6px 7px 14px; min-height:44px` (52 px when it has a sub-line). The left padding adds **16 px per indent level** (BOM tree).

Slots, left to right:
- optional 44 px checkbox hit area: 20 px box, 1.5 px border, radius 3, checked `#18181b` with a white ✓;
- 6 px status dot;
- optional 20 px numbered square: radius 3, mono 11; `#F8D448` for quick-start steps, `#18181b` for the active stage;
- **text column** (`flex:1; min-width:0`):
  - label: Inter 500, 15 px (14.5 px with sub-lines), `#171717`, line-height 1.3, **wraps, never truncates**;
  - sub-line 1: mono 10.5 px / 1.45, `#525252`, wraps;
  - sub-line 2: same style, tabular-nums;
  - optional ticks row: 8 × (14 × 2 px), gap 3, `#18181b` for on and `#e4e4e4` for off;
  - optional reason: 12 px `#525252`, line-height 1.4;
- value: mono 12.5 px / 500, tabular-nums, right-aligned;
- chip: mono 10 px, padding 2 × 6, radius 3; outline `#d4d4d4`, or `#18181b` filled for "current";
- trailing control, one of:
  - inline button: min-height 44, padding 0 14, outline `#d4d4d4`, 13.5 px / 500;
  - ★ / ☆ star: 44 × 44, 19 px;
  - ✕ remove: 44 × 44;
  - toggle: 34 × 18 pill inside a 44 × 44 hit area;
  - `›` chevron: 20 px wide, 18 px, `#8a8a8a`.

States:
- **default**: as above;
- **pressed**: background `#f4f4f5` for 120 ms;
- **disabled**: label `#a3a3a3`, the row is not tappable, and a **visible 12 px reason line** is required (e.g. "Only the project owner can delete it.");
- **destructive**: label `#bf2330` with a red dot;
- **loading**: skeleton at row height, 52 px, with bars at 55% × 11 px `#ececee` and 78% × 8 px `#f2f2f3`;
- **error**: red dot, "Couldn't load X", sub-line "the request failed — nothing was changed", and a Retry button calling the existing refetch;
- **empty** (panel level): 28 × 16 padding, centred 14 px `#525252` sentence plus an optional outline next-action button (44 px).

### 2.2 `MobileSheet`: one sheet style everywhere
On mobile, every shadcn `Dialog` / `AlertDialog` goes through a new `ResponsiveDialog`:

```tsx
const ResponsiveDialog = (p) => useIsMobile() ? <MobileSheet {...p}/> : <Dialog {...p}/>;
```

The desktop branch is the untouched original. This retires the restyled 12 px-radius dialog on mobile (screens `07`, `20`, `41`).

- **Container**: anchored above the tab bar (`bottom: var(--tabbar-h)`), white, top radius **16 px**, shadow `0 -6px 24px rgba(0,0,0,.14)` (the only shadow in the app). The scrim is `rgba(0,0,0,.32)`, with no blur.
- **Height**: `max-height: 76%` of the space above the tab bar; content-sized. The **full** variant (data, long lists) is `calc(100% - 28px)`. Add `padding-bottom: env(safe-area-inset-bottom)` when the sheet covers the tab bar region.
- **Grab bar**: a 20 px zone holding a 36 × 4 bar, radius 2, `#d4d4d4`. Drag to dismiss.
- **Header**:
  - left-aligned title, 17 px / 600, letter-spacing −0.019em, wraps;
  - optional sub, 12 px `#525252`;
  - ✕ as a 44 × 44 target on the right;
  - 1 px `#e8e8ea` bottom border.
- **Body**: `#f4f4f5`; padding 12 × gutter; gap 12; the **only** scroll container (no nested scroll); content is Panels, notes (12 px `#525252`), micro-labels and links.
- **Footer**: white, top border; optional 12 px reason line; secondary plus one primary, both 46 px.
- **Focus**: Radix `onOpenAutoFocus={e => e.preventDefault()}`. Nothing focuses on open, so the keyboard appears only when the user taps a field.
- **Stacking**: a sheet opened from a sheet (e.g. Organizations → one organization) replaces the content with a back affordance, or stacks with the same geometry. Never more than one scrim.

### 2.3 `ConfirmSheet` and `useConfirm()`
Replaces every destructive `window.confirm()`:
- delete project;
- remove member;
- remove from organization;
- delete version;
- delete scenario;
- cancel run;
- delete organization;
- delete user.

```ts
const confirm = useConfirm();
if (!(await confirm({ title, bullets, actionLabel, typedName? }))) return;
```

On desktop, `useConfirm` returns `(o) => Promise.resolve(window.confirm(originalMessage))`, so it behaves exactly as today. On mobile it opens `ConfirmSheet`.

- **Title** names the object and ends with "?". For example: "Delete Lyon Stamping Plant — FY27 resilience study?" or "Remove Sofia Marchetti from Contoso Automotive Components GmbH?"
- **Bullets** are a white panel of rows: 6 px dot, 14.5 px text, padding 11 × 14. Dots are red for permanent loss and amber for side effects. The **text is the existing confirm message split by sentence**. Add no new claims.
- **Footer**: Cancel (outline) plus a red `#bf2330` primary verb: "Delete project", "Remove", "Delete version", "Delete organization".
- **Typed-name variant** (organization, user):
  - adds a field "Type the organization name to confirm", **never auto-focused**;
  - the primary stays disabled (`#a1a1aa`) with the reason line "Type the name exactly to enable this." until the existing name check passes.
- **Loading**: the primary reads "Deleting…" and is disabled.
- **Error**: a red 12 px line above the buttons; the sheet stays open.

### 2.4 `DataTableSheet` (Project Manager → View data)
`ProjectViewData` renders `<DataTableSheet>` when `useIsMobile()`. Otherwise it renders today's inline 256 px table.

The sheet uses the full variant:
- **title**: "View data", with the project name as its sub;
- **dataset chips**: BOM · Inbound · Outbound · Node list · Deep tier. They **wrap**: min-height 44, padding 0 14, radius 4, 13.5 px / 500; active is `#18181b` fill with white text.
- **toolbar row**:
  - left: mono 11 px "6 records · page 1 of 1" (the real count, unabbreviated);
  - right: "10 rows ▾" (rows per page) and ↻ (refresh), each a 44 px outline control.
- **records**: one Panel per record. The head reads "Record 1 of 6"; each row is a column label on the left and the value on the right (mono). There is **no horizontal scroll** anywhere.
- **footer**: Close (secondary) plus **Download CSV** (primary).
- **states**:
  - loading: toolbar "Loading BOM…" plus skeleton rows;
  - empty: "No Inbound records yet. Upload data to add them." with an Upload data button (existing route);
  - error: "Couldn't load BOM" with Refresh.

### 2.5 `MobileAdminHeader` (title switcher)
On every `/admin/*` page on mobile, the header title becomes a 44 px button such as "Users ▾". It opens a sheet titled "Super admin", sub "8 sections":
- the rows are Dashboard · Users · Role Defaults · Organizations · Projects · AI Models · AI Usage · Audit Log;
- the current section shows a dark dot and the value "here";
- the others show `›`;
- each row navigates to the same route as the desktop tab strip.

**Remove** the 190 px "SUPER ADMIN · tap to switch section" panel from the mobile branch. It is already mobile-only.

### 2.6 `RightsSummary`
A row sub-line "N of M rights", where N and M are **counted from the capability list the row already receives**. Do not hardcode 6 or 8. Below it are M 2 px ticks in the fixed capability order. Tapping opens the full list as rows with a `✓` value, or `⊘` with the label muted. Desktop keeps its chip grid.

### 2.7 More-menu account block (`MobileNavDrawer`)
The last panel of the More menu, with the head "Account":
1. The user name plus role as a mono sub-line, with a **Sign out** button (existing sign-out).
2. The current organization name, with the sub-line "current organization · ★ default" (★ part only if it is the default).
3. "Switch organization", with the organization count as its value and `›`. It opens the **Switch organization** sheet:
   - one row per organization: name, with "role · ★ default" as the sub-line;
   - the current one carries a `current` filled chip;
   - every other row has a **Switch** button calling the **same `switchOrganization()`** that `/profile` uses;
   - a note: "Switching reloads the app. Each sign-in starts in your default organization, set by an administrator.";
   - footer: Close.

---

## 3. Screens
Every screen below has **desktop unchanged**. The mechanism is noted per screen. "→" means the control calls that existing action.

### P0-1 · Admin → a user's access page (`/admin/users/:id`)
Mechanism: `AdminUserAccess` renders `<MobileUserHub>` when `useIsMobile()`; the long desktop page is the else branch.

**Header**: "User access" with a Back button (44 × 44, `‹`).

**Identity panel** (no head), one row:
- name;
- sub 1: email;
- sub 2: "★ {default org} — every sign-in lands here";
- chip: platform role.

**"Access" panel** with summary rows, each with a `›`:

| Row | Sub-line | Value | Opens |
|---|---|---|---|
| Organizations | default {org} | count | Organizations sheet |
| Projects | roles summary | count | Projects sheet |
| Pages | notable denies | `9 of 11` | Pages sheet |
| Features | notable offs | `6 of 7` | Features sheet |
| AI models | default · fallback | count | Models sheet |
| Budget | `$1.44 of $25.00 this month` / `$0.12 of $3.00 today` | — | Budget sheet |

**Below**: a panel with the row "Show preview", sub "the navigation and abilities she sees on her next login" → show / hide preview.

**Pinned primary**: "Add to a project" → the existing add (person is fixed, project, role, optional end date and reason).

The sheets:
- **Organizations sheet**:
  - one row per organization: name on line 1; "role · ★ default · active" and "N members · N projects" on line 2; validity on sub 2; `›`;
  - note: "Its projects are visible when she switches to that organization.";
  - footer: Add to organization (secondary) and Done.
- **One-organization sheet**:
  - micro-label "Role", then a 3-up segmented control Owner · Admin · Member → change role, which applies immediately as on desktop;
  - row "Default organization", sub "every sign-in lands in the default", with a ★ / ☆ 44 px toggle → set or clear default;
  - info row with member and project counts and validity;
  - a separate panel with the red row "Remove from organization…" → ConfirmSheet → remove.
- **Projects sheet**: the same pattern. Rows show "role · until date · via org"; each row opens a role segmented control (Owner · Editor · Analyst · Viewer) plus "Remove from project…".
- **Pages and Features sheets** (full height):
  - one row per page, with sub "default allow · on" (or similar);
  - the value shows the current setting (Inherit / Allow / Deny);
  - tapping opens a 3-up segmented picker → the existing page or feature access toggle;
  - "My Profile" is muted with "always available" and no control, as on desktop.
- **AI models sheet**:
  - allowed models as checkbox rows (44 px hit area);
  - "Default model ›" and "Fallback model ›" open pickers of the allowed models.
- **Budget sheet** (full height):
  - panel "This month": cost this month, cost today, requests this month, requests today, as value rows;
  - panel "Budgets & limits": fields for monthly budget (USD), daily budget (USD), monthly token limit, requests / min and requests / day;
  - pinned **"Save budgets & limits"** → the existing save.

### P0-2 · Admin → Users → "Organizations" sheet
Mechanism: the content component branches on `useIsMobile()` inside the existing mobile actions sheet.

- **Sheet**: title "Organizations", with the user name as its sub.
- **Panel**, one row per organization:
  - the name on line 1;
  - "owner · default · current" on line 2: role, then "default" if it is the default, then "current" if it is the working organization;
  - **★ / ☆** (44 × 44) → set or clear default;
  - **✕** (44 × 44) → ConfirmSheet → remove from organization.
- **Note**: "Every sign-in lands in the default organization (★)." followed by the link **"What's the default?"** (44 px tall, underlined, `›`). The link opens a small sheet: the existing 4-line explanation split into 4 bullets, with a "Got it" button.
- **Footer**: "Add to organization" (secondary) opens the add sheet; "Done" is the primary.
- **Add sheet**:
  - "Organization ›" row opens a picker;
  - "Role there" 3-up segmented control: Owner / Admin / Member;
  - the primary "Add" is disabled until an organization is chosen, with the reason "Choose an organization first.";
  - Back is the secondary.

### P1-2 · Admin lists: Users, Projects, Organizations
Mechanism: only the existing mobile list branch changes.

- **Header**: the title switcher ("Users ▾"), plus a refresh icon (↻, 44 px).
- **Search**: full width, 44 px tall, outline `#d4d4d4`, radius 4, 15 px placeholder ("Search name, email, organization"). It is **not** auto-focused.
- **One row per record.** No separate "Actions" row. Tapping the row opens its actions sheet.
  - **Users**:
    - dot: teal for active, `#d4d4d4` for suspended;
    - sub 1: "{platform role} · ★ {default org} · +N orgs" (or "· now in {current org}");
    - sub 2: "${spent} of ${budget} this month · until {validity}";
    - all values come from the existing record.
  - **Projects**: name; sub 1 the organization; sub 2 the owner; chip draft / done.
  - **Organizations**: name; sub 1 "N members · N projects"; sub 2 the plan and validity.
- **Pinned primary**: "Add user", "Add organization" (or the existing equivalent per page).
- **User actions sheet**: the title is the name, the sub repeats sub-line 1. It holds every existing action of the current actions row, **in today's order**, as `›` rows: Manage access · Organizations… · Change role… · … · Suspend (red).
- **Organization actions sheet**: the four "Valid for 1 week / month / quarter / year" rows (plus "Remove expiry" if it exists) fold into one row, **"Access period…"**, valued "until {date}". It opens a picker sheet listing those exact existing actions.
- **States** (each list):
  - loading: 3 skeleton rows;
  - empty (search): "No users match "lyo"." with a Clear search button;
  - error: a row "Couldn't load users", with a Retry button.

### P1-1 · ConfirmSheet cases to verify
- Delete project, from the Projects actions sheet and from Project Manager.
- Remove a person from an organization (P0-1, P0-2).
- Delete a policy version (Policies → Version history).
- Typed-name: delete organization, delete user.

Copy and spec are in §2.3.

### P1-3 · Members & access (a project)
Mechanism: `ProjectMembersDialog` goes through `ResponsiveDialog`; a new mobile content branch.

**Sheet** (full height): title "Members & access", with the project name as its sub.

**Body, in order:**
1. A one-line note: "Super admins are owner on every project and appear only when recorded here."
2. Panel **"With a project role · N"**, one row per member:
   - label "Name · Role · until date";
   - sub 1: "via {org}" / "delegated by {name}" / "granted by {name}";
   - sub 2: RightsSummary "N of M rights";
   - `›`.
3. Panel **"No project role · N"**: people who see the project through the organization. Sub: "Viewer rights · 2 of 8".
4. The link **"What each role grants"**, which opens the legend sheet.

**Footer**: "Add member" (secondary) and "Done".

The member and legend sheets:
- **Member sheet**:
  - title the name, sub "Role · until · delegated by";
  - "Project role" 2 × 2 segmented control (Owner, Editor, Analyst, Viewer) → change role;
  - panel "Rights · N of M", with one row per capability valued `✓` or `⊘` (muted);
  - red row "Remove from project…" → ConfirmSheet → remove;
  - Done.
- **Add member sheet**:
  - "Person ›" opens a picker;
  - "End date ›", sub "empty = standing membership";
  - Role 2 × 2 segmented control;
  - "Why (optional)" field;
  - the existing note about people outside the organization;
  - primary Add, disabled with "Choose a person first.";
  - Back.
- **Role legend sheet**, read-only:
  - one row per role: label, a sub such as "7 of 8 · everything but manage members", and the tick row;
  - a note stating the tick order: sees project · edits settings · view data · edit input data · edit policies · run simulations · export · manage members (use the app's real capability labels);
  - Done.
- **States**:
  - loading: skeleton rows;
  - empty: "No one holds a project role yet." with an Add member button;
  - error: Retry.

### P1-4 · My profile (`/profile`)
Mechanism: `Profile` renders `<MobileProfile>` when `useIsMobile()`.

**Header**: "My profile". The tab bar shows More as active.

**Tabs**: a **2 × 2 segmented control** fits 320:
- items Profile · My access · My organization · Change password;
- padding 4, gap 4, outer radius 5, 40 px items, 13 px / 500, active `#18181b`;
- each item switches to the existing tab.

**Profile tab:**
- Panel "You can edit · 3":
  - "Avatar colour" row (dot plus value, `›`) opens a swatch sheet;
  - User name field, with the existing hint;
  - Phone field.
- Panel "Account":
  - User ID (mono sub) with a **Copy** button;
  - Name (value) with the reason "Changed only by an administrator.";
  - Email (mono sub);
  - Role (value).
- Panel "Your organizations · N": rows "role · ★ default · current". The others have a **Switch** button → `switchOrganization()`.
- Panel "Plan": Valid for · Valid until (with the existing note "Does not apply to super admins.") · Organization users "7 of 50" · Organization projects "4 of 25".
- **Pinned primary**: "Save changes" → the existing save.

**My organization tab:**
- members panel: name, with "role · account type" as the sub;
- the note "Read-only — an administrator makes changes.";
- the existing project picker (full-width chip);
- a project-roles panel with RightsSummary rows (tap opens the read-only rights sheet);
- the link "What each project role grants".

**My access tab**: read-only rows.

**Change password tab**: its existing fields in one panel, with a pinned primary.

**More menu**: add the account block from §2.7.

### P1-5 · Project Manager → View data
Covered by `DataTableSheet` (§2.4). Two other changes:
- **Project actions** open as a sheet listing every existing action as rows:
  - View data;
  - Upload data;
  - Edit item master;
  - Generate node list. When disabled, it shows the visible reason "Upload BOM, inbound and outbound first — the node list is combined from them.";
  - Combine datasets;
  - Edit project;
  - Delete project (red), through ConfirmSheet.
- The mobile page title reads **"Project Manager"**, matching the menu (today it says "Your Projects").

### P1-6 · Dense reference tables: Data map and role legend
Rule: **defer, never truncate.** Mechanism: `DataMap` renders `<MobileDataMap>` when `useIsMobile()`.

**Data map screen** (inside Policies):
- the project chip;
- the existing tabs as a segmented control (Policies · Guide · Data map), 44 px;
- the view switch as a segmented control (Policies page · Uploaded data → engine);
- Panel "Columns by effect · {total}", one row per effect with a coloured dot and its **count, computed from the existing column spec**:
  - Changes the run (teal);
  - Only when… (amber, with a 12 px explainer);
  - Shown ≠ run (red);
  - Ignored by the run (red);
  - Disabled (grey);
  - Information (grey);
- the existing provenance note;
- a row "All {n} columns ›".

Tapping an effect row opens a full sheet filtered to that effect:
- effect chips at the top (44 px);
- one Panel per column, headed with the column name;
- inside, rows for Shows / Edit saved to / Engine uses / Changes the run, taken from the existing table cells.

**Role legend**: see P1-3.

### P1-7 · About and Docs
Mechanism: the About and Help routes render inside the mobile shell when `useIsMobile()`; the desktop public layout is unchanged.

**Both pages keep the tab bar** (More active).

**About:**
- the existing content as an intro (21 px headline with the serif-italic last clause, plus 14.5 px prose);
- Panels: Home · Funded by (chip "running") · Key people;
- **pinned primary: "Open app"** → `/app` when signed in; signed-out users keep "Get started".

**Docs:**
- **one header**, "Documentation", with ⌕ (existing search) and ≡ (section tree), both 44 px;
- the intro, then a "Start here" panel;
- pinned "Start reading";
- the **section tree is a full sheet**, "Sections · 15", not a push-down: one row per section, with the number as a mono sub, a "7 of 7" style value and `›`.

### P1-8 · Touch-target and label pass
Mechanism: base classes reset at `md:` (e.g. `h-11 w-11 md:h-8 md:w-8`) for sizes. Short labels come from a `mobileLabel` prop used only when `useIsMobile()`.

| Element | Today | Mobile |
|---|---|---|
| Header icon buttons (Refresh, avatar, Back) | 32 × 32 | 44 × 44 hit area (the avatar's visible circle stays 32) |
| Project chip | 26 px tall, truncates | ≥ 44 px, wraps to 2 lines, mono 11.5 |
| Version history Export / Load / Select (`07`) | 28 px | move into the version row's sheet as 44 px rows |
| Data map tabs (`08`) | 20 px | 44 px segmented control |
| Create API key checkboxes (`41`) | 16 px | 20 px visible box in a 44 px hit area; the whole row toggles |
| Version note "edit" | 10 px link | "Edit note" 44 px outline button in the row |
| View data rows selector and icons | 24–28 px | 44 px |
| Toast close | small | 44 × 44 |

Segmented labels at 320:
- Developer: "API keys" → **"Keys"**; Quickstart and Notebook are kept whole.
- Audit: "Sign-ins & exports" → **"Sign-ins"**; "Data changes" → **"Data"**. Result: All · Sign-ins · Data · Admin.
- Lab: Setup · Events · Run · Results · Compare, at 13 px with 2 px horizontal padding, `minmax(0,1fr)` columns, so "Compare" fits at 288 px content width.

### P2 · Consistency
- **Sheets**: everything goes through `MobileSheet` (§2.2).
- **Toasts**: on mobile, the Sonner toaster's offset sits 8 px above the tab bar, plus the action bar if one is pinned.
  - style: white, 1 px `#d4d4d4`, radius 4, min-height 48, a 6 px dot, 14 px text, a 44 × 44 ✕;
  - no shadow, and never on top of the tab bar.
- **AI area name**: the tab is "Intelligence"; the page title and menu entry are **"Project Intelligence"**, the same as desktop. Change the mobile nav config only.
- **Project Manager**: the mobile title is "Project Manager".
- **Policies stage list (`MobileStagePolicyList`) — BOM tree**:
  - the root row (finished good) has the sub "level 0 · finished good · {plant}";
  - each component row is indented **16 px per BOM level**;
  - label: the part number;
  - sub 1: "level N · in {parent}";
  - sub 2: the status (e.g. "needs supplier") with a red dot when blocking;
  - **Qty/assy is the right-aligned value**, "2 per assy", and never moves into the sub-line;
  - `›` opens the existing line editor.
- **Hover-only reasons** become a visible 12 px `#525252` line under the control: why Delete is disabled, data freshness, result credibility.

---

## 4. Landscape (844 × 390, touch, height < 500)
Mechanism: §0 detection plus `isLandscapePhone`.

- **Bars**: the tab bar is 52 px, with icon and label in a row; the header is 44 px.
- **The pinned action bar merges into the header**: the primary is 36 px tall, padding 0 16, 13.5 px / 600, at the far right of the header. Disabled is `#a1a1aa`, with the reason shown as the first content line.
- **Content**: a 2-column grid (`repeat(2, minmax(0,1fr))`, gap 12, padding 6 × 16). Tall panels `grid-row: span 2`; notes and search span `1 / -1`.
- **Never shown** in the mobile shell: icon sidebar, desktop header, black credit footer, floating AI bubble.

Per screen:
- **Home**:
  - header "Getting started", avatar, header primary "Continue";
  - left column: dark "Where you left off" panel;
  - right column: the Quick start panel (yellow step numbers), spanning 2 rows.
- **Policies**:
  - the header carries the project chip (32 px, truncation allowed here only for the chip label, with the full name in the chip sheet) and "Save model version";
  - left column: Model version and Planning unit;
  - right column: the dark "Configure SC policies" stage list.
- **Lab**:
  - the header carries the 5-segment control and "Save version & run" (disabled with its reason);
  - the first line of content is the unsaved-state note (spanning both columns), then the dark gate panel, Experiment design, and Scenario.
- **Admin users**:
  - the header shows "Users ▾", ↻ and "Add user";
  - search spans both columns;
  - the user panel lays its rows out in **2 columns**.

---

## 5. States: required in the build
| Surface | Loading | Empty | Error |
|---|---|---|---|
| Admin lists | 3 skeleton rows; the counter shows "…" | "No users match "{q}"." + Clear search | "Couldn't load users" row + Retry |
| View data | toolbar "Loading {dataset}…" + skeleton record | "No {dataset} records yet. Upload data to add them." + Upload data | "Couldn't load {dataset}" + Refresh |
| Members & access | 2 skeleton rows | "No one holds a project role yet." + Add member | "Couldn't load members" + Retry |

Skeletons sit at row height so lists don't jump. Retry and Refresh call the existing refetch.

---

## 6. Ideas that would need logic (OUT OF SCOPE: do not build)
- "Last active" on each user row.
- Search and filter inside View data records.
- Per-user spend history over time.
- Undo after a removal (needs a restore endpoint).
- A push notification when a run finishes.
- Data map effect counts for the selected project only (today the counts describe all projects).

---

## 7. Suggested implementation order (one PR each)
1. §0 detection change, plus the `isLandscapePhone` hook. Check desktop at 1280 against D1–D4.
2. `MobileSheet` v2 plus `ResponsiveDialog` (with no-autofocus). Swap the dialogs over.
3. `useConfirm` / `ConfirmSheet`. Replace every destructive `window.confirm` call site (grep `confirm(`).
4. `MobileRow` v2 (two sub-lines, states). Migrate the existing mobile rows.
5. `MobileAdminHeader`, plus the admin lists (P1-2), plus the Organizations sheet (P0-2).
6. `MobileUserHub` (P0-1).
7. Members & access (P1-3) plus `RightsSummary`.
8. `MobileProfile` (P1-4), plus the More-menu account block.
9. `DataTableSheet` (P1-5) plus `MobileDataMap` (P1-6).
10. About / Docs in the mobile shell (P1-7).
11. Touch-target and label pass (P1-8), toasts, naming, BOM tree, visible reasons (P2).
12. The landscape layouts (§4).

## 8. Acceptance checklist (every PR)
- [ ] At 1280 px with a mouse, the screenshot diff against D1–D4 is empty.
- [ ] No new data, API call, permission, validation or route behaviour; each control calls an existing handler.
- [ ] Every change is scoped to `useIsMobile()`, `md:` resets, or a mobile-only component.
- [ ] No page-level or in-panel sideways scroll at 320 px; nothing is cut off at the right edge.
- [ ] Every hit area is ≥ 44 × 44, including icon buttons, chips, checkboxes and links.
- [ ] One primary action per screen, pinned above the tab bar (in the header in landscape).
- [ ] No input focuses when a sheet opens.
- [ ] Destructive actions go through ConfirmSheet on mobile, never `confirm()`.
- [ ] Nothing explains itself only on hover.
- [ ] Numbers are never truncated, rounded for display or abbreviated.
- [ ] No emoji, gradients, blur, large radii, or shadows other than the sheet's.

## Design tokens (quick reference)
- **Ink and neutrals**:
  - ink `#171717`, primary `#18181b`;
  - body `#525252`, quiet `#737373` / `#8a8a8a`, muted label `#a3a3a3`;
  - borders `#d4d4d4`, dividers `#e8e8ea`, chrome border `#dcdcdc`;
  - panel head `#fafafa`, sheet body `#f4f4f5`, canvas `#ededed`;
  - skeleton `#ececee` / `#f2f2f3`, disabled primary `#a1a1aa`.
- **Semantic**: red `#bf2330` · amber `#e0930b` · teal `#14b8c4` · violet `#7c3aed` · begin-here yellow `#F8D448`.
- **Radii**: 3 (chips, checkboxes, segment items) · 4 (panels, buttons, inputs) · 5 (segmented outer) · 16 (sheet top only).
- **Spacing**: 6 / 8 / 12 / 16 / 24 / 32; gutter 16 (12 at 320).
- **Heights**:
  - row ≥ 44 (52 with sub-lines);
  - header 46 / 44 (landscape);
  - tab bar 58 / 52;
  - action bar 64, with a 46 px button;
  - sheet grab zone 20.
- **Shadow** (sheet only): `0 -6px 24px rgba(0,0,0,.14)`. Scrim: `rgba(0,0,0,.32)`.

## Assets
- No images.
- Icons are **lucide-react** (already in the app). The mock uses Unicode stand-ins: ‹ = `ChevronLeft`, ↻ = `RefreshCw`, ⌕ = `Search`, ≡ = `ListTree` or `Menu`, ✕ = `X`, ★ / ☆ = `Star` filled / outline.
- The tab-bar icons are drawn by hand in the mock; use the app's existing ones. Keep the functional glyphs `› ▾ ✓ ⊘ ·` as text.

## Files
- `Mobile Redesign.dc.html`: the full spec canvas (every screen, state and control → action map). Sample data and copy are in its logic class.
- `support.js`: the runtime needed to open the `.dc.html` file locally.
- `CLAUDE_CODE_PROMPT.md`: a kickoff prompt to paste into Claude Code.
