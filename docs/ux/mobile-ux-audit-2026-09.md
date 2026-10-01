> **Status: AUTHORED** · 2026-09-30 · mobile only (viewport < 768 px) · audit of `main` @ `e685e07`
> Companion brief for the redesign: [`claude-design-mobile-prompt.md`](./claude-design-mobile-prompt.md) · Screenshots: [`mobile-audit-shots/`](./mobile-audit-shots/)

# Mobile UX / UI audit — September 2026

## 0. The three rules every recommendation obeys

1. **Super friendly to a phone user.** The yardstick for each finding is the user's task on a phone:
   - reachable with a thumb;
   - one obvious primary action;
   - no sideways scrolling;
   - readable at a glance;
   - 44 px touch targets;
   - no information hidden behind hover.
2. **Mobile only.** Every fix applies below 768 px and nowhere else. The desktop layout (≥ 768 px) must look and behave exactly as it does today. Every "Mobile-only fix" line below says how that is guaranteed, using one of four mechanisms:
   - an `isMobile` branch (`useIsMobile`, `src/hooks/use-is-mobile.ts`);
   - base classes reset at `md:`;
   - a component that only renders on mobile (`MobileSheet`, `Panel`, `MobileActionBar`, `MobileNav`, …);
   - a new `Mobile*` component.
3. **No change in logic.** Fixes change presentation and interaction only. The following stay as they are:
   - data, queries and RPCs;
   - permissions, capabilities and validation;
   - business rules;
   - state shape.

   A mobile component calls the **same** handlers and hooks the desktop already uses. Anything that would need more than that is listed separately in §7, *Out of scope — needs logic or a global change*.

## 1. Scope and method

| | |
|---|---|
| **Widths** | 390 × 844 (iPhone 13/14, primary); 320 × 568 (smallest supported); 844 × 390 (phone landscape). 1280 × 800 captured as the desktop "must not change" reference |
| **Build** | Vite dev server, Chromium (Playwright 1.56) with the iPhone 13 device profile (touch, DPR 2) |
| **Data** | The live database cannot be reached from the audit sandbox, so every Supabase call was answered with mock data. The data was realistic and deliberately long (e.g. *"Rahul Venkataraman-Iyer"*, *"Contoso Automotive Components GmbH"*) to stress truncation. Signed in as a super admin so every page was reachable |
| **Coverage** | 41 captures across 23 routes. Interaction states included: More menu, 9 bottom sheets and dialogs, a native `confirm()`, and focus-on-open |
| **Runtime checks** | Run per screen: horizontal overflow, tap targets < 44 px, text < 11 px, and whether focus lands in an input when a sheet opens |
| **Static checks** | `npm run audit:ui` passes (591 files, 0 new violations, 7 baselined). §8 lists what it cannot see |
| **Not covered** | Real devices; the iOS Safari keyboard and viewport-resize behaviour; VoiceOver/TalkBack; live data volumes. Mock values (e.g. "1250 d" horizons) are fixture noise, not findings |

Severity:
- **P0**: a phone user cannot finish the task, or the screen is visibly broken.
- **P1**: major friction or loss of information.
- **P2**: polish or consistency.

## 2. Executive summary: the ten that matter

