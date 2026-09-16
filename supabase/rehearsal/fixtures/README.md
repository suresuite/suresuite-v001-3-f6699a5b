# Rehearsal fixtures — and the rule that keeps them from going stale

A fixture is state the rehearsal base does **not** have and a migration in this
branch must survive. The base is generated from `build/schema.introspected.json`,
which records what the MIGRATIONS say; it is a fresh, empty database of exactly
that shape. Production is neither fresh nor empty, and a migration written for
production has paths the fresh base never takes. `--fixtures` is where those
paths get executed:

```
npm run contract:rehearse -- --fixtures
```

`data-contract.yml` runs the rehearsal BOTH ways on every pull request. Neither
run alone is the answer — that is WP 3.0's finding and it still holds.

## The rule WP 3.1 had to add

**A fixture must no-op once the migration it serves has merged, or it must be
deleted by the package that finds it spent.** A fixture describes a divergence
between the contract and production; the migration it accompanies closes that
divergence; the day that migration merges, the fixture is describing a database
that no longer exists. There are exactly two ways to write one:

1. **Shape-conditional** — guard every statement on the shape it is reproducing
   (`IF to_regclass('public.old_name') IS NOT NULL THEN …`). Once the migration
   is in the base, the guard is false and the fixture is a no-op. **Prefer this.**
   It is the same discipline the migration itself is held to: correct on a fresh
   database and on production's.
2. **Data-conditional, which cannot be written** — a fixture that plants rows a
   migration then removes has no shape to key on. It passes exactly once, on the
   branch that carries the migration, and fails on every branch after it.

WP 3.0's two fixtures were of the second kind and nobody noticed, because the
only run that mattered was the one on WP 3.0's own branch. The day WP 3.0 merged,
`main`'s `migrations run` job went red (run `35077191060`) and stayed red:
`020_d1_zero_safety_stock.sql` planted the four `policy_overrides` rows and
`020_d1_unseeded.sql` asserted a migration had removed them — a migration that
was now in the base and therefore never ran again.

Both fixtures and that assertion were deleted in WP 3.1 rather than repaired.
Their subjects are settled and §15 has the numbers: `policy_overrides` rows
carrying the frozen zero went 477 → **0**, and relations production holds that no
migration creates went 2 → **0**. A fixture reproducing a divergence that no
longer exists is not a safety net; it is a false statement about production, held
by CI, which is the §5 T1 failure inside the gate that exists to prevent it.

## What belongs here

- Rows or relations **production has and the base cannot**, needed so a migration
  in THIS branch executes its real path rather than a vacuous one.
- Nothing else. Test data an assertion needs belongs in the assertion, inside the
  transaction the runner rolls back.
