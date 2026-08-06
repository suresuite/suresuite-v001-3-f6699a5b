// Per-parameter transparency side-sheet (Phase D / 6.B / §II.6, §III/§IV).
//
// Opened from a grid column header, it answers — for that one parameter —
// symbol · unit · range · default · meaning + the decision-rule the engine
// executes, and states plainly whether the engine consumes it or only stores
// it for now. Everything is drawn from the spec-grounded paramMeta catalog;
// nothing here is asserted per-project.
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { KX_TIGHT, MonoChip, StatusDot, SURFACE, TD } from "@/components/intelligence/piUi";
import type { ColSpec } from "@/lib/policies/columnSpecs";
import { resolveParamMeta } from "@/lib/policies/paramMeta";

function fmtDefault(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td
        className={cn(
          TD,
          "w-24 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
        )}
      >
        {label}
      </td>
      <td className={cn(TD, "font-mono text-[11.5px]")}>{children}</td>
    </tr>
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
      <SheetContent className="w-[392px] overflow-y-auto sm:max-w-[392px]">
        {meta && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-[13px]">
                {meta.label}
                {meta.symbol && <MonoChip color="#111111">{meta.symbol}</MonoChip>}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-3 flex flex-col gap-3">
              {/* Consumed vs stored-only — the headline "does it matter?". */}
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                <StatusDot ok={consumed} pending={!consumed} />
                {consumed
                  ? meta.isMaster
                    ? "reaches engine · from item master"
                    : "reaches engine"
                  : meta.engine.state === "pending"
                    ? `stored only · activates with ${meta.engine.milestone}`
                    : "stored only · not consumed yet"}
              </span>

              {/* Facts. */}
              <div className={cn(SURFACE, "overflow-hidden")}>
                <table className="w-full">
                  <tbody>
                    {meta.unit && <Fact label="Unit">{meta.unit}</Fact>}
                    {meta.range && <Fact label="Range">{meta.range}</Fact>}
                    <Fact label="Default">{fmtDefault(meta.defaultValue)}</Fact>
                    <Fact label="Source">{meta.isMaster ? "item master" : meta.family}</Fact>
                    {meta.specRef && <Fact label="Spec">{meta.specRef}</Fact>}
                  </tbody>
                </table>
              </div>

              {/* Meaning. */}
              <div className="flex flex-col gap-1">
                <span className={KX_TIGHT}>What it means</span>
                <p className="text-[12.5px] leading-relaxed">{meta.meaning}</p>
              </div>

              {/* Decision rule / formula. */}
              {meta.formula && (
                <div className="flex flex-col gap-1">
                  <span className={KX_TIGHT}>Decision rule</span>
                  <pre className="whitespace-pre-wrap break-words rounded-sm border border-[#ebebeb] bg-[#fafafa] px-2.5 py-2 font-mono text-[11px]">
                    {meta.formula}
                  </pre>
                </div>
              )}

              {/* Enum choices, if any. */}
              {meta.options && meta.options.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className={KX_TIGHT}>Choices</span>
                  <div className={cn(SURFACE, "overflow-hidden")}>
                    <table className="w-full">
                      <tbody>
                        {meta.options.map((o) => (
                          <tr key={o.value}>
                            <td className={cn(TD, "w-32 font-mono text-[11px]")}>{o.value}</td>
                            <td className={cn(TD, "text-[12px] text-muted-foreground")}>
                              {o.meaning}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
