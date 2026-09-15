// The route element behind /docs/:slug.
//
// Three cases, and all three are deliberate:
//   · a live page    → its body
//   · a planned page → a stub naming the work package that owes it
//   · an unknown slug → a "no such page" panel that stays inside the manual
//
// The stub is the interesting one. A site map that hid its unwritten pages
// would be a smaller, tidier manual that quietly misrepresents itself — the
// reader cannot tell "this product has no audit log" from "that page is not
// written yet". Naming the owing package makes the absence a fact rather than
// a silence (§5.3 T3).

import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PageTitle, P, Key, DocLink } from "@/components/docs/prose";
import { ALL_PAGES, DEFAULT_SLUG, getGroup, getPage } from "@/components/docs/registry";
import { DOC_BODIES } from "@/components/docs/bodies";

function Stub({ slug }: { slug: string }) {
  const page = getPage(slug);
  if (!page) return null;
  const group = getGroup(page.section);
  const siblingsLive = (group?.pages ?? []).filter((p) => p.status === "live");

  return (
    <>
      <PageTitle lead={page.summary}>{page.title}</PageTitle>

      <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">Not written yet</Badge>
          {page.wp && <Badge variant="secondary">WP {page.wp}</Badge>}
        </div>
        <Key>
          This page is planned and not yet written
          {page.wp ? `. Work package ${page.wp} ships it.` : "."}
        </Key>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          It is listed in the navigation rather than left out so that you can tell the difference
          between a feature this product does not have and a page this manual has not written. The
          software behind it works; the explanation is what is missing.
        </p>
      </div>

      {group && (
        <div className="space-y-2">
          <P>
            <strong className="text-foreground">{group.group}</strong> — {group.blurb}
          </P>
          {siblingsLive.length > 0 && (
            <P>
              Written so far in this section:{" "}
              {siblingsLive.map((s, i) => (
                <span key={s.slug}>
                  {i > 0 && ", "}
                  <DocLink to={s.slug}>{s.title}</DocLink>
                </span>
              ))}
              .
            </P>
          )}
        </div>
      )}

      <P>
        In the meantime, <DocLink to="data-model">The data model at a glance</DocLink> lists every
        table in the system, and <DocLink to="known-limits">Known limits</DocLink> records what the
        product does not do.
      </P>
    </>
  );
}

function Unknown({ slug }: { slug: string }) {
  return (
    <>
      <PageTitle lead="There is no page at this address.">Page not found</PageTitle>
      <P>
        The manual has no page with the address{" "}
        <code className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[12px]">
          {slug}
        </code>
        . It may have been renamed, or the link may be from an older version of the site.
      </P>
      <P>
        Every page the manual will ever have is in the navigation, including the ones not yet
        written — so if it is not there, it was never here. Start at{" "}
        <DocLink to={DEFAULT_SLUG}>{getPage(DEFAULT_SLUG)?.title}</DocLink>, or use the search box
        above, which covers all {ALL_PAGES.length} pages.
      </P>
    </>
  );
}

export default function DocPage() {
  const params = useParams();
  const slug = params.slug ?? DEFAULT_SLUG;
  const page = getPage(slug);

  if (!page) return <Unknown slug={slug} />;

  const Body = DOC_BODIES[slug];
  if (page.status !== "live" || !Body) return <Stub slug={slug} />;

  return <Body />;
}
