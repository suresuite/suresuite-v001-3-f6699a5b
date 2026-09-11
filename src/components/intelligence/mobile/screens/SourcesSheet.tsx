/**
 * SC Intelligences — sources (screen 07, handoff §2/§6.3).
 *
 * Numbered to match the answer's citation marks, credibility per row, ending
 * in the implied next action rather than a bare "Done".
 */
import * as React from "react";
import { MobileSheet } from "@/components/shared/MobileSheet";
import { MobileButton } from "@/components/mobile";
import { CredibilityChip } from "../primitives";

export interface SourceCitation {
  kind?: string;
  label?: string;
  ref?: string;
}

export function SourcesSheet({
  open,
  citations,
  onClose,
  onOpenArtifact,
}: {
  open: boolean;
  citations: SourceCitation[];
  onClose: () => void;
  /** The implied action — opening the artefact the sources point at. Absent
   *  when the citations don't resolve to one navigable surface. */
  onOpenArtifact?: () => void;
}) {
  return (
    <MobileSheet
      open={open}
      title="Sources"
      sub={`${citations.length} ${citations.length === 1 ? "source" : "sources"} behind this answer`}
      onClose={onClose}
      footer={
        onOpenArtifact && (
          <MobileButton block weight="primary" onClick={onOpenArtifact}>
            Open the artefact
          </MobileButton>
        )
      }
    >
      {citations.map((c, i) => (
        <div key={i} className="flex items-start gap-2.5 border-b border-[#e8e8ea] px-3 py-2.5 last:border-b-0">
          <span className="mt-0.5 font-mono text-[11px] font-semibold text-[#bf2330]">[{i + 1}]</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13.5px] font-medium text-[#171717]">
              {c.label ?? c.kind ?? "Source"}
            </span>
            {c.ref && <span className="font-mono text-[10.5px] text-[#525252]">{c.ref}</span>}
          </span>
          <CredibilityChip status="validated">validated</CredibilityChip>
        </div>
      ))}
    </MobileSheet>
  );
}
