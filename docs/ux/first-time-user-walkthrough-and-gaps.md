# SureSuite — First-Time User Walkthrough & Gap Analysis

> Purpose: a page-by-page, click-by-click narrative of the product as a brand-new user
> experiences it, followed by a structured catalog of the gaps between what the UI
> *implies* and what it actually *does*. This document is the working record we use to
> plan gap-closing work. It is written from reading the frontend source
> (`src/`), not from a marketing deck — every screen, button, empty state, and dead
> end below is traceable to a component in the codebase.
>
> Scope note: SureSuite uses a **custom email/password auth** (Supabase RPC
> `authenticate_approved_user`, not Supabase Auth) and a **4-role model**
> (`super_admin`, `admin`, `modeler`, `user`). Several page-level behaviors branch on
> role, so where it matters the narrative calls out what each role sees.

---

## PART 1 — The walkthrough (screenplay)

### Scene 0 — I open the application (bootstrap + route guard)

I navigate to the app URL. Before any page paints, the app shell mounts a stack of
providers: React Query, a theme provider (`next-themes`, default "system" so it follows
my OS light/dark setting), an **AuthProvider**, and a **GlobalProjectProvider**. The
AuthProvider immediately tries to rehydrate me from `localStorage` (`auth_user`). There is
no server session — my identity lives entirely in the browser's local storage.

Every real route is wrapped in `<ProtectedRoute>`. Because I'm a first-time user with
nothing in local storage, `user` is `null`, so ProtectedRoute renders `<Navigate to="/auth">`
and I'm bounced to the login screen. (If auth were still resolving I'd briefly see a
centered spinner with "Loading…", but since state is read synchronously from local storage
I mostly skip straight to `/auth`.)

### Scene 1 — The Auth page (`/auth`)

I land on a single centered card on a plain background, with a small footer pinned to the
bottom. The card header reads **"Welcome Back"** with the subtitle *"Enter your credentials
to access the app."*

Inside the card is a two-tab control:

- **Login** (active by default)
- **Register**

**On the Login tab** I see:

- A field labeled **"Username"** — but note it's actually an `<input type="email">` with the
  placeholder *"Enter your username,"* a small mail icon on the left, and it is validated by
  Zod as an email address. (So the label says "Username" while the validation demands an
  email. More on this in the gaps section.)
- A **"Password"** field with a lock icon and an eye/eye-off toggle button on the right that
  shows/hides the password.
- A full-width primary **"Log In"** button. While a request is in flight it disables and its
  text changes to *"Logging in…"*.

I type my approved email + password and click **Log In**. Under the hood this calls the
`authenticate_approved_user` RPC; on success it also calls `set_current_user_context` (to arm
row-level-security), looks up my organization, and enriches my profile (display name, avatar,
`is_active`, password-expiry, `force_password_change`). If my account is flagged inactive,
login is refused with *"Your account has been deactivated."* On any credential failure I get a
red destructive toast *"Login failed — Please check your credentials and try again."* On
success I get a green *"Login successful — Welcome back!"* toast and I'm navigated to `/`.

**If I click the Register tab instead**, there is *no registration form at all*. I only see an
alert box: *"Account Registration — To request access to this application, please send an
email to phu.nguyen@hwr-berlin.de with your request for an account,"* plus a *"Log in here"*
link that just resets the form and (visually) sends me back. So self-service signup does not
exist; access is granted manually by an administrator. There is also **no "Forgot password"**
link anywhere on this screen.

### Scene 2 — The landing page: "Getting Started" (`/`)

After login I arrive at the route `/`, which renders the **GettingStarted** page. Critically,
this is *not* a functional dashboard — it is a long, marketing-style scrolling page. On the
left is the persistent navigation sidebar (Scene 3). The main column, top to bottom:

1. **Hero band.** A gradient/grid background. A rounded logo tile with a network icon, the
   wordmark **"SuReSuite"** and tagline *"Supply Chain Resilience Suite."* A giant headline:
   *"Stress Testing Your Supply Chain with Known and Unknown Disruptions."* A paragraph selling
   the network-science + simulation pitch. Then two buttons:
   - **"Start Analysis"** (primary, with a spreadsheet icon) → links to `/project-manager`.
     This is the intended entry into the real workflow.
   - **"View Demo"** (outline, with a play icon) → **does nothing** (no handler, no link).
   Below the buttons, four green-checked "stat chips": *3 network levels · 5k+ sims · 5 tactics
   · Easy scenarios.*

2. **"See SuReSuite in action" video section.** A large embedded YouTube player… except the
   embed's `videoId` is the literal placeholder string `"VIDEO_ID"`, so the player is broken.
   Under it, an outline button *"View the full network view tutorial"* → `/help/network-sci`.

3. **"Core Capabilities" — three feature cards:**
   - *Interactive Network Graph* — "See disruption impact fast."
   - *Hidden Critical Detection* — "Surface nexus nodes automatically."
   - *Strategy Simulation* — "Test tactics side-by-side."
   Each card has a **"Learn more"** ghost button — but **none of them navigate anywhere** (no
   handler). They're decorative.

4. **"Quick Start with SuReSuite" (dark band).** A three-step story — *Data Upload → AI
   Analysis → Strategy Testing* — with a **"Launch SuReSuite"** button → `/project-manager`
   and a subtitle line: *"Upload data → Analyze vulnerabilities → Simulate strategies."* This
   sentence is effectively the product's promised happy path.

5. **"Technical Architecture" tabbed panel.** Three tabs — *Network / Nexus Detection /
   Simulation*. On load, the tabs auto-rotate once (network → nexus → simulation → back to
   network over ~9s) and then stop. The Network tab embeds a live **3D network visualization**
   (`NetworkVisualization3D`); the other two tabs are static explanatory panels.

6. **A CTA band** — *"Ready to boost the resilience of your supply chain?"* with a **"Start
   now"** button → `/project-manager`.

7. **Roadmap** — a static timeline: *Enhanced Training (In progress, Q4 2025), GIS Mapping
   (Planned, Q1 2026), Deep-Tier Analysis (Planned, Q2 2026).* Purely informational.

8. **Footer band** — developer/lab credits (Phu Nguyen; Prof. Dmitry Ivanov; Digital SC Lab @
   HWR Berlin) and the EU/ACCURATE grant acknowledgement with project start/finish dates.

As a first-time user, everything real routes to **one destination — `/project-manager`** — so
that's where I go next by clicking **"Start Analysis."**

