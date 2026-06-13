import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CHAT_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "fast (default)" },
  { id: "gpt-5", label: "GPT-5", hint: "highest quality" },
  { id: "gpt-5-mini", label: "GPT-5 mini", hint: "balanced" },
  { id: "deepseek-chat", label: "DeepSeek", hint: "experimental" },
] as const;

export const DEFAULT_MODEL_ID = "gemini-2.5-flash";

export function getStoredModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;
  const v = window.localStorage.getItem("projectChat.model");
  return v && CHAT_MODELS.some((m) => m.id === v) ? v : DEFAULT_MODEL_ID;
}

export function setStoredModel(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("projectChat.model", id);
}

export function getModelLabel(id: string): string {
  return CHAT_MODELS.find((m) => m.id === id)?.label ?? id;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto gap-1 border-border/60 bg-background/80 px-2 text-[11px] font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[220px]">
        {CHAT_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            <span className="font-medium">{m.label}</span>
            <span className="ml-1 text-muted-foreground">· {m.hint}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
