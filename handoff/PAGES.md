# SuReSuite mobile — the page book

Every mobile surface in the prototype, one entry each: what it is, what the
phone layout does differently and why, how to build it in the repo, and how to
open it in the demo so you can see it moving.

This is the **design record**. Its companions:
`docs/mobile-ui-spec.md` is the rulebook, `handoff/FINAL.md` is the remaining
code, `handoff/IPHONE-FIX.md` is the one live device defect. Where this file and
the spec disagree, the spec wins.

**To check your repo against this book**, see `handoff/VERIFY.md` — three layers,
starting with `node handoff/verify-repo.mjs`, which reports the outstanding
delta as exact find/replace strings.

**Do not take this file's word for anything — check it.** `handoff/AUDIT.md` is
the output of two mechanical checks, re-runnable with
`handoff/audit-pages.mjs`: every double-quoted string here must exist in the
demo, and every entry must carry a **Copy on this screen** deck extracted from
the demo rather than retyped, so an entry cannot quietly omit a block. The first
draft of this book described screens in summary and the About entry left out
three of them; the decks exist because prose cannot be checked for omission.

**Reading the demo.** Open `SuReSuite Live Demo.dc.html`. The left rail lists
every surface — tap a row to jump. The `route:` line in each entry below is the
rail row to press; where a surface is an overlay (a sheet or a full-screen
takeover) the entry says which control opens it.

**Status vocabulary.** `landed` = merged in `main` and verified in source.
`remaining` = specified in `FINAL.md`, not yet in the repo. `n/a` = prototype
only, deliberately not shipped.

**Two literals worth memorising**, because they appear on every page:

- gutter — `px-[clamp(0.75rem,4vw,1.125rem)] py-4 md:px-12 md:py-6`
  (`PAGE_GUTTER` in `src/components/shared/PageBody.tsx`). The demo uses the
  container-query twin `clamp(11px,3.4cqw,15px)` because it renders inside a
  phone frame rather than a viewport.
- touch floor — 44px below `md`, expressed `min-h-11 md:min-h-0`. Where 44px
  would break a text line's rhythm, grow the hit area without moving anything:
  `-m-[14px] box-content p-[14px] md:m-0 md:p-0`.

---

## 01 · Landing
shot: handoff/shots/01-landing.png
route: Landing (public)
repo: src/pages/Landing.tsx
status: landed
accept: verify src/pages/Landing.tsx

### What it is
The public front door, and the only page that may use black bands, the radial
red haze and full marketing type. Nobody signs in from a phone by accident —
this page's job is to explain the product and hand off to `/auth`.

### On the phone
- One column at `max-w-6xl px-6` → fluid `clamp()` gutter; the `py-24` section
  rhythm holds, separated by `border-t border-border/60`.
- The hero headline drops from 60px to 36px and keeps the serif italic tail —
  "Design supply chains that survive" then *the next shock.* in serif italic.
  It is the one place the flourish is allowed.
- The three-lens band is a stacked list on black — firm (amber), product
  (violet), process (teal) — each with its 6px colour dot. The three
  lens colours are the product's spine; they must survive the phone.
- The 3D band is **not** rendered on mobile. The decision (CONTEXT §3) is
  findings-only on a phone; the black band carries the three lens definitions
  instead of a WebGL canvas.
- Architecture and Roadmap collapse into a 2-tab pager (`01 / 02`) so neither
  section becomes a 2000px scroll.
- The funding band is a disclosure: grant number, dates and the two names, with
  the EU attribution kept verbatim.
- Top bar is `h-14` with a 44px hamburger; the sheet holds About · Demo · Docs ·
  Log in.

### How to implement
- Nothing outstanding. The page already carries `sm:`/`md:` branches
  (FINAL §2.6.4 lists `Landing.tsx:146` as correct — `sm:min-w-[180px]`).
- If you add a section, keep it out of `PageLayout`: this page has no sidebar,
  no `PageHeader`, and no bottom tab bar.

### Check it
- 320px: the headline does not hyphenate mid-word; the CTA is one line.
- The kicker keeps `font-mono tracking-[0.2em]` — landing only, never in-app.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Log in
- Resilience-grade simulator
- Design supply chains that survive
- the next shock.
- Deep network AI
- One network,
- three lenses.
- Firm level
- Who supplies whom — suppliers, customers, and the focal firm.
- Product level
- Which materials feed which products, exposing single-source risk.
- Process level
- The steps that make each product — where capacity really binds.
- The depth of a research lab, the speed of a workspace.
- Introduction
- See SuReSuite in
- two minutes.
- A quick walkthrough — from importing your data to reading the resilience results.
- 2:04 · tap to play
- 01 / 02 — Architecture
- SuReSuite technical architecture
- Next step
- Put your supply chain under pressure —
- on purpose.
- Upload data, analyze vulnerabilities, and simulate strategies in one workspace.
- 02 / 02 — Roadmap
- Roadmap
- What we're building next.
- Developer:
- Phu Nguyen
- Supervisor:
- Prof. Dmitry Ivanov
- Digital SC Lab @ HWR Berlin
- Start
- Finish
- © 2026 SuReSuite
- About
- Accounts approved by the Digital SC Lab

---

## 02 · Sign in
shot: handoff/shots/02-auth.png
route: Sign in
repo: src/pages/Auth.tsx, src/components/AuthHeroStrip.tsx
status: landed
accept: built  src/pages/Auth.tsx,src/components/AuthHeroStrip.tsx

### What it is
Desktop is a split screen: form column plus an always-black rotating brand
strip. On a phone there is no room for two columns, and the form is the reason
you came.

### On the phone
- Form first, full width. The headline is "Welcome" plus *back.* in serif
  italic — the same tail treatment as the landing hero.
- The brand strip compresses to a slim black band **below** the form, carrying
  the two rotating stats (`5,000+ training runs`, `20+ built-in SC policies`,
  `3 echelons`) on the source's 7s rotation with its 300ms cross-fade.
  `AuthHeroStrip.tsx:102` is `hidden … md:flex`, so the desktop panel never
  renders here — the band is a separate mobile element.
- Email and password inputs are 48px; the show/hide password control is a 44px
  target with `aria-label`, not a 16px icon.
- "Keep me signed in on this device" is a 44px row, tappable across its whole
  width, not a 16px checkbox.
- The approval reality is stated, not hidden: "Accounts are approved by the
  Digital SC Lab. Email phu.nguyen@hwr-berlin.de to request access." A phone
  user cannot self-serve, so telling them early is the kindest thing the page
  can do.

### How to implement
- Landed. Keep the mobile stat band driven by the same `AuthHeroStrip` data so
  the two cannot drift.

### Check it
- Landscape 874×402: the form stays visible with the keyboard up; the black band
  may scroll off, which is correct.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- About
- Welcome
- back.
- Email address
- Password
- Forgot password?
- Keep me signed in on this device
- No account yet
- Accounts are approved by the Digital SC Lab. Email
- phu.nguyen@hwr-berlin.de
- to request access.
- Put your supply chain under pressure —
- on purpose.

---

