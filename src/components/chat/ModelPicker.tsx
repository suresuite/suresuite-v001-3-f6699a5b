import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CHAT_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "deepseek-chat", label: "DeepSeek" },
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
  className?: string;
}

export function ModelPicker({ value, onChange, className }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={`h-8 w-auto gap-1 rounded-md border-border bg-transparent px-2 text-[12px] font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus:ring-0 ${className ?? ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="z-[110] min-w-[200px]">
        {CHAT_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-[13px]">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
