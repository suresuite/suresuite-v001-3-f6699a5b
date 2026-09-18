# Dead-code & dead-document audit — archive register

**Status: AUTHORED.** Snapshot taken 2026-09-18 against `main` (335 commits).
This file is the register for the archive-then-delete programme. It is a
*decision document*, not a deletion list: every row carries the evidence that
put it here and the verdict that takes it out.

The programme has one rule, which is the same rule the rest of this repo runs on:
**an audit without a gate regenerates its own findings.** WP D.3 below is the
only part that makes this last.

---

## 0 · How a candidate got here

Three independent sweeps, all reproducible (see §6 for the prompt that re-runs them):

1. **Frontend reachability.** An import graph built from `src/main.tsx` across all
   388 `src/**` modules, resolving `@/` and relative specifiers, plus a second
   graph rooted at the 29 test files. Anything in neither graph is unreachable.
2. **Backend/asset reachability.** Caller counts for each of the 19 edge
   functions; reference counts for every file under `public/`; dependency
   names matched against all first-party source.
3. **Document reachability.** Inbound reference count per markdown file across
   the whole repo, plus last-touched date.

Reachability is *evidence*, not a verdict. §1 separates the four kinds of
"unreachable", because they carry completely different risk.

---

## 1 · The four classes (read this before deleting anything)

| Class | What it means | Default action | Risk of deleting |
|---|---|---|---|
| **A · Dead** | Unreachable AND no product intent behind it | Archive now, delete T+14d | Low |
| **B · Dormant** | Works, but never wired to a route/flag. Deleting destroys *product optionality* | **Product decision required — do not auto-delete** | High |
| **C · Scaffolding** | Vendored `shadcn/ui` primitives never adopted | Leave, or bulk-archive as one lot | Very low, but so is the benefit |
| **D · Superseded doc** | Stale but still reads as authoritative | Archive under `docs/archive/`, leave a tombstone | Medium — stale docs are worse than none |

The single most expensive mistake available here is treating class B as class A.

---

## 2 · Findings

### 2.0 · NOT dead — a live defect this scan surfaced (fix, don't archive)

`src/components/ui/toaster.tsx` is unreachable, and that is the bug rather than
the finding. The app mounts **sonner**'s `<Toaster />` in `src/App.tsx`; the
Radix toast renderer is never mounted. But **8 files still raise toasts through
`@/hooks/use-toast`** — among them `UploadWizard`, `ProjectDataViewer` and
`DeveloperApi`. Those toasts are pushed into a store that nothing renders.

**Every one of those notifications is invisible to the user**, including upload
errors. 31 other files use `sonner` directly and work correctly.

> **Action: this is a bug ticket, not an archive row.** Either mount the Radix
> `<Toaster />`, or migrate the 8 callers to `sonner` and *then* archive the
> Radix toast stack as class A. Until that decision is made, nothing in the
> toast stack may be archived.

### 2.1 · Class A — dead (archive now)

| Path | LOC | Evidence |
|---|---|---|
| `src/App.css` | 42 | No importer anywhere, including `index.html` |
| `src/components/RequireFeature.tsx` | 24 | Zero references repo-wide |
| `src/components/chat/FileCard.tsx` | 144 | Zero references repo-wide |
| `src/components/shared/StatCard.tsx` | 44 | No importer; the name is generic, so its 13 textual hits are unrelated |
| `src/lib/policies/presets.ts` | 108 | No importer, app or test |
| `src/lib/sim/seeds.ts` | 19 | Superseded by the Python `seeds` module in the engine |
| `src/lib/sim/warmup.ts` | 39 | Superseded by the Python `warmup` module in the engine |
| `src/components/ui/use-toast.ts` | 3 | Re-export shim; every live caller imports `@/hooks/use-toast` directly |

**~423 LOC, 8 files.** All eight entered in the same import commit and have
never been modified since.

`src/lib/policies/resolutionChains.ts` is reachable **only from tests**. It is
not dead — it is untested production logic that has become test-only. Route it
to a product decision, not to the attic.

### 2.2 · Class B — dormant features (STOP: product call, not a code call)

These are complete, working features that were never wired to a route. Archiving
them is cheap; deleting them throws away build-ready capability.

**B1 · The experimentation cluster — 688 LOC + a live database table.**

`src/components/sim/ExperimentDesigner.tsx` (361), `ExperimentResultsPanel.tsx`
(176), `src/hooks/useExperiments.tsx` (94), `src/lib/sim/doe.ts` (48, full
factorial + Latin hypercube) and `src/lib/sim/playbookFactor.ts` (57) form one
internally-consistent unit that nothing imports. The hook reads a **real
`experiments` table**, created in a migration and deferred in `coverage.yaml`
under a named work package.

