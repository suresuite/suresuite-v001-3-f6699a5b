/**
 * WP 4.4 · the two grading shapes the Trust Report consumes, re-exported.
 *
 * `grading.ts` lives under `supabase/functions/_shared/` because the validation
 * gate runs in an edge function. Importing across that boundary from `src/`
 * pulls a Deno module into the Vite build, so the TYPES are named here and the
 * SHAPES stay the edge function's. They are structural: a drift in `grading.ts`
 * fails where the report is constructed, which is the point — a second
 * hand-written copy of a shape is `single-source` (I1) broken, and a type alias
 * that has to match is the cheapest thing that notices.
 */
export type Severity = "block" | "warn" | "info";

export interface GradedField {
  field: string;
  level: string;
  policyRef: string;
  policyName: string;
  reason: string;
  fallbackProse: string | null;
  evaluable: boolean;
  set: string[];
  resolved: Array<{ id: string; grade: "info" | "warn"; value?: number; via: string }>;
  missing: string[];
}

export interface GradedFinding {
  severity: Severity;
  field: string;
  policy: string;
  rows: string[];
  message: string;
  reason: string;
}
