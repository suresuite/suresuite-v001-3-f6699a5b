// Per-parameter transparency side-sheet (Phase D / 6.B / §II.6, §III/§IV).
//
// Opened from a grid column header, it answers — for that one parameter —
// symbol · unit · range · default · meaning + the decision-rule the engine
// executes, and states plainly whether the engine consumes it (✅) or only
// stores it for now (🧩). Everything is drawn from the spec-grounded
// paramMeta catalog; nothing here is asserted per-project.
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Puzzle, Sigma } from "lucide-react";
import type { ColSpec } from "@/lib/policies/columnSpecs";
import { resolveParamMeta } from "@/lib/policies/paramMeta";

function fmtDefault(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 border-b last:border-b-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}

export function ParameterSheet({
  col,
  open,
  onOpenChange,
}: {
  col: ColSpec | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const meta = col ? resolveParamMeta(col) : null;
  const consumed = meta?.engine.state === "reaches-engine";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        {meta && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {meta.label}
                {meta.symbol && (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-primary">
                    {meta.symbol}
                  </code>
                )}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {meta.family} policy parameter{meta.specRef ? ` · ${meta.specRef}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-col gap-4">
              {/* Consumed vs stored-only — the headline "does it matter?". */}
              <div
                className={
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-xs " +
                  (consumed
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-amber-500/40 bg-amber-500/10")
                }
              >
                {consumed ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Puzzle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div>
                  <div className="font-semibold">
                    {consumed ? "Consumed by the engine" : "Stored only — not yet consumed"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {consumed
                      ? meta.isMaster
                        ? "The engine reads this value from the item master."
                        : "This value reaches the scsim engine and changes results."
                      : meta.engine.state === "pending"
                      ? `Saved & versioned now; activates when its catalog policy lands (${meta.engine.milestone}).`
                      : "Saved & versioned, but the engine does not read it yet."}
                  </div>
                </div>
              </div>

              {/* Facts table. */}
              <div className="rounded-md border px-3 py-1">
                {meta.unit && <Row label="Unit">{meta.unit}</Row>}
                {meta.range && <Row label="Range">{meta.range}</Row>}
                <Row label="Default">
                  <code className="font-mono text-[11px]">{fmtDefault(meta.defaultValue)}</code>
                </Row>
                {meta.isMaster && <Row label="Source">item master</Row>}
              </div>

              {/* Meaning. */}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  What it means
                </div>
                <p className="text-xs leading-relaxed">{meta.meaning}</p>
              </div>

              {/* Decision rule / formula. */}
              {meta.formula && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <Sigma className="h-3 w-3" /> Decision rule
                  </div>
                  <pre className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-words">
                    {meta.formula}
                  </pre>
                </div>
              )}

              {/* Enum choices, if any. */}
              {meta.options && meta.options.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    Choices
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {meta.options.map((o) => (
                      <li key={o.value} className="text-xs">
                        <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
                          {o.value}
                        </Badge>
                        <span className="text-muted-foreground">{o.meaning}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
