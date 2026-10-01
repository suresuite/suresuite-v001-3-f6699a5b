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
 * `surrogate_training_summary`. Absent until it is read.
 */
import { trainingSetLine, type TrainingGroup } from "@/lib/sim/surrogateTraining";

export function SurrogateCard({ training = null }: { training?: TrainingGroup[] | null } = {}) {
  const line = trainingSetLine(training);
  return (
    <section
      aria-label="Surrogate model: nexus node detection, coming soon"
      className="mb-3 flex w-full flex-col gap-[3px] rounded-sm border border-dashed border-[#d4d4d8] bg-[#fafafa] px-[14px] py-3"
    >
      <span className="flex items-center gap-[7px]">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#d4d4d8]" />
        <span className="min-w-0 text-[13px] font-semibold tracking-[-0.011em] text-[#3f3f46]">
          Surrogate model: nexus node detection
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm bg-[#f0f0f2] px-[6px] py-px font-mono text-[10.5px] text-[#71717a]">
          coming soon
        </span>
        <span className="text-[11.5px] text-[#71717a]">criticality ranking from a sample of runs</span>
      </span>
      {line ? (
        <span className="text-[11.5px] text-[#52525b] [text-wrap:pretty]" data-testid="surrogate-training-set">
          {line}
        </span>
      ) : null}
    </section>
  );
}
