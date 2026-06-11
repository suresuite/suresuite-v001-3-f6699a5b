# Simulation Lab — UI refresh

Three contained changes. No backend, no data-model edits, no behaviour changes outside the left column and the rail card.

## 1. New `StressTestCard` above the Scenarios rail

New file `src/components/sim/StressTestCard.tsx`. Same width as the rail (`w-64`), same card chrome, lives directly above it in the left column.

Contents: header "Built-in stress tests" + six canonical one-click tests, each a row with a small icon, label, and tooltip blurb.

| Test | What it sets |
|---|---|
| Single-supplier outage | Primary supplier offline 14d from day 30, 100% |
| Material shortage | Critical material inbound −50% for 21d |
| Lead-time shock | Inbound lane lead time +200% for 28d |
| Demand surge | Aggregate demand +40% for 21d |
| Multi-hit (compound) | Supplier outage day 30 + demand surge day 45 |
| Nexus-node attack | Highest-prominence node offline 14d |

Each click calls `create()` (the existing `useScenarios` hook) with the preset name, description, and `disruption_schedule` filled in, then selects the new scenario and switches the pane to **Recovery playbook** so the user lands on the configured disruption.

A disabled footer reads "Resilience Index · coming soon" to telegraph the composite-score direction without building it yet.

## 2. Cleaner scenario cards in `ScenarioRail`

Drop the cramped one-liner `30× · 90d · seed 42`. New stacked layout per card:

- **Line 1**: scenario name, bolder when selected, truncates cleanly.
- **Line 2**: a status chip — amber `⚠ N disruptions` when the schedule is non-empty, muted `● Steady-state` otherwise — followed by `· 10 reps · 90d`. Seed is removed (it belongs in Setup, not in the rail).
- **Line 3**: relative timestamp (`today`, `yesterday`, `3d ago`) in muted micro-text.

Hover still reveals Duplicate / Delete. Selected state keeps the left primary bar but adds a subtle background.

Empty-state copy nudges toward the new card: *"No scenarios yet. Create one or launch a stress test above."*

## 3. Tighter left column + workspace focus

In `SimulationLab.tsx` the existing `<ScenarioRail …/>` becomes a small `<aside>` stack:

```text
┌──────────────┐  ┌──────────────────────────────┐
│ Stress tests │  │ Setup / Recovery / Run / …   │
├──────────────┤  │                              │
│  Scenarios   │  │   (workspace gets the focus) │
│              │  │                              │
└──────────────┘  └──────────────────────────────┘
```

The rail loses its forced `min-h-[60vh]` so it sizes to its content; the workspace column gets the visual weight. Toolbar (pane tabs + Browse library) is unchanged — those already work well.

## Files touched

- **New**: `src/components/sim/StressTestCard.tsx`
- **Edited**: `src/components/sim/ScenarioRail.tsx` — card markup + height rules only.
- **Edited**: `src/pages/SimulationLab.tsx` — wrap rail + new card in a left-column `<aside>`, wire `onLaunch` to `create()` + `setSelectedId` + `setPane("recovery")`.

## Out of scope (call out separately if you want them)

- Real Resilience Index calculation / scorecard panel.
- Stress-test runner that auto-launches the simulation (current plan only *creates* the pre-configured scenario; user still clicks Run).
- Any change to Setup, Recovery, Run, Results, Compare panes.
- Backend table for stress-test results.