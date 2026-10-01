/**
 * The graph-level vocabulary lives in `supabase/functions/_shared/graphLevels.ts`,
 * and this file re-exports it — the `trustReport.ts` precedent (WP 6.3). The Trust
 * Report is computed in the browser and by the agent's tool, and both must name a
 * level version with the same code the network pages use (WP 11.3, §4 D263).
 */
export * from "../../../supabase/functions/_shared/graphLevels";
