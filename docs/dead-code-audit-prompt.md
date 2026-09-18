# Prompt — dead-code & dead-document audit

Paste this to re-run the audit in `docs/dead-code-audit.md`. It is written to
produce a *decision register*, not a deletion list. Replace `<DATE>`.

---

You are acting as a senior product manager who owns codebase health for this
repository. Run a dead-code and dead-document audit. The deliverable is a
decision register that a team can act on, not a list of files to delete.

**First read `CLAUDE.md`, `docs/PLAN.md` §2.1 and §16, and
`docs/design/next-gen-platform-design.md` §13.** This repo's governing rule is
that anything unenforced drifts within two months. Your output is held to that
standard: an audit that does not end in a gate is not finished.

## Step 1 — Measure, don't grep

Do not guess from filenames or from a text search for a symbol. Build real
reachability:

- **Frontend**: construct an import graph over every module under `src/`, rooted
  at `src/main.tsx`, resolving the `@/` alias, relative specifiers, extensionless
  imports and `index` files. Build a **second** graph rooted at every test file.
  A module in neither is unreachable.
  - **You must resolve `new Worker(new URL("./x.ts", import.meta.url))`** and
    treat `*.d.ts` ambient declarations as roots. Skipping either produces
    confident false positives.
- **Edge functions**: count real invocation sites for each function in
  `supabase/functions/`, excluding the function's own directory.
- **Documents**: count inbound references to each markdown file from the whole
  repo, excluding self-references.
- **Assets and dependencies**: reference-count everything under `public/`, and
  match every `package.json` entry against first-party source only.

Report what you measured (totals, roots, method) so the numbers can be checked.

## Step 2 — Classify, and defend each classification

Reachability is evidence, never a verdict. Sort every candidate into:

- **A · Dead** — unreachable and no product intent behind it.
- **B · Dormant** — it works, it was never wired to a route or flag, and deleting
  it destroys product optionality. Look hard for these: a cluster of files that
  import each other but that nothing imports is a *feature*, not debt. Check
  whether a backing database table, migration or roadmap item still exists.
- **C · Scaffolding** — vendored/generated UI primitives never adopted. State
  plainly that these are nearly free to keep, so the reader can decide rather
  than delete on reflex.
- **D · Superseded document** — stale but still reads as authoritative.

For every candidate give: path, size, the evidence that put it there, the class,
and the verdict. **Where the evidence is ambiguous, say so and name the person or
role who should decide.** Never silently promote class B into class A.

## Step 3 — Flag what the scan finds that is not dead code

A reachability scan surfaces live defects, and they outrank the tidying. Look
specifically for:

- A renderer, provider or listener that is unmounted while its producers are
  still called — the producers then run into nothing.
- Deployed backend surface with no consumer (availability and security exposure,
  not tidiness).
- Code reachable **only from tests** — that is untested production logic, not
  dead code.
- A document whose completed work still reads as open scope.
- Duplicate implementations where one is live and one is orphaned.

Report these **first**, as bug tickets, and explicitly block archiving anything
they touch.

## Step 4 — Distinguish deliberate artefacts from debt

Some unreferenced things are load-bearing. Before flagging, check for: tombstone
stubs that exist to catch stale citations; reference implementations cited as
the canonical pattern elsewhere; assets under contractual or funding obligation;
and files loaded at runtime through a generated manifest or a constructed path.
Getting this wrong once costs more trust than the whole audit earns.

## Step 5 — Propose the programme

- **Phase 1 (now)**: tag the repo, then move class A/C/D-confirmed to `_attic/`
  preserving paths, with a `MANIFEST.md` recording per entry: original path,
  class, evidence, date archived, delete-after date, and who can veto.
- **Phase 2 (parallel)**: every class-B item, ambiguous doc and uncalled backend
  surface gets a named owner and a yes/no. **No archiving on this track without
  an answer** — a silent archive is a product decision made by nobody.
- **Phase 3 (T+14d, <DATE>)**: delete what is untouched and unvetoed. Recovery
  comes from the tag, which is what makes two weeks sufficient rather than
  arbitrary.
- **Phase 4 (ships WITH phase 1)**: the gate.

## Step 6 — The gate is the deliverable

Specify a `check:dead` script wired into `npm run lint` that fails on any
unreachable `src/**` module absent from an allow-list, where each allow-list
entry carries a `why:` and an **owning work package** — the same shape as
`scripts/data-contract/coverage.yaml`, so an exemption is a dated promise rather
than a silence. Pre-populate it with class B so the gate is green on day one
without pre-empting the phase-2 decisions. Report test-only-reachable modules as
a separate warning class.

## Output

Write the register to `docs/dead-code-audit.md`. Lead with the live defects, then
the class table, then the per-class findings, then the programme, then the gate.

Define success as: **zero unreachable modules outside a declared allow-list, and
zero unresolved class-B rows.** Do not define success as lines removed — that
metric rewards deleting exactly the working capability you should be shipping.
