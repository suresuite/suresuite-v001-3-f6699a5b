/**
 * The surrogate model, signposted and not yet built (WP 9.4 slice 3).
 *
 * Blueprint §11 · G12 · Phase D: a model trained on a sample of simulations
 * ranks every node by criticality — the "nexus" nodes whose loss hurts the
 * network most — and labels each entry "simulated" or "predicted", with an
 * interval, falling back to simulation where the prediction is not reliable.
 *
 * No prediction, no preset. A placeholder that printed a ranking would be an
 * invented number on the surface that decides what to simulate (T1). It is NOT
 * the network pages' "Nexus node prediction" panel, which reads a different
 * function and a different model. On desktop the card opens its detail on the
 * right (`SurrogateSheet`), as the stress-test card does; that sheet describes
 * and counts, it never predicts. Without `onOpen` the card is inert.
 *
 * Red, not teal: teal is the stress-test card's, which is live; red marks this
 * one as not built yet, so it is never mistaken for a working surface.
 *
 * WP 10.8 (§4 D249) gives it ONE figure, and it is a count, not a prediction:
 * how many replications the training set already holds, from
 * `surrogate_training_totals` (distinct, §4 D254). Absent until it is read.
 */
import { cn } from "@/lib/utils";
import { trainingSetLine, type TrainingTotals } from "@/lib/sim/surrogateTraining";

export function SurrogateCard({
  training = null,
  open = false,
  onOpen,
}: {
  training?: TrainingTotals | null;
  /** The detail sheet is open — the card shows it, as the stress-test card does. */
  open?: boolean;
  /** Opens the detail on the right. Absent: the card is inert. */
  onOpen?: () => void;
} = {}) {
  const line = trainingSetLine(training);
  // One line on the card; what it will do and the training-set size on hover.
  const detail = ["Nexus node detection — criticality ranking from a sample of runs", line]
    .filter(Boolean)
    .join("\n");
  const className = cn(
    "mb-3 flex w-full items-center gap-[7px] rounded-sm border border-dashed border-[#BF2330] px-[14px] py-[9px] text-left",
    open ? "bg-[rgba(191,35,48,0.12)] shadow-[0_0_0_3px_rgba(191,35,48,0.12)]" : "bg-[rgba(191,35,48,0.06)]",
    onOpen && "hover:border-solid",
  );
  const body = (
    <>
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#BF2330]" />
      <span className="min-w-0 text-[13px] font-semibold tracking-[-0.011em] text-[#18181b]">Surrogate model</span>
      <span className="ml-auto shrink-0 rounded-sm bg-[rgba(191,35,48,0.12)] px-[6px] py-px font-mono text-[10.5px] text-[#BF2330]">
        coming soon
      </span>
      {onOpen ? <span className="shrink-0 text-[13px] text-[#BF2330]">{open ? "\u25BE" : "\u25B8"}</span> : null}
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Surrogate model: nexus node detection, coming soon — show details"
        aria-expanded={open}
        title={detail}
        className={className}
        data-testid="surrogate-card"
      >
        {body}
      </button>
    );
  }
  return (
    <section
      aria-label="Surrogate model: nexus node detection, coming soon"
      title={detail}
      className={className}
      data-testid="surrogate-card"
    >
      {body}
    </section>
  );
}
