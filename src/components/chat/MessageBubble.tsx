import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/hooks/useProjectChat";
import { DataTable } from "./DataTable";
import { KpiCards } from "./KpiCards";
import { BulletList } from "./BulletList";
import { ToolCallBadge } from "./ToolCallBadge";
import { AssistantMascot } from "./AssistantMascot";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <AssistantMascot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
        <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:mt-2 prose-headings:mb-1 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none">
          <ReactMarkdown>{message.content || "_(no response)_"}</ReactMarkdown>
        </div>
        {message.parts?.map((p, i) => {
          if (p.kind === "table") return <DataTable key={i} data={p.data} />;
          if (p.kind === "kpi") return <KpiCards key={i} data={p.data} />;
          if (p.kind === "bullets") return <BulletList key={i} data={p.data} />;
          return null;
        })}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallBadge calls={message.toolCalls} />
        )}
      </div>
    </div>
  );
}