| # | Sev | Finding | Where | Shot |
|---|---|---|---|---|
| 1 | **P0** | Organization rows on **/admin/users/:id** break the name and details one word per line. The role switch overlaps the text. The page is about 6 000 px tall on a phone | `UserMemberships.tsx:145-165` | `17-admin-user-access`, `17a-…-orgs` |
| 2 | **P0** | The **Organizations sheet** on /admin/users is wider than the screen. Its title runs under the close ✕, and the "current" badge and every row's action buttons are off-screen | `AdminUsers.tsx:405-432` | `16-admin-users-orgs` |
| 3 | **P0** | A **phone held sideways** gets the full desktop layout: icon sidebar, desktop header, a credit footer over content, and the floating AI bubble over the grid. 844 px wide is ≥ 768 | `use-is-mobile.ts:12-27` | `35-policies-landscape`, `36-admin-users-landscape` |
| 4 | **P1** | **Destructive actions use the browser's `confirm()`** (13 call sites), not the app's bottom sheet. This includes every new organization, project-member and project-delete flow | §3.2 | logged at runtime (a native dialog cannot be screenshotted) |
| 5 | **P1** | **Admin list rows cut their key facts to one line.** The new default organization, accessible organizations, role, plan and limits (D210, D216, D218) are invisible on a phone. Each user also gets a second "Actions" row, doubling the list | `mobile/Panel.tsx:181-183`, `AdminUsers.tsx:205-210` | `14-admin-users` |
| 6 | **P1** | **/profile has no mobile design.** It uses desktop cards and a 4-tab strip that scrolls sideways ("Chang…" cut off). One very long form has an unpinned Save. The organization switcher exists only here, not in More | `Profile.tsx:195-200` | `12-profile`, `13-profile-org` |
| 7 | **P1** | **Members & access sheet** (new, D215): the title and a 4-line description take the first screen. A 5-field form comes before the member list. The ✕ is a boxed 60 px button over the title, and the body scrolls inside a sheet that also scrolls | `ProjectAccess.tsx:107-120, 286` | `20-admin-project-members` |
| 8 | **P1** | **"View data" opens inline** at the bottom of Project Manager, not in a sheet. Its table is a 256 px box that scrolls both ways, with 24 px tabs and controls and "Outbound" cut off | `ProjectDataViewer.tsx:59, 264, 418-487` | `04-pm-view-data`, `04c-…-table` |
| 9 | **P1** | **Header icon buttons are 32 × 32** on every admin page and on Home (Refresh, Your profile, Back). The project chip on Policies, Lab and SC Intel is 26 px tall | `shared/PageHeader.tsx` right slot | runtime checks |
| 10 | **P1** | **About and Docs drop the app shell.** They have no tab bar. A signed-in user on /about is only offered "Get started → /auth" | `About.tsx:285`, `docs/DocsLayout.tsx` | `26-docs`, `27-about-signed-in` |

What already works well is listed in §9. The mobile skin (panels, pinned action bar, tab bar, sheets) is strong on Home, Policies, Lab, SC Intel and Developer. **The problems cluster in the admin, organization and profile work of the last six weeks, which was built desktop-first**.

## 3. App-wide findings

### 3.1 Shell and navigation
- **N1 · P0 · Landscape phones get desktop.**
  - `useIsMobile` is width-only (`max-width: 767px`). Every current iPhone and Android phone is 780–932 px wide in landscape, so it renders the desktop sidebar, a 46 px desktop header and the `Footer` credit bar, which is drawn *over* the content (`35`).
  - The skin spec's landscape rules (52 px bars, `useCompactChrome`) never apply on those devices.
  - *Mobile-only fix:* treat `(max-width: 767px), (pointer: coarse) and (max-height: 500px)` as mobile, in the one hook and one matching Tailwind custom variant. A desktop mouse never matches the second query. Tablets in portrait stay as they are.
- **N2 · P1 · About and Docs leave the shell.**
  - `/about` and `/docs` do not use `PageLayout`, so there is no tab bar.
  - On /about a signed-in user sees only "Get started", which goes to /auth (`About.tsx:285`).
  - On Docs, only "Open app" returns to the app, and there are two stacked headers.
  - *Mobile-only fix:* render `MobileTabBar` on these routes below 768 px, and swap the CTA for "Open app" when `user` exists (reading the same `useAuth`).
- **N3 · P2 · More menu account row.**
  - It shows the raw role token `super_admin` (`MobileNav.tsx:279`).
  - It has no current-organization name and no organization switcher. The desktop account menu has both.
  - The avatar ignores the user's chosen `avatar_color`.
  - *Mobile-only fix:* the row lives inside `MobileNavDrawer`. Reuse the switch handler Profile already calls.
