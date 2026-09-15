// The manual's diagrams, as inline SVG.
//
// WHY INLINE, AND WHY IN THIS REPOSITORY
// PLAN.md §6.5 asked WP 5.2a to "move the figure SVGs into the repo so the docs
// have no external dependency and the diagrams version with the code they
// describe". There were no SVGs to move — the repository contained none, and
// the figures the sentence refers to live in an artifact this repository does
// not have. Rather than link to something outside version control (which is
// precisely the dependency the requirement forbids) the diagrams are authored
// here, in the same commit as the pages that use them. The requirement is met
// by construction: a diagram cannot go stale relative to the code without the
// staleness showing up in a diff.
//
// THEMING: every fill and stroke is a Tailwind token utility, so both themes
// are served by one drawing. No hard-coded hex, no second dark-mode copy.
//
// SIZING: each figure declares a viewBox and fills its container's width. The
// `Figure` wrapper scrolls horizontally, which is what a wide diagram should do
// on a phone — shrinking it to fit would make the labels unreadable, and an
// unreadable diagram is worse than one you have to swipe.

const BOX = "fill-card stroke-border";
const BOX_MUTED = "fill-muted/40 stroke-border";
const LABEL = "fill-foreground text-[12px] font-semibold";
const SUB = "fill-muted-foreground text-[10px]";
const TIER = "fill-muted-foreground text-[10px] font-semibold uppercase tracking-wider";
const RULE = "stroke-border";

function Arrow({ x, y }: { x: number; y: number }) {
  return (
    <g className="stroke-muted-foreground fill-muted-foreground">
      <line x1={x} y1={y} x2={x + 10} y2={y} strokeWidth={1.5} />
      <polygon points={`${x + 15},${y} ${x + 8},${y - 4} ${x + 8},${y + 4}`} stroke="none" />
    </g>
  );
}

/**
 * The six tiers as the journey a user's data takes — the shape PLAN.md §6.2
 * calls the organizing principle, drawn rather than described.
 */
export function TierJourney() {
  const tiers: { tier: string; name: string; who: string }[] = [
    { tier: "Tier 0", name: "Landing", who: "the bytes you sent" },
    { tier: "Tier 1", name: "Staging", who: "parsed, not yet yours" },
    { tier: "Tier 2", name: "Canonical", who: "your data" },
    { tier: "Tier 3", name: "Derived", who: "what we worked out" },
    { tier: "Tier 4", name: "Decisions", who: "your policies" },
    { tier: "Tier 5", name: "Results", who: "what the run produced" },
  ];
  const w = 128;
  const gap = 16;
  const x0 = 12;
  return (
    <svg viewBox="0 0 892 208" className="w-full min-w-[640px]" role="img"
      aria-label="The six data tiers, left to right: landing, staging, canonical, derived, decisions, results, with a governance layer spanning all of them.">
      <text x={x0} y={18} className={TIER}>external</text>
      <text x={x0 + 2 * (w + gap)} y={18} className={TIER}>the only tier you edit</text>
      <text x={x0 + 5 * (w + gap)} y={18} className={TIER}>stamped</text>

      {tiers.map((t, i) => {
        const x = x0 + i * (w + gap);
        return (
          <g key={t.tier}>
            <rect x={x} y={28} width={w} height={84} rx={4} className={i === 2 ? BOX : BOX_MUTED} strokeWidth={1} />
            <text x={x + 12} y={50} className={TIER}>{t.tier}</text>
            <text x={x + 12} y={70} className={LABEL}>{t.name}</text>
            <text x={x + 12} y={90} className={SUB}>{t.who}</text>
            {i < tiers.length - 1 && <Arrow x={x + w + 1} y={70} />}
          </g>
        );
      })}

      <line x1={x0} y1={132} x2={x0 + 6 * w + 5 * gap} y2={132} className={RULE} strokeWidth={1} strokeDasharray="3 3" />
      <rect x={x0} y={146} width={6 * w + 5 * gap} height={48} rx={4} className={BOX_MUTED} strokeWidth={1} />
      <text x={x0 + 12} y={168} className={LABEL}>Governance</text>
      <text x={x0 + 12} y={185} className={SUB}>
        who you are, what you may touch, and what was recorded — spans every tier above
      </text>
    </svg>
  );
}