> Role caveat: the primary CTA links to `/project-manager`, which is **only** permitted for
> `admin`, `modeler`, `super_admin`. A plain **`user`** who clicks "Start Analysis" is
> redirected by the route guard to **`/forbidden`** — a dead end from the landing page's main
> call to action.

### Scene 3 — The persistent navigation sidebar (chrome on every app page)

A fixed left rail, collapsed to a thin icon strip (`w-14`) by default. It animates open to a
labeled panel (`w-48`) when I click the compact logo / chevron at the top. Sections
(separated by dividers), filtered by my role via `canAccessRoute`:

- **Getting Started** (`/`, home icon)
- **Project Manager** (`/project-manager`, database icon) — *hidden for `user` role*
- **Product-Level** (`/network/product-level`)
- **Process-Level** (`/network/process-level`)
- **Firm-Level** (`/network/firm-level`)
- **Policies** (`/policies`) — tooltip "Sourcing, inventory, transportation, fulfillment"
- **Simulation Lab** (`/simulation-lab`) — tooltip "replications, warm-up, utilization KPIs"
- **Project Intelligence** (`/project-intelligence`, brain icon)
- **Super Admin** (`/admin`, shield icon) — *only visible to `super_admin`*
- **About & Help** (`/help`, info icon)

At the very bottom is an **account button** (my avatar/initial + name + role). Clicking it
opens a dropdown: **My Profile** (`/profile`), **Help** (`/help`), and **Logout**. Logout
clears local storage and drops me back to `/auth`.

Notably, **there is no "Interactive Network Space" link in the sidebar**, even though the
route `/network/interactive-space` exists and is fully built — it's reachable only by direct
URL.

### Scene 4 — Project Manager (`/project-manager`) — the real starting point

This is where the actual work begins. The page (wrapped in the shared `PageLayout`, which also
renders the sidebar, a possible **password-expiry banner**, and a footer) shows a header
**"Your Projects."** Its subtitle depends on my role: *"Create and manage your supply chain
projects"* (if I can modify) or *"View available projects"* (read-only `user`). On the right
of the header: a badge showing the currently-selected project's name (once one is selected),
and — for modifiers — a **"New Project"** button.

**Empty state.** As a brand-new user, my project list is empty, so I see a bordered card:
*"No projects found — Create your first project to get started."* There is no wizard or
guided tour; the only affordance is the **New Project** button.

**Creating a project.** I click **New Project**. An inline dashed **"Create New Project"**
card expands (not a modal) with:

- **Project Name** (text; shows a red *"A project with this name already exists"* inline if it
  collides with one of my existing projects).
- **Plant** (text).
- **Data** — radio: *Curated data* / *Uncurated data*. (The UI gives no explanation of what
  this changes.)
- **Supply Chain Model** — radio: *Make-To-Order* / *Make-To-Stock*.
- **BOM Level** — radio: *Single Level BOM* / *Multiple Level BOM*.
- **Deep Tier Network** — a switch *"Enable Deep Tier Network Analysis"*; when on, a helper
  note appears about tier-2/tier-3 supplier data.
- **Simulation Start Date** / **Simulation End Date** — two stepwise date pickers, pre-filled
  with a sensible default range; the end date can't precede the start.
- **Create Project** (disabled until name + plant are filled and the name isn't a duplicate)
  and **Cancel**.

I fill it in and click **Create Project**. This calls the `create_project` RPC. On success I
get a toast *"Project '…' has been created,"* the form collapses, and the project appears as a
card in the list.

**The project card.** Each project renders as a rich `ProjectCard`. Clicking anywhere on the
card **selects** it (a primary ring + tinted background mark the selection; this drives the
`selectedProject` state). The card shows:

- The **name**, and a row of outline badges: plant, curated/uncurated, model (MTO/MTS),
  BOM level, and (if enabled) a blue *"Deep Tier Enabled"* badge. If a combine has run, a
  status badge (pending/running/completed/failed) appears too.
- A **"Simulation Period"** row with start/end date pills (falls back to current-year defaults,
  labeled "(default)", if dates were never set).
- A **"Data Completion Checklist"** of colored badges: **BOM ✓/✗, Inbound ✓/✗, Outbound ✓/✗**
  (green when present, red when missing), plus deep-tier badges (Deep Nodes / Deep Edges) if
  enabled, and an **optional "Node List"** badge. The Node List badge is special: once the
  three core datasets exist, it becomes clickable — if a node list already exists it
  **downloads** the pre-combined node list CSV (with a tooltip explaining you can enrich it
  with locations and re-upload); if not, clicking it **generates** one (combine → rebuild).
- A footer line: *"Modeller: … • Created: …"*.

On the right edge of the card is a **toolbar** (only fully shown to the owner/admin):

- A **Global-project switch** (a small toggle). This is *distinct from card selection*: turning
  it on sets the **global** active project (`globalSelectedProjectId`) used across the network,
  policies, simulation, and intelligence pages, and pops a toast *"…is now the active project
  across the app."* (So there are two selection concepts — local click-select and the global
  toggle — and only the global one carries to other pages.)
- **View data** (eye) — expands an inline `ProjectDataViewer` below the card to inspect
  uploaded rows.
- **Upload data** (upload icon) — expands the **Upload Wizard** inline (Scene 4a).
- **Edit item master** (coin icon) — expands an `ItemMasterEditor` for per-item costs &
  capacities.
- **Combine datasets** (workflow icon) — appears once some data exists and no combine is
  running; runs the combine pipeline (Scene 4b).
- **Edit project** (pencil) — flips the card into an inline edit form (same fields as create).
- **Delete project** (trash) — a native `confirm()` dialog; complex (deep-tier + multi-level)
  projects warn they'll be "force-deleted."

#### Scene 4a — The Upload Wizard (inline)

Clicking **Upload data** opens a card with a tab strip of dataset types: **BOM, Inbound,
Outbound, Item Master, Node List**, and (if deep tier is on) **Deep Tier Network**. Top-right
of the wizard: a **Template** download button (grabs the matching CSV template — or a JSON
example for deep-tier JSON), a **Guide** button (opens the CSV upload guide), and a close (X).

Flow for a standard dataset (e.g., BOM):

1. The wizard auto-picks the right template (single- vs multi-level BOM based on the project).
2. I download the template, fill it, and choose my file via a file input (`.csv`).
3. On select, it parses the CSV, checks that required columns are present (else *"Missing
   required columns: …"*), coerces numeric fields, and runs row-level validation (e.g.
   consumption rate > 0; non-root multi-level BOM rows need a higher-level component; volumes
   and prices non-negative). Errors surface in a red alert listing each offending row.
