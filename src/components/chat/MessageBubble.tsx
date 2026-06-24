import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/hooks/useProjectChat";
import { DataTable } from "./DataTable";
import { KpiCards } from "./KpiCards";
import { BulletList } from "./BulletList";
import { ToolCallBadge } from "./ToolCallBadge";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0">
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
          </>
        )}
      </div>
    </div>
  );
}
