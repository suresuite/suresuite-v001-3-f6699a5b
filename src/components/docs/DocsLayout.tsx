// Dedicated, full-screen documentation chrome for the /docs manual — modelled
// on a classic three-pane docs layout: top bar (search · theme · font-size),
// collapsible left nav tree, center content (breadcrumb + Outlet + prev/next),
// and a right "On this page" + "Related" rail. No app shell.
//
// Page bodies arrive through <Outlet/>; `registry.ts` owns the site map and
// `DocPage.tsx` resolves a slug to a body or to a stub. WP 5.2a restored the
// routes, moved the manual to /docs (PLAN.md §6 names it that throughout; the
// old address still redirects so no existing link breaks) and taught the nav
// and the search to show a page that is planned but not yet written.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
import {
  Search, ChevronRight, ArrowLeft, ArrowRight, X,
  PanelLeftClose, PanelLeftOpen, BookText,
} from "lucide-react";
import {
  ALL_PAGES, DEFAULT_SLUG, DOC_GROUPS, getPage, prevNext, searchPages,
} from "@/components/docs/registry";

const FONT_STEPS = [0.92, 1, 1.12];
const FONT_KEY = "docs-font-step";

function slugify(s: string) {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) ||
    "section"
  );
}

type Heading = { id: string; text: string };

/** Collect h3 headings from the rendered content and track the active one. */
function useHeadings(ref: React.RefObject<HTMLElement>, dep: string) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll("h3")) as HTMLElement[];
    const used = new Set<string>();
    const list: Heading[] = els.map((el) => {
      let id = el.id;
      if (!id) {
        const base = slugify(el.textContent || "section");
        let candidate = base;
        let n = 2;
        while (used.has(candidate)) candidate = `${base}-${n++}`;
        id = candidate;
        el.id = id;
      }
      used.add(id);
      el.style.scrollMarginTop = "84px";
      return { id, text: el.textContent || "" };
    });
    setHeadings(list);
    setActiveId(list[0]?.id ?? "");
    if (!list.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId((visible[0].target as HTMLElement).id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ref, dep]);

  return { headings, activeId };
}

function FontSizeControl({
  step,
  setStep,
}: {
  step: number;
  setStep: (n: number) => void;
}) {
  return (
    <div className="flex items-center rounded-md border bg-background" title="Text size">
      <button
        type="button"
        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label="Smaller text"
        disabled={step <= 0}
        onClick={() => setStep(Math.max(0, step - 1))}
      >
        A
      </button>
      <span className="h-4 w-px bg-border" />
      <button
        type="button"
        className="px-2 py-1 text-base text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label="Larger text"
        disabled={step >= FONT_STEPS.length - 1}
        onClick={() => setStep(Math.min(FONT_STEPS.length - 1, step + 1))}
      >
        A
      </button>
    </div>
  );
}

function DocsSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchPages(q), [q]);

  function go(slug: string) {
    navigate(`/docs/${slug}`);
    setQ("");
    setOpen(false);
  }

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0].slug);
            if (e.key === "Escape") {
              setQ("");
              setOpen(false);
            }
          }}
          placeholder="Search the docs…"
          className="pl-8 h-9"
        />
        {q && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
            onClick={() => setQ("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && q && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No matches.</div>
          ) : (
            <ul className="max-h-80 overflow-auto py-1">
              {results.map((r) => (
                <li key={r.slug}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted/60"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(r.slug);
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 text-sm font-medium">{r.title}</span>
                      {r.status === "planned" && (
                        <span className="shrink-0 w-24 text-right text-[10px] text-muted-foreground">
                          WP {r.wp}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.group}
                      {r.summary ? ` · ${r.summary}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NavTree({ activeSlug, onNavigate }: { activeSlug: string; onNavigate: () => void }) {
  // Fifteen sections and eighty pages do not fit on a screen, so only the
  // section you are reading opens by default. `collapsed` holds the reader's
  // own overrides on top of that, which is why it is keyed by group and starts
  // empty rather than being seeded with fourteen `true`s.
  // Falls back to 1 so an unknown slug still shows an open section rather than
  // fifteen closed ones — the reader who mistyped a URL needs the nav most.
  const activeSection = getPage(activeSlug)?.section ?? 1;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <nav className="text-sm">
      <ul className="space-y-4">
        {DOC_GROUPS.map((g) => {
          const isCollapsed = collapsed[g.group] ?? g.section !== activeSection;
          return (
            <li key={g.group}>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [g.group]: !c[g.group] }))
                }
                className="flex items-center gap-1.5 w-full text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />
                <span className="tabular-nums">{g.section}</span>
                <span className="min-w-0 text-left">{g.group}</span>
              </button>
              {!isCollapsed && (
                <ul className="mt-1.5 space-y-0.5">
                  {g.pages.map((p) => {
                    const active = p.slug === activeSlug;
                    return (
                      <li key={p.slug}>
                        <Link
                          to={`/docs/${p.slug}`}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-baseline gap-2 rounded-sm border-l-2 pl-3 pr-2 py-1 transition-colors",
                            active
                              ? "border-l-primary bg-primary/5 text-foreground font-medium"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                        >
                          <span className="min-w-0">{p.title}</span>
                          {p.status === "planned" && (
                            // Not a dead link and not a hidden one: the page is
                            // owed, and by whom.
                            <span
                              className="shrink-0 w-10 text-right text-[10px] tabular-nums text-muted-foreground/70"
                              title={`Not written yet — work package ${p.wp}`}
                            >
                              {p.wp}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The public site's own top bar, above the manual's.
 *
 * /docs is a public address reached from the same nav as /about and /, so it
 * wears the same chrome: a reader who followed "Docs" from the landing page
 * should not feel they have been handed off to a different product, and a
 * reader who arrived from a search result needs a way INTO the product that a
 * bare docs toolbar never gave them.
 *
 * Deliberately NOT sticky, unlike the landing page's. The manual's own toolbar
 * carries the search box and is sticky at top-0, and two stacked sticky bars
 * would cost 7rem of a phone screen on every scroll. This one scrolls away;
 * the one that does the work stays.
 *
 * The right-hand pair depends on who is reading. Signed out, it is the public
 * site's "Log in / Get started". Signed in, offering "Get started" to someone
 * with an account would be a dead end, so it becomes the way back to their
 * workspace. While the session is still resolving it renders neither rather
 * than guessing and swapping under the reader's cursor.
 */
function PublicBar() {
  const { user, loading } = useAuth();
  const { homePath } = useCapabilities();

  return (
    <div className="border-b border-[--hair-rule] bg-background">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 md:h-16 md:px-6">
        <Link to="/" className="flex items-center" aria-label="SuReSuite home">
          <img
            src="/logo-mark.png"
            alt="SuReSuite — Supply Chain Resilience Suite"
            className="h-[19px] w-auto object-contain md:hidden"
          />
          <img
            src="/logo-lockup.png"
            alt="SuReSuite — Supply Chain Resilience Suite"
            className="hidden h-[58px] object-contain md:block"
          />
        </Link>
        <nav className="flex items-center gap-1 whitespace-nowrap md:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex md:h-8">
            <Link to="/about">About</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="hidden md:inline-flex md:h-8">
            <Link to="/docs">Docs</Link>
          </Button>
          {!loading &&
            (user ? (
              <Button asChild size="sm" className="h-11 whitespace-nowrap md:h-8">
                <Link to={homePath}>Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex md:h-8">
                  <Link to="/auth">Log in</Link>
                </Button>
                <Button asChild size="sm" className="h-11 whitespace-nowrap md:h-8">
                  <Link to="/auth">Get started</Link>
                </Button>
              </>
            ))}
        </nav>
      </div>
    </div>
  );
}

/** The slim footer Landing and About both end on. Same reason as PublicBar. */
function PublicFooter() {
  return (
    <footer className="border-t border-[--hair-rule]">
      <div className="pb-safe mx-auto flex min-h-14 max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 text-xs text-muted-foreground md:px-6">
        <span>© {new Date().getFullYear()} SuReSuite</span>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/about" className="hover:text-foreground">About</Link>
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}

export default function DocsLayout() {
  const location = useLocation();
  // Read from the path, not from useParams: this is the PARENT of the
  // `:slug` route, and a parent match does not carry its child's params.
  // DocPage — the child — reads the param the ordinary way.
  const rawSlug = location.pathname.replace(/^\/docs\/?/, "").split("/")[0];
  // `/docs` itself is the front door (DocsHome), not the first article. Kept as
  // a separate flag rather than a slug of its own: the breadcrumb, the pager
  // and the nav highlight are all statements about an ARTICLE, and the home
  // page is not one. `slug` keeps its DEFAULT_SLUG fallback for everything that
  // still needs a page in hand.
  const isHome = !rawSlug;
  const slug = rawSlug || DEFAULT_SLUG;
  const page = getPage(slug);
  const contentRef = useRef<HTMLDivElement>(null);
  const { headings, activeId } = useHeadings(contentRef, slug);
  const { prev, next } = prevNext(slug);

  // Closed by default. The aside is `lg:block`, so this state only governs
  // phone and tablet — where an open tree pushes the page itself below the
  // fold and the reader lands on a table of contents instead of on the thing
  // they followed a link to.
  const [navOpen, setNavOpen] = useState(false);
  const [fontStep, setFontStep] = useState(1);

  useEffect(() => {
    const saved = Number(localStorage.getItem(FONT_KEY));
    if (!Number.isNaN(saved) && saved >= 0 && saved < FONT_STEPS.length) {
      setFontStep(saved);
    }
  }, []);
  function changeFont(n: number) {
    setFontStep(n);
    localStorage.setItem(FONT_KEY, String(n));
  }

  // Scroll to top on page change.
  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Empty on the front door. `page` is DEFAULT_SLUG's there, and its related
  // list is a statement about THAT article — printing it under "Related
  // articles" beside a table of contents claims a relationship to a page the
  // reader is not on.
  const related = (isHome ? [] : (page?.related ?? []))
    .map((s) => getPage(s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="flex min-h-[calc(100dvh-2.5rem)] flex-col bg-background text-foreground">
      <PublicBar />

      {/* Top bar */}
      <header className="sticky top-0 z-30 h-12 border-b bg-background/95 backdrop-blur flex items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-h-11 min-w-11 md:min-h-0 md:min-w-0 lg:hidden"
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
        <Link to="/docs" className="flex items-center gap-2 text-sm font-semibold shrink-0">
          <BookText className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Docs</span>
        </Link>
        <div className="flex-1 flex justify-center px-2">
          <DocsSearch />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FontSizeControl step={fontStep} setStep={changeFont} />
        </div>
      </header>

      <div className="flex-1 mx-auto w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_15rem]">
        {/* Left nav */}
        <aside
          className={cn(
            "border-r px-4 py-6 lg:block",
            navOpen ? "block" : "hidden",
          )}
        >
          <div className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5rem)] lg:overflow-auto">
            <NavTree activeSlug={isHome ? "" : slug} onNavigate={() => setNavOpen(false)} />
          </div>
        </aside>

        {/* Center content */}
        <main className="min-w-0 px-[var(--m-gutter)] py-6 md:px-6 md:py-8 lg:px-10">
          {/* Breadcrumb */}
          {/* §4: the skin's chrome budget has no band for a breadcrumb, and
              the group is already the doc's own section head. Desktop keeps
              it — this is additive below `md`, not a deletion. */}
          {!isHome && (
            <nav className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
              <Link to="/docs" className="hover:text-foreground">Home</Link>
              {page && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span>{page.group}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="text-foreground font-medium">{page.title}</span>
                </>
              )}
            </nav>
          )}

          <div ref={contentRef} style={{ zoom: FONT_STEPS[fontStep] }} className="m-cq space-y-6">
            <Outlet />
          </div>

          {/* Prev / next pager */}
          {/* The pager is the last band on a page with no tab bar under it,
              so it carries the device inset itself (v2 §5.2). Absent on the
              front door: "previous" from a table of contents means nothing,
              and DocsHome ends on its own list of where to go next. */}
          <div
            className={cn(
              "pb-safe mt-12 grid grid-cols-1 gap-3 border-t border-[--hair-rule] pt-6 sm:grid-cols-2",
              isHome && "hidden",
            )}
          >
            {prev ? (
              <Link
                to={`/docs/${prev.slug}`}
                className="group rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Previous
                </div>
                <div className="text-sm font-medium group-hover:text-primary">{prev.title}</div>
              </Link>
            ) : <span />}
            {next ? (
              <Link
                to={`/docs/${next.slug}`}
                className="group rounded-md border p-3 text-right hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </div>
                <div className="text-sm font-medium group-hover:text-primary">{next.title}</div>
              </Link>
            ) : <span />}
          </div>
        </main>

        {/* Right rail */}
        <aside className="hidden lg:block px-4 py-8">
          <div className="sticky top-[4.5rem] space-y-6 text-sm">
            {headings.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  On this page
                </div>
                <ul className="space-y-1 border-l">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        className={cn(
                          "block -ml-px border-l-2 pl-3 py-0.5 transition-colors",
                          activeId === h.id
                            ? "border-l-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {related.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  Related articles
                </div>
                <ul className="space-y-1.5">
                  {related.map((r) => (
                    <li key={r.slug}>
                      <Link to={`/docs/${r.slug}`} className="text-primary hover:underline">
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <PublicFooter />
    </div>
  );
}
