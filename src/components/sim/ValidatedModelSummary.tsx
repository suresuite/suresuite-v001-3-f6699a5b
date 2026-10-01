// The Validated Model summary card — what Save Validated Model produced and what
// the Simulation Lab will open. Phase 10 / WP 10.3 / blueprint §9.5 · G13 · §4 D243.
//
// T1, no number without a source: every line is built by `validatedModelLines`
// (`src/lib/sim/validatedModel.ts`) from a named column of the model, or of the
// version row it points at, and a value that was never recorded is SAID to be
// unrecorded with the reason, never shown as a default.
// `validatedModelSummary.test.tsx` holds it to that.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SURFACE, StatusDot, TD } from "@/components/intelligence/piUi";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Credibility, ModelValidationCard } from "@/hooks/useModelValidation";
import {
  modelDeepLink,
  shortHash,
  staleMessage,
  validatedModelLines,
  type VersionRefs,
} from "@/lib/sim/validatedModel";

/** Reads the two version numbers the card names (one row each). */
function useVersionRefs(card: ModelValidationCard): VersionRefs {
  const [refs, setRefs] = useState<VersionRefs>({ graphVersionNo: null, policyVersionNo: null });
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void Promise.all([
      card.dataset_version_id
        ? sb.from("dataset_versions").select("version_no").eq("id", card.dataset_version_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sb.from("policy_versions").select("version_no").eq("id", card.policy_version_id).maybeSingle(),
    ]).then(([ds, pv]: Array<{ data: { version_no?: number | null } | null }>) => {
      if (!alive) return;
      setRefs({ graphVersionNo: ds.data?.version_no ?? null, policyVersionNo: pv.data?.version_no ?? null });
    });
    return () => {
      alive = false;
    };
  }, [card.dataset_version_id, card.policy_version_id]);
  return refs;
}

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
  return (
    <div className={cn(SURFACE, "flex flex-col")} data-testid="validated-model-summary">
      <div className="flex flex-wrap items-center gap-2 border-b border-[--hair-border] bg-[#fafafa] px-2.5 py-1.5">
        <StatusDot ok={credibility.state === "validated"} pending={credibility.state !== "validated"} />
        <span className="text-[12.5px] font-medium">
          {card.name ?? "Validated model"}
          {card.version_no != null ? ` · v${card.version_no}` : ""}
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
