/**
 * ChatComposer — auto-growing textarea + attach/mode/model/send row.
 *
 * Height behavior (the part that matters): the textarea grows with content up
 * to 160px, and the expand toggle raises the ceiling to 420px with a 220px
 * floor for drafting long, careful prompts. Do NOT put a static `height` in
 * the style prop — React re-applies it on every render and clobbers the
 * imperative resize.
 *
 * Ask / Review are the only real modes; Auto is rendered disabled on purpose
 * (§10 Q23 — it does not exist and must not look available).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Maximize2, Minimize2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAT_MODELS, getModelLabel } from "@/components/chat/ModelPicker";
import { chatModesUiEnabled } from "@/components/chat/ModeSwitch";
import { useCapabilities } from "@/hooks/useCapabilities";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  model: string;
  onModelChange: (id: string) => void;
  mode: "ask" | "review";
  onModeChange: (m: "ask" | "review") => void;
}

const COLLAPSED_MAX = 160;
const EXPANDED_MAX = 420;
const EXPANDED_MIN = 220;
// One line of 14px/1.4 plus the 9px/6px box padding. It was 40 while the
// composer band carried 27px controls; the v1b pass drops the controls to 24px
// (26px send) and the resting box with them, which is ~14px of the ~60px the
// pass returns to the conversation. The ceilings are untouched — a long draft
// still grows to 160, and 420 with the expander.
const BASE = 34;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "How can I help you today?",
  disabled,
  projects,
  projectId,
  onProjectChange,
  model,
  onModelChange,
  mode,
  onModeChange,
}: ChatComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const max = expanded ? EXPANDED_MAX : COLLAPSED_MAX;
    const min = expanded ? EXPANDED_MIN : BASE;
    el.style.height = BASE + "px";
    el.style.height = Math.max(min, Math.min(el.scrollHeight, max)) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [expanded]);

  useEffect(() => {
    resize();
  }, [value, expanded, resize]);

  const toggleExpand = () => {
    setExpanded((v) => !v);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const canSend = Boolean(value.trim()) && !disabled;
  const modesOn = chatModesUiEnabled();

  // Same allowlist rule as ModelPicker: only permitted models, but never hide
  // the current value or the trigger renders blank.
  const { isModelAllowed } = useCapabilities();
  const visibleModels = CHAT_MODELS.filter((m) => isModelAllowed(m.id).ok || m.id === model);
  const modelOptions = visibleModels.length > 0 ? visibleModels : CHAT_MODELS;

  return (
    <div className="rounded-sm border border-[--hair-border] bg-background">
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="block w-full resize-none rounded-t-sm border-none bg-transparent px-3 pb-1.5 pt-[9px] text-[14px] leading-[1.4] text-foreground outline-none placeholder:text-[#a8a8a8]"
        style={{ minHeight: BASE, overflow: "hidden" }}
      />

      {/* #ececec, not --hair-divider: this rule sits INSIDE the composer box,
          a hairline lighter than the box's own #d4d4d4 edge, so the box reads
          as one control rather than two stacked ones. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[#ececec] px-1.5 py-1">
        <Select value={projectId ?? "none"} onValueChange={(v) => onProjectChange(v === "none" ? null : v)}>
          <SelectTrigger className="h-6 w-auto gap-1 rounded-sm border-[--zinc-border] px-1.5 text-[11.5px] text-muted-foreground">
            {/* Explicit children so an unattached thread reads "+ Project"
                instead of the "No project" item label. */}
            <SelectValue>
              {projectId ? (projects.find((p) => p.id === projectId)?.name ?? "Project") : "+ Project"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="rounded-sm">
            <SelectItem value="none" className="text-[12px]">
              No project
            </SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-[12px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            title={expanded ? "Collapse composer" : "Expand composer for longer input"}
            aria-label={expanded ? "Collapse composer" : "Expand composer for longer input"}
            onClick={toggleExpand}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[--zinc-border]",
              expanded ? "bg-foreground text-background" : "bg-background text-muted-foreground",
            )}
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>

          {modesOn && (
            <div className="inline-flex rounded-sm border border-[--zinc-border] p-[2px]">
              {(["ask", "review"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onModeChange(m)}
                  className={cn(
                    "rounded-[2px] px-2 py-[2px] text-[11.5px] capitalize",
                    mode === m ? "bg-foreground text-background" : "text-muted-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
              {/* Auto does not exist (§10 Q23) — visible, disabled, explained. */}
              <button
                type="button"
                disabled
                title="Auto isn't available: it unlocks only after sustained accepted-proposal rates, org opt-in, and resolved identities."
                className="cursor-not-allowed px-2 py-[2px] text-[11.5px] text-[#c9c9c9]"
              >
                Auto
              </button>
            </div>
          )}

          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger className="h-6 w-auto gap-1 rounded-sm border-[--zinc-border] px-1.5 text-[11.5px] text-muted-foreground">
              <SelectValue>{getModelLabel(model)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="rounded-sm">
              {modelOptions.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[12px]">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            title="Send"
            aria-label="Send"
            onClick={onSubmit}
            disabled={!canSend}
            className={cn(
              "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm",
              canSend ? "bg-foreground text-background" : "cursor-default bg-[#f0f0f0] text-[#b8b8b8]",
            )}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