> This is Design-of-Experiments capability sitting one `<Route>` away from
> shipping, and the blueprint's experimentation workstream is still open.
> **Recommendation: do not archive. Raise as a scoping question** — is this the
> WP's starting point or is it being rebuilt? If rebuilt, archiving it is right;
> nobody should discover that answer from a `git log` in six months.

**B2 · Visualisation — 1 111 LOC.** `src/components/MapView.tsx` (740, a full
Mapbox surface) and `src/components/NetworkVisualization3D.tsx` (371, three.js).
The live network pages use `mapbox-gl` through their own code paths, so these two
are parallel implementations. `three`, `@react-three/fiber` and `@react-three/drei`
are carried in `package.json` largely for the 3D one.

> **Recommendation: archive, and drop the three `three`-family dependencies with
> it.** This is the largest bundle-weight win in the register. Confirm no 3D
> surface is on the near roadmap first.

**B3 · `src/components/intelligence/MobileIntelligence.tsx` — 746 LOC.** The
single largest unreachable file. A mobile variant of the intelligence room, never
routed, while `docs/mobile-ux-demo-parity-plan.md` describes an active mobile
parity effort.

> **Recommendation: do not archive until the mobile parity owner confirms it is
> superseded.** This is exactly the file a parity plan would want.

**B4 · `src/components/policies/PolicyOverridesTable.tsx` (150) +
`BulkEditDialog.tsx` (79).** A coherent pair — the table imports the dialog —
for editing policy overrides in bulk. Nothing imports the table. Bulk override
editing is a recurring `/policies` ask.

> **Recommendation: product call.** Cheap to revive, 229 LOC to lose.

**Class B total: ~2 774 LOC of working, unrouted product capability.**

### 2.3 · Class C — unadopted `shadcn/ui` primitives

17 vendored primitives are never imported: `accordion`, `aspect-ratio`,
`breadcrumb`, `calendar`, `carousel`, `chart`, `collapsible`, `command`,
`context-menu`, `drawer`, `hover-card`, `input-otp`, `menubar`,
`navigation-menu`, `pagination`, `resizable`, `toaster`. **~2 000 LOC.**

Honest assessment: **these cost almost nothing.** They are tree-shaken out of the
bundle, they are generated rather than authored, and re-adding one is a single
CLI command. The only real cost is that they inflate "how big is this codebase"
by ~2 000 lines and give reviewers 17 files that look maintained.

> **Recommendation: archive as ONE lot, lowest priority, or consciously decide to
> keep them and exempt `src/components/ui/**` from the gate in §5.** Either is
> defensible; drifting between the two is not. Note `toaster.tsx` is blocked on §2.0.

### 2.4 · Dependencies

`@dagrejs/dagre`, `@hello-pangea/dnd`, `geist` and `@types/mapbox-gl` appear in
no first-party source. `@types/mapbox-gl` belongs in `devDependencies` if kept at
all. Removing B2 additionally frees `three`, `@react-three/fiber`,
`@react-three/drei`.

> Verify each against a production build before removal — a plugin can pull a
> package without a literal import.

### 2.5 · Edge functions

19 deployed; all but three have live callers.

| Function | Finding |
|---|---|
| `ingest-outbound-logistics` | No caller in `src/`. Referenced only by parity tests, config and the plan |
| `ingest-bom-multi-level` | Same. It is also cited across the codebase as *the reference implementation* of the trim/empty validation pattern |
| `project-ai-health` | No caller in `src/`. The plan already records it as invoked by nothing |

> **Recommendation: do not archive any of the three, but do not leave them
> ambiguous either.** All three are deployed surface area with no consumer, which
> is an availability and security question, not a tidiness one. They are also
> load-bearing *as documentation* (the BOM validation pattern). Convert to an
> explicit decision: keep-and-document, or undeploy-and-archive.

### 2.6 · Documents

Repo history begins 2026-09-06, so "last touched" separates almost nothing.
Inbound reference count is the usable signal.

**Zero inbound references:**

| Doc | Lines | Assessment |
|---|---|---|
| `docs/handoff-fable5.md` | 372 | A handover note to a specific session. Its job is done. **Class D — archive.** |
| `docs/research/literature-review-prompt.md` | 241 | A prompt template, not a document. Belongs beside the other prompts or in the attic |
| `docs/ux/policies-redesign-brief.md` | 168 | A brief. **Check whether `/policies` shipped against it before archiving** — if it did, it is a delivered brief; if not, it is live scope |

