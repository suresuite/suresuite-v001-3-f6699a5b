// The Lab's first two steps — Model, Engine — and the protocol the run inherits
// from the model, LOCKED unless "Advanced" is opened. Phase 10 / WP 10.5 /
// blueprint §9.1, §9.5.1.
//
// One component for the desktop page and the phone composition, so the choice
// and what is said about it cannot differ by platform (D224's rule). Every
// figure on it is a field of the chosen model, of its version rows, of the
// engine registry, or a declared estimate with its basis (T1).
import { useId } from "react";
import { cn } from "@/lib/utils";
import { LAYER, tint } from "@/components/intelligence/piUi";
import type { Credibility, ModelValidationCard } from "@/hooks/useModelValidation";
import type { SimEngine } from "@/hooks/useSimEngines";
import { useVersionRefs } from "@/hooks/useModelVersionRefs";
import { modelOptionLabel, type Deviation } from "@/lib/sim/labModel";
import { driftReasons, protocolLine } from "@/lib/sim/validatedModel";

const SELECT =
  "h-7 min-h-11 w-full min-w-0 rounded-sm border border-[#d4d4d8] bg-white px-2 text-[12.5px] text-[#18181b] " +
  "focus:border-foreground focus:outline-none md:min-h-0 md:max-w-[460px]";

export interface LabModelStepProps {
  /** The models offered (active, validated, newest first). */
  models: ModelValidationCard[];
  /** The chosen model; may be one NOT offered (a `?model=` link to history). */
  chosen: ModelValidationCard | null;
  onChoose: (id: string) => void;
  /** Its credibility against the live policy, graph and baseline world. */
  credibility: Credibility | null;
  exploratory: boolean;
  onExploratory: (v: boolean) => void;
  /** Editors may run an exploratory model; others see the model path only. */
  canExplore: boolean;
  engines: SimEngine[];
  enginesLoading: boolean;
  engineId: string | null;
  onEngine: (id: string) => void;
  deviations: Deviation[];
  advanced: boolean;
  onAdvanced: (v: boolean) => void;
  /** Shown when the selected scenario is the read-only validated baseline. */
  onRunModel?: () => void;
  runModelReason?: string | null;
}

function ChosenFacts({ card, credibility }: { card: ModelValidationCard; credibility: Credibility | null }) {
  const refs = useVersionRefs(card);
  const status =
    card.status === "revoked"
      ? "revoked — not usable"
      : card.status === "superseded"
        ? "superseded — a newer model is in force"
        : credibility?.state === "stale"
          ? `${driftReasons(credibility.drift).join(" · ") || "stale"} → re-validate`
          : credibility?.state === "validated"
            ? "in force"
            : "not matched to the live policy, graph and scenario";
  const stale = card.status !== "active" || credibility?.state === "stale";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#52525b]" data-testid="model-facts">
      <span title="model_validations.dataset_version_id → dataset_versions.version_no">
        graph {refs.graphVersionNo != null ? `v${refs.graphVersionNo}` : card.graph_hash.slice(0, 7)}
      </span>
      <span title="model_validations.policy_version_id → policy_versions.version_no">
        policy {refs.policyVersionNo != null ? `v${refs.policyVersionNo}` : card.policy_hash.slice(0, 7)}
      </span>
      <span title="model_validations.validated_at">validated {new Date(card.validated_at).toLocaleDateString()}</span>
      <span style={{ color: stale ? LAYER.firm : LAYER.process }}>{status}</span>
    </div>
  );
}

