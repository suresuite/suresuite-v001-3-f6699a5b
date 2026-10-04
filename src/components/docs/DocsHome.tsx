// The manual's front door at /docs.
//
// WHY THIS PAGE EXISTS. The index route used to render the first article, so
// /docs opened mid-manual: a reader who had not yet decided to read anything
// landed on page one of fifteen sections with no way to see what the other
// fourteen were without expanding a tree. §6.5's argument is that the
// architecture is a selling point and that "a prospective customer, a
// researcher and a new modeller all ask the same opening question" — and all
// three of them arrive HERE, from the public site, without an account. This
// page answers that question before asking them to pick an article.
//
// It is written in the public site's vocabulary (mono kicker, hairline rules,
// serif-italic tail on the headline) rather than the manual's, because it is
// the seam between the two: /docs is reachable from the same top bar as
// /about, and a reader crossing that seam should not feel they have left.
//
// NOTHING HERE IS TYPED TWICE. Every title, blurb, count and link is read from
// `registry.ts` at render time. The section list cannot fall behind the nav,
// and the "written" counts cannot flatter the manual, because both are the
// same numbers the nav and the pager use. That is the point of the counts
// being here at all: §5.3 T3 says we publish our own blind spots, and a front
// door that showed only the finished sections would be the tidier, dishonest
// version of this page — the reader could not tell a feature we do not have
// from a page we have not written.

import { Link } from "react-router-dom";
import { ArrowRight, BookText, Compass, Rocket, ShieldCheck } from "lucide-react";
import { DOC_GROUPS, getPage } from "@/components/docs/registry";
import { useCapabilities } from "@/hooks/useCapabilities";

const KICKER = "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground";


/** The three questions §6.5 says every first-time reader arrives with. */
const START_HERE = [
  {
    slug: "what-suresuite-is",
    icon: Compass,
    question: "Manager or researcher: understand the model",
  },
  {
    slug: "how-suresuite-is-designed",
    icon: BookText,
    question: "New engineer: explore the architecture",
  },
  {
    slug: "your-first-project",
    icon: Rocket,
    question: "Analyst: build your first comparison",
  },
  {
    slug: "getting-an-api-key",
    icon: ShieldCheck,
    question: "API developer: authenticate and make a request",
  },
] as const;

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="px-5 py-4 md:px-6">
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className={`${KICKER} mt-1 block`}>{label}</div>
    </div>
  );
}

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
  const startHere = START_HERE.filter(({ slug }) => visible(slug));
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
          The manual is released section by section, and this page lists every section open to
          you. A prospective user, a researcher and a new modeller all open with the same question — how is this thing put together, and can I
          trust it? That question is answered first here, before the reference section, because a
          tool that asks you to stake a decision on its numbers owes you the way it got them.
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

      {/* What the manual covers, in numbers it cannot fake */}
      <div className="grid grid-cols-2 divide-x divide-y divide-[--hair-rule] border border-[--hair-rule] sm:grid-cols-4 sm:divide-y-0">
        <Stat value={groups.length} label="Sections" />
        <Stat value={pages.length} label="Pages mapped" />
        <Stat value={liveCount} label="Written so far" />
        <Stat value={pages.length - liveCount} label="Owed, and named" />
      </div>

      {/* Start here */}
      <section className={startHere.length === 0 ? "hidden" : "space-y-5"}>
        <div className="space-y-2">
          <span className={KICKER}>Start here</span>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            {startHere.length === START_HERE.length ? "Four pages, four questions" : "Where to begin"}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {startHere.map(({ slug, icon: Icon, question }) => {
            const page = getPage(slug);
            if (!page) return null;
            return (
              <Link
                key={slug}
                to={`/docs/${slug}`}
                className="group rounded-sm border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-semibold tracking-tight">{question}</span>
                </div>
                <div className="mt-2 text-sm font-medium text-foreground group-hover:text-primary">
                  {page.title}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{page.summary}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* The whole site map */}
      <section className="space-y-5">
        <div className="space-y-2">
          <span className={KICKER}>Everything in the manual</span>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            {groups.length} {groups.length === 1 ? "section" : "sections"}, and what each one answers
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every page the manual will ever have is listed — including the ones not yet written,
            each naming the work package that owes it. So you can always tell the difference
            between something this product does not do and something we have not explained yet.
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