- **N4 · P2 · Tab label drift.** The tab reads "SC Intel" while the page title reads "SC Intelligences" and the More menu reads "Project Intelligence". Three names for one place. *Mobile-only fix:* copy in mobile components only.
- **N5 · P2 · Admin section switcher costs about 190 px on every admin page.**
  - A "SUPER ADMIN · 8 sections / Users · tap to switch section" panel sits above the content (`AdminLayout.tsx:161-194`).
  - The search field beside "Add user" is about 160 px wide, so its placeholder is cut off (`14`).
  - *Mobile-only fix:* collapse it into the page header as a title-dropdown ("Users ▾"), and make search full-width on its own row.

### 3.2 Sheets, dialogs and confirmation
- **S1 · P0 · A sheet wider than the screen** (`16`).
  - `DialogContent` is a CSS grid whose implicit column sizes to *min-content*. A `truncate` (nowrap) organization name therefore pushes the track past the viewport, and nothing shrinks.
  - *Mobile-only fix:* add `grid-cols-[minmax(0,1fr)]` to `DIALOG_AS_SHEET`'s base (pre-`md:`) classes (`shared/index.ts:69`), and let the membership row wrap below `md`.
- **S2 · P1 · Native `confirm()` for destructive actions.**
  - Call sites:
    - `UserMemberships.tsx:109,122`
    - `ProjectAccess.tsx:90`
    - `AdminProjects.tsx:89`
    - `AdminModels.tsx:56`
    - `ScenarioRail.tsx:171`
    - `PolicyVersionSheets.tsx:167,475`
    - `RunValidateStage.tsx:805`
    - `RunQueueConsole.tsx:172`
    - `SimulationLab.tsx:203`
    - `DataManager.tsx:691`
    - `lib/projects/projectDeletion.ts:37`
  - On a phone, `confirm()` shows an unstyled system alert with the URL as its title, and it cannot say what will be lost.
  - *Mobile-only fix:* on mobile, show a shared `ConfirmSheet` built on `MobileSheet`, with a red primary button and a list of consequences. It resolves the same boolean the `confirm()` call returned, so the handler is unchanged. Desktop keeps `confirm()` until someone decides otherwise.
- **S3 · P1 · Two sheet systems.**
  - `MobileSheet` is the skin's version: z-45, drag to dismiss, stops above the tab bar, 16 px radius.
  - `DIALOG_AS_SHEET` is a Radix dialog restyled: z-50, *covers* the tab bar, no drag handle, no safe-area inset, 12 px `rounded-t-xl`, and its close ✕ sits in the title row.
  - About 27 dialogs use the second. Users see two kinds of sheet with different handles, corners and stacking.
  - *Mobile-only fix:* align `DIALOG_AS_SHEET`'s pre-`md:` classes: `pb-[env(safe-area-inset-bottom)]`, 16 px top radius, a grab bar, title left-aligned with the ✕ in its own 44 px slot.
- **S4 · P1 · Keyboard pops on open.**
  - `autoFocus` on Rename (`AdminOrganizations.tsx:302`), both typed-name delete confirmations (`AdminOrganizations.tsx:403`, `AdminUsers.tsx:538`) and Create API key (`41`).
  - On iOS the keyboard covers half the sheet before the user has read what they are confirming.
  - *Mobile-only fix:* `autoFocus={!isMobile}`.
- **S5 · P2 · Centred titles and descriptions in sheets** (`20`, `41`) read as a desktop modal. The skin's sheets are left-aligned. *Mobile-only fix:* `text-left` before `md:`.
- **S6 · P2 · `MobileSheet` accessibility.** No Escape handler and no focus return (`MobileSheet.tsx:100`). The More panel has no focus trap. These matter for external keyboards and VoiceOver. *Mobile-only fix:* the component only renders on mobile.

### 3.3 Feedback
- **F1 · P1 · Toasts from six screens never appear** (on any device):
  - `ProjectDataViewer`
  - `UploadWizard`
  - `ProjectCard`
  - `DeveloperApi`
  - `Auth`
  - `Profile`

  Each calls `@/hooks/use-toast` (the shadcn reducer), but `ui/toaster.tsx` is not mounted. `App.tsx:292` mounts only Sonner. So on a phone, "Profile saved", "Key created", "Upload failed" and every View-data error go nowhere. **See §7:** the true fix is global.