/**
 * The seven hops a number makes between a spreadsheet cell and a result. The
 * tier each hop lands in is named, so this figure and TierJourney are two views
 * of one structure rather than two descriptions of it.
 */
export function DataFlow() {
  const hops: { act: string; then: string; tier: string }[] = [
    { act: "You upload a file", then: "kept exactly as sent", tier: "Tier 0" },
    { act: "We parse and check it", then: "findings, nothing changed yet", tier: "Tier 1" },
    { act: "You promote it", then: "now it is your data", tier: "Tier 2" },
    { act: "We compute from it", then: "shares, paths, summaries", tier: "Tier 3" },
    { act: "You set policies", then: "defaults, then overrides", tier: "Tier 4" },
    { act: "You simulate", then: "replications, not one number", tier: "Tier 5" },
    { act: "The result is stamped", then: "data, policy, scenario, engine", tier: "Tier 5" },
  ];
  const rowH = 46;
  return (
    <svg viewBox={`0 0 660 ${hops.length * rowH + 16}`} className="w-full min-w-[440px]" role="img"
      aria-label="Seven steps from uploading a file to a stamped result, each labelled with the tier it lands in.">
      {hops.map((h, i) => {
        const y = 8 + i * rowH;
        return (
          <g key={h.act}>
            <rect x={0} y={y} width={660} height={rowH - 8} rx={4}
              className={i === hops.length - 1 ? BOX : BOX_MUTED} strokeWidth={1} />
            <circle cx={22} cy={y + 19} r={9} className="fill-primary" />
            <text x={22} y={y + 23} textAnchor="middle" className="fill-primary-foreground text-[10px] font-semibold">
              {i + 1}
            </text>
            <text x={42} y={y + 17} className={LABEL}>{h.act}</text>
            <text x={42} y={y + 31} className={SUB}>{h.then}</text>
            <text x={648} y={y + 23} textAnchor="end" className={TIER}>{h.tier}</text>
            {i < hops.length - 1 && (
              <line x1={22} y1={y + 28} x2={22} y2={y + rowH - 8} className="stroke-border" strokeWidth={1} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * What runs where, and what crosses each line. Drawn for the reader who has to
 * approve the tool rather than use it.
 */
export function SystemBoundaryFigure() {
  const zones: { name: string; what: string; runs: string }[] = [
    { name: "Your browser", what: "the interface, and nothing else", runs: "React" },
    { name: "Supabase", what: "your data, your policies, your results, and the rules about who may read them", runs: "Postgres + edge functions" },
    { name: "Simulation worker", what: "takes a job, runs it, writes the result back", runs: "Fly.io" },
    { name: "Engine", what: "the model itself — no database access of its own", runs: "scsim, Python" },
  ];
  const h = 62;
  const gap = 26;
  return (
    <svg viewBox={`0 0 660 ${zones.length * (h + gap) - gap + 8}`} className="w-full min-w-[440px]" role="img"
      aria-label="Four layers: your browser, Supabase, the simulation worker and the engine, with what crosses each boundary.">
      {zones.map((z, i) => {
        const y = 4 + i * (h + gap);
        return (
          <g key={z.name}>
            <rect x={0} y={y} width={660} height={h} rx={4} className={BOX} strokeWidth={1} />
            <text x={16} y={y + 24} className={LABEL}>{z.name}</text>
            <text x={16} y={y + 42} className={SUB}>{z.what}</text>
            <text x={644} y={y + 24} textAnchor="end" className={TIER}>{z.runs}</text>
            {i < zones.length - 1 && (
              <>
                <line x1={330} y1={y + h + 4} x2={330} y2={y + h + gap - 4} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
                <text x={340} y={y + h + 16} className={SUB}>
                  {i === 0 ? "authenticated requests only — never a direct database connection" : null}
                  {i === 1 ? "a job, and the data that job is allowed to see" : null}
                  {i === 2 ? "parameters in, a result out" : null}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