**One inbound reference (usually only the plan) — review, do not sweep:**
`docs/design/ui-consistency-audit.md` (468), `docs/design/ai-agents-implementation-prompts.md` (962),
`docs/research/measurement-protocol.md` (106), `docs/ux/first-time-user-walkthrough-and-gaps.md` (934).

> Point audits like the first and last of these are *meant* to be consumed and
> retired. A completed audit that still reads as an open one is the class D
> hazard. For each: confirm closed → archive; still open → it is a backlog item
> hiding in `docs/`, which is worse than dead.

**Already handled correctly, leave alone:** `docs/data-simulation-mapping.md` and
`docs/simulation-data-lifecycle.md` are deliberate tombstones (17 and 16 lines)
with 27 and 9 inbound references. **Do not archive them** — they exist to catch
stale citations, and the repo guidance says to follow the stub. `docs/archive/legacy-help-site/`
is the precedent this programme should copy.

Also present: `docs/policy-version-fix.sql` — a one-off fix script living in
`docs/`. It is either applied (archive it) or unapplied (it is a defect, not a doc).

### 2.7 · Assets

`public/funding/` carries five sponsor logos with no reference from `src/` or
`index.html`, including the same logo in three formats (`.png`, `.jpg`, `.webp`).
**320 KB.** Sponsor-attribution assets are frequently a contractual obligation —
**confirm with whoever owns the funding relationship before touching them.**

`public/engine/*.whl` and `public/template/*.csv` scanned as unreferenced but are
**live**: the wheels load through a generated manifest at runtime, and the two
templates are almost certainly reached by a constructed path. Do not archive.

---

## 3 · Summary

| Class | Files | LOC | Verdict |
|---|---|---|---|
| A · Dead | 8 | ~423 | Archive now |
| B · Dormant | 9 | ~2 774 | **Product decision first** |
| C · Scaffolding | 17 | ~2 000 | One lot, lowest priority |
| D · Docs | 3–7 | ~780–2 500 | Archive with tombstones |
| Deps | 4–7 | — | Verify against a build |
| Edge functions | 3 | — | Decide keep vs undeploy |

Unreachable frontend code is **~5 200 LOC of 388 files (~13%)**. Only ~8% of that
is unambiguously dead. **The headline number is not the story — the story is that
more than half of it is finished product capability that was never routed.**

---

## 4 · The programme

**Phase 1 — Archive (this week).** Class A + class C + class D-confirmed move to
`_attic/` preserving their paths, with `_attic/MANIFEST.md` recording for each
entry: original path, class, evidence, date archived, delete-after date, and the
name of the person who can veto. Tag `pre-attic-2026-09-18` before the first move.

**Phase 2 — Decide (this week, parallel).** Class B, the three edge functions,
the one-inbound-reference docs, and `resolutionChains.ts` each get a named owner
and a yes/no. **No archiving on this track without an answer** — a silent archive
is a product decision made by nobody.

**Phase 3 — Delete (T+14d, 2026-10-02).** Anything in `_attic/` untouched and
unvetoed is removed. Recovery stays available from the tag forever, which is what
makes the two-week window sufficient rather than arbitrary.

**Phase 4 — Gate (with phase 1, not after).** §5.

Success is not LOC removed. Success is: **zero unreachable modules outside a
declared allow-list, and zero rows in class B — every one resolved to shipped,
scheduled, or deleted.**

---

## 5 · The gate — WP D.3 (`no-dead-module`)

Without this, the register regenerates in a quarter. The rest of this repo
already knows that; this programme should be held to the same standard.

Add `scripts/check-dead-modules.mjs`, wired into `npm run lint`:

1. Build the import graph from `src/main.tsx`, **resolving `new Worker(new URL(...))`**
   — omitting that produces a false positive on `src/lib/sim/engine.worker.ts`,
   which is live and was one of this scan's own near-misses.
2. Treat ambient declarations (`src/vite-env.d.ts`) as roots.
3. Fail on any `src/**` module in neither the app graph nor the test graph,
   unless listed in `scripts/dead-module-allow.yaml` with a `why:` and an
   **owning work package** — the same shape as `coverage.yaml`'s deferrals, so
   an exemption is a dated promise rather than a silence.
4. Report modules reachable *only* from tests as a separate warning class.

Ship the allow-list pre-populated with class B so the gate goes green on day one
without pre-empting the phase-2 decisions. Extend later to unreferenced
`public/` assets and uncalled edge functions.

---

## 6 · The re-run prompt

See `docs/PLAN-PROMPTS.md` conventions. The prompt that reproduces this audit is
kept beside this file: **`docs/dead-code-audit-prompt.md`**. It is repeatable by
someone who was not here, and it is written to produce the decision register
above rather than a deletion list.
