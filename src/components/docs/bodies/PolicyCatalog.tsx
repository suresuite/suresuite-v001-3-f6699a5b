// §6.3 section 5 — the policy catalog. Marked G*.
//
// The whole catalog is read from the engine registry. §6.6 is explicit that the
// policy catalogue must NOT be mined from the archived manual — "already in
// registry.generated.json and rendered by gen_docs.py, which is precisely why
// the hand copy drifted". This page renders the export.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { policyCatalog, engineVersion, type RegistryPolicy } from "@/lib/policies/registryAccess";

/** §4.2's prefixes, as the catalog references themselves spell them. */
const STAGE_TITLE: Record<string, string> = {
  supplier: "Supplier",
  plant: "Plant",
  transport: "Transport",
  customer: "Customer",
  cross: "Cross-cutting",
};

function PolicyCard({ p }: { p: RegistryPolicy }) {
  const params = Object.keys(p.params_schema?.properties ?? {});
  return (
    <div id={p.id} className="scroll-mt-20 rounded-sm border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        {p.catalog_ref && (
          <span className="font-mono text-[11px] font-semibold text-foreground">{p.catalog_ref}</span>
        )}
        <span className="text-sm font-semibold text-foreground">
          {p.id.replace(/_/g, " ")}
        </span>
        <Badge variant={p.status === "implemented" ? "secondary" : "outline"} className="text-[10px]">
          {p.status}
        </Badge>
      </div>
      {p.summary && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{p.summary}</p>
      )}
      {params.length > 0 && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {params.length} parameter{params.length === 1 ? "" : "s"}:{" "}
          {params.map((f, i) => (
            <span key={f}>
              {i > 0 && ", "}
              <Term>{f}</Term>
            </span>
          ))}
        </p>
      )}
      {p.milestone && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">Milestone: {p.milestone}</p>
      )}
    </div>
  );
}

export default function PolicyCatalog() {
  const all = policyCatalog();
  const stages = [...new Set(all.map((p) => p.stage))];
  const implemented = all.filter((p) => p.status === "implemented").length;

  return (
    <>
      <PageTitle lead="Every policy the engine knows about, whether or not it is built yet.">
        The policy catalog
      </PageTitle>

      <Section id="how-to-read-this" title="How to read this page">
        <Key>
          {all.length} policies, of which {implemented} are implemented and {all.length - implemented}{" "}
          are planned. Engine <Term>{engineVersion()}</Term>.
        </Key>
        <P>
          A <em>planned</em> policy is in the catalog and not in the engine. It is listed rather than
          hidden so that the answer to “does this tool model X” is a fact you can read rather than a
          silence you have to interpret. Nothing on this page is a roadmap commitment; it is the
          state of the engine's own declaration.
        </P>
        <Callout title="This page is generated, and that is the point">
          <p>
            The archived manual carried a hand-copied policy catalogue, and it drifted from the
            engine within a quarter. This one is read from the engine's export, so a policy that is
            added, implemented or renamed changes here with no one editing a page.
          </p>
        </Callout>
      </Section>

      {stages.map((s) => {
        const rows = all.filter((p) => p.stage === s);
        return (
          <Section key={s} id={`stage-${s}`} title={`${STAGE_TITLE[s] ?? s} — ${rows.length}`}>
            <div className="space-y-3">
              {rows.map((p) => (
                <PolicyCard key={p.id} p={p} />
              ))}
            </div>
          </Section>
        );
      })}

      <Section id="related" title="Related">
        <P>
          <DocLink to="policy-types">Policy types</DocLink> ·{" "}
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink> ·{" "}
          <DocLink to="recovery-playbooks">Recovery playbooks</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry export (registry.generated.json)" />
    </>
  );
}
