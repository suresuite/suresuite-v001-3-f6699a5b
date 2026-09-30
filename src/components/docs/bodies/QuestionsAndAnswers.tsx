// §6.3 section 16 — Questions & answers.
//
// The one page of the manual whose words are not in this repository. Each
// question and its prepared answer is a row in `docs_faq`, written by a super
// admin at /admin/docs, and it reaches this page only through `docs_list_faq`,
// which applies two audiences in the database: this section's own, and that of
// the section each answer is about. So an answer about a confidential section
// is never sent to a reader who may not open that section — unlike a page body,
// which ships with the app.
//
// Answers are Markdown rendered with raw HTML disabled (react-markdown's
// default). A link to `/docs/<slug>` becomes an in-app link.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageTitle, P } from "@/components/docs/prose";
import { DOC_GROUPS, getPage } from "@/components/docs/registry";
import { useDocsReader } from "@/components/docs/docsReader";
// Type-only: the API module loads the Supabase client, which needs a browser, so
// it is imported when the page mounts rather than when the manual is built.
import type { DocsFaqEntry } from "@/lib/docs/docsReleasesApi";

function AnswerLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href && href.startsWith("/")) {
    return (
      <Link to={href} className="text-primary underline-offset-2 hover:underline">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function Answer({ entry }: { entry: DocsFaqEntry }) {
  const related = (entry.related_slugs ?? [])
    .map((s) => getPage(s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  return (
    <div className="space-y-2 pb-1 text-[14px] leading-relaxed text-muted-foreground">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => <AnswerLink href={href}>{children}</AnswerLink>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
          code: ({ children }) => (
            <code className="rounded-sm border border-border bg-muted/50 px-1 py-0.5 font-mono text-[12px]">{children}</code>
          ),
        }}
      >
        {entry.answer}
      </ReactMarkdown>
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <span className="text-muted-foreground/80">Read more:</span>
          {related.map((p) => (
            <Link key={p.slug} to={`/docs/${p.slug}`} className="text-primary underline-offset-2 hover:underline">
              {p.title}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QuestionsAndAnswers() {
  const { userId } = useDocsReader();
  const [entries, setEntries] = useState<DocsFaqEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    setEntries(null);
    setFailed(false);
    import("@/lib/docs/docsReleasesApi")
      .then((api) => api.fetchDocsFaq(userId))
      .then((rows) => live && setEntries(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [userId]);

  // General questions first, then by the manual's own section order.
  const grouped = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = (e: DocsFaqEntry) => {
      const hay = `${e.question} ${e.answer}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    const rows = (entries ?? []).filter(match);
    const order = [null, ...DOC_GROUPS.map((g) => g.key)];
    const byKey = new Map<string | null, DocsFaqEntry[]>();
    for (const e of rows) {
      const key = e.section_key && DOC_GROUPS.some((g) => g.key === e.section_key) ? e.section_key : null;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    return order
      .filter((k) => byKey.has(k))
      .map((k) => ({
        key: k,
        title: k ? DOC_GROUPS.find((g) => g.key === k)!.group : "General",
        rows: byKey.get(k)!,
      }));
  }, [entries, q]);

  return (
    <>
      <PageTitle lead="Common questions, answered briefly — each answer points to the page that goes deeper.">
        Questions &amp; answers
      </PageTitle>

      <P>
        These are the questions people ask most often, with answers prepared in advance. An answer is
        deliberately short: where a question touches a fact the manual documents in full — a column,
        a unit, a rule — the answer links to the page that owns that fact rather than repeating it,
        so the two cannot drift apart. Which answers you see depends on which sections of the manual
        are open to you.
      </P>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter the questions…"
          className="h-9 pl-8"
          aria-label="Filter the questions"
        />
      </div>

      {failed ? (
        <P>The questions could not be loaded just now. Reload the page to try again.</P>
      ) : entries === null ? (
        <P>Loading the questions…</P>
      ) : entries.length === 0 ? (
        <P>
          There are no questions here for you yet. {userId ? "" : "Signing in may show more. "}
          In the meantime, <Link to="/docs" className="text-primary hover:underline">the manual&apos;s front page</Link>{" "}
          lists every section open to you.
        </P>
      ) : grouped.length === 0 ? (
        <P>No question matches that filter.</P>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.key ?? "general"} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.title}</h3>
              <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
                {g.rows.map((e) => (
                  <details key={e.id} className="group px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-start gap-2 text-[14px] font-medium text-foreground">
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                      <span>{e.question}</span>
                    </summary>
                    <div className="mt-2 pl-6">
                      <Answer entry={e} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
