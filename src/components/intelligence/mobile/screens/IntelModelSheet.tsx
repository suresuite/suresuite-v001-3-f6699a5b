/**
 * SC Intelligences — intelligence & model sheet (screen 06c, handoff §Thread).
 *
 * One sheet, two sections: which of the five intelligences the next turn in
 * this thread goes to, and which model answers it. Picking an intelligence
 * here is the same "ask the other" action as the thread's own action-list
 * row — both just set the thread's active intelligence for the next send.
 */
import * as React from "react";
import { MobileSheet, MobileSheetRow } from "@/components/shared/MobileSheet";
import { useCapabilities } from "@/hooks/useCapabilities";
import { CHAT_MODELS, DEFAULT_MODEL_ID } from "@/components/chat/ModelPicker";
import { SC_INTEL } from "../intel";

export function IntelModelSheet({
  open,
  onClose,
  intelId,
  onSelectIntel,
  model,
  onSelectModel,
}: {
  open: boolean;
  onClose: () => void;
  intelId: string;
  onSelectIntel: (id: string) => void;
  model: string;
  onSelectModel: (id: string) => void;
}) {
  const { isModelAllowed } = useCapabilities();

  return (
    <MobileSheet open={open} title="Intelligence & model" onClose={onClose}>
      <div className="border-b-4 border-[#f4f4f4]">
        <div className="px-3 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8a8a]">
          Intelligence
        </div>
        {SC_INTEL.map((a) => (
          <MobileSheetRow
            key={a.id}
            mono={a.badge}
            monoColor={a.fg}
            title={a.name}
            meta={a.remit}
            checked={a.id === intelId}
            onClick={() => {
              onSelectIntel(a.id);
              onClose();
            }}
          />
        ))}
      </div>

      <div>
        <div className="px-3 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8a8a]">
          Model
        </div>
        {CHAT_MODELS.map((m) => {
          const gate = isModelAllowed(m.id);
          return (
            <MobileSheetRow
              key={m.id}
              title={m.label}
              tag={m.id === DEFAULT_MODEL_ID ? "default" : gate.ok ? undefined : "not enabled"}
              tagTone={gate.ok ? "neutral" : "warn"}
              checked={m.id === model}
              disabled={!gate.ok}
              hint={!gate.ok ? gate.reason : undefined}
              onClick={() => {
                if (!gate.ok) return;
                onSelectModel(m.id);
                onClose();
              }}
            />
          );
        })}
      </div>

      <p className="px-3 py-3 text-[12px] leading-[1.5] text-[#525252] [text-wrap:pretty]">
        The model changes from the next turn — the intelligence's remit and what it may read do not
        change with it.
      </p>
    </MobileSheet>
  );
}
