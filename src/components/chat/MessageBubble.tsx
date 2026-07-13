import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/hooks/useProjectChat";
import { DataTable } from "./DataTable";
import { KpiCards } from "./KpiCards";
import { BulletList } from "./BulletList";
import { ToolCallBadge } from "./ToolCallBadge";
import { ProposalCard } from "./ProposalCard";
import { MemoryChip, type MemoryOfferData } from "./MemoryChip";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-foreground px-3.5 py-2 text-[14px] leading-relaxed text-background">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full text-[14px] leading-relaxed text-foreground">
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-pre:bg-surface-elevated prose-pre:border prose-pre:border-border prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12.5px] prose-code:font-mono">
          <ReactMarkdown>{message.content || "_(no response)_"}</ReactMarkdown>
        </div>
        {message.parts?.map((p, i) => {
          if (p.kind === "table") return <DataTable key={i} data={p.data} />;
          if (p.kind === "kpi") return <KpiCards key={i} data={p.data} />;
          if (p.kind === "bullets") return <BulletList key={i} data={p.data} />;
          if (p.kind === "proposal") {
            return <ProposalCard key={i} proposalId={(p.data as { proposal_id?: string })?.proposal_id} />;
          }
          // M2 (ai-agents.md §14.4): the server-emitted memory chip offer —
          // nothing is stored until the user clicks Save. memory_saved parts
          // need no card: the reply text already carries the confirmation.
          if (p.kind === "memory_offer") {
            return <MemoryChip key={i} offer={p.data as MemoryOfferData} />;
          }
          return null;
        })}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallBadge calls={message.toolCalls} />
        )}
      </div>
    </div>
  );
}
