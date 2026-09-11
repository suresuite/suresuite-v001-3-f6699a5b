/**
 * SC Intelligences — new question (screen 03, handoff §2/§6).
 *
 * Routing is shown before send and is always overridable: the composer picks
 * a specialist the way the old picker picked a persona, except the choice is
 * now one of the five intelligences rather than a free-form chat persona.
 */
import * as React from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { MobilePageHeader } from "@/components/mobile";
import { IntelBadge } from "../primitives";
import { SC_INTEL } from "../intel";
import { AttachContextSheet, type AttachedItem } from "./AttachContextSheet";
import { cn } from "@/lib/utils";

export interface NewQuestionProps {
  projectId: string | null;
  onBack: () => void;
  onSend: (text: string, intelId: string, attached: AttachedItem[]) => void;
  defaultIntelId?: string;
}

export function NewQuestion({ projectId, onBack, onSend, defaultIntelId }: NewQuestionProps) {
  const [intelId, setIntelId] = React.useState(defaultIntelId ?? SC_INTEL[0].id);
  const [input, setInput] = React.useState("");
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [attached, setAttached] = React.useState<AttachedItem[]>([]);

  const canSend = input.trim().length > 0;
  const submit = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text, intelId, attached);
  };

  return (
    <div className="flex h-[calc(100svh-var(--pi-chrome,170px))] min-h-[420px] flex-col overflow-hidden bg-white">
      <MobilePageHeader variant="detail" title="New question" onBack={onBack} />

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--m-gutter)] py-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a8a]">
          routed to
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SC_INTEL.map((a) => {
            const active = a.id === intelId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setIntelId(a.id)}
                className={cn(
                  "flex min-h-[36px] items-center gap-1.5 rounded-[4px] border px-2 py-1",
                  active ? "border-[#18181b] bg-[#18181b]" : "border-[#d4d4d4] bg-white",
                )}
              >
                <IntelBadge id={a.id} />
                <span className={cn("text-[12.5px] font-medium", active ? "text-white" : "text-[#171717]")}>
                  {a.name}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12.5px] leading-[1.5] text-[#525252]">
          {SC_INTEL.find((a) => a.id === intelId)?.remit}
        </p>

        {attached.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {attached.map((a, i) => (
              <span
                key={i}
                className="rounded-[4px] border border-[#d4d4d4] bg-white px-2 py-1 font-mono text-[10.5px] text-[#525252]"
              >
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#ebebeb] bg-[#f6f6f6] px-4 pb-[14px] pt-[9px]">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setAttachOpen(true)}
            aria-label={attached.length > 0 ? `Attach ${attached.length}` : "Attach context"}
            title="Attach context"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] border border-[#d4d4d4] bg-white text-[#525252]"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this project…"
            className="min-h-11 flex-1 resize-none rounded-[4px] border border-[#d4d4d4] bg-white px-3 py-[11px] text-[14px] leading-[1.4] text-[#171717] outline-none placeholder:text-[#9a9a9a]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-[4px]",
              canSend ? "bg-[#18181b] text-white" : "bg-[#e4e4e4] text-[#9a9a9a]",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AttachContextSheet
        open={attachOpen}
        projectId={projectId}
        selected={attached}
        onClose={() => setAttachOpen(false)}
        onAttach={(items) => {
          setAttached(items);
          setAttachOpen(false);
        }}
      />
    </div>
  );
}
