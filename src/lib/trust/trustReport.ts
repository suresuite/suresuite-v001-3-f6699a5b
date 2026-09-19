/**
 * A3's report now lives in `supabase/functions/_shared/trustReport.ts`, and this
 * file re-exports it.
 *
 * WHY IT MOVED (WP 6.3). A3 renders through `report-render`, a Deno edge function,
 * so the report must be computable where the data is — a PDF built from numbers the
 * browser asserted is not "reproducible or not published" (T5/T4), it is a claim
 * about a client. The alternative was a server copy of `buildTrustReport`, and two
 * implementations of one report is the defect this plan keeps finding (D101).
 *
 * `_shared/` is the established home for a pure module both sides read —
 * `grading.ts` and `ingestSpec.generated.ts` are already imported from `src/`. This
 * re-export exists so no consumer had to change, and so a reader who looks for the
 * Trust Report where it used to be finds out where it went.
 */
export * from "../../../supabase/functions/_shared/trustReport";
