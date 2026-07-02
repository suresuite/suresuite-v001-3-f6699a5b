import { useRef, useEffect } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { AttachProjectButton } from "./AttachProjectButton";
import { cn } from "@/lib/utils";

interface Project { id: string; name: string; plant_name?: string | null }

interface Props {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  model: string;
  onModelChange: (id: string) => void;
  projects: Project[];
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minRows?: number;
  className?: string;
}

export function ChatComposer({
  input,
  onInputChange,
  onSubmit,
  loading,
  model,
  onModelChange,
  projects,
  projectId,
  onProjectChange,
  placeholder = "How can I help you today?",
  autoFocus,
  minRows = 2,
  className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 40); }, [autoFocus]);

  const disabled = !input.trim() || loading;

  return (
    <div className={cn("rounded-2xl border border-border bg-card shadow-sm", className)}>
      <textarea
        ref={ref}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !disabled) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={minRows}
        className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        style={{ minHeight: 60, maxHeight: 200 }}
        disabled={loading}
      />
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-2">
        <AttachProjectButton
          projects={projects}
          projectId={projectId}
          onChange={onProjectChange}
          disabled={loading}
        />
        <div className="flex items-center gap-1.5">
          <ModelPicker value={model} onChange={onModelChange} />
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            aria-label="Send"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-full transition",
              disabled
                ? "bg-muted text-muted-foreground/60"
                : "bg-foreground text-background hover:bg-foreground/85",
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
