import { useRef, useEffect, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { chatModesUiEnabled, ModeSwitch, type ThreadMode } from "@/components/chat/ModeSwitch";
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
  /** §15 mode control, rendered beside the model picker when the modes UI
   * flag is on and both props are provided. */
  mode?: ThreadMode;
  onModeChange?: (mode: ThreadMode) => void;
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
  mode,
  onModeChange,
  placeholder = "How can I help you today?",
  autoFocus,
  minRows = 2,
  className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 40); }, [autoFocus]);

  const disabled = !input.trim() || loading;

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-elevated transition-all duration-150",
        focused ? "border-strong shadow-sharp-sm" : "border-border shadow-xs",
        className,
      )}
    >
      <textarea
        ref={ref}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !disabled) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={minRows}
        className="w-full resize-none rounded-t-xl bg-transparent px-3.5 py-3 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        style={{ minHeight: 56, maxHeight: 200 }}
        disabled={loading}
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <AttachProjectButton
          projects={projects}
          projectId={projectId}
          onChange={onProjectChange}
          disabled={loading}
        />
        <div className="flex items-center gap-1.5">
          {chatModesUiEnabled() && mode && onModeChange && (
            <ModeSwitch value={mode} onChange={onModeChange} disabled={loading} />
          )}
          <ModelPicker value={model} onChange={onModelChange} />
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            aria-label="Send"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150",
              disabled
                ? "bg-muted text-muted-foreground/50"
                : "bg-foreground text-background hover:opacity-90 active:scale-95",
            )}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
