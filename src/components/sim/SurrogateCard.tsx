/**
 * The surrogate model, signposted and not yet built (WP 9.4 slice 3).
 *
 * Blueprint §11 · G12 · Phase D: a model trained on a sample of simulations
 * ranks every node by criticality — the "nexus" nodes whose loss hurts the
 * network most — and labels each entry "simulated" or "predicted", with an
 * interval, falling back to simulation where the prediction is not reliable.
 *
 * Deliberately inert: no button, no prediction, no preset. A placeholder that
 * printed a ranking would be an invented number on the surface that decides
 * what to simulate (T1). It is NOT the network pages' "Nexus node prediction"
 * panel, which reads a different function and a different model.
 *
 * Neutral palette on purpose — teal is the stress-test card's, which is live.
 *
 * WP 10.8 (§4 D249) gives it ONE figure, and it is a count, not a prediction:
 * how many replications the training set already holds, from
 * `surrogate_training_totals` (distinct, §4 D254). Absent until it is read.
 */
import { trainingSetLine, type TrainingTotals } from "@/lib/sim/surrogateTraining";

export function SurrogateCard({ training = null }: { training?: TrainingTotals | null } = {}) {
  const line = trainingSetLine(training);
  // One line on the card; what it will do and the training-set size on hover.
  const detail = ["Nexus node detection — criticality ranking from a sample of runs", line]
    .filter(Boolean)
    .join("\n");
  return (
    <section
      aria-label="Surrogate model: nexus node detection, coming soon"
      title={detail}
      className="mb-3 flex w-full items-center gap-[7px] rounded-sm border border-dashed border-[#d4d4d8] bg-[#fafafa] px-[14px] py-[9px]"
      data-testid="surrogate-card"
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#d4d4d8]" />
      <span className="min-w-0 text-[13px] font-semibold tracking-[-0.011em] text-[#3f3f46]">Surrogate model</span>
      <span className="ml-auto shrink-0 rounded-sm bg-[#f0f0f2] px-[6px] py-px font-mono text-[10.5px] text-[#71717a]">
        coming soon
      </span>
    </section>
  );
}
