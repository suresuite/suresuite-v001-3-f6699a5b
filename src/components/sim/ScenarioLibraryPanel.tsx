import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useScenarioTemplates, type ScenarioTemplate } from "@/hooks/useScenarioTemplates";

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCloned: (scenarioId: string) => void;
}

const CATEGORIES = [
  { key: "all",           label: "All" },
  { key: "supplier",      label: "Supplier" },
  { key: "logistics",     label: "Logistics" },
  { key: "demand",        label: "Demand" },
  { key: "production",    label: "Production" },
  { key: "geopolitical",  label: "Geopolitical" },
] as const;

const SEVERITY_COLORS: Record<string, string> = {
  low:      "bg-green-100 text-green-800 border-green-200",
  medium:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  high:     "bg-orange-100 text-orange-800 border-orange-200",
  extreme:  "bg-red-100 text-red-800 border-red-200",
};

function TemplateCard({
  template,
  onUse,
  cloning,
}: {
  template: ScenarioTemplate;
  onUse: () => void;
  cloning: boolean;
}) {
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-2 bg-card hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug">{template.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
            {template.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">
          {template.category}
        </Badge>
        <span
          className={`text-[10px] font-medium border rounded px-1.5 py-0 capitalize ${SEVERITY_COLORS[template.severity] ?? ""}`}
        >
          {template.severity}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {Math.round(template.horizon_days / 7)}w · {template.replications} reps
        </span>
      </div>
      {template.suggested_playbook_name && (
        <p className="text-[10px] text-muted-foreground">
          Suggested playbook: <span className="font-medium">{template.suggested_playbook_name}</span>
        </p>
      )}
      <Button
        size="sm"
        className="h-7 text-xs w-full mt-1"
        onClick={onUse}
        disabled={cloning}
      >
        {cloning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        Use this scenario
      </Button>
    </div>
  );
}

export function ScenarioLibraryPanel({ open, projectId, onClose, onCloned }: Props) {
  const { templates, loading, cloneToProject } = useScenarioTemplates();
  const [filter, setFilter] = useState<string>("all");
  const [cloningId, setCloningId] = useState<string | null>(null);

  const visible = filter === "all"
    ? templates
    : templates.filter((t) => t.category === filter);

  const handleUse = async (template: ScenarioTemplate) => {
    setCloningId(template.id);
    const newId = await cloneToProject(template, projectId);
    setCloningId(null);
    if (!newId) {
      toast.error("Failed to create scenario from template");
      return;
    }
    toast.success(`"${template.name}" added to your scenarios`);
    onCloned(newId);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">Scenario library</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Pre-built disruption scenarios. Click "Use this scenario" to clone it
            into your project — disruption schedule is pre-filled.
          </p>
        </SheetHeader>

        <div className="px-4 py-2 border-b flex gap-1.5 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                filter === c.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-accent border-border"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1 px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No templates in this category.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {visible.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onUse={() => void handleUse(t)}
                  cloning={cloningId === t.id}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
