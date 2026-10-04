// §6.3 section 12 — engine versions & changes. PLAN.md §25 · WP 15.6 · §4 D296.
//
// EVERY FACT ON THIS PAGE IS READ, NONE IS TYPED HERE:
//   the versions, what each changed, its tier and comparability, its amendments
//     → scsim/CHANGELOG.yaml, through `engineChangelog.generated.ts` (gate `engine-ledger`)
//   what each release measurably did on the reference set
//     → scsim/docs/releases/<version>.json (release_report.py, CI-compared)
//   which builds ran, when, and which were withdrawn
//     → the `sim_engine_builds` ledger, read live (WP 15.2)
//
// The page's own words explain how to read those facts. If the record changes,
// this page changes with no edit — which is the point of authoring it once.

import { useEffect, useState } from "react";
import { PageTitle, Section, P, Key, Callout, Bullets, Defs, DocLink, Provenance, Prose } from "@/components/docs/prose";
import { ENGINE_CHANGES, type EngineChange } from "@/components/docs/generated/engineChangelog.generated";
import { CURRENT_ENGINE, RELEASE_REPORTS } from "@/lib/sim/engineChanges";
import { FROZEN_CELL } from "@/components/shared/frozenCell";
// The Supabase client needs a browser, so it is loaded when the page mounts rather
// than when the manual is built (the pattern QuestionsAndAnswers set).

const COMPARABLE: Record<EngineChange["comparable"], { label: string; cls: string }> = {
  identical: { label: "Results unchanged", cls: "border-emerald-500 text-emerald-700 dark:text-emerald-400" },
  "changed-for": { label: "Changed for some projects", cls: "border-amber-500 text-amber-700 dark:text-amber-400" },
  "not-comparable": { label: "Not comparable", cls: "border-destructive text-destructive" },
};

const anchor = (v: string) => `v${v.replace(/\./g, "-")}`;

type LedgerRow = {
  code_version: string;
  first_seen_by: string;
  first_seen_at: string;
  last_seen_at: string;
  commit_sha: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
};

function useLedger() {
  const [state, setState] = useState<{ rows: LedgerRow[]; current: string | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      // Untyped, like docsReleasesApi: the generated Database types predate the
      // ledger table, and the typed builder is too deep for the checker here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      // Read-only, and readable by anyone: the ledger and the registry name no project.
      const [{ data: rows, error }, { data: eng }] = await Promise.all([
        db
          .from("sim_engine_builds")
          .select("code_version, first_seen_by, first_seen_at, last_seen_at, commit_sha, withdrawn_at, withdrawn_reason")
          .order("first_seen_at", { ascending: false })
          .limit(50),
        db.from("sim_engines").select("code_version").eq("status", "active").maybeSingle(),
      ]);
      if (!live) return;
      setState({
        rows: (rows as LedgerRow[] | null) ?? [],
        current: (eng as { code_version?: string } | null)?.code_version ?? null,
        error: error ? error.message : null,
      });
    })();
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function ReportLine({ version }: { version: string }) {
  const r = RELEASE_REPORTS[version];
  if (!r) {
    return (
      <p className="text-xs text-muted-foreground">
        Measured release report: none — reports start with 0.6.1 (WP 15.5); earlier versions are described,
        not measured.
      </p>
    );
  }
  const cases = Object.keys(r.cases).length;
  return (
    <p className="text-xs text-muted-foreground">
      Measured against {r.previous_version} on {cases} reference runs × {r.replications} replications, same seeds:{" "}
      {r.changed.length === 0
        ? "no KPI changed."
        : `changed — ${r.changed.join(", ")}; beyond noise — ${r.moved.join(", ") || "none"}.`}
    </p>
  );
}

