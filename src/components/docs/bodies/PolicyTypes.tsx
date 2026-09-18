// §6.3 section 5 — Policy types. Marked G* : generated from the engine registry.
//
// Every type, every parameter, every unit, range, default and enum below comes
// from `registryPolicyTypes.ts`, which reads `registry.generated.json` — the
// engine's own export. §3 and blueprint §6.2 make that the single source of
// truth for policy schemas, and hand-writing a parallel one is exactly what the
// archived manual did (§6.1 (b)).

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { policyCategories, type RegistryParam } from "@/lib/policies/registryPolicyTypes";
import { chainFor } from "@/components/docs/stageFacts";

function Param({ p }: { p: RegistryParam }) {
  return (
    <div className="border-t border-border py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium text-foreground">{p.label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{p.field}</span>
        {p.unit && p.unit !== "-" && (
          <span className="text-[11px] text-muted-foreground">in {p.unit}</span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
        {p.notes ?? (p.enum ? `One of: ${p.enum.join(", ")}.` : `A ${p.type}.`)}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        <span className="text-foreground">If you leave it blank:</span>{" "}
        {p.default === undefined ? (
          <span className="text-destructive">not declared in the registry.</span>
        ) : (
          <>
            <Term>{String(p.default)}</Term>, the registry's declared default
          </>
        )}
        {(p.min !== undefined || p.max !== undefined) && (
          <>
            {" "}
            · accepted range {p.min ?? "−∞"} to {p.max ?? "∞"}
          </>
        )}
      </p>
    </div>
  );
}

export default function PolicyTypes() {
  const categories = policyCategories();
  // The two fields whose chains break in the inventory family. Named by the
  // derivation, not by this page — if either is ever wired, the warning below
  // disappears on its own.
  const rop = chainFor("plant", "reorder_point");
  const oup = chainFor("plant", "order_up_to");

  return (
    <>
      <PageTitle lead="Min-max, base stock, (R, Q) and periodic review — and which parameters each one actually uses.">
        Policy types
      </PageTitle>

      <Section id="what-a-type-is" title="What a policy type is">
        <P>
          A replenishment policy answers two questions: <em>when do we order</em>, and{" "}
          <em>how much</em>. Different types answer them differently, and each one needs a different
          set of numbers from you. Choosing the type is what decides which parameters appear.
        </P>
        <Key>
          The types, their parameters and every default below are read from the engine's own export.
          If the engine gains a parameter, it appears here without anyone editing this page.
        </Key>
      </Section>

      {categories.map((cat) => (
        <Section key={cat.key} id={cat.key} title={cat.label}>
          {cat.types[0]?.summary && <P>{cat.types[0].summary}</P>}
          <div className="space-y-4">
            {cat.types.map((t) => (
              <div key={t.value} id={`type-${t.value}`} className="scroll-mt-20 rounded-sm border border-border bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{t.label}</span>
                  <Badge variant={t.status === "implemented" ? "secondary" : "outline"} className="text-[10px]">
                    {t.status}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {cat.discriminator} = {t.value}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Parameters this type uses
                  </div>
                  {[...t.headline, ...t.rest].map((p) => (
                    <Param key={p.field} p={p} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}

      {(rop?.breaks.length || oup?.breaks.length) && (
        <Callout tone="limit" title="Two of these parameters do not change a run">
          <p>
            The grid accepts them, stores them, versions them and hashes them into the policy
            fingerprint. The simulation does not consult them.
          </p>
          {rop?.breaks.length ? (
            <p>
              <Term>reorder_point</Term> — the engine computes the reorder point itself from the
              average lead time, the average demand and the safety stock. Whatever you type here is
              replaced before the run starts.
            </p>
          ) : null}
          {oup?.breaks.length ? (
            <p>
              <Term>order_up_to</Term> — read only by the older simulation engine, which is frozen.
              The strategic engine replaces it with a coverage-based target.
            </p>
          ) : null}
          <p>
            Both stay on screen rather than being hidden, because a parameter that silently
            disappears is harder to reason about than one that is labelled. Their full path, with a
            file and line, is on{" "}
            <DocLink to="plant-stage">Plant stage</DocLink> and{" "}
            <DocLink to="supplier-stage">Supplier stage</DocLink>.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="policy-catalog">The policy catalog</DocLink> ·{" "}
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="plant-stage">Plant stage</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry export (registry.generated.json) and the frontend schemas for the fields it does not declare" />
    </>
  );
}