4. A **preview table** shows the first 5 rows and a *"N rows ready for upload"* banner with a
   green **Upload** button.
5. Uploading batches the rows (via RPCs or edge functions, with retry/timeout handling for big
   files) and toasts *"Upload successful — N records uploaded."*

Sub-flows:
- **Item Master** adds a radio to pick **Materials / Products / Suppliers** — each with its own
  template of economics the simulation reads (cost/MOQ/holding/lead-time-shape for materials;
  price/capacity/demand/fulfillment for products; capacity/reliability for suppliers). Only the
  ID column is strictly required; enum columns are checked against the engine's allowed values.
- **Deep Tier Network** adds a **format** radio: *CSV (two files: nodes + edges)* or *JSON
  (single combined file)*. CSV mode shows two separate file inputs with their own previews and
  a combined *"N nodes + M edges ready"* upload button. After a deep-tier upload, node
  "prominence" is auto-recalculated.

When the wizard reports completion, the page refreshes the project's status. If the three core
datasets are now present but the node list isn't, I get a nudge toast: *"All datasets uploaded.
Click 'Refresh Data' to finalize project '…'."*

#### Scene 4b — Combine / finalize

Once BOM + Inbound + Outbound exist, I click the **Combine datasets** (workflow) icon. The card
badge flips to *running* (spinner), the app checks completion, invokes the `combine-project`
edge function, then polls the node list for readiness (~20s). On success: *"Data combined and
node list is ready,"* sometimes with a breakdown of outbound/BOM/inbound counts. Only after
this combine does the project's network actually render downstream. This is a **manual,
multi-click orchestration** (upload each dataset → combine → optionally build/enrich node
list), not a single "process my data" action.

### Scene 5 — The network views

With a combined project set as the **global** active project (via that toggle on the card), I
open the network pages. Each is a full analytical workspace. They share a pattern: a
`PageHeader` with a dynamic subtitle counting the entities, a **project `Select` dropdown** in
the header (a *second* place to switch projects, separate from the Project Manager toggle),
a large graph canvas, and side analytics.

**Product-Level Network (`/network/product-level`).** Header subtitle counts suppliers /
materials / products / customers. The header's right side has: (when a node is selected) an
orange **disruption** button (triangle icon), a **search** toggle ("find a node"), an
**analytics** toggle, a **map ⇄ network** view toggle, a **Refresh** button, and the project
dropdown. The main area is a `ReactFlow` canvas (background grid, zoom controls, minimap
colored by node group) or, toggled, a geographic **MapView**. A hint reads: *"Click/double-click
node to select and add disruptions • Double-click to focus supply chain path."* Selecting a
node and clicking the disruption button opens the **Disruption dialog** (Scene 5a). If the
project has no combined data, I get a toast *"No data found for project."*

**Process-Level Network (`/network/process-level`).** Same shell; subtitle describes shop-floor
dependencies with level filters (a "Level 1 Filter" select, a "find a component" search). Empty
state text: *"Select a project to view its integrated process-level network."*

**Firm-Level Network (`/network/firm-level`).** Titled *"Firm-Level Network Intelligence,"*
subtitle counts Tier 1 / Tier 2 / Tier 3 suppliers and plants (the deep-tier view). Richer
tables of firms by industry/revenue.

**Interactive Network Space (`/network/interactive-space`).** Titled *"Interactive Network
Space — Advanced network exploration with intelligent search and subgraph extraction."* A
powerful search box (*"Search components, products, suppliers… (type ? for options)"*) and
subgraph extraction. Empty state: *"Select a project and upload your supply chain data to start
exploring."* **This page is not in the sidebar** — I'd only find it via a direct link.

#### Scene 5a — The Disruption dialog (network → scenario bridge)

From any network node I select and click the disruption (triangle) button, a modal **"Add
Disruption Scenario"** opens. It explains I'm configuring a disruption and that *"Once saved,
you can run simulations on the Simulation page."* Fields:

- **Scenario Name** (required, e.g. "Major Supplier Outage").
- **Disruption Target** — radio *Single Node* (pre-filled with the selected node id) or *Single
  Edge* (pick from connected edges, or type `from→to`).
- **Disruption Type** — radio *Capacity Reduction* (then a unit: percentage or numeric, and the
  magnitude) or *Time Delay* (amount + days/weeks; end date auto-calculates).
- **Disruption Event Start / End** — stepwise date pickers constrained to the project's
  simulation window (with a helper showing the allowed range).
- **Description** (optional).
- **Cancel** / **Create Scenario**.

On **Create Scenario**, it writes the scenario (`create_disruption_scenario_v2` + a
`createFromNode` scenario record) and shows a success toast with an **"Open in Simulation Lab"**
action that deep-links to `/simulation-lab?scenario_id=…&pane=recovery`. This is the intended
hand-off from "explore the network" to "simulate a disruption."

### Scene 6 — Policies (`/policies`) — the deep walkthrough

This is the analytical core of the product, and it is far denser than any other page. I'll
narrate it in full — the page frame, then how I *set* a policy, then the entire
**Run & Validate** trail (verification → single run → multiple runs → warm-up detection →
validation → adopt), because that pipeline is the whole point of the page and was badly
under-described before.

#### 6.0 — The page frame

Header **"Supply chain policies."** The subtitle is a live **context strip**
(`ProjectContextStrip`): **Plant · Model (MTO/MTS) · BOM · #suppliers · #plants · #customers**,
read from the selected project's combined data. The header's right side has *another* project
`Select` (bound to the global project). No project selected → an alert *"Select a project to
configure policies."*

With a project chosen, the body is a **three-tab** control:

- **Stages** (default) — the editor (6.1–6.6 below).
- **Guide me** — a `GuidePanel` narrative that can deep-jump me straight to a specific stage.
- **Data map** — a `DataMapGrid` showing, field by field, how my uploaded data (BOM / inbound /
  outbound / item masters) maps into the parameters the engine actually reads. This is the
  "where does this number come from" reference.

On the **Stages** tab, above the editor, three persistent bars:

- **PolicyVersionBar** — policies are **versioned snapshots**. I can pick a saved version from a
  dropdown, **Save** a new snapshot (label it), and **Restore** an older one. A **dirty**
  indicator lights up the moment my live edits drift from the selected version. This matters
  downstream: **a run requires a saved policy version**, and an unsaved edit is "dirty."
- **TimeUnitBar** — the simulation calendar (the project's start/end and the time unit the
  engine steps in — the model runs on a **weekly phase pipeline**).
- **StageRail** — the four ordered stages, with badges showing how many overrides each carries
  and whether its data is present.

