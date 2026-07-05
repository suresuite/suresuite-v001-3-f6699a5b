import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Provenance } from "@/lib/policies/effectiveEconomics";

const LABEL: Record<Provenance, string> = {
  master: "master override",
  inbound: "from inbound data",
  outbound: "from outbound data",
  "engine-default": "engine default",
};

const STYLE: Record<Provenance, string> = {
  master: "bg-primary/10 text-primary border-primary/30",
  inbound: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  outbound: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  "engine-default": "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

/**
 * Tiny badge naming where an economics value resolves from — the engine's
 * priority chain (item master → inbound/outbound logistics → engine default).
 * Shared by ItemMasterEditor and the Data Map grid.
 */
export function ProvenanceBadge({ source, className }: { source: Provenance; className?: string }) {
  return (
    <Badge variant="outline" className={cn("h-4 px-1.5 text-[9px] font-normal whitespace-nowrap", STYLE[source], className)}>
      {LABEL[source]}
    </Badge>
  );
}