- **F2 · P2 · Sonner toasts sit on top of the tab bar** (`11`, "Loaded 13 records for project"). Their 20 px close ✕ is a 20 × 20 target. *Mobile-only fix:* `<Toaster offset>` / `mobileOffset` set to `var(--pi-chrome)` plus the safe area, below 768 px only. Also suppress success toasts that only report a load.

### 3.4 Touch targets (runtime-measured, 390 px)
- **T1 · P1** — the ones found at runtime:
  - 32 × 32 header icon buttons on every admin page, Home, Network and Developer.
  - The 26 px project chip (Policies, Lab, SC Intel, Network).
  - 28 px buttons in the Verifiable-exports block of Version history (`07`).
  - 20–24 px Data map segmented tabs (`08`).
  - 16 px checkboxes in Create API key (`41`).
  - 24 px `h-6` controls in View data (`ProjectDataViewer.tsx:59,479`).
  - The `h-6` Save/Cancel on version notes and the 10 px "edit" link (`PolicyVersionSheets.tsx:366,380,393`).
- **T2 · P2 · `MobileButton` drops to 40 px in landscape** (`mobile/Controls.tsx:52`), below the 44 px floor.
- *Mobile-only fix:* `min-h-11 min-w-11 md:min-h-0 md:min-w-0`, or the negative-margin hit-area pattern (spec §2.4), so the visible size can stay compact.

### 3.5 Tables and dense data
- **D1 · P1 · Tables that scroll both ways inside a scrolling page:**
  - View data (`ProjectDataViewer.tsx:264`);
  - the Data map's two grids (≈ 700 px and 950 px wide; `PolicyColumnCheck`, `DataMapGrid`);
  - the role legend (`UserMemberships.tsx:394`, `min-w-[420px]`), shown in three places.

  The skin rule (§10 "defer, never truncate") is summary on screen and the full table in a full-height sheet.
  *Mobile-only fix:* a `MobileTableSheet` that takes the same rows array the desktop table already receives.
- **D2 · P1 · The capability "dot wall".**
  - Each person in Members & access, My Organization and /admin/users/:id shows 6–8 ✓/⊘ capability chips (`13`, `20`).
  - With 5 people that is 40 chips to parse.
  - *Mobile-only fix:* show the role name plus "5 of 6 rights", and tap for the list. The data is unchanged.

### 3.6 Typography, copy and truncation
- **C1 · P2 · Monospace sub-lines truncate on 390 px** everywhere:
  - admin rows;
  - Lab rows ("Stress-tests the Lyon net…");
  - Developer ("sk_undefined_undefined_••••", fixture-driven, but the field has no room).

  Where the truncated part is the *only* place a fact appears, that is P1 (see finding 5).
- **C2 · P1 · Segmented labels truncate or wrap:**
  - Developer "API k… | Quickst… | Notebook" (`25`);
  - Audit "Sign-ins & exports" wraps to two lines at 320 px (`32`);
  - the Lab's 5-item control clips "Compare" at 320 px (a known deviation).

  *Mobile-only fix:* shorter labels on mobile ("Keys · Start · Notebook"), or a horizontally scrollable chip row with a fade edge.
- **C3 · P2 · Mixed date formats.** Dates render in the browser locale (`12/31/2026`) next to spelled-out dates ("Sep 29, 12:00 AM") and ISO dates elsewhere. On a narrow row, the long forms are what gets truncated. *Mobile-only fix:* display formatting in the mobile components only; the data is unchanged. (The "granted by" uuids in the `13`/`20` screenshots are an artefact of the mock data. The real read returns a name.)
- **C4 · P2 · Too much small text.** The runtime check counts 50–195 text nodes below 11 px on Policies, Data map and Version history. Some are the skin's intended 10 px micro-labels, but explanatory paragraphs at 11 px on a phone are hard to read.

## 4. Recent development: deep dive