## 03 · About
shot: handoff/shots/38-about.png
route: About — from the landing hamburger, or the landing footer link
repo: src/pages/About.tsx, src/components/about/HeroLattice.tsx, public/funding/*
status: landed, with one placeholder — the contributor names are not written yet
accept: pending   contributor names are placeholders (see status)

### What it is
The lab, the two funded programmes, and the people. Public, no tab bar, and the
page most likely to be opened from a phone right after a talk. Six blocks in one
scroll: hero → Home → Funded by → Key people → Contributors → footer.

### On the phone
- Header is the logo mark, a black 44px "Log in", and a 44px close button that
  returns to the landing page. The footer repeats the exit as a 44px "Back to
  home" beside "© 2026 SuReSuite" — on a phone the way out has to be at both
  ends of a long scroll.
- The hero runs the animated lattice behind the text: `hero-lattice.js` mounted
  at `opacity: 0.5`, `scale(0.95)`, `aria-hidden="true"` and
  `pointer-events: none`, so it is decoration that can never intercept a tap.
- Hero type: a brand-red 6px dot with the `ABOUT US` mono kicker at `0.2em`,
  then a 31px headline with the serif italic tail — "Built inside a research
  lab, *shipped as a product.*" — and a lead paragraph that names the Digital-AI
  Supply Chain Lab and the ripple-effect / supply chain viability research.
- **Home** block on `#fafafa`: the HWR Berlin mark at 40px, then "Digital-AI
  Supply Chain Lab" and "HWR Berlin · Campus Schöneberg".
- **Funded by** carries *two* programmes, not one, and says which is live. Two
  dot buttons (`aria-label="Show ACCURATE"` / `"Show euroFMX"`) cross-fade two
  logos inside one fixed 168×42 box, so the block's height never jumps; a
  `Running` / `Next` chip states the state — brand red for Running — and a mono
  `tabular-nums` line carries the grant:
  `GA 101138269 · 01/12/2023 → 30/11/2026` for ACCURATE,
  `GA 101299128 · 01/06/2026 → 31/05/2030` for euroFMX. The
  "Funded by the European Union" mark sits below both.
- **Key people** is a stacked card list — no side-by-side portraits. Kicker in
  brand red, a 26px headline with its serif tail ("The science and the build,
  *core team.*"), then one card per person: an index numeral (`01`, `02`) top
  right, a glowing initials portrait (`PN`, `DI`) since this product has no
  photography, the role in brand red, name, title, bio, tag chips, and the
  affiliation on a hairline footer. Two people: Phu Nguyen (Technical lead) and
  Prof. Dr. Dr. habil. Dmitry Ivanov (Scientific lead) — the full honorific,
  because it is on his card in the product.
- **Contributors** on `#f4f4f5`: kicker, the headline "And the people around
  them.", then rows of group / organisation / name / one-line contribution.

### How to implement
- The mobile layout is landed. **The contributors rows render the literal string
  "Name to add"** — it is hardcoded in the row markup, not per-entry data, so
  every row shows it. Real names are needed before this page is shown publicly;
  until then it reads as unfinished. That is content, not layout — it needs the
  lab, not a UI change.
- `About.tsx:196`'s fixed logo box stays fixed — it is a logo, not content
  (FINAL §2.6.4).
- If a third programme is ever added, the dot pager and the fixed 168×42 logo
  box are the two things to revisit; the detail line is already derived from the
  selected programme.

### Check it
- Tap both funding dots: the logo cross-fades, the chip flips Running/Next, and
  the GA line changes with it — the three must never disagree.
- 320px: the honorific "Prof. Dr. Dr. habil. Dmitry Ivanov" wraps rather than
  truncating. A name is not an abbreviation candidate.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Log in
- About us
- Built inside a research lab,
- shipped as a product.
- Home
- Digital-AI Supply Chain Lab
- HWR Berlin · Campus Schöneberg
- Funded by
- Horizon Europe
- The science and the build,
- core team.
- Contributors
- And the people around them.
- Name to add
- © 2026 SuReSuite
- Back to home

---

## 04 · Getting Started
shot: handoff/shots/03-home.png
route: Getting Started
repo: src/pages/GettingStarted.tsx
status: shell landed · remaining (FINAL §2 — 5 baselined violations) · one open question (the visual-dialect divergence below)
accept: pending   visual-dialect decision open; do not enforce until settled

### What it is
The authenticated home: where you left off, plus the three-step quick start.

**A decision is buried here and it needs your sign-off.** The repo page is the
*legacy* visual generation, and the design system says so in as many words:
§3.10 names Getting Started as the one surface that "predates it and looks
nothing like it" — gradients on cards, icon tiles, panels and step markers,
`rounded-2xl`, six accent colours, `font-bold` — recreated faithfully in
`ui_kits/home/` "because it is what ships", but explicitly **not** the house
style. The mobile prototype does **not** reproduce it: it rebuilds the page in
the current vocabulary. Read the demo and you will find no
gradient and no radius above 4px on this screen. That is defensible — the legacy
dialect is documented as legacy — but it means desktop and mobile would speak
different dialects on the same route, which the standing rule ("every change
ships desktop and mobile") exists to prevent. Either the repo page is modernised
too, or this divergence is accepted deliberately and written down. It is not a
thing to discover in review.

### On the phone
- `#ebebeb` canvas, white cards, `border-radius: 4px`, 1px `#d4d4d4` borders,
  mono kickers — the sharp/current vocabulary, not the legacy one.
- Header is the 20px page title plus a 36px black circular avatar ("M"). No
  project select on this screen: you are resuming, not choosing.
- "Where you left off" is one card — a `12 min ago` mono stamp in its header,
  then "Project <name>", the project meta line, and three status rows: the data
  label with a check and its file count, "Policies configured" with a dot and
  its status chip, "Validated run" with a dot and its status chip. A full-width
  48px black Continue button closes the card. Resuming is the most common phone
  action, so it is the first thing under the header and needs no scrolling.
- Quick start is a brand-red mono kicker, a hairline rule, and the count "three
  steps", then three rows in one card. Each marker is a **flat 30px `#f8d448`
  circle** with a mono numeral — the yellow's "begin here" role (design-system
  use 2), but flat: §3.9 records 32px with `from-[#F8D448] to-[#F8D448]/80`, and
  this prototype drops the gradient along with everything else legacy. §3.10's
  guidance for exactly this case is "reach for the legacy dialect only when
  extending Getting Started itself, and say so explicitly" — which is the
  argument *for* what the prototype did, and the reason it still needs saying out
  loud rather than shipping silently.

### How to implement
- `scripts/adaptive-ui-baseline.json` currently records
  `GettingStarted.tsx::6` = 4 and `::C6` = 1. Fix with the §3.1 ladder (wrap →
  truncate+title → line-clamp-2 → shorter label variant in `lib/ui/labels.ts` →
  icon+aria-label → disclosure card), then
  `node scripts/audit-adaptive-ui.mjs --update-baseline`.
- The `C6` item is a hex or `bg-black`/`text-white` where a semantic token
  belongs — the audit prints file and line.

### Check it
- Desktop 1280 pixel-identical to `main` after each fix.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Getting started
- Where you left off
- 12 min ago
- Policies configured
- Validated run
- Quick start
- three steps

---

## 05 · Project Manager
shot: handoff/shots/04-projects.png
route: Project Manager
repo: src/pages/DataManager.tsx, src/components/UploadWizard.tsx, src/components/erp/ErpConnectionsPanel.tsx
status: landed
accept: verify src/pages/DataManager.tsx,src/components/UploadWizard.tsx,src/components/erp/ErpConnectionsPanel.tsx

### What it is
Data import and item masters. Four sections in the demo's stacked shell: add
data, connect a source, your projects, item masters, then the dataset table for
the active project.

### On the phone
- Every section is a `SectionCard` with a mono kicker, and every row is a 62px
  tap target with label + meta + chevron. Density comes from type sizes, not
  from cramming two columns.
- "Download template" carries `#F8D448` — sanctioned use 1, the starter
  workbook button.
- Project rows carry a 6px `StatusDot`: teal complete, brand red incomplete,
  `#d4d4d4` draft. The dot is the status; the meta line says why
  ("2 files missing · edges unmapped").
- The datasets table keeps the table and scrolls sideways (File / Rows / Mapped
  / Updated) — the column set is the information.
- Item-master rows that need attention say so in words, not colour alone:
  "312 items · 4 unmapped".

### How to implement
- Landed; no fixed rails found in this page (FINAL §2.6.5).
- New rows go through `PAGE_GUTTER` and the 44px floor; nothing page-specific.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Project Manager
- 4 projects · 2 with complete data
- Add data
- Upload CSV
- nodes · edges · BOM
- primary
- Download template
- starter workbook
- template
- Connect a data source
- orbit-mrp
- Item master · BOM · OAuth
- Your projects
- Tronico EMS
- 1 284 nodes · 6 files · complete
- Continental tier-1
- 2 files missing · edges unmapped
- Airbus Atlantic
- draft · no data yet
- Item masters
- Materials
- 312 items · 4 unmapped
- Products
- 48 items · complete
- Locations
- 15 items · complete
- BOM
- 640 links · 2 cycles flagged
- Datasets · {project}
- File
- Rows
- Mapped
- Updated
- nodes.csv
- Aug 28
- edges.csv
- Aug 21

---

## 06 · Project data viewer
shot: handoff/shots/05-viewer.png
route: Project Manager → tap a project row ("Tronico EMS")
repo: src/components/ProjectDataViewer.tsx
status: landed
accept: verify src/components/ProjectDataViewer.tsx

### What it is
The imported CSVs, exactly as imported: up to 7 tabs (BOM, Inbound, Outbound,
Node List, and Deep Nodes/Edges/Summary when `deep_tier_enabled`).

### On the phone
- A full-height screen, not an in-page card — the tables need every pixel.
- **A tab renders only when its file has rows.** Continental's un-imported
  Outbound and Node List produce no tabs rather than empty ones. This is the
  source's `visibleTabs` rule and it is the difference between "you have no
  outbound data" and "we broke the outbound tab".
- Per-tab record counts sit on the tab chips; the row limit is the source's
  10 / 25 / 50 / 100 / All, and "Showing 10 of 12" appears when the limit
  truncates: "Showing 10 of 12 — raise the row limit to see more."
- The first column is sticky; below the scroll container sits the line
  "swipe the table sideways for the remaining columns". Never guess at a
  gesture — name it.
- The 44px "Download CSV" control carries the `TEMPLATE_BTN` yellow with its
  `#e6c02f` border — sanctioned use 1, an export starter, not a status.
- BOM columns switch on `bom_level` as the source does: multi-level projects get
  Higher Level Component ID / Level, single-level gets Product ID.
- The empty line names what is missing rather than the tab that is blank —
  "No data imported for Airbus Atlantic yet — upload nodes, edges and a BOM to
  browse it here." for a project with nothing imported, and a per-tab variant
  naming the tab otherwise.

### How to implement
- Landed. Keep `FROZEN_CELL` / `FROZEN_CELL_ON_TINT` from
  `src/components/shared` for the sticky column — both release at `md:static`,
  so desktop is untouched.

### Check it
- A project with no outbound file shows no Outbound tab at any width.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Show
- swipe the table sideways for the remaining columns

---

## 07 · Connect a data source (OrbitMRP / ERP)
shot: handoff/shots/06-erp.png
route: Project Manager → "orbit-mrp" row
repo: src/components/erp/ErpConnectionsPanel.tsx, src/lib/erp/orbitMrpOAuth.ts, src/pages/OrbitMrpCallback.tsx, MappingWarningsCard (exported from src/components/sim/RunProgressPanel.tsx)
status: landed
accept: verify src/components/erp/ErpConnectionsPanel.tsx,src/components/sim/RunProgressPanel.tsx

### What it is
An OAuth link to an external MRP, and the one flow where a phone genuinely
leaves the app. **It is a two-stage gate:** "Sync now" only *stages* a mapping
report; nothing reaches the project's item masters until Apply.

### On the phone
- Four states, each its own screen rather than a stack of collapsibles: idle
  (what happens, numbered), hand-off (leaving SuReSuite), company picker, linked.
- The hand-off is shown honestly, because a real redirect leaves the app:
  discovery/registration, the authorize URL, and the fact that SuReSuite never
  sees the password and the token is stored server-side in Vault, never in the
  browser.
- The company comes from `list_companies` — the source's rule is that the
  company id is never typed by hand, so there is no free-text field.
- Three link states, all reachable: active/Connected teal,
  needs_attention/Needs attention amber, revoked/Disconnected red.
  `needs_attention` is reached the way the real system reaches it — an access
  token is short-lived, so a sync after one has been applied finds it expired.
- "Connect orbit-mrp" renders unconditionally (matching the source's CardHeader
  placement outside `links.map`), relabelling to "Reconnect" on a broken link
  and "Connect another source" on a healthy one. Revoke hides once broken.
- The staged mapping report reuses `MappingWarningsCard`'s contract: warn =
  defaulted with no source, info = derived from logistics data, plus its
  verbatim explanation and a count chip in the form `<n> defaulted · <n> derived`.
- Known reduction, stated in the UI rather than silently: the source panel is a
  *list* of links per project; the demo holds one, so picking a company while
  one is linked replaces it — and says that already-applied item-master rows
  stay, but the sync history restarts.

### How to implement
- Landed. The property to preserve above all others is the two-stage gate: any
  redesign that lets a sync write directly to item masters is wrong, however
  much tidier it looks.

### Check it
- Starting an authorisation and backing out leaves the existing link and its
  sync history intact (the source writes the link only from a successful
  callback).

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- What happens
- Leaving SuReSuite
- orbit-mrp
- Sync mapping report
- Apply sync to this project

---

## 08 · Network lenses — product, process, firm
shots: handoff/shots/07-product-lens.png, handoff/shots/08-product-lens-metrics.png, handoff/shots/09-process-lens.png, handoff/shots/10-firm-lens.png
route: Product-Level · Process-Level · Firm-Level
repo: src/pages/ProductLevelNetwork.tsx, ProcessLevelNetwork.tsx, FirmLevelNetwork.tsx, src/utils/networkMetrics.ts, sim-worker/network_metrics.py
status: landed (interiors) · remaining (FINAL §2.6.3 selects, §2 ProcessLevel §3.3)
accept: pending   lens interiors not built in the repo

### What it is
The three lenses on one graph: firm (amber, who supplies whom), product (violet,
which materials feed which products), process (teal, the steps that make each
product). Each page reads its own edge slice of the same project graph.

### On the phone
- **No 3D.** The interactive space is named as a desktop surface; the phone gets
  the findings. This was an explicit decision (CONTEXT §3), not an omission —
  and the page says so rather than rendering an empty canvas.
- Each lens page is: "How to read this" (a disclosure, so the definitions are
  available without occupying the screen) → Scope line → Findings → Structural
  risk → Centrality table → Nexus prediction.
- Metrics are **computed, not asserted**: Brandes betweenness, power-iteration
  eigenvector, BFS closeness, degree and volume-weighted degree, and the longest
  lead-time-weighted critical path, run over that lens's edges. The hub is
  whatever the graph found at peak betweenness — never a name typed into the
  design.
- The centrality table keeps the source's columns (Degree, Wtd, Eigenvector,
  Betweenness, Closeness, Prominence) with `getProminenceColor` thresholds
  (≥0.8 red, ≥0.6 amber, ≥0.4 ink), scrolls sideways, and carries "swipe →".
- Structural risk follows `networkMetrics.ts`: single-source risk, >70%
  concentration, mean supplier HHI, and the composite resilience score
  (+0.4 no SPOF, +0.3 (1−HHI), +0.3 (1−peak betweenness)).
- Findings are lens-specific prose, not a repeated panel: the firm lens explains
  that the graph is a star and nothing routes around the plant; the process lens
  explains that the 98%-utilised assembly step is the constraint on the critical
  path. Repeating one panel three times would put material sourcing on a page
  about where capacity binds.
- The source legend's emoji were dropped (the UI audit files emoji as a defect);
  its metric definitions were kept exactly.

### How to implement
- **FINAL §2.6.3** — the lens selects are fixed-width and below the touch floor.
  Apply the Case A/Case B test *by reading the JSX*: is the trigger inside
  `PageHeader`'s `rightContent`? If yes, `h-9 w-[clamp(120px,38vw,200px)]`; if
  no, `h-9 min-h-11 w-full min-w-0 md:min-h-0 md:w-[180px]`.
  Lines: `FirmLevelNetwork.tsx:1146`, `ProcessLevelNetwork.tsx:1124` and `:1204`,
  `ProductLevelNetwork.tsx:915`.
- **FINAL §2** — `ProcessLevelNetwork.tsx` carries a `§3.3` violation
  (a number being shortened to fit) and `InteractiveNetworkSpace.tsx` another.
  Both are priority 1: fix by scrolling the table, never by abbreviating the
  figure.

### Check it
- 320px: no horizontal page overflow; the table scrolls, the page does not.
- Every figure at 320 is byte-identical to the same figure at 1280.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- How to read this
- Scope
- Findings
- Columns
- Network structure
- Structural risk
- Centrality
- swipe →
- Nexus Node Prediction
- Processing predictions…
- This may take a few minutes for large datasets.
- CSV

---

## 09 · Node inspector and scenario-from-node
shot: handoff/shots/11-node-inspector.png
route: any lens → tap a node id in the Centrality table
repo: the three network pages + src/pages/help/docBodies.tsx:518 (workflow step 3)
status: n/a — prototype ahead of product; needs a product decision
accept: none      writes a scenario — needs a feature PR, not a UI PR

### What it is
Workflow step 3 in the docs reads "Right-click any node to create a disruption
scenario and send it to the Simulation Lab". A phone has no right-click, so the
node's own id cell became the tap target: the row stays a data row and the id
becomes the link.

### On the phone
- A sheet: all five centralities **with the node's rank among its peers**, its
  edge list with direction and weight, and a lens-specific risk note (highest
  betweenness → partitions the graph; single inbound edge → no alternate path).
- Derived from the same lens graph the table renders, so the sheet and the row
  cannot disagree.
- Below that, a scenario builder: disruption kind, a Day/Date timing toggle with
  a resolver panel (starts / clears / ticks), and duration.
- The scenario it writes uses the Lab's own `[kind, target, day, duration]` event
  shape, so it appears in the Events pane with no translation, is simulated by
  the same model, and invalidates the completed run — a new scenario is a
  different question.
- Horizon guard: an event past the 52-week horizon is **refused with the
  reason** rather than silently dropped. The horizon is published by the model
  (`horizonWeeks`/`horizonDays`) as the single source for the guard, the resolver
  text and the button.
- The Day/Date resolver states that the engine advances in weekly ticks, so a
  date is for the record and the week is what the model sees.

### How to implement
- Not a UI-only change: it writes a scenario. Ship the *tap-target* half (the id
  cell becomes a button with `aria-label`) only if the product wants the
  interaction on mobile; the scenario write belongs in a feature PR with the
  Lab's owner.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Connected to
- Create a disruption scenario
- Saved against this project and immediately available in the Simulation Lab.
- Disruption
- Timing
- Starts · day
- Starts · date
- Duration · days

---

## 10 · Nexus node prediction
shot: handoff/shots/12-nexus.png
route: any lens → scroll to "Nexus Node Prediction"
repo: src/components/MLPrediction.tsx, docs/nexus-node.md
status: landed
accept: pending   only 3 extractable strings — too thin to enforce; deck needs work

### What it is
A plant-scoped ML prediction of which nodes drive cascading failure. Present on
all three lenses.

### On the phone
- A mono "last run" line, a full-width Run prediction button, the source's +random-10-per-
  second progress ticker to 90% then 100%, and its exact copy —
  "Processing predictions…", "This may take a few minutes for large datasets".
- Three counts: Total nodes / Nexus (red) / Non-nexus (teal).
- One line the product never spells out, added because on a phone the two
  numbers sit adjacent and read as contradicting each other: nexus nodes are a
  **prediction** about cascade; the single-source materials count is a
  **structural fact** about sourcing.
- Run state is keyed per project, so one project's run cannot appear under
  another.

### How to implement
- Landed. Keep the `docs/nexus-node.md` info affordance — it is how a user finds
  out what "criticality" means.

### Copy on this screen

Extracted from the demo. This surface renders inside the shared lens shell, so
the deck is scoped to the prediction panel itself:

- Nexus Node Prediction
- Processing predictions…
- This may take a few minutes for large datasets.

---

## 11 · Policies
shots: handoff/shots/13-policies.png, handoff/shots/15-policies-runvalidate.png
route: Policies (tab bar)
repo: src/pages/ProjectPolicies.tsx, src/components/policies/PolicySetupBar.tsx, RunValidateStage.tsx
status: shell landed · **interior remaining (FINAL §2.5, §2.6.2, §2.6.3, §2.6.3a)**
accept: pending   PR 6 fixes the rails; the interior is not built

### What it is
The densest screen in the product and the one a planner uses most: model
version, planning unit, fulfillment strategy, preset, the four configuration
steps, warm-up & replication adequacy, and the library/history.

### On the phone
- Model version card first: `v14 · saved`, who and when, `13 snapshots`, then a
  48px "Save model version" and a History button carrying the count. Versioning
  is the safety net for editing policy on a phone, so it leads.
- Planning unit is a three-way segmented control (day / week / month) with the
  horizon stated underneath in mono — `365 days · 52.1 weeks`, and the mapping
  `week 1 = Jan 6 → Jan 12, 2025 (7 d)`. A planning unit with no visible mapping
  is a trap.
- Fulfillment strategy is five chips (MTS / MTO / ATO / CTO / ETO) plus the
  gated-field list from `strategyGating.ts` — each gated field struck through
  with its reason ("MTO: no finished-goods stock — produced on order"). This is
  the product's rule that a disabled control is **shown, disabled and
  explained**, never hidden.
- Policy preset shows the applied state, the `strategyWarning` combination
  warning in amber when the pair is contradictory, and a 48px "Apply preset"
  row with the count (8). Applying one opens a diff panel transcribing the
  preset's `derive()` — field, value, and its "why".
- The four configuration steps are a numbered list with per-step state: amber
  dot = warnings, check = ready, `LOCKED` chip = blocked, and an `n / 4 ready`
  counter in the divider.
- Warm-up & replications carries the three estimators side by side (MSER-5 /
  Conway / Welch), `n*` at ε = 5% · 95% confidence, and the adequacy table
  (KPI / Mean / ± half / Rel / n*) with a sticky KPI column. Then one button
  adopts both. Empty state: "No completed replications yet — warm-up and n*
  need a pilot series."
- "Continue to Simulation Lab" appears only when the page is actually ready, and
  fades in — the phone's version of a workflow arrow.

### How to implement
This is the largest remaining piece of work. `src/components/policies/` has 4
`md:` occurrences in the whole folder; `StagePolicyTable.tsx` (67 kB) has none.

- **§2.5 A** — the two 192px label rails. `PolicySetupBar.tsx:267` and
  `RunValidateStage.tsx:1315` both hold
  `<div className="flex w-[192px] shrink-0 flex-col justify-center gap-[3px] pr-2.5">`.
  Replace with
  `<div className="flex w-full min-w-0 flex-col justify-center gap-[3px] pb-2 md:w-[192px] md:shrink-0 md:pb-0 md:pr-2.5">`
  and add `flex-col md:flex-row` to the nearest enclosing flex wrapper. Do not
  touch `items-*` — the desktop row depends on it.
- **§2.5 B** — `PolicySetupBar.tsx:213, 225, 248` mark whole chip groups
  `shrink-0`, so they push the bar past the viewport. Add `min-w-0` +
  `flex-wrap`, move `shrink-0` behind `md:`. Line 85's segmented control is
  fixed-width chrome — leave it.
- **§2.5 C** — freeze the identifying column in `StagePolicyTable.tsx` with
  `FROZEN_CELL_ON_TINT` on the first `<th>` and `FROZEN_CELL` on the first
  `<td>`, plus the "swipe the table sideways for the remaining columns" line.
  Never reflow this grid to cards: the column set *is* the information.
- **§2.5 D** — `StagePolicyTable.tsx:1004` and `:1672` are 15px controls and are
  the primary way to edit a row. Use
  `-m-[14px] box-content p-[14px] md:m-0 md:p-0`. Lines 1014, 1106, 1127 are
  static marks, not buttons — leave them.
- **§2.6.2** — `ParameterSheet.tsx:55` is `w-[392px]`, wider than 320/360/375.
  Use `w-full … sm:w-[392px] sm:max-w-[392px]`. `FocusedStage.tsx:188`'s 340px
  dropdown becomes `w-[min(340px,calc(100vw-1.5rem))]`.
- **§2.6.3a** — this page's `rightContent` holds a 3-option `Segmented` **plus**
  the 210px project select; the spec caps the mobile right slot at three
  controls. Wrap the `Segmented` in `<span className="hidden md:contents">` and
  render a second copy as the first child of the content column inside
  `<div className="md:hidden">`. Both drive the same `tab` state.

### Check it
- 320px: `document.documentElement.scrollWidth > innerWidth` is false.
- No control under 44×44 below 768px (spec §5 probe).
- Desktop 1280 pixel-identical to `main`.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Policies
- Model version
- Save model version
- History
- Planning unit
- horizon
- 365 days · 52.1 weeks
- Fulfillment strategy
- Policy preset
- applied
- Apply preset
- Configure SC policies
- / 4 ready
- LOCKED
- Warm-up & replications
- MSER-5
- Conway
- Welch
- n* at ε = 5 % · 95 % confidence
- KPI
- Mean
- ± half
- Rel
- No completed replications yet — warm-up and n* need a pilot series.
- Library & history
- Policy library
- 20+ built-in SC policies
- Version history
- Continue to Simulation Lab
- P-S.1 sourcing
- swipe table →
- Bulk edit
- Supplier
- Lead time
- Reorder pt
- Split

---

## 12 · Policy stage sheet, selection and bulk edit
shots: handoff/shots/14-policies-stage-sheet.png, handoff/shots/39-policies-bulk-edit.png, handoff/shots/16-presets.png
route: Policies → tap configuration step 1 ("P-S.1 sourcing")
repo: src/components/policies/StagePolicyTable.tsx, BulkEditDialog.tsx, PolicyOverridesTable.tsx
status: **mixed — read this before building it**
accept: none      no selection model in StagePolicyTable — own PR

### What it is
The editable policy grid, opened as a sheet from a step row. Supplier / Lead
time / Reorder pt / Split, with row multi-select and a sparse bulk patch.

### On the phone
- The sheet's header **is** the drag handle: a 36px pill, the title, a 44px
  close button, and dragging past 90px dismisses. Every sheet in the prototype
  behaves this way; landscape forces full height.
- The table keeps the table, scrolls sideways, freezes the supplier id column,
  and says "swipe table →" in the kicker row.
- Row select is a 44px checkbox cell; select-all lives in the sticky header cell
  and carries an indeterminate bar when the selection is partial.
- With a selection, a bar appears above the table — the label is composed
  ("3 rows selected", singular "1 row selected") — plus a black "Bulk edit"
  button and a 44px clear.
- Bulk edit opens a sheet titled "Bulk edit · sourcing", subtitled "Apply a
  patch to 3 selected rows." Its three fields carry their unit as the hint
  (`weeks`, `units`, `% primary`) and an example as the placeholder
  (`e.g. 2.5`, `e.g. 820`, `e.g. 70 / 30`). Blank fields are skipped, so the
  override stays sparse; values are coerced per field type, so units survive.
- Edits commit to a per-row override store, not to the live selection, so an
  edit cannot vanish or bleed onto an unedited row.

### How to implement — the honest version
- **E1, in scope.** Render the existing `BulkEditDialog` as a sheet below `md`.
  Its logic, its `targetKeys` contract and its own copy — the repo string is
  "Empty fields are skipped so the override stays sparse", which is the repo's
  wording, not the demo's — stay verbatim; only the shell changes. Its
  heading already pluralises correctly — leave that alone.
- **E2, NOT in scope.** `StagePolicyTable.tsx` has **no row-selection model**:
  its only `Set` is `collapsedGroups` (line 363), there is no `Checkbox` import,
  and `BulkEditDialog`'s only caller is `PolicyOverridesTable.tsx` with a single
  target. Adding selection is a state-shape change, which the UI-only rule
  forbids. Do not add the selection bar markup as dead code.
- **This is the one place the prototype is ahead of the product**, because the
  demo has a selection model the repo never had. It needs its own PR:
  `selectedKeys` state in `StagePolicyTable`, a checkbox column, and
  `targetKeys={[...selectedKeys]}` threaded into the existing dialog. Report it;
  do not smuggle it in.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Bulk edit · sourcing
- Apply a system preset

---

## 13 · Validation findings and version history
shots: handoff/shots/17-findings.png, handoff/shots/18-history.png
route: Policies → History, or Lab → the findings link beside the blocked run
repo: supabase/functions/_shared/validationGate.ts, _shared/dispatch.ts, _shared/grading.ts
status: landed (presentation)
accept: pending   presentation only; gate semantics are engine-side

### What it is
Two sheets sharing one shell: the graded validation findings that gate a run,
and the policy version history.

### On the phone
- The sheets are titled "Validation findings" and "Version history".
- Findings are graded rows — blocking vs warning — each with its mark, label
  and reason. The acknowledge action is one 48px button whose label counts what
  it covers ("Acknowledge 2 warnings", becoming "Warnings acknowledged" once
  pressed), and acknowledging is recorded (`acknowledge_warnings`), because the
  run binds to a policy version.
- A blocked run says so in the Lab, counting the blockers: "Run rejected — 3
  blocking gaps" (or "Run rejected — no data imported" for a draft project),
  with a second line saying what to do and a route into this sheet. Never a
  disabled button with no explanation.
- Version history rows carry the version, who saved it, when, and the snapshot
  count; the row that a completed run is bound to is marked.
- A sheet the parent screen owns is cleared when the parent closes — a sheet
  cannot outlive the screen that opened it. (That was a real defect in an
  earlier pass on the admin person sheet.)

### How to implement
- Presentation only; the gate semantics are engine-side and must not be touched
  in a UI PR.

### Copy on this screen

This sheet is entirely hole-driven — every string comes from `renderVals`, so
the template carries no literals. The strings it can show:

- Validation findings — sheet title when opened from the gate
- Version history — sheet title when opened from Policies
- Policy library — same shell, third use
- Switch project — same shell, fourth use
- Acknowledge N warnings / Warnings acknowledged — the sheet's one action
- the per-finding mark, label and reason, and the version rows' author and time

---

## 14 · Simulation Lab
shots: handoff/shots/19-lab.png, handoff/shots/20-lab-events.png
route: Lab (tab bar)
repo: src/pages/SimulationLab.tsx, src/components/sim/StageRail.tsx, ExperimentDesigner.tsx, DisruptionScheduleEditor.tsx
status: shell landed · **rail remaining (FINAL §2.6.1)**
accept: pending   PR 6 fixes the rail; the panes are not built

### What it is
Where an experiment is designed and dispatched: four panes (Setup · Events ·
Compare · Run), the disruption schedule, the validation gate, and the run queue.

### On the phone
- Desktop's 256px scenario rail becomes a **stacked** section above the pane —
  you pick a scenario, then work on it. That order is deliberate.
- The four panes become a segmented strip; the active pane centres itself
  (`centreTab()` on update) so a mid-list pane is never half off-screen.
- The disruption schedule keeps its table (Event / Target / Start / Duration)
  with a sticky first column and "swipe →". It is authored in **days**, and the
  engine advances in weekly ticks — the schedule says so.
- Empty state names the project it is empty for: "No disruption schedule yet —
  this project has no network to disrupt", with "Add disruption" beneath.
- The gate is honest: with blocking findings, the run button is disabled and the
  reason is on screen; with warnings only, an explicit acknowledge toggle
  appears with the warning summary and a link to the findings sheet. The run
  binds to a policy version and shows which.
- "warm-up & n* not adopted — set them in Policies" is a cross-screen note with
  a route, not a dead-end warning.
- Scenario comparison keeps its five columns and scrolls; its caption is derived
  from the rows through one field binding, so it cannot quote a different column
  than it ranked.

### How to implement
- **§2.6.1, two edits, both required** — the aside alone does nothing while its
  parent is a `flex-row`:
  parent `<div className="flex gap-4 items-start">` →
  `<div className="flex flex-col gap-4 md:flex-row md:items-start">`;
  aside `<aside className="w-64 shrink-0">` →
  `<aside className="w-full min-w-0 md:w-64 md:shrink-0">`.
  Its sibling already carries `min-w-0` — leave it.
- `StageRail.tsx:58` — `export const RAIL_LABEL_COL = "w-[220px] shrink-0"` →
  `"w-full min-w-0 md:w-[220px] md:shrink-0"`.
- **§2.6.3** — `SimulationLab.tsx:290` (Case A, inside `rightContent`),
  `ExperimentDesigner.tsx:279` and `:337`, `PlaybookPicker.tsx:55`,
  `ReplicationSeedExplorer.tsx:80` (all Case B).
- **Do not touch** `StageRail.tsx:70,81,260`, `DisruptionScheduleEditor.tsx:40–87`
  or `ExperimentDesigner.tsx:195,244` — they already have correct branches
  (FINAL §2.6.4).

### Check it
- 320px: the rail is full width and above the pane; at 768 it is 256px beside it.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Simulation Lab
- Experiment design
- Disruption schedule
- edit in Events
- warm-up & n* not adopted — set them in Policies
- swipe →
- Event
- Target
- Start
- Duration
- No disruption schedule yet — this project has no network to disrupt.
- Add disruption
- Setup
- Scenario comparison
- Scenario
- Service
- Fill
- Cost
- TTR
- Open Nordic retail DC
- Go to Run
- Spec
- Fill rate · 52 weeks
- playbook on
- playbook off
- Recovery playbook impact
- KPI
- Without
- With
- mean ± 95% CI
- Need at least 2 completed replications to plot convergence.
- running mean
- Utilization · node × week
- Rep
- Ask the AI about this run
- view

---

## 15 · Lab results
shots: handoff/shots/21-lab-run-done.png, handoff/shots/22-lab-results.png, handoff/shots/23-lab-recovery.png
route: Lab → acknowledge warnings → Run, then the Run pane
repo: src/components/sim/RecoveryImpactCard.tsx, KpiStatTable.tsx, ConvergencePlot.tsx, UtilizationHeatmap.tsx, src/lib/sim/recoveryScore.ts, kpiDisplay.ts
status: landed (prototype computes them) · repo unchanged
accept: pending   results panels not built in the repo

### What it is
Everything a run produces, on a 414px screen: KPI tiles, the fill-rate path,
recovery playbook impact, convergence, the utilisation heatmap and the
per-replication table.

### On the phone
- **Results are computed from a weekly engine model, not asserted constants.**
  One disruption window, a 3-day detection lag, playbook levers, exponential
  replenishment. That matters on mobile because the numbers must stay consistent
  across four cards a user scrolls past in sequence.
- KPI tiles use the real vocabulary (Fill rate, OTIF, Time to recover,
  Resilience index) and read off the model.
- "Fill rate · 52 weeks" plots playbook-on against playbook-off, bands every
  event in its layer colour with a per-event legend chip (kind, target, window,
  duration), draws the baseline rule and marks TTR.
- The window is labelled explicitly, because two honest means differ: scenario
  KPIs are reported over the disruption-to-recovery window (88.5%, matching the
  model card's 88.6%), not the flattering 52-week horizon mean (95.0%). Both
  labels are on screen. This was a real cross-screen contradiction.
- Recovery impact is a Without | With | Delta table over the real KPI
  vocabulary, with `RESPONSE_LABELS` weight chips, detection lag and cost cap.
- Convergence draws the running mean with a 95% CI band, the `n*` marker and
  ±1.0% tolerance lines, computed from the **same seeded draws** as the
  per-replication table, so curve and rows cannot disagree. Below 2 completed
  replications it says "Need at least 2 completed replications to plot
  convergence." The x-domain runs to `n*` so the marker cannot contradict the
  note, and the un-run region is shaded with a legend entry.
- The utilisation heatmap is node × week with a 0–100% ink ramp, >95% flagged
  brand red; the disruption reads as a mid-horizon spike on the survivors.
- "Ask the AI about this run" hands the run to Project Intelligence — on a phone
  that is faster than reading six cards.

### How to implement
- Nothing outstanding in the repo for mobile beyond §2.6.1/§2.6.3. If these
  panels move, the computation belongs in `src/lib/model/` (§3) so both layouts
  render from one source.

### Check it
- Every number identical at 320 and 1280. Tables scroll; numbers never truncate.

---

## 16 · Project Intelligence
shots: handoff/shots/24-ai.png, handoff/shots/25-ai-agents.png
route: AI (tab bar) · standalone: Project Intelligence Mobile.dc.html
repo: src/pages/ProjectIntelligence.tsx, src/components/intelligence/ChatWorkspace.tsx, ChatComposer.tsx, MessageParts.tsx, piUi.tsx, src/lib/chat/agents.ts
status: landed
accept: verify src/pages/ProjectIntelligence.tsx,src/components/intelligence/ChatWorkspace.tsx,src/components/intelligence/ChatComposer.tsx,src/components/intelligence/MessageParts.tsx

### What it is
The agent chat workspace over a project. All five agents, all nine message part
kinds, threads, files and both memories. `Project Intelligence Mobile.dc.html`
holds the same screen standalone with a nine-state jump rail.

### On the phone
- Chrome was consolidated to reclaim ~150px of stream: the agent strip, memory
  strip and suggestion chips fold into the header badge, the ⋯ menu and a
  composer lightbulb. On a phone the conversation is the product.
- The composer collapses to one control row — a single
  chip carrying the live values — "Tronico EMS · Gemini 2.5 Flash · Ask" — that
  opens "This chat" — plus auto-grow, an
  expand ceiling, and a 44px send.
- All five agents carry their real `piUi` mono badges and colours: RA
  risk-analyst (red), SM simulation-modeler (violet), IS inventory-strategist
  (amber), LP logistics-planner (teal), GA general. Agent identity is a
  two-letter badge, never an icon and never an avatar.
- All nine `MessagePart` kinds render: text, evidence (grounded / not_grounded
  with citations), table, kpi, bullets, plan, mode_notice, memory_offer,
  memory_saved. Tables inside a message scroll sideways.
- Plan parts carry a per-step `STEP_DOT` dot in seven states: pending
  `#d9d9d9`, active `#e0930b`, done `#14b8c4`, failed `#bf2330`, refused
  `#d9d9d9`, awaiting_run `#e0930b` — and **awaiting_approval `#F8D448`, which
  is a defect.** Design system §3.9 is explicit — the yellow has exactly four
  uses and is "never a status, never a large fill". The nearest sanctioned use is
  `LAYER.accent` in `piUi.tsx`, on this very surface, but that is held for
  agent/layer accenting, not step state. It is also the only status in the ramp
  not drawn from the status palette. Fix: `#e0930b` amber, the existing "waiting
  on a human" colour — awaiting_run already uses it.
  Cross-check `MessageParts.tsx` before changing it; if the repo has the same
  value, this is a repo defect and not a prototype one.
- Activity traces are collapsed by default and summarise as "Analyzed project
  data · 3 steps · 2.3s"; expanded they show tool name, row count and duration.
- Proposal cards follow the real lifecycle — proposed / approved (applying) /
  applied / rejected. Approve triggers apply; a failed apply shows the server
  reason with Retry; rejected cards stay at 0.55 opacity as the audit trail.
  The body is the real row table (Entity, Field, Value, [low, high], Method,
  Source) with the "AI-drafted — verify" provenance chip and the citations line.
- Ask/Review is explicit, and Auto is **visible but disabled** with its verbatim
  tooltip: it unlocks only after sustained accepted-proposal rates, org opt-in
  and resolved identities.
- The real four models only — Gemini 2.5 Flash (default), GPT-5, GPT-5 mini,
  DeepSeek — from Google / OpenAI / DeepSeek. No Claude models exist here.
- "chat" is the user-visible word everywhere (matching `ChatSidebar`); "thread"
  survives only as the data term.
- Empty state refuses to invent: with no completed replications it says so and
  offers to dispatch the run instead of estimating one.

### How to implement
- Landed; `ChatSidebar`/`ChatComposer` already carry `min-h-11 md:min-h-0`
  (FINAL §2.6.5).

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Choose an agent
- needs project
- drafted a proposal
- Source:
- Switch to Review
- Saved to project memory.
- Save this for the project?
- Save
- Dismiss
- Approve
- Reject
- Retry

---

## 17 · Chats, files and memory sheets
shot: handoff/shots/25-ai-agents.png
route: AI → header ⋯ menu, or the thread title
repo: src/components/intelligence/ChatSidebar.tsx, src/components/intelligence/SidebarPanels.tsx (MyFilesPanel, ProjectMemoryPanel, ThreadInfoStrip), ModelPicker.tsx, SuggestedActions.tsx
status: landed
accept: verify src/components/intelligence/ChatSidebar.tsx,src/components/intelligence/SidebarPanels.tsx

### What it is
Five sheets sharing the drag-dismissable shell: agents, model, chats, my files,
and the two memories.

### On the phone
- Chats follow `ChatSidebar`: "New chat", folder tags, per-project meta, rename
  and delete per row, and a search field.
- My files follows `MyFilesPanel`: 14-day retention, a Keep action, and the
  expiry warning copy verbatim.
- Both memories are separate and both are user-controlled: the **thread
  summary** is visible and deletable; **project memory** is consent-only, each
  entry showing its source, a `stale` chip when it ages, and an archive action.
  The explainer states the rule in the product's own words — adding an entry is
  the consent; the model never writes memory on its own.
- Suggested-action chips carry their server `reason` as the tooltip, so a
  suggestion is never unexplained.

### How to implement
- Landed. Keep the sheet shell shared — five bespoke sheets is how drag-dismiss
  behaviour drifts apart.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Used only to keep older context in this conversation — never as a source of facts.
- The assistant keeps two kinds of memory, and you control both:
- This conversation
- Project memory
- — facts, preferences and decisions saved for the whole project. Writes are
- consent-only
- visible
- with its source, and is
- cited
- whenever it informs an answer.
- Save
- Adding an entry here is the consent — the model never writes memory on its own.
- Nothing saved yet — say &ldquo;remember&hellip;&rdquo; in a chat, or add a note here.
- stale

---

## 18 · Navigation — tab bar, More, and the shell
shot: handoff/shots/26-more.png
route: More (tab bar)
repo: src/components/MobileNav.tsx, src/components/Navbar.tsx, src/components/shared/PageLayout.tsx, PageHeader.tsx, Footer.tsx
status: landed · **one live defect (IPHONE-FIX.md)**
accept: built  src/components/MobileNav.tsx,src/components/shared/PageLayout.tsx,src/components/shared/PageHeader.tsx,src/components/Footer.tsx

### What it is
The mobile shell. The 192px sidebar is `hidden md:block`; below `md` a five-item
bottom tab bar plus a More drawer replaces it.

### On the phone
- Tabs: Home · Policies · Lab · AI · More — the five destinations a phone user
  actually opens, each with the **same lucide icon as the sidebar** for the same
  destination.
- More carries everything else in the sidebar's six groups and order, with the
  logo at the top, the account row (name, role) and Log out. Group separators,
  no group headings — the real `NAV_SECTIONS` leaves every `title` unset.
- Desktop-only destinations are listed and marked, never silently absent.
- `PageHeader` stays sticky with a 44px floor and gains a mobile back button
  (`h-11 w-11 … md:hidden`); the right slot is capped at three controls.
- The black credit footer is kept on mobile, sits **above** the tab bar, and can
  be dismissed (the dismissal persists in `localStorage`). A SuReSuite mock
  without the ACCURATE credit reads as fake.
- Bottom reservation is derived, not hand-summed: tab bar height + its border +
  the **measured** credit-bar height + 16px + the device inset. The credit bar
  wraps to three lines at 320–390 and two at 414–600, so a constant would leave
  content underneath at every common iPhone width.

### How to implement
- **`handoff/IPHONE-FIX.md` — the one defect that reproduces on hardware only.**
  `index.html` needs `viewport-fit=cover`, or iOS resolves every
  `env(safe-area-inset-*)` to 0 and all three bottom-pinned elements lose their
  clearance. Verified present in `main` at `a05c7508`, together with the derived
  reservation and the audit's `safe-area-inert` rule — but **still unverified on
  a physical iPhone**, which is exactly the claim that failed last time.

### Check it
On a real iPhone, not the simulator: tab labels clear the home indicator; "More"
registers on the first tap; a visible gap sits between the credit bar and the tab
bar; the last row of content clears the credit bar; in landscape nothing hides
behind the notch and sheets go full height.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Desktop
- m.langner
- researcher
- Developed by
- Phu Nguyen
- Prof. Dmitry Ivanov
- (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union

---

## 19 · Super Admin
shots: handoff/shots/27-admin-hub.png, handoff/shots/28-admin-people.png, handoff/shots/30-admin-audit.png
route: More → Super Admin
repo: src/components/admin/AdminLayout.tsx, AdminDashboard.tsx, AdminUsers.tsx, AdminRoles.tsx, AdminAudit.tsx, AdminOrganizations.tsx, AdminProjects.tsx, AdminModels.tsx, AdminUsage.tsx, adminUi.tsx
status: landed
accept: verify src/components/admin/AdminLayout.tsx,src/pages/admin/AdminDashboard.tsx,src/pages/admin/AdminUsers.tsx,src/pages/admin/AdminAudit.tsx,src/pages/admin/AdminUserAccess.tsx,src/components/admin/OrgAccessDrawer.tsx

### What it is
Desktop is an eight-tab scrolling strip over eight tables. On a phone that is
eight wrong answers, so mobile admin is a **triage surface**: search first, then
the two things you actually do from a phone.

### On the phone
- Order: search → "Needs attention" → today's 2×2 → People → Recent changes →
  Reference. Reference data is demoted, not hidden.
- Search is first because an admin on a phone is looking for one person.
  Results group by kind with counts.
- "Needs attention" is the real alert — **over budget**. "Pending approval" was
  invented in an earlier pass and removed: the real model is `is_active`
  (Active / Suspended).
- Platform Overview keeps the real ledger: Reach (orgs / projects / users /
  active-7d) and AI spend (requests all-time, cost today, cost MTD, avg $/req),
  including the **third** sanctioned `#F8D448` use — the 2px × 36px emphasis rule
  on the `#fffdf3` Cost MTD cell (see the appendix note on the yellow's real
  count). Other tiles carry a mono hint instead.
- Top users and Top organizations carry the MTD chip.
- The eight tables remain reachable under Reference, as card lists where the
  product itself already switches (`AdminAudit.tsx`), keeping before/after
  values.
- Add user matches `admin_create_user` (name, email, temporary password min 8,
  role, org — creates an active account); add organization matches
  `admin_create_organization` (slug optional, derived from the name when blank).
- Project scope is keyed per project: switching swaps the whole record — runs,
  versions, model card — and never inherits.

### How to implement
- Landed; all seven admin pages have a `useIsMobile` card branch
  (FINAL §2.6.5). Admin `max-w-[…]` cells are `max-w` + `truncate`, which is the
  correct §3.1 rung-2 fix — do not "improve" them.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Needs attention
- Reach
- AI spend
- MTD
- Name
- Req
- Cost
- People
- Recent changes
- Full log
- Reference
- before
- after
- Save budgets & limits
- The navigation and abilities this user sees on their next login.
- Navigation
- Features
- AI models
- Organization access defaults
- Role
- Access
- Manage access

---

## 20 · User access
shot: handoff/shots/29-admin-access.png
route: More → Super Admin → People → a person → Manage access
repo: src/pages/admin/AdminUserAccess.tsx, src/components/admin/OrgAccessDrawer.tsx
status: landed
accept: pending   no extractable copy deck yet — enforcing it would prove nothing

### What it is
The per-user capability matrix — the highest-consequence screen in the product,
and the reason mobile admin exists at all: granting or revoking access is the
thing you get asked for while away from a desk.

### On the phone
- Four tabs: Navigation/Features capabilities, AI models, Budgets & limits,
  Preview as user.
- Each capability row is Inherit / Allow / Deny with an **effective** On/Off dot
  and the role-default hint beside it. The effective math matches the product:
  user override ?? org override ?? role default; super admin always on.
- My Profile is shown **locked** — it is the always-on capability, and hiding it
  would misrepresent the role matrix.
- The AI model allowlist is grouped by provider with default and fallback picks,
  falling back to `DEFAULT_MODEL_ID`.
- Budgets & limits pair each field with its current usage, turning red at the
  cap. "Save budgets & limits" states what it does: "The navigation and
  abilities this user sees on their next login."
- Organization access defaults open in their own sheet (`OrgAccessDrawer`), so
  the org layer is never confused with the user layer.
- Preview as user is a read-only rendering of what that person will actually see.

### How to implement
- Landed. `AdminUserAccess.tsx:247` is already `w-full … sm:w-[210px]`
  (FINAL §2.6.4) — leave it.

### Copy on this screen

Extracted from the demo, scoped to the access matrix and its four tabs:



---

## 21 · Developer API
shots: handoff/shots/31-developer-keys.png, handoff/shots/32-developer-quickstart.png
route: More → Developer API
repo: src/pages/DeveloperApi.tsx
status: landed · remaining (FINAL §2 — 2 baselined violations)
accept: verify src/pages/DeveloperApi.tsx

### What it is
Keys, scopes and quickstarts. Rebuilt from source after an earlier pass invented
its scopes ("read, run" and "read, admin" are not real scopes).

### On the phone
- The real seven scopes with their hints: `read:data`, `write:data`,
  `read:policies`, `write:policies`, `read:runs`, `write:runs`, `admin:keys`.
- Three tabs: API keys (hygiene card + key cards), Quickstart (base URL, four
  snippets, all 11 v1 endpoints with scope and purpose), Notebook (project
  picker, pre-filled CONFIG cell, id tables).
- The nine-column keys table becomes **cards** — name, env, status dot, masked
  key, scope chips, a 3-up stat row, rotate/revoke. This is one of the few
  places a table legitimately becomes cards, because each key is an object you
  act on rather than a row you compare.
- Create key is a sheet with 52px scope rows. The minted secret is shown once
  and says so: "Copy it now — this is the only time it is shown."
- Key lifecycle is real: create with env + scopes + expiry, rotate with the 72h
  overlap, revoke that "stops working on the next request". Revoked keys stay
  listed at reduced opacity as the audit trail.
- The Notebook tab's "Download template (.ipynb)" is the `TEMPLATE_BTN` yellow —
  the *same* sanctioned use 1 as the admin starter workbook, not a new one; the
  design system names both `adminUi.tsx` and `DeveloperApi.tsx` for it. It also
  carries the security note: never paste a key into a cell; use Colab Secrets as
  `SURESUITE_API_KEY`.
- Code blocks scroll horizontally rather than wrapping; a wrapped `curl` is a
  broken `curl`.

### How to implement
- Two §6 violations remain baselined. Fix with the ladder; the audit prints the
  lines.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Developer API
- Drive SuReSuite programmatically — keys, scopes, quickstarts.
- Key hygiene
- Store keys in a secret manager, never in source control. Start on
- test
- Organization keys
- Base URL
- All endpoints are versioned under
- and authenticated with
- Authorization: Bearer sk_…
- . Errors use a consistent
- envelope; rate-limit state comes back in
- X-RateLimit-*
- headers.
- Endpoints · v1
- Full reference:
- docs/api/README.md
- in the repository.
- Ready-to-run quickstart
- Project
- Notebook CONFIG cell — paste over the notebook’s first code cell
- Never paste your API key into a notebook cell. In Colab, store it once in the
- Secrets
- panel as
- SURESUITE_API_KEY
- — the notebook reads it from there, or from the environment when run locally.

---

## 22 · Docs
shots: handoff/shots/33-docs.png, handoff/shots/34-docs-body.png
route: About & Help → "Open the docs"
repo: src/components/docs/registry.ts, DocsLayout.tsx, src/pages/help/docBodies.tsx
status: landed · remaining (FINAL §2 — 1 table violation in docBodies.tsx)
accept: built  src/components/docs/registry.ts,src/components/docs/DocsLayout.tsx,src/pages/help/docBodies.tsx

### What it is
All 21 real doc pages in their five real groups, with verbatim slugs, titles,
summaries, keywords and related links.

### On the phone
- Three desktop panes become one column: the left nav tree is a
  drag-dismissable sheet with collapsible groups and the brand-red active bar;
  "On this page" is a collapsible above the body; Related articles moves inline
  above the prev/next pager.
- `searchPages` is reproduced exactly — every term must match across title +
  group + summary + keywords, capped at 8, with "No matches." as the empty
  state.
- The pager walks the flat `ALL_PAGES` order across group boundaries, as the
  source does.
- The font-size control is the real three-step scale (0.92 / 1 / 1.12) and
  scales body, headings and tables. On a phone this is an accessibility control,
  not a preference.
- "On this page" actually navigates: each `h3` is slugified into an id and the
  scrolling container is scrolled to it (`scrollIntoView` is banned in this
  project). It used to only close and toast.
- Doc bodies are the real content — the PH-00…PH-99 phase pipeline verbatim,
  warm start at S_m, Eqs. 2–3 for s_m/S_m with κ, the parameter dictionary with
  units and scopes, real enum value sets, the P-C.1 / P-P.1 / P-C.2 policy logic
  and math, the five stages and five classes, the statistical methods as the
  code states them, the Supabase/Fly.io/Realtime architecture, the real
  four-category 39-term glossary, and the three ACCURATE pilots with their
  actual disruption lists.
- Tables inside a doc body scroll sideways with a sticky first column.

### How to implement
- One §2.7 table violation in `docBodies.tsx` remains baselined.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Docs
- No matches.
- Home
- On this page
- Related articles
- All pages

---

## 23 · My Profile
shot: handoff/shots/35-profile.png
route: More → My Profile
repo: src/pages/Profile.tsx
status: landed
accept: verify src/pages/Profile.tsx

### What it is
Three tabs — Profile · My Access · Change Password — plus the forced-change mode.

### On the phone
- Forced-change mode locks the first two tabs and shows the destructive alert:
  "You must change your password before continuing." A phone user cannot escape
  it by navigating away, which is the point.
- Avatar upload states the rule ("PNG or JPG, up to 2 MB"); email, role and
  organization are visible but disabled — the product shows what it will not let
  you change.
- My Access is the read-only capability summary: pages you can open as check
  chips, pages that are not available to you, features as On/Off badges, the AI
  model allowlist with default and fallback, and the four usage tiles (spent
  MTD/today, requests MTD/today) turning red at the cap.
- Password validation is the real rule — 8 characters and match — with the
  confirmation "valid for 90 days".

### How to implement
- Landed, built mobile-first.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- My Profile
- Manage your account, contact info, and password.
- You must change your password before continuing.
- Profile information
- Your name and contact details visible to teammates.
- PNG or JPG, up to 2 MB.
- Save changes
- What you can access
- A read-only summary of your current access. To request changes, contact your administrator.
- Pages you can open
- Not available to you
- Opening one of these shows the access-restricted page. Ask your administrator to grant it.
- Features
- AI models you can use
- AI budget & usage
- Your spend caps and current usage this month.
- Change password
- Use at least 8 characters. Passwords expire every 90 days for security.
- Update password

---

## 24 · Access restricted
shot: handoff/shots/36-forbidden.png
route: any denied destination (More → a page you cannot open)
repo: src/pages/Forbidden.tsx
status: landed
accept: built  src/pages/Forbidden.tsx

### What it is
The `RoleGuard` denial. Small, but it is the screen a wrongly-provisioned user
meets first.

### On the phone
- `ShieldAlert`, the verbatim copy, and one 48px action.
- The action returns to **the first page they may open**, not the landing page —
  bouncing a signed-in user out to marketing is a bug, not a policy.

### How to implement
- Landed.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- Access restricted
- Return to home

---

## 25 · About & Help
shot: handoff/shots/37-help.png
route: About & Help
repo: src/pages/help/* + the docs registry
status: landed
accept: pending   help hub rows point at real slugs; page not rebuilt

### What it is
The hub into documentation and support. It replaced a placeholder whose four doc
links were invented.

### On the phone
- Documentation rows point at real slugs: the docs overview (21 pages · 5
  sections · searchable), the engine & phase pipeline, the 22-policy catalog,
  statistical methods, and the glossary.
- Support rows are the real contacts; nothing here promises a channel that does
  not exist.

### How to implement
- Landed.

### Copy on this screen

Extracted from the demo, not retyped — every visible string on this surface, so
nothing is described only in summary:

- About & Help
- documentation · support
- Documentation
- Open the docs
- 21 pages · 5 sections · searchable
- overview
- Engine & phase pipeline
- how scsim actually runs
- des-model
- Supply chain policies
- 22-policy catalog
- policies
- Statistical methods
- warm-up · CRN · n*
- stats
- Glossary
- plain-language definitions
- glossary
- Support
- Email the lab
- phu.nguyen@hwr-berlin.de
- About SuReSuite
- team · funding
- about

---

## Appendix · The yellow, counted against the design system

The design system settles this, and I got there the long way. §3.9 states the
count outright — "`#F8D448` is the 'begin here' accent, and it has exactly four
uses… never a status, never a large fill" — and names all four. So:

| # | Sanctioned use (§3.9) | In the demo | Verdict |
|---|---|---|---|
| 1 | `TEMPLATE_BTN` — the starter/template **download** button (`adminUi.tsx`, `DeveloperApi.tsx`) | Project Manager "Download template" chip; Developer API "Download template (.ipynb)"; the `#fffdf3` row tint behind template rows | correct |
| 2 | Quick Start step markers on Getting Started — three **32px** circles, `from-[#F8D448] to-[#F8D448]/80` | flat 30px circles, no gradient | right role, **rebuilt flat** — part of the entry 04 divergence |
| 3 | A 2px × 36px rounded emphasis rule under the one stat that matters (`AdminDashboard.tsx`) | Super Admin, on the `#fffdf3` Cost MTD cell | correct |
| 4 | `LAYER.accent` in `piUi.tsx`, held for agent/layer accenting | not used as a layer accent anywhere in the demo | unused |
| — | *not sanctioned* | `STEP_DOT.awaiting_approval` in PI plan parts | **violation — see entry 16** |
| — | *not sanctioned* | the viewer's 44px "Download CSV" button | **drift — see below** |

**Two corrections to my own earlier work, both worth recording.**

The first draft of entry 04 said "the second of the yellow's four sanctioned
uses". That was **right** — four is the documented count — and I replaced it with
a note doubting the number. Recounting occurrences in the demo instead of reading
§3.9 turned a correct claim into a wrong one. The demo has six occurrences of the
hex; the system has four *roles*. Those are different questions, and I answered
the one I could compute rather than the one that mattered.

The second: I filed the viewer's "Download CSV" button as an open question for
the design system to settle. It is already settled. Use 1 is specifically the
*starter/template* download — the thing you open to begin — and §3.9 closes by
saying that outside those four uses, the yellow is not to be reached for. A CSV of data you already
imported is an export, not a starting point. It is drift, and the fix is the
neutral 44px icon button the viewer's other controls use.

That leaves two real defects in the demo, not one open question and one violation.

---

## Appendix · What is deliberately not on mobile

| Thing | Why |
|---|---|
| 3D interactive network space | Decided: findings-only on a phone. It is named as a desktop surface, never rendered empty. |
| Multi-row bulk edit in `StagePolicyTable` | The component has no selection model; adding one is not a UI-only change. Report it, do not smuggle it. |
| Scenario-from-node write | It writes a scenario; the tap-target half is UI, the write is a feature PR. |
| A second breakpoint | One breakpoint, 768px, forever. |
