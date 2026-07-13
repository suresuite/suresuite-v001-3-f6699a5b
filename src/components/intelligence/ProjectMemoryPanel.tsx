import { useState } from "react";
import { Archive, Brain, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useProjectMemory, type ProjectMemoryEntry } from "@/hooks/useProjectMemory";

/**
 * "Project memory" sidebar panel — workstream M2 (ai-agents.md §14.4
 * visibility rule): the user always sees exactly what the system remembers,
 * per entry, with archive control and a stale chip on grounding-hash drift.
 * Adding an entry here IS the consent (the model never writes memory).
 */

const KIND_LABEL: Record<ProjectMemoryEntry["kind"], string> = {
  fact: "fact",
  preference: "pref",
  decision: "decision",
};

export function ProjectMemoryPanel({ projectId }: { projectId: string | null }) {
  const { entries, loading, save, archive } = useProjectMemory(projectId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!projectId) return null;

  const onSave = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    const err = await save({ content: draft, kind: "fact" });
    if (err) setError(err);
    else {
      setDraft("");
      setAdding(false);
    }
    setBusy(false);
  };

  return (
    <div className="border-t border-border px-2 pb-2 pt-1.5">
      <div className="flex items-center gap-1.5 px-1 py-1">
        <Brain className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Project memory
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-5 w-5 p-0"
          title="Remember something for this project"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {adding && (
        <div className="mb-1.5 flex items-center gap-1 px-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSave();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="e.g. S3 is our strategic supplier"
            maxLength={500}
            className="h-6 text-[12px]"
            autoFocus
          />
          <Button size="sm" className="h-6 px-2 text-[11px]" disabled={busy || !draft.trim()} onClick={() => void onSave()}>
            Save
          </Button>
        </div>
      )}
      {error && <div className="px-1 pb-1 text-[11px] text-destructive">{error}</div>}

      {entries.length === 0 && !loading ? (
        <div className="px-1 pb-1 text-[11.5px] text-muted-foreground">
          Nothing saved yet — say “remember …” in a chat, or add a note here.
        </div>
      ) : (
        <ul className="max-h-44 space-y-1 overflow-y-auto px-1">
          {entries.map((m) => (
            <li key={m.id} className="group flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-muted/50">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium uppercase text-muted-foreground",
                )}
              >
                {KIND_LABEL[m.kind]}
              </span>
              <span className="min-w-0 flex-1 text-[12px] leading-snug" title={m.content}>
                {m.content}
                {m.stale && (
                  <span
                    className="ml-1.5 rounded bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
                    title="Saved against older project data (policy/data hash drift)"
                  >
                    stale
                  </span>
                )}
              </span>
              <button
                type="button"
                className="invisible mt-0.5 shrink-0 text-muted-foreground hover:text-foreground group-hover:visible"
                title="Archive this memory"
                onClick={() => void archive(m.id)}
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
