// Dedicated, full-screen documentation chrome for the /help docs site — modelled
// on a classic three-pane docs layout: top bar (search · theme · font-size),
// collapsible left nav tree, center content (breadcrumb + Outlet + prev/next),
// and a right "On this page" + "Related" rail. No app shell.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, Moon, Sun, ChevronRight, ArrowLeft, ArrowRight, X,
  PanelLeftClose, PanelLeftOpen, BookText, CornerUpLeft,
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

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Toggle theme"
      title="Toggle light / dark"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
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
    navigate(`/help/${slug}`);
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
                    <div className="text-sm font-medium">{r.title}</div>
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

function NavTree({ activeSlug }: { activeSlug: string }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <nav className="text-sm">
      <ul className="space-y-4">
        {DOC_GROUPS.map((g) => {
          const isCollapsed = collapsed[g.group];
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
                {g.group}
              </button>
              {!isCollapsed && (
                <ul className="mt-1.5 space-y-0.5">
                  {g.pages.map((p) => {
                    const active = p.slug === activeSlug;
                    return (
                      <li key={p.slug}>
                        <Link
                          to={`/help/${p.slug}`}
                          className={cn(
                            "block rounded-sm border-l-2 pl-3 pr-2 py-1 transition-colors",
                            active
                              ? "border-l-primary bg-primary/5 text-foreground font-medium"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                        >
                          {p.title}
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

export default function DocsLayout() {
  const params = useParams();
  const location = useLocation();
  const slug = params.slug ?? DEFAULT_SLUG;
  const page = getPage(slug);
  const contentRef = useRef<HTMLDivElement>(null);
  const { headings, activeId } = useHeadings(contentRef, slug);
  const { prev, next } = prevNext(slug);

  const [navOpen, setNavOpen] = useState(true);
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

  const related = (page?.related ?? [])
    .map((s) => getPage(s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 border-b bg-background/95 backdrop-blur flex items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 lg:hidden"
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
        <Link to="/help" className="flex items-center gap-2 font-semibold shrink-0">
          <BookText className="h-5 w-5 text-primary" />
          <span className="hidden sm:inline">DSCT Docs</span>
        </Link>
        <div className="flex-1 flex justify-center px-2">
          <DocsSearch />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FontSizeControl step={fontStep} setStep={changeFont} />
          <ThemeToggle />
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 hidden sm:inline-flex">
            <Link to="/">
              <CornerUpLeft className="h-3.5 w-3.5" />
              App
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 mx-auto w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-[16rem_1fr_15rem]">
        {/* Left nav */}
        <aside
          className={cn(
            "border-r px-4 py-6 lg:block",
            navOpen ? "block" : "hidden",
          )}
        >
          <div className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5rem)] lg:overflow-auto">
            <NavTree activeSlug={slug} />
          </div>
        </aside>

        {/* Center content */}
        <main className="min-w-0 px-6 lg:px-10 py-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
            <Link to="/help" className="hover:text-foreground">Home</Link>
            {page && (
              <>
                <ChevronRight className="h-3.5 w-3.5" />
                <span>{page.group}</span>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-foreground font-medium">{page.title}</span>
              </>
            )}
          </nav>

          <div ref={contentRef} style={{ zoom: FONT_STEPS[fontStep] }} className="space-y-6">
            <Outlet />
          </div>

          {/* Prev / next pager */}
          <div className="mt-12 pt-6 border-t grid grid-cols-2 gap-3">
            {prev ? (
              <Link
                to={`/help/${prev.slug}`}
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
                to={`/help/${next.slug}`}
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
                      <Link to={`/help/${r.slug}`} className="text-primary hover:underline">
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
    </div>
  );
}
