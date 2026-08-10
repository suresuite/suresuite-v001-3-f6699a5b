import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";

/**
 * §22.2 evidence part (ai-agents.md Phase H1): the reply's numbered source
 * list, assembled server-side from the turn's recorded tool calls — the
 * model never mints an entry. A verified reply renders the subtle
 * "grounded — N sources" chip (click = the list); a verifier-fallback reply
 * renders under the §17.2 errors-and-refusals treatment with its typed code.
 * Inline [n] markers in the reply bind to citations[n-1].
 */

export interface EvidenceCitation {
  kind: "tool_call" | "table_rows" | "registry" | "run" | "validation_card" | "document" | "user_message";
  ref: string;
  rows?: string[];
  quote?: string;
}

export interface EvidencePartData {
  citations: EvidenceCitation[];
  verified: boolean;
  fallback: boolean;
}

const KIND_LABELS: Record<EvidenceCitation["kind"], string> = {
  tool_call: "tool result",
  table_rows: "project rows",
  registry: "policy registry",
  run: "simulation run",
  validation_card: "validation card",
  document: "document",
  user_message: "your message",
};

function citationTarget(c: EvidenceCitation): string | null {
  // §22.2 resolver click-through: run citations deep-link to the Lab; cards
  // to the policies room. Other kinds are informational lines.
  if (c.kind === "run") return `/simulation-lab?run=${encodeURIComponent(c.ref)}`;
  if (c.kind === "validation_card") return "/policies";
  return null;
}

export function EvidenceList({ data }: { data: unknown }) {
  const payload = (data ?? {}) as Partial<EvidencePartData>;
  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  const fallback = Boolean(payload.fallback);
  const verified = Boolean(payload.verified) && !fallback;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!fallback && citations.length === 0) return null;
  const t = fallback ? PART_TREATMENTS.error : PART_TREATMENTS.evidence;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition",
          t.chip,
        )}
      >
        {fallback ? (
          <ShieldAlert className={cn("h-3.5 w-3.5", t.icon)} aria-hidden />
        ) : (
          <BadgeCheck className={cn("h-3.5 w-3.5", t.icon)} aria-hidden />
        )}
        {fallback
          ? "not_grounded: reply replaced by a verified fallback"
          : verified
            ? `grounded — ${citations.length} source${citations.length === 1 ? "" : "s"}`
            : `${citations.length} source${citations.length === 1 ? "" : "s"}`}
        {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
      </button>
      {open && (
        <div className={cn("mt-1.5 overflow-hidden", t.card)}>
          {fallback && (
            <div className="border-b border-border px-3 py-2 text-[12px] text-muted-foreground">
              The drafted reply contained claims the verifier could not trace to this
              project's data, so a grounded fallback shipped instead. The data the
              tools did return still renders above.
            </div>
          )}
          {citations.length > 0 && (
            <ol className="divide-y divide-border" aria-label="Reply sources">
              {citations.map((c, i) => {
                const target = citationTarget(c);
                return (
                  <li key={i} className="flex items-baseline gap-2 px-3 py-1.5 text-[12px]">
                    <span className={cn("shrink-0 font-mono", t.accent)}>[{i + 1}]</span>
                    <span className="shrink-0 text-muted-foreground">{KIND_LABELS[c.kind] ?? c.kind}</span>
                    {target ? (
                      <button
                        type="button"
                        onClick={() => navigate(target)}
                        className={cn("truncate font-mono underline-offset-2 hover:underline", t.accent)}
                        title={`Open ${c.ref}`}
                      >
                        {c.ref}
                      </button>
                    ) : (
                      <span className="truncate font-mono text-foreground" title={c.ref}>{c.ref}</span>
                    )}
                    {c.quote && (
                      <span className="truncate text-muted-foreground" title={c.quote}>{c.quote}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
