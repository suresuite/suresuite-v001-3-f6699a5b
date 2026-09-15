// Presentational primitives for the manual's page bodies.
//
// One set of components, one payload: DocsLayout renders these on a phone and
// on a desktop from the same tree (§6.4 — "mobile reads the same payload"). A
// second content tree for small screens is the duplication this programme
// exists to end, so nothing here branches on device; it branches on width, in
// CSS, at the single `md` breakpoint the UI spec allows.
//
// Headings: DocsLayout's "On this page" rail tracks `h3`, so `Section` renders
// h3 and takes an explicit `id`. Explicit, because the id is the deep link
// (§6.4) and an id derived from the heading text changes when the wording is
// edited — a stable URL cannot depend on prose.

import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CONTRACT_VERSION, ENGINE_VERSION } from "@/components/docs/generated/dataModel.generated";

export function PageTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <header className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{children}</h1>
      {lead && <p className="text-base text-muted-foreground md:text-lg">{lead}</p>}
    </header>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 pt-2">
      <h3 id={id} className="scroll-mt-20 text-lg font-semibold tracking-tight">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** Emphasised sentence that carries the point of the section it opens. */
export function Key({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium leading-relaxed text-foreground">{children}</p>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Term({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

type CalloutTone = "note" | "limit" | "law";

const TONE: Record<CalloutTone, { border: string; label: string }> = {
  // No colour fills: the manual is read on a projector as often as a laptop,
  // and the left rule survives both. Tone is carried by the label, not a tint.
  note: { border: "border-l-primary", label: "Note" },
  limit: { border: "border-l-destructive", label: "Limit" },
  law: { border: "border-l-foreground", label: "The rule" },
};

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <aside
      className={cn("rounded-sm border border-l-4 border-border bg-card p-4 shadow-xs", t.border)}
      role="note"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title ?? t.label}
        </span>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </aside>
  );
}

/** A numbered walkthrough. Each step names the screen it happens on. */
export function Steps({
  steps,
}: {
  steps: { title: string; where?: string; body: ReactNode }[];
}) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3 rounded-sm border border-border bg-card p-4 shadow-xs">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{s.title}</span>
              {s.where && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {s.where}
                </Badge>
              )}
            </div>
            <div className="text-sm leading-relaxed text-muted-foreground">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Term-and-meaning pairs. Stacks on a phone, two columns from `md`. */
export function Defs({ items }: { items: { term: ReactNode; def: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
      {items.map((d, i) => (
        <div key={i} className="grid grid-cols-1 gap-1 p-4 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-4">
          <dt className="text-sm font-medium text-foreground">{d.term}</dt>
          <dd className="min-w-0 text-sm leading-relaxed text-muted-foreground">{d.def}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Figure({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-sm border border-border bg-card p-4 shadow-xs">
        {children}
      </div>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

/** Link to another page of the manual. */
export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={`/docs/${to}`} className="text-primary underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/** Link to a screen in the product. */
export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-primary underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/**
 * The provenance footer every generated page carries (§6.4).
 *
 * It names the contract version, never a date. A committed generated file that
 * embeds today's date differs from itself tomorrow, so the drift gate fails on
 * every pull request for a reason no change caused — and a gate that cries wolf
 * is the gate people route around. (Corrected in WP 1.4; the rule used to say
 * "generated on date Z".)
 */
export function Provenance({ from }: { from: string }) {
  return (
    <div className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
      <p>
        Generated from {from}. Data contract <Term>{CONTRACT_VERSION}</Term>, engine{" "}
        <Term>{ENGINE_VERSION}</Term>. This page is rebuilt by{" "}
        <Term>npm run contract:generate</Term> and a difference between it and its sources
        fails CI, so what you are reading cannot drift from what the software does.
      </p>
    </div>
  );
}
