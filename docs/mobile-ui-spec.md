# SuReSuite — Adaptive UI specification

**Audience:** an AI coding agent (Claude Code) working in
`suresuite/suresuite-v001-3-f6699a5b`, branch `main`.
**Status:** implementation-ready. Every rule below is either lifted from the repo's own
contract (`docs/design/ui-consistency-audit.md`, C1–C9) or from the design system
(`SKILL.md` / readme §3). Where this file and the audit disagree, **the audit wins** —
except on the two points §0.3 lists as deliberate mobile amendments.

---

## 0. Read this before you touch a file

### 0.1 The two hard constraints

**A. This is a UI-only change set. No logic changes.**

Permitted: JSX structure, `className`, Tailwind utilities, CSS, `aria-*`/`title`,
presentational component extraction, adding a label variant to a **display constant**,
adding a purely visual local `useState` (e.g. a disclosure card's open/closed).

Forbidden: touching Supabase queries, RPC names or arguments, Zod schemas, engine
parameters, computation, validation rules, routing logic, RoleGuard/capability
resolution, state shape that anything else reads, or any number a user could act on.

If a layout fix seems to require a logic change, **stop and report it** rather than
making it. A UI-only diff must be reviewable by reading the JSX alone.

**B. Every change ships for desktop AND mobile, in the same commit.**

The product has **one** breakpoint: **768px** (`useIsMobile`, Tailwind `md:`). Do not
introduce a second. A PR that improves one layout and leaves the other unstated is
incomplete — the PR body must say what happens to both (template in §8).

### 0.2 Which dialect am I in?

Decide this first; getting it wrong produces something that looks almost right.

| | Semantic dialect | Sharp dialect | Sharp / zinc |
|---|---|---|---|
| Pages | Project Manager, Admin, Getting Started | Project Intelligence, policy grids, `/auth`, Developer API | Simulation Lab |
| Border | `border-border` | `#ebebeb` | `#e0e0e3` |
| Divider | `border-border` | `#f4f4f4` | `#ececee` |
| Radius | `rounded-lg` cards / `rounded-md` chrome | `rounded-sm` (4px) everything | `rounded-sm` |
| Active | `bg-muted/80` + 4px left bar | black pill `bg-foreground text-background` | black pill |
| Label | `text-[11px] uppercase tracking-wide text-muted-foreground` | `font-mono text-[10px] uppercase tracking-[0.2em]` | same |
| Quiet text | `text-muted-foreground` | `#9a9a9a` | `#71717a` |

Never mix two dialects inside one panel. Match whatever the neighbouring panels use.

### 0.3 The two deliberate amendments for mobile

Both are additive; neither weakens the audit on desktop.

1. **C1's `px-12 py-6` is desktop-only.** Mobile uses a fluid gutter (§2.1). Express it
   as `px-[clamp(...)] md:px-12`, so the desktop value is literally unchanged.
2. **C3's `PageHeader` right slot** (`h-8` buttons, `h-9` selects) is desktop-only.
   Mobile raises every interactive target to **44px** (§2.4). This is an accessibility
   floor, not a style preference.

Everything else in C1–C9 applies to both platforms as written.

---

## 1. Target matrix — what "responsive" is measured against

Ordered by real share (StatCounter, Sept 2025 – Aug 2026). **Test at all six.**

| Width | Device | Why it's in the matrix |
|---|---|---|
| **414** | 414×896 | Highest-share mobile width, ~7% and rising. **Default dev target.** |
| **360** | 360×800 | Top Android width, ~6%. |
| **390** | 390×844 | iPhone 12–15, ~4%. |
| **375** | 375×812 | iPhone SE3 / 13 mini. Ranked lower but live. |
| **320** | — | Stress floor, below every ranked width. Nothing may clip or scroll sideways. |
| **874×402** | landscape phone | ~250px of content height. Sheets go full-height (§2.6). |
| **768** | breakpoint | Check the switch itself: no layout may be broken *at* 768. |
| **1280+** | desktop | The primary surface. Must be pixel-unchanged unless the task says otherwise. |

402 (iPhone 16 Pro) is the design baseline but **is not in the ranking** — do not tune
to it exclusively. The historical failure mode in this project was a design tuned to
exactly 402px that broke at 320.

---

## 2. Responsive primitives — the whole vocabulary

Use these. Do not invent new scales.

### 2.1 Fluid gutter

```jsx
// Every app page's content wrapper.
<div className="px-[clamp(0.75rem,4vw,1.125rem)] py-4 md:px-12 md:py-6">
```

320 → 12px · 375 → 15px · 414 → 16.5px · 768+ → 48px (the audit's value, untouched).

`PageHeader`'s bleed must match the gutter it sits in:

```jsx
className="-mx-[clamp(0.75rem,4vw,1.125rem)] -mt-4 md:-mx-12 md:-mt-6"
```

This clamp is the **only** horizontal one in an app surface. A near-miss reads as
sloppiness rather than as a variant — mobile Project Intelligence carried
`clamp(0.6875rem,3.4vw,0.9375rem)` in five places, so its header rule, its title and
its message column all sat ~2px inboard of every other screen. `audit:ui` now reports
any `[mp][xlr]-[clamp(…)]` that is not this one (§2.1), marketing surfaces excepted.

### 2.2 Fluid type — three scales only

```css
/* src/index.css */
:root {
  --fs-page-title:  clamp(15px, 4.2vw, 17px);   /* the app H1 */
  --fs-section:     clamp(13px, 3.6vw, 14px);   /* in-content headings */
  --fs-stat:        clamp(18px, 5.4vw, 26px);   /* StatCard value */
  --fs-body:        clamp(13px, 3.6vw, 15px);   /* mobile body copy */
}
```

Rules: **never** shrink a value below the design system's floors — micro-labels stay
10–11px, dense table cells stay 12–12.5px, and mobile body copy is **15px**, not 13px
(15 is the mobile reading size; 13 is a desktop density). Marketing headlines keep their
own `clamp(2rem, 8vw, 3.75rem)`.

### 2.3 Grids that cannot overflow

Every multi-column grid uses `minmax(0, 1fr)`, never bare `1fr`. Bare `1fr` has a
`min-width:auto` floor equal to its widest child, which is what makes a "responsive"
grid scroll sideways.

```jsx
// 2-up that collapses to 1-up under 360
<div className="grid grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))] gap-px">

// fixed 2-up, safe
<div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">

// 3-up KPI strip
<div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-px">
```

### 2.4 Touch targets — 44px floor on mobile

```jsx
// icon-only control
<button aria-label="Refresh data" title="Refresh data"
  className="grid h-11 w-11 place-items-center md:h-8 md:w-8">

// a control inside a text line, where 44px would break the rhythm:
// pad the hit area, negate the layout cost
<button className="-my-[11px] flex min-h-11 items-center gap-1.5 py-[11px] md:my-0 md:min-h-0 md:py-0">
```

That negative-margin pattern is the sanctioned way to hit 44px without moving anything
visually. Every icon-only control carries **both** `aria-label` and `title`.

### 2.5 The two flex rules that prevent every horizontal-scroll bug

1. **`min-w-0` on every flex child that contains text.** Flex items default to
   `min-width:auto`, so a long unbroken string forces the parent wider than the
   viewport. This caused the one horizontal-scroll defect in this project.
2. **Never `shrink-0` on a text element.** `shrink-0` belongs on icons, badges,
   avatars, and fixed-width chrome — never on anything that can be long.

```jsx
<div className="flex items-center gap-2">
  <Icon className="h-4 w-4 shrink-0" />                       {/* ok */}
  <span className="min-w-0 flex-1 truncate">{title}</span>     {/* required */}
  <Badge className="shrink-0">{status}</Badge>                 {/* ok */}
</div>
```

### 2.6 Sheets

Side panels and dialogs become bottom sheets on mobile. Portrait caps at 76% height;
**landscape goes full-height**, because 76% of 402px leaves no usable content area.

```jsx
className="max-h-[76%] landscape:max-h-full landscape:rounded-none"
```

Bottom-pinned chrome keeps the safe-area inset:

```jsx
className="pb-[max(0.75rem,env(safe-area-inset-bottom))]"
```

### 2.7 Tables

Never reflow a Ledger table into cards silently — the column set *is* the information.
Mobile keeps the table, scrolls it horizontally, and freezes the identifying column:

```jsx
<div className="overflow-x-auto">
  <table className="w-full border-collapse whitespace-nowrap">
    <thead>
      <tr>
        <th className="sticky left-0 z-[1] bg-[#fafafa] …">{head[0]}</th>
```

Add the affordance line under any scrollable table:
`swipe the table sideways for the remaining columns`.

**Exception — the card list.** Where the product itself already switches to cards on
mobile (`AdminAudit.tsx` has a `useIsMobile` branch), follow it. In a card, every
column from the source must still appear: identifier as the title, status as a chip,
one meta line, and the numeric columns as a 2-up label/value grid. Do not drop columns.

---

## 3. Adaptive text — the rule you asked for, made mechanical

**Principle: the copy adapts, the meaning does not.** A label may get shorter; it may
not become ambiguous, and a number may never be truncated, abbreviated or rounded.

### 3.1 The ladder

Apply in order. Only descend when the rung above genuinely does not fit at 320px.

| Rung | Technique | Use for |
|---|---|---|
| 1 | `text-wrap: pretty` + wrap onto 2 lines | headings, captions, prose |
| 2 | `truncate` + `title={full}` | ids, names, filenames, chat titles |
| 3 | `line-clamp-2` + disclosure | descriptions, help text |
| 4 | Shorter label variant (§3.2) | buttons, tabs, chips, table headers |
| 5 | Icon + `aria-label` + `title` | toolbar actions only |
| 6 | Move into a disclosure card (§3.4) | secondary explanatory blocks |

**Never** truncate: a numeric value, a unit, a status word, a currency figure, an error
message, or the reason a control is disabled.

### 3.2 Declaring label variants

Put both strings in the **display constant** beside the existing label. This is a
display-vocabulary addition, not a logic change — no caller behaviour changes.

```ts
// src/lib/nav/labels.ts   (or beside the existing constant)
export const TAB_LABELS = {
  interactive: { full: 'Interactive space', short: 'Space' },
  product:     { full: 'Product-Level',     short: 'Product' },
  process:     { full: 'Process-Level',     short: 'Process' },
  firm:        { full: 'Firm-Level',        short: 'Firm' },
} as const;
```

Render both and let CSS choose — no JS branch, so it responds to the *container*, not
just the viewport:

```jsx
<span className="hidden sm:inline">{L.full}</span>
<span className="sm:hidden">{L.short}</span>
```

Where a component already measures with `useIsMobile`, use it instead of duplicating
DOM. Do not add a new `useIsMobile` call just for a label.

### 3.3 Numbers never adapt

```jsx
// right
<span className="font-mono tabular-nums">{value}</span>

// wrong — do not do any of these on mobile
{value.slice(0, 6)}            // truncated number
{Math.round(value)}            // silently different number
{value > 1000 ? '1k+' : value} // invented abbreviation
```

If a numeric row does not fit, the **table** scrolls (§2.7). The number does not change.

### 3.4 The disclosure card

Long explanatory blocks collapse behind a summary rather than being cut. Use for
"How to read this", methodology notes, provenance detail.

```jsx
const [open, setOpen] = useState(false);   // purely visual state — permitted

<div className="min-w-0 overflow-hidden rounded-sm border border-[#ebebeb] bg-white">
  <button onClick={() => setOpen(!open)}
    aria-expanded={open}
    className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left">
    <span className="min-w-0 flex-1 text-[13px] font-medium">How to read this</span>
    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200',
      open && 'rotate-90')} />
  </button>
  {open && (
    <div className="border-t border-[#f4f4f4] px-3 py-3 text-[12.5px] leading-relaxed
                    text-muted-foreground [text-wrap:pretty]">
      …
    </div>
  )}
</div>
```

Placement: **above** the data it explains, collapsed by default. The numbers stay first
on screen; the explanation is available before you read them, not after.

### 3.5 Sentence case, always

Sentence case everywhere — headings, buttons, table cells, menu items. The only
uppercase in the product is the mono kicker (`10–11px`, `uppercase`, `tracking 0.14em`
for policy-grid micro-headers, `0.04em` for Ledger `TH`, `0.2em` for landing kickers).
Never uppercase a heading or a button to make it fit.

---

## 4. Component-level specs

### 4.1 `PageHeader` (`src/components/shared/PageHeader.tsx`)

```jsx
<header className="sticky top-0 z-40 -mx-[clamp(0.75rem,4vw,1.125rem)] -mt-4 mb-4
                   border-b border-border bg-header-background/95 backdrop-blur-md
                   md:-mx-12 md:-mt-6 md:mb-5">
  <div className="flex items-center gap-2 px-[clamp(0.75rem,4vw,1.125rem)] py-2.5
                  md:gap-3 md:px-8 md:py-3.5">
    {/* back: mobile only, and only where a parent route exists */}
    {showBack && (
      <button aria-label="Back" title="Back"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border
                   border-border bg-card md:hidden">
        <ChevronLeft className="h-4 w-4" />
      </button>
    )}
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-[var(--fs-page-title)] font-semibold leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
    {/* right slot: 44px on mobile, the audit's h-8/h-9 on desktop */}
    <div className="flex shrink-0 items-center gap-1.5 [&_button]:h-11 [&_button]:w-11
                    md:gap-2 md:[&_button]:h-8 md:[&_button]:w-auto">
      {actions}
    </div>
  </div>
</header>
```

**Rules.** Max **three** controls in the right slot on mobile; the rest go to an
overflow `⋯`. Title truncates with `title={title}`. The subtitle collapses entirely
when empty — never render an empty line. Back appears only where a parent route
exists; it is not decoration. Nothing in the right slot may be a fixed width or
unbounded text: the slot is `shrink-0`, so a `w-60` search field or a bare project
name takes the row past the viewport instead of giving width back to the title.
Use `w-[clamp(130px,42vw,<desktop px>)] md:w-<desktop>`, and bound interpolated
text with `max-w-[…vw] md:max-w-none` + `truncate`.

**The chrome has one definition.** `PageHeader.tsx` exports it as three constants,
and the two screens that compose their own header row — mobile Getting Started (an
avatar link where the actions go) and mobile Project Intelligence (a two-line title
stack inside a fixed-height flex column) — import them rather than re-declaring:

```ts
PAGE_HEADER_SHELL  // sticky top-0 z-40 + header tint + backdrop blur + bottom rule
PAGE_HEADER_ROW    // the §2.1 gutter + py-2.5 md:py-3.5 + gap-2 md:gap-4
PAGE_HEADER_TITLE  // --fs-page-title, md:15px, semibold, truncate
```

A screen that needs the bar to bleed past a page gutter adds its own
`-mx-[clamp(0.75rem,4vw,1.125rem)]`; everything else comes from the constants. Do
not hand-roll a header: the three that existed drifted to three tints, two border
tokens, two gutters and two title scales.

**`sticky top-0` only pins because the shell is `overflow-x-clip`.** Per CSS
Overflow 3, `overflow-x: hidden` against a visible `y` computes `overflow-y: auto`,
which makes `PageLayout`'s content wrapper a scroll container. It is `min-h-screen`
with no fixed height, so it never scrolls — the document does — and a `sticky` child
resolves against that motionless scrollport and never sticks. Every `PageHeader` in
the product scrolled away while its class said otherwise. `clip` clips identically
(`documentElement.scrollWidth` stays at the viewport width) without establishing a
scrollport, and leaves `position: fixed` descendants such as `MobileSheet`
unclipped. If a header stops pinning, look at that class first.

### 4.2 Mobile tab bar

Five roots, fixed: **Home · Policies · Lab · AI · More**. Everything else lives under
More. `More` shows the SuReSuite logo at the top of its sheet, not a bare list.

```jsx
<nav className="flex shrink-0 items-stretch border-t border-border bg-background
                pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
  {ROOTS.map(r => (
    <button key={r.key} aria-current={active === r.key ? 'page' : undefined}
      className="flex min-h-11 flex-1 flex-col items-center gap-1 py-2">
      <r.Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      <span className="text-[10px] leading-none">{r.label}</span>
    </button>
  ))}
</nav>
```

Icons are the **same lucide icons as the sidebar** for the same destination — a user
must not have to learn two vocabularies.

### 4.3 Ledger table — both platforms

Constants stay exactly as `adminUi.tsx` declares them. Mobile changes only the
container and the first column.

```
SURFACE    rounded-sm border border-[#ebebeb] bg-white overflow-hidden
TH         text-left font-mono text-[11px] uppercase tracking-[0.04em] font-medium
           text-[#8a8a8a] bg-[#fafafa] border-b border-[#ebebeb] px-4 py-2 whitespace-nowrap
TD         px-4 py-[9px] border-b border-[#f4f4f4] align-middle
ROW_HOVER  hover:bg-[#fcfcfc]
```

Row height by page density, unchanged: Developer API `py-[11px]` · Admin `py-[9px]` ·
Sim results + PI `py-1.5` · Sim parameter cards `py-[5px]`. Divider: `#f4f4f4`
everywhere **except** the two simulation tables, which use `#ececee`.

`TH` tracking is **`0.04em`**. Setting it at kicker tracking (`0.2em`) is the single
most common way to make one of these tables look wrong.

### 4.4 Sheet shell

```jsx
<div className="fixed inset-0 z-40 flex flex-col justify-end bg-foreground/30">
  <button aria-label="Close" onClick={close} className="flex-1" />
  <div className="flex max-h-[76%] shrink-0 flex-col rounded-t-xl border-t border-border
                  bg-background landscape:max-h-full landscape:rounded-none">
    <div className="relative flex shrink-0 items-start gap-2.5 border-b border-border
                    px-3.5 py-4 [touch-action:none]">
      <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2
                       rounded-full bg-border" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {sub && <p className="mt-1 text-[12px] leading-snug text-muted-foreground
                              [text-wrap:pretty]">{sub}</p>}
      </div>
      <button aria-label="Close" title="Close"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border">
        <X className="h-4 w-4" />
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">{children}</div>
  </div>
</div>
```

The header is the drag handle (drag down past 90px dismisses). Closing must also clear
any sheet the parent screen owns, so navigating away can't leave a scrim behind.

### 4.5 `StatCard` / KPI tile

```jsx
<div className="min-w-0 bg-card p-3">
  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
    {label}
  </div>
  <div className="mt-1 text-[var(--fs-stat)] font-semibold leading-none
                  tabular-nums tracking-[-0.02em]">
    {value}
  </div>
  {hint && <div className="mt-1 text-[10.5px] text-muted-foreground">{hint}</div>}
</div>
```

The grid is 1px-gapped cells on a border-coloured background (§3.7 of the readme —
"when you need a visual, show the data"). Labels do **not** truncate; they wrap.

---

## 5. Per-screen work list

For each: what changes on mobile, and what changes on desktop. "unchanged" is a valid
and common answer for desktop — but it must be stated.

| # | Screen | Mobile | Desktop |
|---|---|---|---|
| 1 | `/profile` | **Build it.** Not in the nav today. `My Profile` is a *locked, always-on* capability in the role matrix — a user who can reach nothing else reaches this, so its absence is a hole in the access-control story. Sections: identity, role (read-only, with the resolution path), budget/usage, sign out. | Add the nav entry; standard `px-12 py-6` page. |
| 2 | `/developer` | Currently a stub with invented keys. Rebuild from `DeveloperApi.tsx` — this is the "locked reference" the Ledger constants were lifted from, so getting it right stabilises the whole table vocabulary. Keys table (scroll + sticky first col), scopes as mono chips, quickstart in `ApiCodeBlock`, `TEMPLATE_BTN` in `#F8D448` for the starter download. | Verify against the reference; correct any drift. |
| 3 | `/forbidden` | One screen: what was blocked, which capability governs it, who to ask. Closes the `RoleGuard` loop. | Same content, page layout. |
| 4 | `/admin` dashboard | Restore the real dashboard alongside the triage hub. It carries the **fourth sanctioned `#F8D448` use** — a 2px × 36px rounded emphasis rule under the one stat that matters. | Unchanged. |
| 5 | `/network/interactive-space` | **No 3D on mobile** (confirmed). Findings-only: nexus nodes, centrality ranking, and the spatial view named as a desktop surface — not a dead route. | Unchanged. |
| 6 | OrbitMRP / ERP | In scope. Connect → authorise → return → sync status. Full-height sheet for the authorise hand-off; status card with last-sync, record counts, and the reason on failure. | Same flow in a dialog. |
| 7 | All lens pages | Disclosure card (§3.4) above the data for "How to read this". Centrality table scrolls with frozen node column. | Unchanged. |
| 8 | Policies | Row multi-select + bulk edit as a sheet; sparse patch — "leave a field blank to leave it unchanged". | Bulk edit already exists as a dialog; align copy. |

---

## 6. Anti-patterns — reject in review

| Don't | Because |
|---|---|
| A second breakpoint (`sm:` for layout, `lg:`, `xl:`) | The product has one: 768. `sm:` is permitted **only** for the §3.2 label swap; `lg:` **only** for a multi-pane shell that measurably cannot hold its panes at 768 (§6.1). |
| Bare `1fr` in a grid | `min-width:auto` floor → sideways scroll. |
| `shrink-0` on text | Forces the parent past the viewport. |
| Missing `min-w-0` on a flex text child | Same. |
| `useIsMobile` for a purely visual difference | Use `md:`. Reserve the hook for structural branches (different component tree). |
| Hiding a disabled control | The product **shows it, disables it, and explains why**. |
| A number shortened, rounded or abbreviated to fit | Numbers are load-bearing. Scroll the table instead. |
| `rounded-xl`+ on an app surface | Radii stop at 8px. `rounded-2xl` exists only in legacy Getting Started. |
| A gradient, or a shadow used for hierarchy | Hierarchy is value + 1px borders. |
| `bg-black` / `text-white` in an app page | Confined to landing bands, `/auth` strip, and the fixed footer. |
| Emoji | Never. Functional Unicode marks (`▲▼ › ≈ ⚠ → ·`) are fine. |
| A filled `default` badge | `secondary` neutral/active · `outline` meta · `destructive` bad. |
| `#F8D448` outside its four uses | Template button · Quick Start markers · the admin emphasis rule · `LAYER.accent`. |
| Copy that changes meaning between platforms | Same product, same words. |

---

### 6.1 The one sanctioned `lg:` — multi-pane shells

**Amendment, added after measuring the code this spec governs.** The
one-breakpoint rule above was written for the mobile/desktop split and it holds
everywhere a pane is a *column of content*. It does not survive a **multi-pane
shell** — a layout where two or three panes must each hold a usable minimum at
once — because 768px minus the collapsed sidebar (56) minus the app gutter (96)
leaves **616px of content**, and a 3:1 or sidebar-plus-panel split of 616 gives
one pane a width nothing can be read in.

Measured in Chromium against the real grid templates:

| Shell | at 768 (616px of content) | today at 1024 (872px) |
|---|---|---|
| Network lens (`grid-cols-4`, 3 + 1) | graph 444, **sidebar 148** | graph 636, sidebar 212 |
| Docs shell (`16rem / 1fr / 15rem`) | nav 256, **prose 272**, toc 240 | nav 256, prose 528, toc 240 |
| `AdminUserAccess` (matrix + preview) | **matrix 276**, preview 320 | matrix 532, preview 320 |
| `RunValidateStage` (setup + content) | setup 320, **content 286** | setup 320, content 542 |

A 148px lens sidebar, 272px of prose between two chrome panes, or a five-column
capability matrix in 276px are all worse than what `lg:` does today, which is to
**stack until 1024**. So:

> `lg:` is permitted for a multi-pane shell, and only there. The layout
> breakpoint for everything else stays 768. A new `lg:` must come with the
> measurement that justifies it — the pane width it produces at 616px — in the
> PR body.

The shells this sanctions today are `DocsLayout`, the three network lens pages,
`AdminUserAccess` and `RunValidateStage`; `scripts/audit-adaptive-ui.mjs` holds
the same list, so adding one is a deliberate edit in both places.

This is **not** a general licence. `GettingStarted`'s nine `lg:` uses are legacy
page-padding steps awaiting that page's own redesign, and `DeveloperApi`'s two
are ordinary two-up card grids that would sit at ~300px per pane at 768 — those
stay recorded as debt, not blessed.

---

## 7. Verification — run before every PR

**Widths.** 320 / 360 / 375 / 390 / 414 / 768 / 1280. At each:

- [ ] `document.documentElement.scrollWidth <= innerWidth` — no horizontal scroll
      anywhere except an intentionally scrollable table container.
- [ ] No clipped or overlapping text; nothing truncated that §3.1 forbids.
- [ ] Every interactive element ≥ 44×44 on mobile.
- [ ] Desktop at 1280 is pixel-identical to `main` unless the task changed it.

**Landscape (874×402).** Sheets full-height; bottom chrome not covering content.

**Numbers.** Every figure identical across all widths. Diff the rendered numeric text
at 320 and 1280 — it must match exactly.

**Contrast.** Body text ≥ 4.5:1; headline-scale ≥ 3:1. Full-opacity ink on tinted
grounds, never alpha-muted type.

**Copy.** Sentence case; no emoji; disabled controls explain themselves.

Quick probe:

```js
[320,360,375,390,414,768,1280].forEach(w => {
  // set viewport to w, then:
  const overflow = document.documentElement.scrollWidth > w;
  const small = [...document.querySelectorAll('button,a,[role=button],input,select')]
    .filter(el => { const r = el.getBoundingClientRect();
      return r.width && (r.width < 44 || r.height < 44); })
    .map(el => el.getAttribute('aria-label') || el.textContent.trim().slice(0,24));
  console.log(w, { overflow, small });
});
```

At `w >= 768` the 44px check does not apply — the audit's `h-8`/`h-9` is correct there.

---

## 8. PR template — required

```md
## What changed
<one or two sentences>

## Desktop  (≥768px)
<what changed, or "unchanged — mobile-only layout work">

## Mobile  (<768px)
<what changed>

## UI-only confirmation
- [ ] No query, RPC, schema, engine-parameter, validation or routing change
- [ ] No user-visible number changed
- [ ] Only visual state added (if any): <name it>

## Adaptive text
- [ ] Longest string checked at 320px
- [ ] Label variants (if added) declared in the display constant, not inline
- [ ] No number truncated, rounded or abbreviated

## Verified at
320 · 360 · 375 · 390 · 414 · 768 · 1280 · landscape 874×402
```

---

## 9. Structural recommendation (separate PR, no visual change)

The durable fix for platform drift is structural, not procedural: rules in a document
get forgotten. Extract the shared model —

```
src/lib/model/          // data + computation, zero JSX
  network.ts            // netFor, netAnalyse, centrality
  simulation.ts         // simModel, convergence
  index.ts
```

— then have each screen render both layouts from that one source. A change then becomes
*physically unable* to land on one platform and miss the other, because the reviewer
sees both in the same diff. Do this as its own PR with **no visual change**, verified by
diffing rendered output before and after.

---

## 10. Provenance

Every rule traces to source. When something here is unclear, read the file rather than
guessing:

- `docs/design/ui-consistency-audit.md` §1 — the C1–C9 contract
- `src/index.css`, `tailwind.config.ts` — token source of truth
- `src/components/shared/*` — PageHeader, SectionCard, StatCard, TableShell/Empty/Loading
- `src/components/admin/adminUi.tsx` — the Ledger constants
- `src/components/intelligence/piUi.tsx` — sharp dialect
- `src/components/policies/policyGridUi.tsx` — policy-grid micro-headers (`0.14em`)
- `src/pages/DeveloperApi.tsx` — the locked table reference
- `src/hooks/use-mobile.tsx` — `useIsMobile`, the single 768px breakpoint
- `github.md` (project root) — sync point and screen map


---

## 11. Implementation sequence

Six PRs. Each is independently shippable and independently revertable. Do not merge
two of them together — the first one is what makes the rest reviewable.

### PR 1 — Foundations (no visual change on desktop)

The enabling change. Touches many files, moves nothing at ≥768px.

1. Add the four fluid type tokens to `src/index.css` (§2.2).
2. `PageLayout`: content wrapper gets the fluid gutter `px-[clamp(...)] md:px-12` (§2.1).
3. `PageHeader`: matching bleed, 44px right-slot targets under `md:`, back button (§4.1).
4. Codemod every multi-column grid to `minmax(0,1fr)` (§2.3) and add `min-w-0` to flex
   text children (§2.5).

**Exit criterion: a 1280px screenshot diff against `main` is empty.** If it isn't, the
gutter or the bleed is wrong. Do not proceed until it is.

### PR 2 — Mobile shell

Bottom tab bar, More sheet with the logo, drawer, sheet shell (§4.2, §4.4). All
`md:hidden`; the sidebar is untouched. No page content changes.

### PR 3 — The three missing routes

`/profile`, `/developer` (rebuild from the reference, not the stub), `/forbidden`.
Ordered deliberately: `/profile` first because `My Profile` is a locked always-on
capability, so its absence is a hole in access control; `/developer` second because it
is the locked table reference the Ledger constants were lifted from, so getting it right
stabilises the vocabulary every other table borrows.

### PR 4 — Tables and sheets across existing pages

Horizontal scroll + frozen identifying column (§2.7), side panels → sheets (§2.6),
policy bulk edit (§5 row 8). This is the bulk of the mobile work.

### PR 5 — Adaptive text pass

Apply §3 screen by screen. Declare label variants in display constants. This is last
on purpose: do it before PR 4 and you will shorten labels that PR 4's layout would
have fitted anyway.

### PR 6 — Shared model extraction (no visual change)

§9. Its own PR, verified by diffing rendered output before and after.

---

## 12. Demo-only devices — do NOT ship these

The prototype this spec was derived from had to make some behaviour visible without a
backend. Those devices are **not product behaviour** and must not be implemented:

| Demo device | What the real system does |
|---|---|
| Token expiry triggered by "the sync after one has been applied" | The server reports expiry; the client renders `link.status` + `status_detail` as given |
| Fixed sync counts (14 new · 31 changed · 2 removed) | Read from the sync run row |
| Nexus counts scaled at ~9.2% of node population | `MLPrediction`'s edge function returns real counts |
| `setTimeout`-driven run progress and sync duration | Real subscriptions / polling |
| Seeded pseudo-random KPI draws | Engine output |
| Company list `ERP_COMPANIES` | `list_companies` action |

**What IS product behaviour, and must survive the port** — these are contracts, and the
prototype surfaces them deliberately:

- **ERP sync is a two-stage gate.** Sync stages a mapping report; nothing reaches item
  masters until Apply. An auto-applying sync is a different product.
- **Starting an authorisation writes nothing.** The link row is created only by a
  successful callback; `revokeLink` is the only deletion path. Backing out of a connect
  must leave an existing link and its history intact.
- **Capability resolution is user override ?? org override ?? role default**, with super
  admin always on and `My Profile` locked.
- **A run binds n\* from its own model card** — never a constant.
- **Unavailable controls are shown, disabled, and explained.**
- **A tab with no rows does not render** (project data viewer), rather than rendering empty.
