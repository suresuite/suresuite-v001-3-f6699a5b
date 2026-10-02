// The page's policy defaults, as the SQL literal `public.policy_bundle_defaults()`
// carries them — PLAN.md §23 WP 13.4, §4 D204 (a).
//
// The policies page parses every stored family through the Zod bundle
// (`src/lib/policies/schemas.ts` → `DEFAULT_BUNDLE`), which fills every key the
// project never saved. The policy SNAPSHOT a run binds is built in SQL
// (`_build_policy_snapshot`) and used to copy the stored JSON raw, so a key never
// saved was the page's default on screen and the ENGINE's default in the run.
// The snapshot now merges the stored values over this literal. SQL cannot import
// TypeScript, so the literal is GENERATED from `DEFAULT_BUNDLE` and
// `policyBundleDefaultsSql.test.ts` fails when the two differ.
//
//   npx tsx scripts/gen-policy-bundle-defaults.mts      # prints the JSON
import { DEFAULT_BUNDLE } from "../src/lib/policies/schemas";

process.stdout.write(JSON.stringify(DEFAULT_BUNDLE) + "\n");