export function LabModelStep(p: LabModelStepProps) {
  const ids = { model: useId(), engine: useId() };
  const offeredHasChosen = !!p.chosen && p.models.some((m) => m.id === p.chosen!.id);
  const protocol = p.chosen?.protocol ?? null;
  const usingModel = !!p.chosen && !p.exploratory;

  return (
    <section
      className="overflow-hidden rounded-sm border border-[--hair-rule] bg-white"
      data-testid="lab-model-step"
      aria-label="Model and engine"
    >
      {/* 1 · Model */}
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <label htmlFor={ids.model} className="text-[12.5px] font-medium text-[#18181b]">
            Model
          </label>
          {p.exploratory ? (
            <span
              className="rounded-sm px-[6px] py-px font-mono text-[10.5px]"
              style={{ background: tint(LAYER.firm, 0.12), color: LAYER.firm }}
              data-testid="exploratory-badge"
            >
              exploratory — unvalidated
            </span>
          ) : null}
        </div>
        {p.models.length === 0 && !p.chosen ? (
          <p className="text-[12px] text-[#52525b]">
            No Validated Model yet — save one in Policies › Run &amp; Validate.
            {p.canExplore ? " Until then a run here is exploratory." : ""}
          </p>
        ) : (
          <select
            id={ids.model}
            className={SELECT}
            value={p.chosen?.id ?? ""}
            onChange={(e) => p.onChoose(e.target.value)}
            disabled={p.exploratory}
            aria-label="Validated Model"
          >
            {!offeredHasChosen && p.chosen ? (
              <option value={p.chosen.id}>{modelOptionLabel(p.chosen)} ({p.chosen.status})</option>
            ) : null}
            {p.models.map((m) => (
              <option key={m.id} value={m.id}>
                {modelOptionLabel(m)}
              </option>
            ))}
          </select>
        )}
        {p.chosen && !p.exploratory ? <ChosenFacts card={p.chosen} credibility={p.credibility} /> : null}
        {p.canExplore ? (
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-[12px] text-[#52525b] md:min-h-0">
            <input
              type="checkbox"
              checked={p.exploratory}
              onChange={(e) => p.onExploratory(e.target.checked)}
              className="h-[14px] w-[14px] accent-foreground"
            />
            Run an exploratory (unvalidated) model instead — badged everywhere, never a comparison
            baseline, never surrogate training data
          </label>
        ) : null}
      </div>

      {/* 2 · Engine */}
      <div className="flex flex-col gap-1.5 border-t border-[--hair-rule] px-3 py-2.5">
        <label htmlFor={ids.engine} className="text-[12.5px] font-medium text-[#18181b]">
          Engine
        </label>
        {p.enginesLoading ? (
          <span className="font-mono text-[11px] text-[#52525b]">reading the engine registry…</span>
        ) : p.engines.length === 0 ? (
          <span className="font-mono text-[11px] text-[#52525b]">
            the engine registry is not readable here — the run goes to the single active engine
          </span>
        ) : (
          <select
            id={ids.engine}
            className={SELECT}
            value={p.engineId ?? p.engines[0].id}
            onChange={(e) => p.onEngine(e.target.value)}
            aria-label="Engine"
          >
            {p.engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.version ? ` · ${e.version}` : ""}
                {e.code_version ? ` · ${e.code_version}` : " · build not reported yet"}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* The protocol the run inherits from the model — locked by default. */}
      {usingModel ? (
        <div className="flex flex-col gap-1.5 border-t border-[--hair-rule] bg-[#fafafa] px-3 py-2.5" data-testid="model-protocol">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-medium text-[#18181b]">Protocol</span>
            <span className="font-mono text-[11.5px] text-[#18181b]">
              {protocol
                ? `${protocolLine({ replications: protocol.replications, warmup_week: protocol.warmup_week, horizon_weeks: protocol.horizon_weeks })}` +
                  (protocol.ci_level != null ? ` · CI ${+(protocol.ci_level * 100).toFixed(1)}%` : "") +
                  (protocol.ci_halfwidth_target != null ? ` ±${+(protocol.ci_halfwidth_target * 100).toFixed(1)}%` : "")
                : "no protocol recorded on this model"}
            </span>
            <span className="font-mono text-[10.5px] text-[#71717a]">{p.advanced ? "unlocked" : "locked"}</span>
            <button
              type="button"
              onClick={() => p.onAdvanced(!p.advanced)}
              className="ml-auto min-h-11 text-[12px] text-[#52525b] underline-offset-2 hover:underline md:min-h-0"
              aria-expanded={p.advanced}
            >
              {p.advanced ? "Lock to the model" : "Advanced"}
            </button>
          </div>
          {p.deviations.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-[12px]" data-testid="protocol-deviations">
              <li className="text-[--warn-ink,#92400e]">
                This run deviates from the model — recorded on the run and shown on its results and exports:
              </li>
              {p.deviations.map((d) => (
                <li key={d.key} className="font-mono text-[11.5px] text-[#18181b]">
                  {d.label}: {String(d.model)} → {String(d.run)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[12px] text-[#52525b]">Faithful to the model's protocol — no deviations.</span>
          )}
        </div>
      ) : null}

      {p.onRunModel ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[--hair-rule] px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[12px] text-[#52525b]">
            {p.runModelReason ??
              "The validated baseline is read-only. Running the model makes a scenario seeded from it and runs that."}
          </span>
          <button
            type="button"
            onClick={p.onRunModel}
            disabled={!!p.runModelReason}
            className={cn(
              "h-[30px] min-h-11 shrink-0 rounded-sm border px-4 text-[13px] font-medium md:min-h-0",
              p.runModelReason
                ? "cursor-not-allowed border-[--hair-rule] bg-[#f4f4f5] text-[#a1a1aa]"
                : "border-foreground bg-foreground text-background",
            )}
          >
            Run this model
          </button>
        </div>
      ) : null}
    </section>
  );
}