#### 6.1 — The four stages (what I'm actually configuring)

The pipeline mirrors the physical supply chain, focal-plant-centric:

| Stage | Scope | What I set | Override families |
|---|---|---|---|
| **Supplier** | per **supplier × material** | sourcing strategy & safety stock (transport comes from network edge data, not here) | sourcing, inventory |
| **Focal plant** | per **product** | capacity, production cost, lead time (+ finished-goods inventory if Make-To-Stock) | production, inventory |
| **Customer** | per **customer × product** | sourcing firm, price, backorder handling (demand comes from product data) | fulfillment |
| **Run & validate** | whole model | verify inputs → run → detect warm-up → validate → adopt | — |

There are **seven policy families** in the schema — *sourcing, inventory, transport,
fulfillment, production, recovery, demand* — but the GUI deliberately **only exposes the fields
the scsim engine actually consumes** (`SCSIM_VISIBLE_FIELDS`). Two entire families are hidden:
**transport** (driven by network edge attributes) and **demand** (driven by product/graph data).
So although the schema defines dozens of parameters per family, what I can edit is the engine-
relevant subset, e.g.:

- **Sourcing:** `strategy` (single / multi / primary_backup / dual_sourcing / tiered),
  per-supplier `ratios`, `supply_share`.
- **Inventory:** `type` (min_max / base_stock / rop / periodic_review), `safety_stock_method`
  (fixed_days / service_level / king_method), `safety_stock_days`, `service_level_target`,
  `holding_cost_pct`, and — for MTS — finished-goods safety stock (`fg_safety_stock`,
  `fg_service_level_target`, `fg_safety_stock_days`).
- **Fulfillment:** `allocation` (priority / fair_share / proportional / revenue_max / sla_tier),
  `backorder_allowed`, `max_backorder_days`, `backorder_cost_per_day`, `tier_overrides`.
- **Production:** `capacity_units_per_day`, `allocation_priority_weight`.
- **Recovery:** `response` playbook (reroute / dual_source_activate / mode_shift / capacity_flex
  / early_warning / allocate_materials), `detection_lag_days`.

#### 6.2 — How I actually set a policy (the StagePolicyTable)

Picking a stage renders a **StagePolicyTable** with a heading like *"Supplier policies"* and a
one-line role description. Two layers of settings:

1. **Defaults** — the baseline value for every visible field, grouped into accordion sections
   (Basics / Safety stock / Costs, etc.). Editing a default is a project-wide setting for that
   family. Saving a default calls `saveDefault(family, value)`.
2. **Overrides** — per-entity exceptions. Each row is a specific supplier×material (or product,
   or customer×product) whose value differs from the default. I can bulk-edit overrides
   (`BulkEditDialog`), and delete an override to fall back to the default.

Above the table, two power tools:

- **Excel** (dropdown) — **Export** the whole stage (defaults + overrides) to an `.xlsx`
  workbook, edit offline in a spreadsheet, and **Import** it back (with per-cell error
  reporting). This is the realistic way to configure hundreds of entities.
- **Apply preset** (dropdown, sparkle icon) — pick a curated **stage preset** (e.g. a resilience
  posture). It opens an `ApplyPresetDialog` that resolves the preset against my project context
  and shows what will change; after applying, a **PresetDiffBanner** sits atop the table showing
  *"preset X applied, N changes"* with **Revert**. Presets carry **provenance** (a
  `ProvenanceBadge`) so I can see a value came from a preset vs. my own edit.

If the project has no combined data, a yellow banner tells me to *"upload and combine datasets
in Data Manager"* first.

#### 6.3 — Stage 4: "Run & validate" — the five-step scientific trail

Selecting the **Run & validate** stage replaces the table with a **`PolicyRunStepper`** — a
five-step, ordered pipeline with a "Continue"/"Back" footer (*Step N of 5*) and a persistent
**Model-credibility badge** at the top reading **validated / stale / unvalidated**. Each step
gates the next; the badge and warm-up chips update live. The five steps are literally:

**Step 1 — Verification ("Catch input issues").**
I click **Run checks**. This runs `verifyProjectPolicies` over my defaults, overrides,
fulfillment strategy, all stage rows, item masters, and lanes (inbound/outbound/BOM). It returns
a list of **findings**, each with a severity — **block** (red octagon), **warn** (amber
triangle), or **info** — a message, the offending row/field, and a hint. A header line shows
*"N findings · M blockers · K warnings · verified HH:MM."* The step also shows my **dataset
hash** and whether it's *not snapshotted / changed since last snapshot / up to date* (a snapshot
is captured automatically when I run). **I cannot proceed while any blocker exists.** If data is
still loading it refuses to grade partial data (*"try Run checks again in a moment"*).

**Step 2 — Run simulation ("Single + replications").**
First a **compute-location toggle**: **"Run on server (default)"** — dispatches to the Fly.io
worker via `sim-command`; results stream back live over realtime and the tab stays free — vs.
**"Run in browser (offline)"** — the *same* scsim engine compiled to WebAssembly (Pyodide,
~20 MB one-time download, slower, single-threaded) so a run is possible with nothing but the
static frontend. A collapsible **Diagnostics** row offers a **Test engine** self-test (fixed
input, no data) that reports *"Engine works — scsim vX, fill rate …%"* plus the deployed build
SHA. A **persistent run-status banner** (not a vanishing toast) is the single "did it run?"
signal: *loading → computing (done/total) → succeeded (fill rate · revenue · N reps · engine
version) → or failed (which step, why)*.

Then a **two-tab run control**:

- **Single run** — validates *one deterministic trajectory*. Fields: **Seed** and
  **Horizon (days)** (default 365). I click **Run single**. When it finishes, the panel below
  becomes a model-behavior inspection dashboard: inventory dynamics, the financial statement
  (per-component cost lines), every persisted weekly series (fill rate, backlog, on-hand value,
  revenue), and sanity-check scalars — all from real persisted run output.
- **Multiple runs** — *"ensure statistical significance."* A Setup card: **Seeds** (Auto → N
  replications with seeds 1..N, or List → explicit comma-separated seeds), **Simulation time
  (days)**, **Confidence** (90 / 95 / 99%), and **Focal KPIs** (multi-select chips from the real
  engine KPI vocabulary — fill_rate, max_backlog, on-hand value, revenue, lost sales, capacity
  utilization, and the whole cost-of-resilience family). I click **Run replications**. A
  **MultiRunResultsPanel** renders per-KPI **convergence** and weekly traces (mean ± CI), empty
  until the first run.

