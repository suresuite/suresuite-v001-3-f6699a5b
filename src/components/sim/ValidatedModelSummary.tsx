// The Validated Model summary card — what Save Validated Model produced and what
// the Simulation Lab will open. Phase 10 / WP 10.3 / blueprint §9.5 · G13 · §4 D243.
//
// T1, no number without a source: every line is built by `validatedModelLines`
// (`src/lib/sim/validatedModel.ts`) from a named column of the model, or of the
// version row it points at, and a value that was never recorded is SAID to be
// unrecorded with the reason, never shown as a default.
// `validatedModelSummary.test.tsx` holds it to that.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SURFACE, StatusDot, TD } from "@/components/intelligence/piUi";
import { cn } from "@/lib/utils";
import type { Credibility, ModelValidationCard } from "@/hooks/useModelValidation";
import { useVersionRefs } from "@/hooks/useModelVersionRefs";
import {
  modelDeepLink,
  shortHash,
  noteReasons,
  staleMessage,
  validatedModelLines,
} from "@/lib/sim/validatedModel";
import { dataRef, modelCodeLine, policyRef } from "@/lib/versions/versionLabels";

export function ValidatedModelSummary({
  card,
  credibility,
  projectId,
}: {
  card: ModelValidationCard;
  credibility: Credibility;
  projectId: string;
}) {
  const refs = useVersionRefs(card);
  const lines = validatedModelLines(card, refs);
  const stale = staleMessage(credibility);
  // WP 11.3 — a deep-tier change the simulation does not read: said, never "stale".
  const notes = credibility.state !== "unvalidated" ? noteReasons(credibility.notes) : [];
  return (
    <div className={cn(SURFACE, "flex flex-col")} data-testid="validated-model-summary">
      <div className="flex flex-wrap items-center gap-2 border-b border-[--hair-border] bg-[#fafafa] px-2.5 py-1.5">
        <StatusDot ok={credibility.state === "validated"} pending={credibility.state !== "validated"} />
        <span className="text-[12.5px] font-medium">
          {modelCodeLine(card, {
            data: dataRef({ version_code: refs.simulationCode, version_no: refs.simulationVersionNo }),
            policy: policyRef({ version_code: refs.policyCode, version_no: refs.policyVersionNo }),
          })}
        </span>
        {card.model_hash && (
          <span className="font-mono text-[10.5px] text-muted-foreground" title="model_validations.model_hash">
            model {shortHash(card.model_hash)}
          </span>
        )}
        <div className="flex-1" />
        <Button asChild size="sm" className="h-[24px] min-h-11 px-2.5 text-[11px] md:min-h-0">
          <Link to={modelDeepLink(projectId, card.id)}>Open in Simulation Lab</Link>
        </Button>
      </div>
      {stale && (
        <div className="border-b border-[--hair-border] px-2.5 py-1.5 font-mono text-[11px]" role="status">
          {stale}
        </div>
      )}
      {notes.length > 0 && (
        <div className="border-b border-[--hair-border] px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground" data-testid="model-notes">
          {notes.join(" · ")} — the model stays as validated
        </div>
      )}
      <table className="w-full">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} title={l.source}>
              <td className={cn(TD, "w-40 text-[11.5px] text-muted-foreground")}>{l.label}</td>
              <td className={cn(TD, "font-mono text-[11.5px]")}>
                {l.value ?? <span className="text-muted-foreground">{l.reason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
