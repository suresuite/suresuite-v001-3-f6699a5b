import { Factory, Layers, Boxes, Building2, Truck, Users } from "lucide-react";
import type { ProjectContext } from "@/lib/policies/resolvePreset";

interface Project {
  id: string;
  name: string;
  plant_name: string;
  supply_chain_model: string;
  bom_level: string;
}

interface Props {
  project: Project | null;
  projectId: string | null;
  ctx: ProjectContext | null;
}

/**
 * Inline subtitle strip that surfaces the project context presets read from.
 * Uses the shared `useProjectContext` data (passed in as `ctx`) so the counts
 * match the rest of /policies instead of running its own independent queries.
 */
export function ProjectContextStrip({ project, ctx }: Props) {
  if (!project) return null;

  const sep = <span className="text-muted-foreground/40">·</span>;
  const plantName = ctx?.plant_name || project.plant_name || "—";
  const suppliers = ctx?.supplier_count ?? 0;
  const plants = ctx?.plant_count ?? (plantName && plantName !== "—" ? 1 : 0);
  const customers = ctx?.customer_count ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Factory className="h-3.5 w-3.5" />
        <span>Plant:</span>
        <span className="font-medium text-foreground">{plantName}</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" />
        <span>Model:</span>
        <span className="font-medium text-foreground">{project.supply_chain_model || "—"}</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1.5">
        <Boxes className="h-3.5 w-3.5" />
        <span>BOM:</span>
        <span className="font-medium text-foreground">{project.bom_level || "—"}</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1.5">
        <Truck className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{suppliers}</span>
        <span>suppliers</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1.5">
        <Building2 className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{plants}</span>
        <span>plants</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{customers}</span>
        <span>customers</span>
      </span>
    </div>
  );
}