function Entry({ e }: { e: EngineChange }) {
  const c = COMPARABLE[e.comparable];
  return (
    <div id={anchor(e.version)} className="scroll-mt-20 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Engine {e.version}</h3>
        <span className="text-xs text-muted-foreground">
          {e.date} · Tier {e.tier}
          {e.adr ? ` · ADR ${e.adr}` : ""}
        </span>
        <span className={`rounded border px-1.5 py-0.5 text-[11px] ${c.cls}`}>{c.label}</span>
      </div>
      <p className="mt-2 text-sm"><Prose text={e.summary} /></p>
      <p className="mt-1 text-sm text-muted-foreground">
        <strong>Who is affected.</strong> <Prose text={e.comparability} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        <strong>Technical.</strong> <Prose text={e.technical} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {e.policies.length > 0 && <>Policies {e.policies.join(", ")} · </>}
        {e.kpis.length > 0 && <>KPIs {e.kpis.join(", ")} · </>}
        Frozen reference runs moved:{" "}
        {e.goldensMoved === null ? "not measurable (predates them)" : e.goldensMoved.join(", ") || "none"}
        {e.commit && <> · commit {e.commit}</>}
        {e.refs.length > 0 && <> · {e.refs.join(", ")}</>}
      </p>
      <ReportLine version={e.version} />
      {e.amendments.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium">Changed under this version without a new number:</p>
          <ul className="ml-4 list-disc text-xs text-muted-foreground">
            {e.amendments.map((a, i) => (
              <li key={i}>
                {a.date} · Tier {a.tier}
                {a.commit ? ` · ${a.commit}` : ""} — <Prose text={a.summary} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.backfilled && (e.unrecordedChanges ?? 0) > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Written from history after the fact: {e.unrecordedChanges} further engine change
          {e.unrecordedChanges === 1 ? " was" : "s were"} made under this version and no record describes{" "}
          {e.unrecordedChanges === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

function Ledger() {
  const s = useLedger();
  if (s === null) return <P>Reading the build ledger…</P>;
  if (s.error) {
    return (
      <Callout tone="limit" title="The build ledger could not be read">
        <p>
          {s.error}. The ledger arrives with the release that creates it; until then this section has nothing to
          show, and the versions above remain the record.
        </p>
      </Callout>
    );
  }
  const withdrawn = s.rows.filter((r) => r.withdrawn_at);
  return (
    <>
      <P>
        {s.current ? (
          <>
            The worker runs <code>{s.current}</code> now. The ledger holds {s.rows.length} build
            {s.rows.length === 1 ? "" : "s"}
            {withdrawn.length ? `, ${withdrawn.length} of them withdrawn` : ", none withdrawn"}.
          </>
        ) : (
          <>No worker has reported a build yet.</>
        )}
      </P>
      {s.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className={`py-1 pr-3 ${FROZEN_CELL}`}>Build</th>
                <th className="py-1 pr-3">First seen</th>
                <th className="py-1 pr-3">Last seen</th>
                <th className="py-1 pr-3">Commit</th>
                <th className="py-1">State</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.code_version} className="border-t border-border align-top">
                  <td className={`py-1 pr-3 font-mono ${FROZEN_CELL}`}>{r.code_version}</td>
                  <td className="py-1 pr-3">
                    {r.first_seen_at.slice(0, 10)} ({r.first_seen_by.replace("_", " ")})
                  </td>
                  <td className="py-1 pr-3">{r.last_seen_at.slice(0, 10)}</td>
                  <td className="py-1 pr-3 font-mono">{r.commit_sha ? r.commit_sha.slice(0, 8) : "—"}</td>
                  <td className="py-1">
                    {r.withdrawn_at ? `withdrawn ${r.withdrawn_at.slice(0, 10)}: ${r.withdrawn_reason}` : r.code_version === s.current ? "current" : "recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function EngineVersions() {
  const changing = ENGINE_CHANGES.filter((e) => e.comparable !== "identical").length;
  return (
    <>
      <PageTitle lead="Every version of the simulation engine, what it changed, who it affects, and how to run a result again on the engine that produced it.">
        Engine versions &amp; changes
      </PageTitle>

      <Section id="how-to-read" title="How to read this page">
        <Key>
          A result is only as reproducible as the engine that computed it. Every run records which engine that was,
          and this page says what each engine version changed.
        </Key>
        <Defs
          items={[
            {
              term: "Engine version",
              def: (
                <>
                  The number a person reads, such as <code>{CURRENT_ENGINE.version}</code>. It moves when the engine's
                  behaviour or its contract changes.
                </>
              ),
            },
            {
              term: "Engine build",
              def: (
                <>
                  What actually ran, named by the content of its code: <code>scsim-{CURRENT_ENGINE.version}+</code> followed
                  by a 12-character code computed from the engine's source. Two builds of
                  one version are different code. Since build identity arrived, every run records its build, so a
                  result can say exactly which code computed it.
                </>
              ),
            },
            {
              term: "Comparable",
              def: (
                <>
                  Whether a result from the previous version can be set beside one from this version. “Results
                  unchanged” means every reference run gave the same numbers. “Changed for some projects” names who.
                  “Not comparable” means a result must be re-run before it is compared.
                </>
              ),
            },
            {
              term: "Tier",
              def: (
                <>
                  The engineering classification. Tier 1 changes no behaviour, Tier 2 adds something that is off by
                  default or corrects a result, and Tier 3 changes the engine's contract and comes with a design record.
                  A Tier 2 change can still change results for the projects that use it, which is why
                  comparability is stated separately.
                </>
              ),
            },
          ]}
        />
        <P>
          Of {ENGINE_CHANGES.length} versions, {changing} change results for at least some projects. When two runs
          you compare were computed by different engines, the comparison says so and names the versions between
          them, and a validated model goes stale and says which change made it stale.
        </P>
      </Section>

      <Section id="now" title="The engine running now">
        <P>
          The newest version is <strong>{CURRENT_ENGINE.version}</strong> ({CURRENT_ENGINE.date}). <Prose text={CURRENT_ENGINE.summary} />
        </P>
        <Ledger />
      </Section>

      <Section id="versions" title="Every version, newest first">
        <P>
          Each entry is written when the version is made, and a CI check refuses a change to the engine that moves a
          frozen reference result without a new version and an entry naming exactly what moved. A change made under a
          version without a new number is appended to that version as an amendment, and nothing published is
          rewritten. Entries before the record existed were written from the history afterwards and say so.
        </P>
        <div>
          {ENGINE_CHANGES.map((e) => (
            <Entry key={e.version} e={e} />
          ))}
        </div>
      </Section>

      <Section id="rerun" title="Running a result again on its own engine">
        <P>
          Every engine build the platform has published stays published, and none is ever deleted. To recompute a
          stored result with the engine that produced it, install that build with the Python library and run the
          same frozen inputs:
        </P>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
          {`import suresuite as ss
api = ss.connect()
ss.install_engine(api, version=run["code_version"])   # the exact build the run recorded
# or: ss.install_engine(api, version="0.6.0")         # the newest build of a version`}
        </pre>
        <P>
          The simulation server always runs the current engine; earlier ones run on your machine. See{" "}
          <DocLink to="reproducibility-record">the reproducibility record</DocLink> for everything else a result is bound
          to.
        </P>
      </Section>

      <Section id="limits" title="What this page cannot tell you">
        <Bullets
          items={[
            <>
              <strong>Runs before build identity name only a version.</strong> Several different builds often shipped
              under one number then, so for those runs the version is known and the exact code is not. Every one of those builds is archived and installable, but the run did not record which it was.
            </>,
            <>
              <strong>The measured report sees only what the reference runs exercise.</strong> A change that acts only
              on fields those runs do not set (a typed replenishment level, MRP, demand per customer row) shows as
              unchanged there. The entry's “who is affected” line is what says who else is touched.
            </>,
            <>
              <strong>Some history is counted, not described.</strong> Where engine changes were made without any
              record, the entry gives their number rather than inventing what they were.
            </>,
          ]}
        />
      </Section>

      <Provenance from="scsim/CHANGELOG.yaml (engine_changelog.py, CI-gated) · scsim/docs/releases/*.json (release_report.py, CI-compared) · the sim_engine_builds ledger, read live" />
    </>
  );
}