Below both tabs, a **"Engine run — live status & persisted output"** section shows the
`RunProgressPanel` (cancel; **add replications**) and, once reps land, an `EngineOutputSummary`.
Runs launched from here all reuse one auto-managed scenario named *"Policy validation (auto)"* so
the Lab's scenario list doesn't fill with validation runs.

**Step 3 — Warm-up detection ("Adequacy + estimation").** Two sub-steps:
- **(a) Replication adequacy** — from the real replications it computes, per focal KPI, the
  mean ± confidence-interval half-width and **n\*** = the replications needed to hit a **target
  half-width** (default ≤ 5% of the mean). If I'm short, it offers **+ add replications** on the
  real run. I can tune the target precision here.
- **(b) Warm-up estimation** — I pick **indicators** (which KPI series to analyze) and a
  **Method**: **Engine (most conservative)** — the week the engine itself flagged; **Welch
  moving average**; or **MSER-5**. I click **Auto-detect** and it computes the warm-up cut in
  weeks/days from the persisted weekly fill-rate series (falling back Welch→MSER if the engine
  didn't record one). A **"Warm-up detected: X days (method)"** chip appears, and every weekly
  chart draws a reference line at the cut so I can see steady state begin. (I can also type the
  warm-up days by hand.) I can optionally upload an empirical time-series per indicator here too.

**Step 4 — Validation ("Compare with empirical").**
Subtitle: *"Steady-state (t > warm-up days) · KS + Welch t-test."* For each focal KPI I **upload
an empirical CSV** (real-world observations). Clicking **Run validation** compares my
**steady-state simulated sample** (weekly values after the warm-up cut, or per-rep scalars) with
the empirical values using a **Kolmogorov–Smirnov statistic** and a **Welch t-test**. A results
table shows **KS D, KS p, t, t p, n, source, and pass/fail** per KPI — a KPI **passes** when both
p-values ≥ 0.05 (distributions statistically indistinguishable). If I have no empirical data,
this step can be skipped in favor of **face validation** (step 5).

**Step 5 — Adopt ("Persist the model card").**
A prerequisites checklist makes the gate visible: **Verification** (no blockers) · **Evidence
run** (N completed replications + engine version + run id) · **Warm-up** (X days, method) ·
**Replication adequacy** (recommended n\*) · **Validation** (statistical pass, or an explicit
**face-validation acknowledgment** checkbox when no empirical series were uploaded). When ready,
**Mark model valid** snapshots the *exact* policy version + dataset + baseline scenario and
records a **model card** (`record_model_validation`) bound to a **provenance triple** (policy
version hash · dataset/graph hash · scenario fingerprint hash). The **credibility badge** then
flips to **validated**. Everything on the card is *computed* from real run output — nothing is
asserted. If I later edit a policy, change data, or the scenario, the badge derives **stale** at
read time (hashes no longer match) and offers **Re-validate →**. Lab scenarios can inherit this
validated model.

So the "trail" you asked about is, precisely: **set policies (defaults + per-entity overrides,
optionally from presets or Excel) → Run & validate → 1) Verify → 2) Run (single trajectory,
then multiple replications with seeds/confidence/focal KPIs, on server or in-browser) →
3) detect warm-up (replication adequacy + Welch/MSER/engine estimation) → 4) validate against
empirical data (KS + Welch t-test on steady-state) → 5) adopt a versioned, hash-bound model
card.**

---

## Scene 6 — reality check & build spec (start the redesign here)

> The four items below are the concrete "this is not what I asked for" points on `/policies`,
> each measured against the **authoritative spec** `docs/design/policy-specification.md` and the
> **actual code**. Written as a build ledger so a fresh *Policies UX/UI redesign* work-stream can
> begin from it directly. Format per item: **what you asked for → what the code does today
> (file-referenced) → the gap → the target to build.**

### 6.A — The policy grid is a flat field-dump, not the "Policy Type → dynamic parameters" table

**What you asked for (and what the spec already mandates).** `policy-specification.md` §II.1–§II.3:
each category is a table whose rows are *(facility, item)* pairs and whose **central cell is a
Policy Type** dropdown that drives a **dynamic Policy Parameters** cell — verbatim: *"choosing a
type changes which parameters are shown and editable — exactly the user's core idea."* The spec's
canonical column model is:

`Facility | Item | Policy Type | Policy Parameters | Initial Stock | Policy Basis | Stock Calc. Window | Periodic Check | Period / First Check | Min Split Ratio | Inclusion`

The parameter cell renders **from the selected type's schema**: the type's 1–3 headline params get
their own columns (e.g. `min_max → s, S`), the rest appear as a compact `param = value` chip list
(spec §II.3). That is precisely your "**one column shows the parameters the policy needs, one
column lets me input them**."

**What the code does today** — `src/components/policies/StagePolicyTable.tsx` +
`src/lib/policies/columnSpecs.ts`. The grid is a **wide spreadsheet with one fixed column per
policy field**, grouped into coloured **family bands** (sourcing / inventory / transport /
production / fulfillment). There is **no Policy Type cell that swaps the parameter set.** Headings
are flattened field labels from `FIELD_LABELS` — e.g. the **Supplier** stage renders columns
`Primary · Share (%) · Supply share (P-S.2) · Material price · Lead time mean (days) · Material
cost (master) · MOQ (master) · Supplier capacity (units/wk) · Reliability (0–1) · Policy type ·
Safety stock (days, 0–84) · Holding cost (%/yr) · Mode · Lead time mean (days) · Cost / km`; the
row keys are `Material · Supplier` (plant: `Focal plant · Product`; customer: `Customer ·
Product`). The only "dynamics" is per-cell **`visibleWhen`** gating that renders an inapplicable
cell as `—` (e.g. `supply_share` only when `strategy = multi`; FG fields only under MTS). Inventory
`type` (min_max / base_stock / rop / periodic_review) is just another dropdown column — choosing
`min_max` does **not** reveal `s, S`; choosing `rop` does **not** reveal `R, Q`. The whole per-type
parameter library of spec §III (s, S, R, Q, review period, Initial Stock, **Policy Basis**, MRP
horizon, …) is **absent from the grid.** The spec itself flags this: *"today the grid still uses a
transitional 7-family Zod schema — the reframe here is the target the grid migrates to."*

**The gap (your 1.1 + 1.2).**
- **Wrong column headings** — flattened engine-field names, not the spec's column model; no Policy
  Type / Policy Parameters / Policy Basis / Initial Stock / Periodic Check columns at all.
