import { useState } from "react";
import { Plus, X, Check, Folder } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface Project { id: string; name: string; plant_name?: string | null }

interface Props {
  projects: Project[];
  projectId: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

export function AttachProjectButton({ projects, projectId, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const active = projects.find((p) => p.id === projectId) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
            active
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-border bg-muted/50 text-muted-foreground hover:bg-muted",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          aria-label={active ? `Project: ${active.name}` : "Attach a project"}
        >
          {active ? (
            <>
              <Folder className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate">{active.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onChange(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null); } }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20"
                aria-label="Detach project"
              >
                <X className="h-3 w-3" />
              </span>
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              <span>Project</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[120] w-72 p-0">
        <Command>
          <CommandInput placeholder="Search projects…" className="h-9" />
          <CommandList>
            <CommandEmpty>No projects.</CommandEmpty>
            <CommandGroup>
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => { onChange(p.id); setOpen(false); }}
                  className="flex items-center gap-2"
                >
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.id === projectId && <Check className="h-3.5 w-3.5 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
