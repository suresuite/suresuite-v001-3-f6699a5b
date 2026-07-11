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

### Scene 6 — Policies (`/policies`)

Header **"Supply chain policies."** Its subtitle is a live **context strip** — Plant · Model ·
BOM · #suppliers · #plants · #customers — read from the selected project. The header's right
side has *yet another* project `Select` dropdown (bound to the global project). If no project
is selected: an alert *"Select a project to configure policies."*

With a project chosen, the body is a three-tab control:

- **Stages** (default). Shows a **PolicyVersionBar** (pick/save/restore versioned policy
  snapshots, with a dirty indicator), a **TimeUnitBar** (the simulation calendar), a
  **StageRail** to move between the pipeline stages, and a **FocusedStage** editor. The stages
  are: **Supplier** (per supplier × material: sourcing strategy & safety stock), **Focal plant**
  (per product: capacity, production cost, lead time; inventory if MTS), **Customer** (per
  customer × product: sourcing firm, price, backorder handling), and **Run & validate** (verify,
  auto-detect warm-up, set replications, then launch). Here I set defaults and per-entity
  overrides.
- **Guide me** — a `GuidePanel` that can jump me to a specific stage.
- **Data map** — a `DataMapGrid` showing how uploaded data maps into policy inputs.

Policies are **versioned**, and — importantly for the next scene — a **saved version is
required to run a simulation.**

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