| Area (feature) | Status on phone | Findings |
|---|---|---|
| **/admin/users** (D210 Default vs Accessible organizations, add-user dialog) | ⚠ P1 | Finding 5: the new organization columns are invisible, each row is doubled by an "Actions" row, and sort and filter are desktop-only. **Organizations sheet is P0 (S1)**. The delete sheet focuses the email field on open (S4) |
| **/admin/users/:id** (D210/D211/D216 memberships, rights) | ✗ **P0** | Organization rows collapse (finding 1). The page is about 6 000 px tall: organizations, projects, add-to-project, pages, features, AI models, budgets, then the preview panel open at the very bottom (`AdminUserAccess.tsx:58`). "Save budgets & limits" is not pinned. The add forms are stacked 5-field forms |
| **Members & access** (D215) | ⚠ P1 | Finding 7 and the dot wall (D2). Remove uses `confirm()` (S2) |
| **/admin/projects** (D212 transfer/owner) | ✓ list · ⚠ dialogs | The actions sheet is good (`19`). The Copy, Metadata and Transfer dialogs have about 32 px select options (`AdminProjects.tsx:236-371`). Delete uses `confirm()` |
| **/admin/organizations** (D207 plan, D218 limits) | ⚠ P1 | The actions sheet has 10 rows, 4 of them "Valid for 1 week / month / quarter / year" (`22`). Collapse them into one "Access period…" row that opens a picker. "Access defaults" opens a right-side panel, not a bottom sheet (`OrgAccessDrawer.tsx:109`). Rename focuses its field on open |
| **/admin/audit** | ⚠ P2 | The plane segmented control wraps at 320 px (C2). "What they do" is desktop-only. The "All entries" sheet renders every row at once |
| **/profile** + **My Organization** (D206/D209/D217) | ⚠ P1 | Finding 6: desktop cards, a tab strip that scrolls sideways, 11 px explanatory text, the dot wall, and a role legend table. The organization switcher (D210) is reachable only here |
| **Project Manager → View data** (every role since `b8a3fc0`) | ⚠ P1 | Finding 8. Also, the "Connect a data source" panel is a desktop card nested inside a mobile card (`04c`) |
| **Policies → Version history / Data map** | ⚠ P1 | A 7-line explanatory block before the first version. 28 px buttons. "Delete" is disabled with its reason only on hover (`PolicyVersionSheets.tsx:325-340`). The Data map shows desktop tables (D1) |
| **Policies → stage list** | ✓ | `MobileStagePolicyList` reads well (`06`). Gap: the multi-level BOM tree and Qty/assy columns (recent) have no mobile rendering. Needs a design, not logic |
| **AI assistant launcher toggle** | ⚠ P2 | The floating bubble is `hidden md:flex` (`FloatingChatBubble.tsx:306`), so the new admin setting has no effect on phones. Say so beside the setting (copy only) |
| **Docs manual link** (super admins) | ⚠ P1 | N2: leaving the tab bar behind strands the user |

## 5. Page by page

