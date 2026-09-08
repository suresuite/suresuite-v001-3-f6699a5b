# Audit — the page book, checked against the live demo

Regenerated 2026-09-08. Re-run after any edit to `PAGES.md`.

## Check 1 — every quoted claim is real product copy

- literal claims checked: 44
- on the screen the entry is about: 27
- in the demo but on another screen: 16
- **not in the demo at all: 1**
- composed labels / design-system quotations: 10

### Failures

- Appendix · The yellow, counted against the design system — "outside those four, don't reach for the yellow."

### Found on another screen

Shared chrome, cross-screen copy, and strings that live in the logic class rather
than the sliced template block. Worth a glance; none automatically wrong.

- 03 · About — "Prof. Dr. Dr. habil. Dmitry Ivanov"
- 05 · Project Manager — "Download template"
- 05 · Project Manager — "2 files missing · edges unmapped"
- 05 · Project Manager — "312 items · 4 unmapped"
- 07 · Connect a data source (OrbitMRP / ERP) — "Connect orbit-mrp"
- 07 · Connect a data source (OrbitMRP / ERP) — "Connect another source"
- 11 · Policies — "MTO: no finished-goods stock — produced on order"
- 11 · Policies — "swipe the table sideways for the remaining columns"
- 13 · Validation findings and version history — "Validation findings"
- 13 · Validation findings and version history — "Warnings acknowledged"
- 13 · Validation findings and version history — "(or"
- 16 · Project Intelligence — "AI-drafted — verify"
- 21 · Developer API — "stops working on the next request"
- 23 · My Profile — "valid for 90 days"
- Appendix · The yellow, counted against the design system — "Download template"
- Appendix · The yellow, counted against the design system — "Download template (.ipynb)"

### Composed labels and quotations

- "because it is what ships" — design system §3.10 quotation
- "Project <name>" — composed from the active project
- "Showing 10 of 12" — viewerMoreLine
- "Showing 10 of 12 — raise the row limit to see more." — viewerMoreLine
- "3 rows selected" — selectionLabel
- "1 row selected" — selectionLabel (singular)
- "Empty fields are skipped so the override stays sparse" — repo string, BulkEditDialog.tsx
- "Acknowledge 2 warnings" — ackAllLabel
- "Tronico EMS · Gemini 2.5 Flash · Ask" — setupLabel
- "never a status, never a large fill" — design system §3.9 quotation

## Check 2 — no on-screen copy left undescribed

- entries with a copy deck: 24
- strings across them: 353

## Check 3 — enforcement scope (gate G)

- `verify`: 13 surface(s)
- `pending`: 10 surface(s)
- `none`: 2 surface(s)

Only `verify` and `built` surfaces have their decks checked against the repo.
Two surfaces (10 Nexus, 20 User access) were demoted from `verify` to `pending`
because their decks were empty or too thin — enforcing them would have reported
a pass while proving nothing.

## Unfinished content in the demo

- The contributor rows render the literal string "Name to add" (entry 03).
