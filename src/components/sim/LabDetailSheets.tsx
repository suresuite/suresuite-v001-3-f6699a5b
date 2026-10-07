/**
 * The Lab's two left-rail cards open their detail on the RIGHT, as /policies'
 * "Model version history" does — the rail itself never grows, so the
 * stress-test card, the surrogate card and the scenario list keep their places.
 *
 *   · StressTestSheet — the preset list (the same rows the inline drawer had);
 *     picking one creates the scenario and closes the sheet.
 *   · SurrogateSheet — what the surrogate model will do, why it is not here
 *     yet, and the one figure it carries: the size of its training set.
 *     It prints no ranking and offers no action (T1): a placeholder ranking
 *     would be an invented number on the surface that chooses what to simulate.
 */
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StressTestDrawer, type StressTestPreset } from "./StressTestCard";
import { trainingSetLine, type TrainingTotals } from "@/lib/sim/surrogateTraining";

const SHEET = "w-[440px] overflow-y-auto sm:max-w-[440px]";
const SECTION = "flex flex-col gap-1 rounded-sm border border-[--hair-rule] bg-white px-3 py-[10px]";
const HEAD = "text-[11px] font-semibold uppercase tracking-[0.04em] text-[#52525b]";
const BODY = "text-[12.5px] leading-relaxed text-[#3f3f46]";

export function StressTestSheet({
  open,
  onOpenChange,
  count,
  onLaunch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onLaunch: (preset: StressTestPreset) => void | Promise<void>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={SHEET} data-testid="stress-test-sheet">
        <SheetHeader>
          <SheetTitle className="text-[13px]">Stress-test experiments</SheetTitle>
          <SheetDescription className="text-[12px]">
            {count} presets. Pick one to create a scenario with its disruption schedule; you can edit
            the scenario before you run it.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <StressTestDrawer
            onLaunch={async (preset) => {
              onOpenChange(false);
              await onLaunch(preset);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SurrogateSheet({
  open,
  onOpenChange,
  training,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  training: TrainingTotals | null;
}) {
  const line = trainingSetLine(training);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={SHEET} data-testid="surrogate-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-[13px]">
            Surrogate model: nexus node detection
            <span className="rounded-sm bg-[rgba(191,35,48,0.12)] px-[6px] py-px font-mono text-[10.5px] font-normal text-[#BF2330]">
              coming soon
            </span>
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            Not built yet. Nothing here is a prediction.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-2">
          <section className={SECTION}>
            <h3 className={HEAD}>What it will do</h3>
            <p className={BODY}>
              A model trained on a sample of simulations ranks every node by criticality. The nodes
              it ranks highest are the network's nexus nodes, the ones whose loss hurts most.
            </p>
            <p className={BODY}>
              Each entry will be labelled simulated or predicted, with an interval, and fall back
              to simulation where the prediction is not reliable.
            </p>
          </section>

          <section className={SECTION}>
            <h3 className={HEAD}>Why it sits under stress tests</h3>
            <p className={BODY}>
              A stress test is the question; the ranking decides which stress tests are worth
              simulating.
            </p>
          </section>

          <section className={SECTION} data-testid="surrogate-training-set">
            <h3 className={HEAD}>Training set</h3>
            <p className="font-mono text-[11.5px] text-[#3f3f46]">
              {line ?? "Not read yet."}
            </p>
            <p className={BODY}>
              Only completed, faithful runs of a Validated Model count, its evidence run included.
              Exploratory, deviating or gate-skipped runs never do.
            </p>
          </section>

          <section className={SECTION}>
            <h3 className={HEAD}>Until it is built</h3>
            <p className={BODY}>
              No ranking is shown: a placeholder ranking would be an invented number on the surface
              that chooses what to simulate. This is not the network pages' "Nexus node prediction"
              panel, which reads a different model.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