| Route | Verdict | Top issue(s) | Shots |
|---|---|---|---|
| `/app` Home | ✓ | 32 px avatar button; a large empty area below Quick start | `01` |
| More menu | ⚠ | N3; slides in from the left although full-width | `02` |
| `/project-manager` | ⚠ | "Project Manager" in the nav vs "Your Projects" as the title; View data (finding 8) | `03`, `04*` |
| `/policies` | ✓ / ⚠ | "MODEL SETUP" label touches the panel above it (spacing); 26 px project chip | `05`, `06` |
| `/policies` Version history | ⚠ | See §4 | `07` |
| `/policies` Data map | ✗ | Desktop tables (D1); 20 px tabs | `08` |
| `/simulation-lab` | ✓ | The action bar plus tab bar take 230 px; the disabled primary action is explained in a visible line (good) | `09`, `34` |
| `/project-intelligence` | ✓ | Naming (N4) | `10` |
| `/network/*-level` | ✓ / ⚠ | The graph is honestly deferred to desktop (good); a toast over the tab bar (F2); a two-line title | `11` |
| `/profile` | ✗ | Finding 6 | `12`, `13` |
| `/admin` (overview) | ✓ | — | — |
| `/admin/users` | ⚠ / ✗ | Finding 5 and S1 | `14`, `16` |
| `/admin/users/:id` | ✗ | Finding 1 | `17`, `17a` |
| `/admin/projects` | ⚠ | Finding 7; `confirm()` | `19`, `20` |
| `/admin/organizations` | ⚠ | 10-row actions sheet | `22` |
| `/admin/audit` | ⚠ | C2 | `32` |
| `/developer` | ⚠ | Truncated tabs (C2); desktop dialogs with 16 px checkboxes (`41`) | `25`, `41` |
| `/docs` | ⚠ | N2 | `26` |
| `/about`, `/` | ⚠ | N2 (the CTA for signed-in users) | `27` |
| `/auth` | ✓ | "Forgot password?" is an 18 px-tall link | `29` |
| `/network/interactive-space` | ⚠ | Renders the full React Flow graph on phones, although the spec says findings-only. No nav entry | — |
| Any route, landscape | ✗ | N1 | `35`, `36` |

## 6. Prioritised backlog (all mobile-only, no logic)

| ID | Sev | Change | Mobile-only mechanism | Reuses |
|---|---|---|---|---|
| M1 | P0 | Organization rows on /admin/users/:id: stack the name and details full-width, with the role segmented control and actions on their own row | `flex-col md:flex-row` | the same `run()` handlers |
| M2 | P0 | Fix sheet overflow: `grid-cols-[minmax(0,1fr)]`, and let rows wrap | pre-`md:` classes on `DIALOG_AS_SHEET` | — |
| M3 | P0 | Landscape phones use the mobile shell | extend `useIsMobile` with `(pointer:coarse) and (max-height:500px)`, plus a matching Tailwind variant | existing `useCompactChrome` |
| M4 | P1 | `ConfirmSheet` in place of native `confirm()` | rendered only when `isMobile` | returns the same boolean |
| M5 | P1 | Admin list row v2: two sub-lines, and actions on tap of the row itself (no second "Actions" row) | `Panel` row variant used only by mobile lists | existing row handlers |
| M6 | P1 | /profile mobile layout: panel skin, tabs as a list of sections, pinned Save | `isMobile` branch → `MobileProfile` | the same form state and `update_own_profile` call |
| M7 | P1 | Members & access: member list first, "Add member" as a secondary sheet, left-aligned title, one scroll area | pre-`md:` classes, plus a sheet opened only on mobile | the same `run()` |
| M8 | P1 | View data opens in a full-height `MobileSheet`, with the table as cards (label/value) or a frozen-first-column table | `isMobile` branch | the same fetched arrays |
| M9 | P1 | 44 px floor for header icon buttons, the project chip, `h-6` controls and checkboxes | `min-h-11 md:min-h-0` / hit-area pattern | — |
| M10 | P1 | About and Docs keep the tab bar; signed-in CTA "Open app" | render `MobileTabBar` below `md` | `useAuth` |
| M11 | P1 | Data map, role legend and dense tables → summary plus `MobileTableSheet` | `isMobile` branch | the same rows |
| M12 | P1 | Collapse the capability dot wall to "role · n of m rights", and tap to expand | `isMobile` branch | the same `capabilities` map |
| M13 | P1 | /admin/users/:id as a hub: sections become rows that each open a sheet; pin "Save budgets" | `isMobile` branch | the same handlers |
| M14 | P2 | Organization switcher and org name in the More menu | inside `MobileNavDrawer` | Profile's switch handler |
| M15 | P2 | `autoFocus={!isMobile}` on all sheet inputs | prop | — |
| M16 | P2 | Sheet unification: grab bar, 16 px radius, safe area, z-order below the tab bar | pre-`md:` classes | — |
| M17 | P2 | Toast offset above the tab bar; no "loaded" success toasts on mobile | `mobileOffset` | — |
| M18 | P2 | Shorter segmented labels at ≤ 390 px (Developer, Audit, Lab) | `sm:` label swap (spec §3.2) | — |
| M19 | P2 | Organizations actions sheet: 4 "Valid for" rows → one "Access period…" picker | mobile sheet content only | the same period action the rows call today (`AdminOrganizations.tsx:183-198`) |
| M20 | P2 | Naming: one name for SC Intelligences; "Project Manager" vs "Your Projects" | mobile copy only | — |
| M21 | P2 | BOM tree and Qty/assy in `MobileStagePolicyList` | mobile component | the same rows |
| M22 | P2 | Hover-only reasons (disabled Delete, `FreshnessBadge`, `CredibilityBadge`) shown as a visible 12 px line | mobile render | — |

