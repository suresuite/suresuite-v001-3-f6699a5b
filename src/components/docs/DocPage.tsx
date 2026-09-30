// The route element behind /docs/:slug.
//
// Four cases, and all four are deliberate:
//   · a live page    → its body
//   · a planned page → a stub naming the work package that owes it
//   · an unknown slug → a "no such page" panel that stays inside the manual
//   · a page in a section not released to this reader → says so, and how to
//     get it (sign in, or ask an administrator) — docsVisibility.ts
//
// The stub is the interesting one. A site map that hid its unwritten pages
// would be a smaller, tidier manual that quietly misrepresents itself — the
// reader cannot tell "this product has no audit log" from "that page is not
// written yet". Naming the owing package makes the absence a fact rather than
// a silence (§5.3 T3).

import { Link, useLocation, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
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

/**
 * A page in a section this reader may not open. Said plainly rather than
 * answered with /forbidden or a 404: the page exists, the section has not been
 * released to them, and the two things they can do about it are named.
 */
function NotReleased({ slug }: { slug: string }) {
  const page = getPage(slug);
  const { user } = useAuth();
  const location = useLocation();
  if (!page) return null;
  return (
    <>
      <PageTitle lead={`Part of ${page.group}.`}>{page.title}</PageTitle>
      <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">Not available to you</Badge>
        </div>
        <Key>
          {user
            ? "This section of the manual has not been released to your account."
            : "This section of the manual is open to signed-in users only."}
        </Key>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The manual is released section by section.{" "}
          {user
            ? "If you need it, ask your administrator for access."
            : "Sign in to see whether your account can read it."}
        </p>
        {!user && (
          <Button asChild size="sm" className="mt-3">
            <Link to="/auth" state={{ from: location }}>Sign in</Link>
          </Button>
        )}
      </div>
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
  const { docs } = useCapabilities();

  if (!page) return <Unknown slug={slug} />;
  if (!docs.canReadSection(page.sectionKey)) return <NotReleased slug={slug} />;

  const Body = DOC_BODIES[slug];
  if (page.status !== "live" || !Body) return <Stub slug={slug} />;

  return <Body />;
}