- **Not dynamic** — parameters don't follow the chosen policy type; you can't pick "(R,Q)" and get
  `R` and `Q` inputs. The selectable **policy library** (§III inventory ×12, §IV sourcing /
  production / capacity, …) simply isn't there.

**Target to build.** Migrate the grid to the discriminated-union model generated from
`src/lib/policies/registry.generated.json` (blueprint §6.2): a **Policy Type** column per category;
a **dynamic parameter renderer** (headline params → columns, remainder → chip list) built from the
selected type's JSON-Schema, each editor carrying unit/min/max and inline `feasibility()`
validation; plus the spec's structural columns (Initial Stock, **Policy Basis**, Periodic Check /
Period). Keep the existing provenance dots and the Excel round-trip.

### 6.B — Transparency: good on data-provenance, missing at the policy/parameter level

**What you asked for (1.3, repeatedly).** Settings must be transparent: which parameter belongs to
which policy, its unit/range/meaning, where its value came from, and what the engine actually does
with it — *"no hidden heuristics"* (spec §II.6).

**What exists today.** The grid does **data provenance** well: a per-cell corner-dot legend — *from
project data (sky) · imputed average, verify (red) · derived fallback ≈ (amber) · saved override
(emerald) · edited (primary)* — plus banners ("Policies seeded from your uploaded project data",
"N rows use estimated values — please review") and **engine-status badges** on fields not yet
consumed by the engine (shown disabled with their milestone). The value precedence is real
(draft → project data → override → default).

**The gap.** That transparency answers *where a number came from*, not *what the policy is*. Absent
from the UI: each parameter's **unit / range / default / meaning** (the spec's per-parameter
tables), the **decision rule / equation** the policy executes (spec §III gives one per type), and
clear disclosure that entire families (**transport, demand**) and many fields are
**stored-but-not-consumed** (`SCSIM_VISIBLE_FIELDS` in `schemas.ts` — only a subset is live). You
cannot currently answer "what does this policy do, and which of these numbers matter?" from the
grid.

**Target to build.** A per-policy **parameter side-sheet** generated from the schema: symbol · unit
· range · default · meaning (verbatim from the spec tables) + the decision-rule formula + an
explicit "consumed by engine ✅ / stored-only 🧩" flag per parameter.

### 6.C — Single / multiple run: charts exist, but only at aggregate level

**What you asked for (point 2).** Right in the single run, let me pick main indicators and **see
them over time** — **material inventory**, **finished-goods inventory**, **finished-goods output
(production)**, and **financial indicators** — as visualisations, so I can eyeball abnormalities.

**What the code does today** — `RunValidateStage.tsx` → `EngineOutputSummary`, `WeeklySeriesChart`,
`FinancialStatement`, `MultiRunResultsPanel`. After a single run you get a genuine inspection
dashboard: headline KPI tiles (Fill rate · Revenue · Lost sales · Max backlog, ± CI); an
**"Inventory dynamics — on-hand value (€)"** weekly line chart (up to 8 replication traces, warm-up
cut line); a **Financial statement** (Revenue − each cost component = Margin, + lost-sales memo);
the other weekly series (**fill rate · backlog units · revenue €/week**); and sanity scalars
(capacity utilisation, lost inbound units). Multiple runs add per-KPI **convergence** (running
mean ± CI).

**The gap.** The engine only persists **four aggregate weekly series** on
`run_replications.time_series`: `fill_rate, backlog_units, on_hand_value, revenue_value`. Therefore:
- Inventory-over-time is a **single aggregate € number** — you **cannot** separate **material**
  inventory from **finished-goods** inventory, nor see any **per-item** trajectory.
- **Finished-goods output / production** over time is **not a series at all.**
- The **financial statement is scalar** (means over reps), not a time series — you can't watch a
  cost line move week to week.
- You can only chart the fixed KPI list; there is no "**pick an indicator**" (e.g. material M1's
  stock) to inspect for abnormalities — which is exactly the check you keep asking for.

**Target to build.** (1) Persist richer weekly series from the engine — per-echelon inventory
(material vs FG), production output, per-component cost — then (2) add an **indicator picker** to
the run panel so single-run inspection can plot per-material / per-product / financial trajectories
(where abnormalities actually surface), not just four aggregates.

### 6.D — Model version history: save/load only; no export, delete, or notes

**What you asked for (point 3).** In model version history: **export** a version's data,
**delete** a version, and attach **notes** to a model (a description of the model — *not* a
changelog/label).

**What the code does today** — `src/components/policies/PolicyVersionBar.tsx`. It supports:
**Save model version** with a single optional **Label** ("e.g. Pre-Q4 freeze"), a **History**
side-sheet listing snapshots (label · timestamp · author · parent version), **Select**, and
**Load** (restore). Nothing else.

**The gap.**
- **No export** — a saved version can't be downloaded (no JSON/Excel export of the policy bundle).
- **No delete** — versions only accumulate; there's no remove/confirm.
- **No notes** — only a one-line *label*; there is no free-text **notes/description** field for the
  model (the save dialog offers "Label (optional)" only, and the `PolicyVersion` record carries no
  notes column).

**Target to build.** On each history entry add **Export** (download the bundle, reusing the Excel
exporter in `src/lib/policies/excel.ts`), **Delete** (with confirm), and a **Notes** free-text
field on save/edit (persisted on the version record, distinct from the label).

### Scene 6 — build checklist (for the new UX/UI section)

- [ ] Grid → discriminated-union **Policy Type** column + dynamic parameter renderer from
      `registry.generated.json` (6.A)
- [ ] Add spec structural columns: Initial Stock · Policy Basis · Periodic Check / Period (6.A)
- [ ] Per-parameter transparency side-sheet: unit/range/default/meaning + formula + engine-consumed
      flag (6.B)
- [ ] Persist per-material / per-FG inventory, FG output, per-cost time series (6.C)
- [ ] Run panel **indicator picker** for single & multi run (6.C)
- [ ] Version history: **Export**, **Delete**, **Notes** (6.D)

### Scene 7 — Simulation Lab (`/simulation-lab`)

Header **"Simulation Lab — Scenarios, replications, warm-up auto-detection, and
utilization-first KPIs,"** again with a project dropdown. No project → alert *"Select a project
to start designing experiments."*

With a project, the layout is a left rail + a main workspace:

- **Left rail:** a **StressTestCard** (one-click launch of pre-built stress-test presets —
  creates a scenario, fills its disruption schedule, and jumps to the recovery pane), and a
  **ScenarioRail** listing scenarios with create/duplicate/delete. The first scenario
  auto-selects; if I arrived via `?scenario_id=…` from a network page, that scenario is
  pre-selected and the recovery pane is opened, with a *"From network map"* badge.