## 7. Out of scope: needs logic or a global change

Fixing these would change desktop or behaviour, so they are **not** in the mobile brief. They are recorded here so they are not lost.

- **Unmounted shadcn toaster (F1).** Mounting `ui/toaster.tsx` in `App.tsx` would also make desktop toasts appear. That is a behaviour change on every platform (arguably a bug fix), so it needs its own decision. The mobile-only alternative is to mount it only below 768 px, but toasts that silently vanish on desktop are the real defect.
- **Row virtualisation for the Audit "All entries" sheet.** This is a rendering and performance change, not layout.
- **The two mobile specs disagree** (§8). Settling that is a documentation decision and must come first.
- **Sort and filter on the mobile admin lists.** The desktop filters are table-column UI. Offering them on mobile would need a new mobile control, which is fine, but it must call the same filter state. If that state lives inside the desktop table component, it would need lifting, which is a refactor.

## 8. Spec conflicts to settle before design

`docs/mobile-ui-spec.md` (structure) and `docs/mobile-skin-spec.md` (skin) disagree:

| Topic | ui-spec | skin-spec / code | Recommendation |
|---|---|---|---|
| Dense tables | scroll sideways, freeze the first column (§2.7) | no sideways scroll; summarise and defer to a sheet (§9.5, §10) | **skin**: defer to a sheet (M11) |
| Icon-only button size | 44 px (§2.4) | 32–34 px visible (§8) | 32–34 px visible, **44 px hit area** |
| AI tab label | "AI" (§4.2) | "SC Intel" in code | one name, chosen once (M20) |
| Gutter | `clamp(0.75rem,4vw,1.125rem)` | `--m-gutter clamp(14px,4.1vw,18px)` | keep the token; update ui-spec |
| Tab bar height | `min-h-11` | 58 px | 58 px |
| Page subtitle on mobile | shown (§4.1) | removed (§4) | removed |
| Landscape | "test 874 × 402" (§1) | 52 px bars (§14) | both assume the mobile shell, which N1 shows never renders |

**Gaps in `audit:ui`** (suggestions only; this audit changes no scripts):
- **Missed patterns:** `_1fr` and `rounded-t-xl` are not matched, and neither is `fixed … bottom-0` split across lines.
- **Never checked:** `sm:` layout use and `h-5`/`h-6`/`h-7` interactive controls.
- **Not statically detectable:** min-content overflow in a grid (S1) and width-only mobile detection (N1).
- **Proposal:** add a Playwright pass at 390 px and 844 × 390 to CI, measuring overflow and the 44 px floor. The harness used for this audit is about 200 lines.

## 9. What already works (keep it)

- **Shell and navigation:** the tab bar (58 px, safe-area aware); the pinned `MobileActionBar` with one primary action, which explains *why* it is disabled in a visible line (Lab `09`).
- **Stage policy list:** `MobileStagePolicyList` has "needs input" states and no sideways scroll (`06`).
- **Actions sheets:** on Projects and Organizations, one row per action, destructive rows marked with a red dot, nothing hidden behind a menu (`19`, `22`, `04b`).
- **Network pages:** they say honestly that the graph is desktop-only and give the findings instead (`11`).
- **Admin pages:** they already switch to card lists and 44 px toggles on mobile.
- **Home:** "Where you left off" and a 3-step Quick start (`01`).
