// First-reader paths and page metadata follow the registry and release settings.

import { Link } from "react-router-dom";
import { ArrowRight, BookText, Compass, Rocket, ShieldCheck } from "lucide-react";
import { DOC_GROUPS, getPage } from "@/components/docs/registry";
import { useCapabilities } from "@/hooks/useCapabilities";

const KICKER = "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground";


/** The four role paths §6.5 says every first-time reader arrives with. */
const START_HERE = [
  {
    slug: "what-suresuite-is",
    next: "reading-your-results",
    fragment: "",
    icon: Compass,
    question: "Manager or researcher: assess the model",
  },
  {
    slug: "how-suresuite-is-designed",
    icon: BookText,
    question: "Engineer: understand and run the project",
    next: "how-suresuite-is-designed",
    fragment: "engineer",
  },
  {
    slug: "your-first-project",
    next: "how-your-data-flows",
    fragment: "",
    icon: Rocket,
    question: "Analyst: build your first comparison",
  },
  {
    slug: "getting-an-api-key",
    next: "system-boundary",
    fragment: "",
    icon: ShieldCheck,
    question: "API developer: make your first request",
  },
] as const;

export default function DocsHome() {
  // Released section by section (/admin/docs): the front door lists only what
  // this reader may open, so every card and link on it lands on a page.
  const { docs } = useCapabilities();
  const groups = DOC_GROUPS.filter((g) => docs.canReadSection(g.key));
  const visible = (slug: string) => {
    const page = getPage(slug);
    return Boolean(page && docs.canReadSection(page.sectionKey));
  };
  const firstPage = groups[0]?.pages.find((p) => p.status === "live");
  const startHere = START_HERE.map(path => ({ ...path,
    slug: visible(path.slug) ? path.slug : visible(path.next) ? path.next : "what-suresuite-is",
  })).filter(({ slug }) => visible(slug));
  const pages = groups.flatMap((g) => g.pages);
  const liveCount = pages.filter((p) => p.status === "live").length;
  return (
    <div className="space-y-12 md:space-y-16">
      {/* Hero */}
      <header className="space-y-4">
        <span className={KICKER}>Documentation</span>
        <h1 className="max-w-3xl text-[length:clamp(26px,6vw,40px)] font-semibold leading-tight tracking-tight">
          How SuReSuite works —{" "}
          <span className="font-serif font-medium italic">written down.</span>
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          SuReSuite models your supply chain so you can test disruptions and compare the cost and service of different responses.
        </p>
        <p className="max-w-2xl text-sm font-medium leading-relaxed">
          Model your chain → set policies → break it on purpose and compare.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A policy is a rule for running the chain, such as when to reorder or which supplier to use.
          Start with the overview below; you need an approved account to work in a project.{" "}
          <Link to="/auth" className="text-primary hover:underline">Sign in</Link> if you already have one.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {firstPage && (
            <Link
              to={visible("what-suresuite-is") ? "/docs/what-suresuite-is" : `/docs/${firstPage.slug}`}
              className="group inline-flex h-11 items-center gap-2 rounded-sm bg-primary md:h-10 px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start reading
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
          {visible("all-tables") && (
            <Link
              to="/docs/all-tables"
              className="inline-flex h-11 items-center rounded-sm border border-border md:h-10 px-4 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Jump to the reference
            </Link>
          )}
          {visible("questions") && (
            <Link
              to="/docs/questions"
              className="inline-flex h-11 items-center rounded-sm border border-border md:h-10 px-4 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Questions &amp; answers
            </Link>
          )}
        </div>
      </header>

      {/* Start here */}
      <section className={startHere.length === 0 ? "hidden" : "space-y-5"}>
        <div className="space-y-2">
          <span className={KICKER}>Start here</span>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            {startHere.length === START_HERE.length ? "Choose your starting point" : "Where to begin"}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {startHere.map(({ slug, next, fragment, icon: Icon, question }) => {
            const page = getPage(slug);
            if (!page) return null;
            return (
              <div
                key={question}
                className="group rounded-sm border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-semibold tracking-tight">{question}</span>
                </div>
                <Link to={`/docs/${slug}`} className="mt-2 block text-sm font-medium text-primary hover:underline">
                  {page.title}
                </Link>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{page.summary}</p>
                {visible(next) && (next !== slug || fragment) && (
                  <Link to={`/docs/${next}${fragment ? `#${fragment}` : ""}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-primary hover:underline md:min-h-0">
                    {fragment ? "For engineers: developer setup" : getPage(next)?.title}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                )}
                {!visible(next) && <p className="mt-3 text-xs text-muted-foreground">More task guides appear when their section is open to you.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        {liveCount} available guides across {groups.length} sections open to you.
        {pages.length > liveCount && ` ${pages.length - liveCount} more guides are planned.`}
      </p>

      {/* The whole site map */}
      <section className="space-y-5">
        <div className="space-y-2">
          <span className={KICKER}>Everything in the manual</span>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            {groups.length} {groups.length === 1 ? "section" : "sections"}, and what each one answers
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Browse the sections open to you, including any released for public reading. Start with a task guide, then use the concepts and reference pages to understand the values you encounter.
          </p>
        </div>

        <div className="border-t border-[--hair-rule]">
          {groups.map((g) => {
            const written = g.pages.filter((p) => p.status === "live").length;
            const first = g.pages.find((p) => p.status === "live") ?? g.pages[0];
            return (
              <div
                key={g.group}
                className="grid gap-2 border-b border-[--hair-rule] py-5 md:grid-cols-12 md:gap-6"
              >
                <span className={`${KICKER} tabular-nums md:col-span-1 md:pt-1`}>
                  {String(g.section).padStart(2, "0")}
                </span>
                <div className="md:col-span-8">
                  <Link
                    to={`/docs/${first.slug}`}
                    className="text-base font-semibold tracking-tight hover:text-primary"
                  >
                    {g.group}
                  </Link>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.blurb}</p>
                </div>
                <div className="text-xs text-muted-foreground md:col-span-3 md:justify-self-end md:pt-1 md:text-right">
                  <span className="tabular-nums">
                    {written} of {g.pages.length}
                  </span>{" "}
                  written
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