- **Main workspace toolbar:** a five-way toggle — **Setup / Recovery playbook / Run / Results /
  Compare** — plus a **"Browse library"** button (opens a `ScenarioLibraryPanel` of prebuilt
  scenarios to clone).
  - **Setup** — the `ScenarioSetupForm` (scenario parameters).
  - **Recovery playbook** — the `DisruptionRecoveryPane` (disruption schedule + recovery config).
  - **Run** — shows the bound **policy model version**. If policies are dirty/unsaved, the
    primary button is **"Save version & run"** (it snapshots policies first); otherwise it's
    **"Run."** There's an explicit note: *"Policies are versioned; network data is current."*
    Running queues an experiment and switches to the run progress panel (cancel, add
    replications).
  - **Results** — a `ResultsDashboard` of KPIs for the latest run.
  - **Compare** — a `CompareScenariosPanel` for side-by-side scenario comparison.

The dependency chain is strict and mostly implicit: **project with combined data → saved policy
version → scenario → run.** If any link is missing, the relevant button is disabled or a guard
message appears, but the app doesn't proactively walk me through assembling the chain.

### Scene 8 — Project Intelligence (`/project-intelligence`) + the floating chat

Header **"Project Intelligence — Your on-demand supply-chain colleague."** The body is a
two-pane chat app: a **ChatSidebar** (threads: new/select/delete/rename, attach a project) and a
**ChatWorkspace** (messages, an agent picker, a project picker, a model picker, and a composer).
Selecting a thread that has a project attached also syncs the global project selector. This is
an LLM assistant scoped to a project's supply-chain data.

Independently, a **Floating Chat Bubble** rides on *every* authenticated page (bottom-right by
default, draggable, its position/size persisted). It's a neon-ringed round launcher; clicking it
opens a compact, draggable, resizable **"SC Assistant"** panel with: a project `Select`, a model
picker, suggested prompts (e.g. *"Which suppliers carry the highest risk?"*), and a composer.
Until a project is chosen it prompts *"👋 I'm your Supply Chain assistant. Which project should
we dig into?"* and lists my projects as quick-pick buttons. A maximize button hands the
conversation off to the full Project Intelligence page. The composer is disabled (*"Select a
project to start chatting"*) until a project is active.

### Scene 9 — Profile (`/profile`)

Header **"My Profile."** Two tabs:

- **Profile** — avatar (with an *Upload avatar* button, max 2 MB), read-only **Email / Role /
  Organization**, editable **Display name** and **Phone**, and a **Save changes** button.
- **Change Password** — current / new / confirm password fields, an *Update password* button, and
  a note that *"Passwords expire every 90 days."*

If my account is flagged **`force_password_change`**, the RoleGuard on every other page
redirects me here to `?tab=password&forced=1`, a red banner appears (*"You must change your
password before continuing"*), and the **Profile tab is disabled** until I set a new password.
Separately, if my password is within 14 days of expiry, a **PasswordExpiryBanner** shows at the
top of every page with a *Change password* link.

### Scene 10 — About & Help (`/help`)

A full documentation site (`DocsLayout`) with a left nav tree, breadcrumbs, prev/next pager,
related-links rail, and search. The registry groups pages into **Overview** (what the tool is,
user stories, the ACCURATE project), **For Users** (planner workflow, use cases, pilot
scenarios), **SCSIM simulation** (engine & phase pipeline, parameters, distributions, the
policy catalog, network science, statistical methods, KPIs & Resilience Index, experiments),
**For IT** (architecture, data→simulation mapping, command contract, persistence, security,
current state), and **Reference** (glossary). `/about` simply redirects here. This is genuinely
deep — arguably the most complete part of the product — but it's tucked behind the last
sidebar item.

### Scene 11 — Super Admin (`/admin/*`) — only for `super_admin`

The shield nav item (visible only to super admins) opens an admin console (`AdminLayout`) with a
**Platform Overview** dashboard: KPI tiles (Organizations, Projects, Users, Active users 7d, AI
requests all-time, AI cost today/MTD, avg $/request) and two "Top by AI cost (MTD)" tables
(users, organizations). Sibling routes exist for **Users, Organizations, Projects, Models,
Usage, Audit**. Any non-super-admin who reaches `/admin*` is redirected to `/forbidden`.

### Scene 12 — Forbidden (`/forbidden`)

A minimal centered page: a shield-alert icon, **"Access restricted,"** *"You don't have
permission to view this page… contact your administrator,"* and a **"Return to home"** button.
This is where role-guard rejections land (notably, a plain `user` who clicks the landing page's
"Start Analysis").

---

## PART 2 — Gap analysis (vs. the product's own promise + first-run expectations)

The product promises a linear happy path — **"Upload data → Analyze vulnerabilities →
Simulate strategies"** (stated verbatim on the landing page). Measured against that promise and
against normal first-run expectations, here are the gaps, grouped by severity.

### A. First-run / onboarding gaps (highest leverage)

1. **The home page is a brochure, not an onboarding surface.** A logged-in first-timer with zero
   projects lands on a long marketing scroll (`GettingStarted`), not on a "create your first
   project" step or a progress checklist. The real work only starts two clicks away, and only if
   I correctly guess that "Start Analysis" is the button that matters.
2. **The primary CTA is a dead end for the `user` role.** "Start Analysis" / "Launch SuReSuite"
   / "Start now" all point to `/project-manager`, which `user` role cannot access — they're sent
   to `/forbidden`. The most prominent action on the first screen is broken for an entire role.
3. **No guided assembly of the required chain.** The real path is *create project → upload BOM +
   Inbound + Outbound (+ item master, + node list) → combine → set & save policies → create
   scenario → run.* Nothing in the UI sequences these for me; each is a separate manual action
   discovered by exploration, and downstream pages just say "No data found" without telling me
   which upstream step I missed.
4. **No product tour / coach marks / first-run empty-state guidance** beyond terse strings like
   "Create your first project to get started."

### B. Broken or placeholder UI on the landing page

5. **"View Demo"** (hero) has no handler — clicking does nothing.
6. **The intro video is broken** — the YouTube embed uses the placeholder id `"VIDEO_ID"`.
7. **The three "Core Capabilities" "Learn more" buttons don't navigate** — they're decorative
   ghost buttons.
8. **Roadmap feature routes are stubs** — `multiPlant`, `gis`, `deepTier` are defined with
   `enabled:false` and never wired to anything.

### C. Auth & account gaps

9. **Login label/behavior mismatch** — the field is labeled **"Username"** with placeholder
   "Enter your username," but it's an email input validated as an email. Confusing.
10. **No self-service registration and no "Forgot password."** Registration is an email-an-admin
    note; password reset has no flow at all (only the in-app change-password once logged in). A
    locked-out user is stuck.

### D. Navigation & information-architecture gaps

11. **"Interactive Network Space" is orphaned** — a fully built page (`/network/interactive-space`)
    with no sidebar entry; reachable only by typing the URL.
12. **Two different project-selection mechanisms** that are easy to confuse: clicking a card
    (`selectedProject`, local) vs. the small **global toggle** on the card
    (`globalSelectedProjectId`, the one that actually carries to network/policies/sim/intelligence).
    Only the global one propagates, but the card-click selection is the more obvious gesture.
13. **Project pickers are re-implemented per page** — Project Manager uses a card toggle; network,
    policies, simulation, intelligence, and the floating chat each have their own header
    `Select`. Switching context in one place doesn't always feel connected to the others.

### E. Workflow friction / hidden dependencies

14. **Combining data is a manual multi-step ritual** (upload each dataset, then click the
    workflow/combine icon, then possibly generate/refresh the node list) surfaced through toasts
    like *"Click 'Refresh Data' to finalize."* There's no single "process my data" action, and the
    combine's success is what silently unlocks the network views.
15. **The "Node List" is labeled "optional"** but network **map/location** features effectively
    depend on it (it's where longitude/latitude live). "Optional" undersells its impact on the
    geographic views.
16. **Simulation requires a *saved policy version*, discovered only at the Run step.** If policies
    are dirty, the Run button silently becomes "Save version & run." A first-timer won't know a
    version must exist before a run can be queued.
17. **Undocumented "Curated vs Uncurated data"** choice at project creation — the radio has real
    downstream meaning but zero in-UI explanation.

### F. Robustness / data-contract risk (worth flagging, not strictly UX)

18. **Many core pages carry `// @ts-nocheck — schema mismatch: … not yet migrated`** (DataManager,
    UploadWizard, ProjectIntelligence, Profile, DisruptionDialog, useAuth). They call RPCs
    (`create_project`, `list_projects`, `authenticate_approved_user`, `update_own_profile`,
    `change_own_password`, `create_disruption_scenario_v2`, …) that the generated types don't know
    about. If a given deployment is missing any of those RPCs/tables, the corresponding screen
    fails at runtime with only a toast — a fragile contract for a first-time environment.

### G. Smaller polish items

19. Delete/confirm flows use the browser's native `confirm()` dialog rather than the app's own
    dialog components — inconsistent with the rest of the UI.
20. The account/identity lives only in `localStorage`; there's no server session, so opening a new
    device/browser silently requires a fresh login with no "remember me" or session list.

### H. The Policies / Run & Validate surface (the analytical core)

21. **The whole scientific pipeline is buried as the 4th stage of the Policies page.** Verification,
    single/multiple runs, warm-up detection, validation, and model adoption — the most valuable
    part of the product — live inside `/policies` under "Run & validate," not on the page called
    **Simulation Lab** where a user would look to "run" a model. There are effectively **two run
    entry points that behave differently**: the Policies "Run & validate" trail (auto-managed
    "Policy validation (auto)" scenario, full verify/warm-up/validate/adopt) and the Lab's
    per-scenario Run (setup/recovery/run/results/compare). Nothing on either page explains the
    relationship or points between them.
22. **The rich policy schema over-promises vs. what's editable.** The schema defines seven families
    and dozens of parameters, but the GUI only exposes the `scsim`-consumed subset, and **hides
    the transport and demand families entirely**. A user reading the schema (or docs) expects to
    tune transport modes, routing, demand patterns, forecasting — none of which are editable here.
    What's shown is correct for the engine, but the gap between "documented policy catalog" and
    "editable fields" is unexplained in the UI.
23. **Warm-up and validation quietly require empirical CSVs the user rarely has.** Step 4
    (Validation) is meaningful only if I upload real-world empirical time-series per KPI; without
    them the pipeline falls back to a "face validation" acknowledgment checkbox. The UI doesn't
    set that expectation up front, so a first-timer hits an upload wall at the most important step.
24. **The server/browser compute toggle leaks infrastructure into the user's face.** Choosing
    "Run on server (Fly worker)" vs "Run in browser (Pyodide WASM, ~20 MB, slower)" — plus a
    build-SHA diagnostics row and an engine self-test — are power/debug affordances surfaced inline
    in the primary run step. Useful for operators, noise (and a source of doubt: "did it really
    run on the server?") for an analyst.
25. **"Dirty policy" gating is implicit and easy to trip.** A run needs a *saved* policy version;
    any live edit makes the model "dirty," which silently changes the run button to "Save version &
    run," can invalidate an adopted model card to "stale," and is only explained in fine print. The
    coupling between editing a policy and the credibility of a prior run isn't obvious.
26. **Six-plus context bars stacked on one screen.** The Stages tab stacks the version bar, the
    time-unit bar, the stage rail, the preset/diff banner, the no-data banner, and the credibility
    badge above the actual editor. It's information-dense to the point of intimidating on first
    contact, with no progressive disclosure.

---

## Suggested priority for closing gaps

1. **Fix the role-aware landing CTA** (don't send `user` to a forbidden page) and turn the home
   page into a real first-run surface: a "create your first project" step and a live
   *upload → combine → policies → simulate* progress checklist tied to the selected project. (A, B)
2. **Unify project selection** into one obvious global control shared across pages. (D)
3. **Collapse the upload→combine→node-list ritual** into a single guided "Prepare data" action
   with clear status, and make downstream "No data" empty states link back to the exact missing
   step. (E)
4. **Repair or remove the dead landing-page elements** (View Demo, the intro video, "Learn more"
   buttons) so the marketing surface doesn't erode trust on first impression. (B)
5. **Add password-reset + fix the "Username/Email" mismatch**, and surface the orphaned
   Interactive Network Space (or intentionally retire it). (C, D)
6. **Clarify (or unify) the two run surfaces.** Make the Simulation Lab and the Policies
   "Run & validate" trail one coherent story: either promote the verify → run → warm-up →
   validate → adopt pipeline into the Lab, or clearly cross-link them and explain that Policies
   validates the *model* while the Lab runs *scenarios* against a validated model. Move the
   server/browser + self-test controls behind an "advanced" disclosure, and make the
   dirty-policy → stale-credibility coupling explicit. (H)
