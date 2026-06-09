// Public multi-audience reference page for the DSCT platform.
// Five groups: Overview · For Users · For Modelers · For IT · Reference (Glossary)
// No auth required, no business logic, purely presentational.

import { Link } from "react-router-dom";
import { PageLayout, PageHeader } from "@/components/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowUp,
  Activity,
  Database as DbIcon,
  Cpu,
  Radio,
  ShieldCheck,
  Workflow,
  Boxes,
  AlertTriangle,
  Users,
  BookOpen,
  FlaskConical,
  Store,
  BarChart3,
  Share2,
  TrendingUp,
  ListChecks,
  Globe,
  Library,
} from "lucide-react";

const SUPABASE_FUNCTIONS_BASE =
  "https://wckdrutwkytwcomrlpib.supabase.co/functions/v1";

type Status = "checking" | "ok" | "degraded" | "down";

function LiveStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  async function ping() {
    setStatus("checking");
    const t0 = performance.now();
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/sim-command`, {
        method: "OPTIONS",
      });
      const dt = Math.round(performance.now() - t0);
      setLatencyMs(dt);
      setCheckedAt(new Date());
      if (res.ok || res.status === 204) {
        setStatus(dt < 600 ? "ok" : "degraded");
      } else {
        setStatus("degraded");
      }
    } catch {
      setLatencyMs(null);
      setCheckedAt(new Date());
      setStatus("down");
    }
  }

  useEffect(() => {
    ping();
    const id = setInterval(ping, 30_000);
    return () => clearInterval(id);
  }, []);

  const dot =
    status === "ok"
      ? "bg-green-500"
      : status === "degraded"
        ? "bg-amber-500"
        : status === "down"
          ? "bg-red-500"
          : "bg-muted-foreground/40 animate-pulse";

  const label =
    status === "ok"
      ? "Edge reachable"
      : status === "degraded"
        ? "Slow / degraded"
        : status === "down"
          ? "Unreachable"
          : "Checking…";

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">sim-command</span>
      <span className="text-muted-foreground">{label}</span>
      {latencyMs !== null && (
        <span className="text-muted-foreground tabular-nums">· {latencyMs} ms</span>
      )}
      {checkedAt && (
        <span className="text-muted-foreground/70 text-xs ml-auto tabular-nums">
          {checkedAt.toLocaleTimeString()}
        </span>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={ping}>
        Recheck
      </Button>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card p-4">
      <svg
        viewBox="0 0 920 360"
        className="w-full h-auto text-foreground"
        role="img"
        aria-label="Realtime simulation architecture diagram"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {[
          { x: 20, y: 30, w: 150, h: 70, t1: "Browser (React)", t2: "Product / Process / Lab UIs" },
          { x: 230, y: 30, w: 170, h: 70, t1: "Edge Function", t2: "sim-command (Deno)" },
          { x: 460, y: 30, w: 170, h: 70, t1: "Upstash Redis", t2: "stream sim.cmd.{project}" },
          { x: 690, y: 30, w: 210, h: 70, t1: "Fly.io sim-worker", t2: "Python · SimPy · NetworkX" },
          { x: 230, y: 240, w: 170, h: 70, t1: "Supabase Realtime", t2: "channel sim:{project}" },
          { x: 460, y: 240, w: 170, h: 70, t1: "Supabase Postgres", t2: "simulation_runs, replications" },
          { x: 690, y: 240, w: 210, h: 70, t1: "Graph Cache", t2: "in-memory LRU (worker)" },
        ].map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8"
              className="fill-background" stroke="currentColor" strokeWidth="1.2" />
            <text x={b.x + b.w / 2} y={b.y + 28} textAnchor="middle"
              className="fill-foreground" fontSize="13" fontWeight="600">{b.t1}</text>
            <text x={b.x + b.w / 2} y={b.y + 50} textAnchor="middle"
              className="fill-muted-foreground" fontSize="11">{b.t2}</text>
          </g>
        ))}

        <g stroke="currentColor" strokeWidth="1.5" fill="none">
          <line x1="170" y1="65" x2="228" y2="65" markerEnd="url(#arrow)" />
          <line x1="400" y1="65" x2="458" y2="65" markerEnd="url(#arrow)" />
          <line x1="630" y1="65" x2="688" y2="65" markerEnd="url(#arrow)" />
          <line x1="795" y1="100" x2="545" y2="240" markerEnd="url(#arrow)" />
          <line x1="760" y1="100" x2="315" y2="240" markerEnd="url(#arrow)" />
          <line x1="795" y1="100" x2="795" y2="240" markerEnd="url(#arrow)" />
          <line x1="315" y1="100" x2="315" y2="240" markerEnd="url(#arrow)" />
          <line x1="230" y1="275" x2="95" y2="100" markerEnd="url(#arrow)" />
          <line x1="95" y1="100" x2="460" y2="275" markerEnd="url(#arrow)" strokeDasharray="4 3" />
        </g>

        <g fontSize="10" className="fill-muted-foreground">
          <text x="175" y="58">POST JWT</text>
          <text x="405" y="58">XADD</text>
          <text x="635" y="58">XREAD BLOCK</text>
          <text x="320" y="175">echo + stub KPI</text>
          <text x="555" y="175" textAnchor="middle">kpi.delta</text>
          <text x="700" y="180">writes (service role)</text>
          <text x="130" y="200" transform="rotate(-32 130 200)">PostgREST reads (RLS)</text>
        </g>
      </svg>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

/** Body text wrapper — caps prose width so paragraphs stay scannable. */
function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[760px] space-y-5 text-[15px] leading-7 text-foreground/90">
      {children}
    </div>
  );
}

type GroupAccent = {
  text: string;
  border: string;
  bg: string;
  chip: string;
  ring: string;
};

const GROUP_ACCENT: Record<string, GroupAccent> = {
  Overview: {
    text: "text-slate-600 dark:text-slate-300",
    border: "border-slate-400/70 dark:border-slate-500/60",
    bg: "bg-slate-500/5",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    ring: "border-l-slate-400",
  },
  "For Users": {
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/70",
    bg: "bg-emerald-500/5",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    ring: "border-l-emerald-500",
  },
  "For Modelers": {
    text: "text-violet-600 dark:text-violet-400",
    border: "border-violet-500/70",
    bg: "bg-violet-500/5",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    ring: "border-l-violet-500",
  },
  "For IT": {
    text: "text-sky-600 dark:text-sky-400",
    border: "border-sky-500/70",
    bg: "bg-sky-500/5",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    ring: "border-l-sky-500",
  },
  Reference: {
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/70",
    bg: "bg-amber-500/5",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    ring: "border-l-amber-500",
  },
};

const SECTION_GROUP_BY_ID: Record<string, string> = {
  overview: "Overview", "user-stories": "Overview", accurate: "Overview",
  workflow: "For Users", "use-cases": "For Users", pilots: "For Users",
  "des-model": "For Modelers", strategies: "For Modelers", "network-sci": "For Modelers", stats: "For Modelers",
  tldr: "For IT", boundary: "For IT", flow: "For IT", contract: "For IT",
  persistence: "For IT", security: "For IT", state: "For IT",
  glossary: "Reference",
};

function Section({
  id,
  icon: Icon,
  title,
  eyebrow,
  accent,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  accent?: GroupAccent;
  children: React.ReactNode;
}) {
  const group = SECTION_GROUP_BY_ID[id];
  const a = accent ?? (group ? GROUP_ACCENT[group] : undefined) ?? GROUP_ACCENT.Overview;
  return (
    <section id={id} className="scroll-mt-24 space-y-6 pt-2">
      <header className={cn("space-y-2 border-l-4 pl-4 pb-3 border-b rounded-r-sm", a.border, a.bg)}>
        {eyebrow && (
          <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", a.text)}>
            {eyebrow}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <Icon className={cn("h-5 w-5", a.text)} />
          <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
        </div>
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function AccurateCallout() {
  return (
    <figure
      role="note"
      aria-label="ACCURATE project and MaaS connection"
      className="rounded-lg border-l-4 border-rose-600 bg-rose-50/40 dark:bg-rose-950/20 p-5 space-y-5"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-bold text-rose-700 dark:text-rose-400">ACCURATE</span>
          <Badge variant="outline" className="text-xs border-rose-400 text-rose-600 dark:text-rose-400">
            Horizon Europe · Grant 101138269
          </Badge>
          <Badge variant="outline" className="text-xs border-rose-400 text-rose-600 dark:text-rose-400">
            HORIZON-CL4-2023-TWIN-TRANSITION-01-07
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          This DSCT platform is developed as part of the ACCURATE project. Three industrial
          pilots ground the stress-testing scenarios and validate the tool architecture.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          {
            company: "Airbus Atlantic",
            industry: "Aerospace",
            disruptions: "Political instability (curfew), storms, worker strikes, earthquake, floods",
            detail: "Supplier failure at 30/60/90-day durations; transport delay at 10/25/50/100%",
          },
          {
            company: "Continental",
            industry: "Automotive",
            disruptions: "Suez Canal blockage, semiconductor crisis, material shortage",
            detail: "Multi-supplier shutdown and route closure; transportation bottlenecks and supplier dependency analysis",
          },
          {
            company: "Tronico",
            industry: "Electronics",
            disruptions: "Item obsolescence, geopolitical supplier risk, shop-floor breakage",
            detail: "Two-layer simulation integrating SC dynamics with shop-floor operations",
          },
        ].map((p) => (
          <div key={p.company} className="rounded-md border border-rose-200 dark:border-rose-800 bg-background p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{p.company}</span>
              <Badge variant="secondary" className="text-xs">{p.industry}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{p.disruptions}</p>
            <p className="text-xs text-muted-foreground/70 italic">{p.detail}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-rose-600" />
          <span className="font-semibold text-sm text-rose-700 dark:text-rose-400">ACCURATE Marketplace (MaaS)</span>
        </div>
        <ul className="space-y-1.5 text-sm text-muted-foreground pl-6 list-disc">
          <li>
            When a nexus material has no internal backup, planners can search the ACCURATE Marketplace
            for alternative suppliers or substitute materials — replacing manual supplier discovery.
          </li>
          <li>
            Before committing to a marketplace supplier, planners can run a simulation to compare
            fill rate and cost-of-resilience outcomes, not just price.
          </li>
          <li>
            Firms offering capacity in the marketplace can publish a resilience score derived from
            this DSCT assessment — making supply reliability verifiable rather than self-reported.
          </li>
        </ul>
      </div>
      <figcaption className="text-xs text-muted-foreground/60 border-t pt-2 mt-1">
        Figure: ACCURATE project connection — industrial pilots and Marketplace-as-a-Service integration.
      </figcaption>
    </figure>
  );
}

function UserStoryList() {
  const stories = [
    {
      role: "supply chain planner",
      want: "build a digital twin of my supply chain (nodes, edges, BOM, demand)",
      so: "I have a single data foundation for both network analysis and simulation.",
    },
    {
      role: "supply chain planner",
      want: "identify nexus materials and suppliers via network science metrics",
      so: "I can prioritise resilience investments without needing disruption probability estimates or TTR data from suppliers.",
    },
    {
      role: "supply chain planner",
      want: "create a disruption scenario directly from the network view and carry it into the Simulation Lab",
      so: "network structural insights directly feed simulation experiments without re-entering data.",
    },
    {
      role: "supply chain planner",
      want: "configure supply chain policies derived from my actual uploaded project data (min-max inventory, MOQ, backup suppliers, safety stock by ABC-XYZ class)",
      so: "the simulation reflects my real operating rules before any disruption is applied.",
    },
    {
      role: "supply chain planner",
      want: "stress test individual suppliers by simulating disruptions and rank them by revenue impact",
      so: "I can select the most vulnerable suppliers as focal cases for deeper resilience analysis.",
    },
    {
      role: "supply chain planner",
      want: "evaluate individual resilience strategies (backup supplier, safety stock, overtime, material allocation, expediting) against a scenario and see KPI impact update immediately",
      so: "I can quickly discard ineffective options before committing to a full experiment.",
    },
    {
      role: "supply chain planner",
      want: "run committed Monte Carlo experiments (~30 replications) and receive statistically valid results with confidence intervals",
      so: "I can present evidence-backed recommendations to management.",
    },
    {
      role: "supply chain planner",
      want: "compare strategy combinations on cost of resilience and revenue recovery",
      so: "I can identify which portfolio delivers the best outcome at acceptable cost.",
    },
    {
      role: "supply chain manager",
      want: "see network vulnerability insights and simulation results in one place",
      so: "I can assess resilience posture across strategic, tactical, and operational levels without switching between tools.",
    },
  ];

  return (
    <ol className="space-y-3">
      {stories.map((s, i) => (
        <li key={i} className="rounded-md border bg-card p-3 text-sm">
          <span className="text-muted-foreground">As a </span>
          <span className="font-medium">{s.role}</span>
          <span className="text-muted-foreground">, I want to </span>
          <span>{s.want}</span>
          <span className="text-muted-foreground"> so that </span>
          <span className="text-muted-foreground/80 italic">{s.so}</span>
        </li>
      ))}
    </ol>
  );
}

function WorkflowSteps() {
  const steps = [
    {
      n: "1",
      page: "Data Manager",
      route: "/data-manager",
      desc: "Upload BOM, demand schedule, and supplier data. Create and validate the project that all downstream analysis runs against.",
    },
    {
      n: "2",
      page: "Network Views",
      route: "/network/firm-level · /network/product-level · /network/process-level",
      desc: "Explore the multi-tier supply chain structure. Compute structural metrics (degree, betweenness, eigenvector centrality). Identify nexus materials and single-source exposure.",
    },
    {
      n: "3",
      page: "Network Views → Simulation Lab",
      route: "right-click any node",
      desc: "Create a disruption scenario directly from the network. The scenario is saved and immediately available in the Simulation Lab — no re-entry of node or supplier data.",
    },
    {
      n: "4",
      page: "Project Policies",
      route: "/policies",
      desc: "Configure operating rules drawn from uploaded project data: min-max inventory levels, MOQ, supplier lead times, backup supplier assignments, safety stock by ABC-XYZ class.",
    },
    {
      n: "5",
      page: "Simulation Lab",
      route: "/simulation-lab",
      desc: "Preview mode: toggle resilience strategies and see KPI tiles refresh in ~150 ms. Experiment mode: run ~30 Monte Carlo replications, receive confidence intervals, save results.",
    },
    {
      n: "6",
      page: "Project Intelligence",
      route: "/intelligence",
      desc: "Synthesised view combining network vulnerability metrics and simulation results. Disruption impact rankings, resilience posture, and strategic recommendations in one place.",
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.n} className="flex gap-4 rounded-md border bg-card p-4">
          <span className="flex-none flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold">
            {s.n}
          </span>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{s.page}</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{s.route}</code>
            </div>
            <p className="text-sm text-muted-foreground">{s.desc}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function UseCaseCards() {
  const pages = [
    {
      name: "Data Manager",
      route: "/data-manager",
      items: [
        "Create projects and upload BOM, inbound/outbound datasets, demand schedules, and supplier lists",
        "Combine and validate datasets before analysis — data quality issues surface here, not mid-simulation",
        "Manage multiple projects and track data completeness per project",
      ],
    },
    {
      name: "Network Views",
      route: "/network/firm-level  ·  /network/product-level  ·  /network/process-level",
      items: [
        "Visualise the supply chain at three levels: firm tier (supplier → plant), product tier (supplier → material → product → customer), process tier (shop-floor BOM levels)",
        "Compute structural metrics to identify nexus materials and flag single-source supplier exposure",
        "Right-click any node to create a disruption scenario and send it to the Simulation Lab",
      ],
    },
    {
      name: "Project Policies",
      route: "/policies",
      items: [
        "Set inventory policy parameters (min-max levels, reorder point, κ, MOQ) drawn from your project data",
        "Configure backup supplier assignments, safety stock by ABC-XYZ class, production capacity, and transport lead times",
        "Apply per-node and per-edge overrides on top of project defaults — the simulation engine reads effective policies, not templates",
      ],
    },
    {
      name: "Simulation Lab",
      route: "/simulation-lab",
      items: [
        "Preview mode: toggle resilience strategies against a disruption scenario; KPI tiles (fill rate, revenue) update in ~150 ms without saving",
        "Experiment mode: run ~30 Monte Carlo replications with configurable warmup and horizon; results with confidence intervals saved to the database",
        "Compare tab: rank strategy combinations on cost of resilience vs. revenue recovery across saved experiment runs",
      ],
    },
    {
      name: "Project Intelligence",
      route: "/intelligence",
      items: [
        "Unified view combining network vulnerability data and simulation results for the same project",
        "Disruption impact rankings, critical node summaries, and resilience posture at a glance",
        "AI-assisted insights over network structure and experiment history — ask questions in natural language",
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {pages.map((p) => (
        <Card key={p.name} className="border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">{p.name}</CardTitle>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{p.route}</code>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
              {p.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Glossary ──────────────────────────────────────────────────────────────────

type GlossaryEntry = [string, string];
type GlossaryCategory = { name: string; terms: GlossaryEntry[] };

const GLOSSARY: GlossaryCategory[] = [
  {
    name: "Supply chain & resilience",
    terms: [
      ["DSCT", "Digital Supply Chain Twin. A virtual replica of a physical supply chain, continuously updated and simulation-enabled."],
      ["BOM", "Bill of Materials. The hierarchical list of materials and quantities required to produce each finished product."],
      ["Make-to-order (MTO)", "Production strategy in which manufacturing starts only after a customer order is confirmed."],
      ["Lead time", "Elapsed time from placing an order with a supplier to receiving the materials."],
      ["MOQ", "Minimum Order Quantity. The smallest amount a supplier will accept on a single purchase order."],
      ["Safety stock", "Buffer inventory held to absorb demand and supply variability and prevent stock-outs."],
      ["ABC-XYZ classification", "Two-axis classification: ABC ranks materials by value, XYZ by demand variability. Used to set differentiated service levels."],
      ["Fill rate", "Share of demand satisfied on time from available stock. The primary service-level KPI."],
      ["OTIF", "On-Time In-Full. Delivery meets both the requested date and the full quantity."],
      ["Backup supplier", "Pre-qualified alternative source activated when the primary supplier is disrupted."],
      ["Expediting", "Accelerating an existing order (faster transport or production) at additional cost."],
      ["Nexus material", "A material whose structural network position causes disproportionate resilience impact when disrupted, regardless of spend."],
      ["Cost of resilience", "Total economic burden from disruption onset through recovery: holding cost, backup premium, expediting, overtime, lost sales, allocation labour."],
    ],
  },
  {
    name: "Simulation & modelling",
    terms: [
      ["DES", "Discrete-Event Simulation. Events advance the clock; the engine processes them in time order."],
      ["SimPy", "Python process-based DES library used by the Fly.io worker."],
      ["Monte Carlo", "Repeated random sampling used to estimate distributions of outcomes under uncertainty."],
      ["Replication", "One independent simulation run with its own random seed. N replications give a confidence interval."],
      ["Warmup", "Initial period discarded so steady-state statistics aren't biased by an empty system."],
      ["Steady state", "Regime in which KPI distributions stabilise and are no longer dominated by initial transients."],
      ["Conway's rule", "Warmup-detection heuristic that inspects a KPI time series for visual stabilisation."],
      ["MSER-5", "Marginal Standard Error Rule (batch size 5). A warmup-detection procedure that minimises the marginal standard error of the grand mean."],
      ["CI half-width", "± term of a confidence interval. The stopping rule adds replications until half-width meets the precision target."],
      ["KPI vector", "Fixed-shape struct (fill_rate, otif, revenue, lead_time, …). A delta is the diff between two vectors."],
      ["Disruption scenario", "A defined what-if: which node/edge fails, when, and for how long. Drives the simulation stress test."],
    ],
  },
  {
    name: "Network science",
    terms: [
      ["Degree centrality", "Number of direct connections. Indicates how many products depend on a supplier or material."],
      ["Betweenness centrality", "How often a node lies on shortest paths between others. Indicates control over flow."],
      ["Eigenvector centrality", "Influence weighted by neighbours' influence. Indicates structural importance through well-connected peers."],
      ["Closeness centrality", "Inverse of average distance to all other nodes. Indicates how quickly a disruption can propagate."],
      ["Single-source exposure", "A material with exactly one qualified supplier — no structural redundancy."],
      ["Multi-tier network", "A supply chain modelled beyond direct suppliers, including suppliers' suppliers and downstream customers."],
    ],
  },
  {
    name: "Platform & IT",
    terms: [
      ["Edge function", "Deno serverless function (e.g. sim-command) deployed at the edge of the Supabase network."],
      ["PostgREST", "Auto-generated REST API over Postgres. The browser uses it for RLS-scoped reads and writes."],
      ["RLS", "Row-Level Security. Postgres enforces row visibility based on the caller's JWT claims."],
      ["Service role", "Privileged Supabase key that bypasses RLS. Held only by the Fly.io worker, never by the browser."],
      ["Supabase Realtime", "Pub/sub channel layer used to broadcast KPI deltas to subscribed clients."],
      ["Upstash Redis stream", "Transient command transport (sim.cmd.{project_id}) between the edge function and the worker."],
      ["Fly.io worker", "Long-running Python process that runs the SimPy DES engine and writes results back to Postgres."],
      ["GraphCache", "In-memory LRU cache of NetworkX graphs per active project on the worker."],
      ["MaaS", "Marketplace-as-a-Service. The ACCURATE marketplace layer that extends the DSCT into a two-sided resilience platform."],
    ],
  },
];

function Glossary() {
  return (
    <div className="space-y-8">
      <p className="text-[15px] leading-7 text-muted-foreground max-w-[760px]">
        Plain-language definitions used across this guide. Organised by domain so planners,
        modelers, and IT reviewers can each find the terms they need.
      </p>
      {GLOSSARY.map((cat) => (
        <div key={cat.name} className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {cat.name}
          </h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {cat.terms.map(([term, def]) => (
              <div key={term} className="space-y-0.5">
                <dt className="font-medium text-foreground">{term}</dt>
                <dd className="text-muted-foreground leading-relaxed">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

// ── Sections registry & TOC ──────────────────────────────────────────────────

const sections = [
  { id: "overview",     label: "What is this tool",     group: "Overview" },
  { id: "user-stories", label: "User stories",          group: "Overview" },
  { id: "accurate",     label: "ACCURATE & MaaS",       group: "Overview" },
  { id: "workflow",     label: "Planner workflow",      group: "For Users" },
  { id: "use-cases",    label: "Use cases by page",     group: "For Users" },
  { id: "pilots",       label: "Pilot scenarios",       group: "For Users" },
  { id: "des-model",    label: "DES model",             group: "For Modelers" },
  { id: "strategies",   label: "Resilience strategies", group: "For Modelers" },
  { id: "network-sci",  label: "Network science",       group: "For Modelers" },
  { id: "stats",        label: "Statistical methods",   group: "For Modelers" },
  { id: "tldr",         label: "TL;DR",                 group: "For IT" },
  { id: "boundary",     label: "System boundary",       group: "For IT" },
  { id: "flow",         label: "Realtime flow",         group: "For IT" },
  { id: "contract",     label: "Command contract",      group: "For IT" },
  { id: "persistence",  label: "Persistence model",     group: "For IT" },
  { id: "security",     label: "Security",              group: "For IT" },
  { id: "state",        label: "Current state",         group: "For IT" },
  { id: "glossary",     label: "Glossary",              group: "Reference" },
];

const GROUP_ORDER = ["Overview", "For Users", "For Modelers", "For IT", "Reference"];

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  const visibleRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            visibleRef.current.set(e.target.id, e.intersectionRatio);
          } else {
            visibleRef.current.delete(e.target.id);
          }
        });
        let best: { id: string; r: number } | null = null;
        visibleRef.current.forEach((r, id) => {
          if (!best || r > best.r) best = { id, r };
        });
        if (best) setActive(best.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

function TocItem({ id, label, active, accent }: { id: string; label: string; active: boolean; accent: GroupAccent }) {
  return (
    <li>
      <a
        href={`#${id}`}
        className={cn(
          "block rounded-sm pl-3 pr-2 py-1 border-l-2 transition-colors",
          active
            ? cn(accent.ring, "text-foreground font-medium", accent.bg)
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        {label}
      </a>
    </li>
  );
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div className="relative w-1 rounded-full bg-border/60 overflow-hidden" aria-hidden>
      <div
        className="absolute top-0 left-0 w-full bg-primary/70 rounded-full transition-[height] duration-100"
        style={{ height: `${progress * 100}%` }}
      />
    </div>
  );
}

interface AboutProps {
  isCollapsed?: boolean;
  setIsCollapsed?: (v: boolean) => void;
}

export default function About({ isCollapsed = true, setIsCollapsed = () => {} }: AboutProps) {
  const sectionsByGroup = useMemo(
    () =>
      GROUP_ORDER.reduce<Record<string, typeof sections>>((acc, g) => {
        acc[g] = sections.filter((s) => s.group === g);
        return acc;
      }, {}),
    []
  );
  const ids = useMemo(() => sections.map((s) => s.id), []);
  const active = useActiveSection(ids);

  // Map id → group eyebrow shown above the first section of each group.
  const firstIdOfGroup = useMemo(() => {
    const map = new Map<string, string>();
    GROUP_ORDER.forEach((g) => {
      const first = sectionsByGroup[g]?.[0];
      if (first) map.set(first.id, g.toUpperCase());
    });
    return map;
  }, [sectionsByGroup]);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Digital SC Twin · Platform Reference"
          subtitle="Overview, user workflows, modelling internals, and IT architecture"
          rightContent={
            <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
              <Link to="/">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to app
              </Link>
            </Button>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1px_1fr] gap-x-10 gap-y-14 max-w-6xl mx-auto">

          {/* TOC — scrollable, with scroll progress + active-section indicator */}
          <nav className="hidden lg:block sticky top-20 h-fit">
            <div className="flex gap-3">
              <div className="sticky top-20 h-[calc(100vh-6rem)] flex flex-col items-center pt-1 pb-1">
                <ScrollProgress />
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  className="mt-3 h-6 w-6 rounded-full border bg-background hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Scroll to top"
                  title="Scroll to top"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
              </div>
              <ScrollArea className="max-h-[calc(100vh-6rem)] pr-2 flex-1">
                <ul className="space-y-0.5 text-sm">
                  {GROUP_ORDER.map((group) => {
                    const accent = GROUP_ACCENT[group];
                    return (
                      <li key={group}>
                        <div className={cn(
                          "text-[10px] font-semibold uppercase tracking-[0.14em] mt-5 mb-1.5 first:mt-0 px-2 py-0.5 rounded inline-block",
                          accent.chip,
                        )}>
                          {group}
                        </div>
                        <ul className="space-y-0.5">
                          {sectionsByGroup[group].map((s) => (
                            <TocItem
                              key={s.id}
                              id={s.id}
                              label={s.label}
                              active={active === s.id}
                              accent={accent}
                            />
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          </nav>

          {/* Vertical divider between TOC and content */}
          <div className="hidden lg:block sticky top-20 h-[calc(100vh-6rem)] w-px bg-border" aria-hidden />

          <div className="space-y-28 min-w-0">


            {/* Hero */}
            <div className="space-y-5 max-w-[760px]">
              <Badge variant="secondary">Platform reference · v1</Badge>
              <h1 className="text-4xl font-bold tracking-tight">
                Digital Supply Chain Twin
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                A decision-support system that unifies supply chain network modelling with
                discrete-event simulation — built for planners, validated on industrial pilots,
                and grounded in peer-reviewed research.
              </p>

              {/* Audience quick-jump */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { label: "Overview", href: "#overview", icon: BookOpen },
                  { label: "For Users", href: "#workflow", icon: Users },
                  { label: "For Modelers", href: "#des-model", icon: FlaskConical },
                  { label: "For IT", href: "#tldr", icon: Cpu },
                  { label: "Glossary", href: "#glossary", icon: Library },
                ].map(({ label, href, icon: Icon }) => (
                  <a key={href} href={href}>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </Button>
                  </a>
                ))}
              </div>

              <LiveStatus />
            </div>

            {/* ── OVERVIEW ── */}

            <Section id="overview" icon={BookOpen} title="What is this tool" eyebrow={firstIdOfGroup.get("overview")}>
              <Prose>
                <p>
                  A supply chain planner opens a project — their <strong>digital twin</strong>: nodes
                  (suppliers, factories, distribution centres, customers), edges (supply relationships),
                  bill of materials, and demand schedule, all stored in Supabase. They configure policies
                  that reflect how their chain actually operates: inventory min-max levels, MOQ, supplier
                  lead times, backup source assignments, safety stock by material class. These policies
                  are derived from the data they uploaded — not generic templates.
                </p>
                <p>
                  From any of the three network views, they right-click a supplier and create a disruption
                  scenario. That scenario flows directly into the <strong>Simulation Lab</strong> where
                  they toggle resilience strategies and watch KPI tiles refresh in approximately 150 ms.
                  When confident, they hit <em>Run Experiment</em>: the engine runs ~30 Monte Carlo
                  replications, computes fill rate and revenue outcomes with confidence intervals, and
                  persists the results for the record.
                </p>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Mode</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Trigger</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Engine path</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Persists?</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t text-sm [&_tr:nth-child(even)]:bg-muted/20">
                    <tr>
                      <td className="font-medium">Preview</td>
                      <td>Slider / strategy toggle</td>
                      <td>Single-rep incremental DES on warm graph</td>
                      <td>No — broadcast only</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Experiment</td>
                      <td>"Run scenario" button</td>
                      <td>Full Monte Carlo (N replications, warmup, CIs)</td>
                      <td>Yes — <code>simulation_runs</code> + <code>run_replications</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Prose>
                <p>
                  The integration of network analysis and simulation in one tool eliminates redundant
                  data collection: the same project data that drives network metrics also drives the DES
                  engine. Structural vulnerability findings (nexus materials, single-source exposure)
                  feed directly into simulation stress tests without re-entry.
                </p>
              </Prose>
            </Section>

            <Section id="user-stories" icon={Users} title="User stories">
              <Prose>
                <p className="text-muted-foreground">
                  Each story follows the standard format: <em>As a [role], I want [goal] so that [benefit].</em>
                </p>
              </Prose>
              <UserStoryList />
            </Section>

            <Section id="accurate" icon={Store} title="ACCURATE project & MaaS">
              <Prose>
                <p>
                  This platform is developed within the <strong>ACCURATE</strong> Horizon Europe project.
                  Three industrial pilots — Airbus Atlantic, Continental, and Tronico — provide the
                  real-world disruption scenarios that ground the stress-testing methodology and validate
                  the tool architecture. The project also envisions a <strong>Marketplace-as-a-Service
                  (MaaS)</strong> layer that extends the DSCT from a single-firm tool into a two-sided
                  resilience platform.
                </p>
              </Prose>
              <AccurateCallout />
            </Section>

            {/* ── FOR USERS ── */}

            <Section id="workflow" icon={ListChecks} title="Planner workflow" eyebrow={firstIdOfGroup.get("workflow")}>
              <Prose>
                <p>
                  The typical end-to-end workflow follows six steps. Each step corresponds to a
                  specific page in the application.
                </p>
              </Prose>
              <WorkflowSteps />
            </Section>

            <Section id="use-cases" icon={BarChart3} title="Use cases by page">
              <Prose>
                <p>
                  Each page in the application serves a distinct role in the resilience assessment process.
                </p>
              </Prose>
              <UseCaseCards />
            </Section>

            <Section id="pilots" icon={Globe} title="Pilot scenarios">
              <Prose>
                <p>
                  The three ACCURATE pilots illustrate the range of disruption types the tool is designed
                  to handle. Each pilot contributed real supply chain data and disruption scenarios that
                  informed the simulation model design.
                </p>
              </Prose>
              <div className="space-y-4">
                {[
                  {
                    company: "Airbus Atlantic",
                    industry: "Aerospace manufacturing",
                    context: "A major airframe manufacturer with a globally distributed supplier base across Asia, North Africa, and Southern Europe.",
                    disruptions: [
                      "Political instability (curfew) in the Asian region",
                      "Storms in the Moluccas Straits",
                      "Worker strikes in Morocco",
                      "Earthquake in Southern France",
                      "Floods near Rochefort",
                    ],
                    method: "Each supplier tested individually: failure at 30, 60, and 90 days; transport time increases of 10%, 25%, 50%, and 100%.",
                    insight: "Structural analysis revealed which suppliers have no alternative and therefore require strategic safety stock or backup contracts.",
                  },
                  {
                    company: "Continental",
                    industry: "Automotive components",
                    context: "A Tier-1 automotive supplier exposed to global logistics routes and semiconductor supply constraints.",
                    disruptions: [
                      "Suez Canal blockage (route closure)",
                      "Semiconductor crisis (material shortage)",
                      "Multi-supplier simultaneous shutdown",
                    ],
                    method: "Scenario-based testing: shutdown of several suppliers and closure of transport routes for multiple weeks.",
                    insight: "Transportation bottlenecks and supplier dependency clusters — not individual node failures — drive the largest revenue losses.",
                  },
                  {
                    company: "Tronico",
                    industry: "Electronic manufacturing services",
                    context: "A contract electronics manufacturer managing long lead-time components and geopolitically exposed supplier locations.",
                    disruptions: [
                      "Item obsolescence and component end-of-life",
                      "Tension in the components market",
                      "Suppliers located in natural-disaster or geopolitical risk areas",
                      "Production line breakage with long lead-time repair",
                    ],
                    method: "Two-layer simulation model integrating supply chain dynamics with shop-floor operations, with high interaction between optimisation and simulation.",
                    insight: "Shop-floor constraints amplify supply disruptions: a material shortage that the supply chain could absorb becomes critical when production capacity is already strained.",
                  },
                ].map((p) => (
                  <Card key={p.company} className="border bg-card">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-base">{p.company}</CardTitle>
                        <Badge variant="secondary">{p.industry}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground pt-1">{p.context}</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Disruption scenarios</div>
                        <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-0.5">
                          {p.disruptions.map((d) => <li key={d}>{d}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Method</div>
                        <p className="text-sm text-muted-foreground">{p.method}</p>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Key insight</div>
                        <p className="text-sm text-muted-foreground">{p.insight}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Section>

            {/* ── FOR MODELERS ── */}

            <Section id="des-model" icon={FlaskConical} title="Supply chain DES model" eyebrow={firstIdOfGroup.get("des-model")}>
              <Prose>
                <p>
                  The simulation engine implements a <strong>make-to-order (MTO) supply chain</strong> as
                  a discrete-event simulation running on weekly ticks. Three processes run each week:
                  demand management, material procurement, and production and fulfillment.
                </p>

                <h3 className="text-base font-semibold pt-2">Demand management</h3>
                <p>
                  Each week <em>t</em>, the focal manufacturer receives a forward demand schedule from
                  customers over a horizon of 52 weeks: <code>D_p[t+τ*]</code> for each product{" "}
                  <code>p ∈ P</code>. The current week demand <code>D_p[t]</code> drives production;
                  the lookahead <code>D_p[t+1 … t+52]</code> drives material requirements planning.
                </p>

                <h3 className="text-base font-semibold pt-2">Material procurement</h3>
                <p>
                  BOM consumption rates <code>r_{"{p,m}"}</code> (units of material <em>m</em> per unit
                  of product <em>p</em>) translate product demand into material demand:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`Material demand:    D_m[t] = Σ_{p∈P} D_p[t] · r_{p,m}

Reorder point:      s_m[t] = Σ_{τ=t}^{t+Ts}   D_m[τ]
Target inventory:   S_m[t] = Σ_{τ=t}^{t+Ts+κ} D_m[τ]    (κ = 8 weeks)

Order trigger:      if  I_m[t-1] + I^T_m[t] + I^R_m[t]  <  s_m[t]
Order quantity:     Q_m[t] = max( S_m[t] - (I_m + I^T + I^R),  Q_MOQ )`}
              </pre>
              <Prose>
                <p>
                  Released orders update the in-transit pipeline over the supplier lead time{" "}
                  <code>T_s</code>. Scheduled receipts arrive at <code>t + T_s</code>.
                </p>
                <h3 className="text-base font-semibold pt-2">Production and fulfillment</h3>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`On-hand update:   I_m[t] = I_m[t-1] + I^R_m[t]

Production:       Q_p[t] = min( D_p[t],  O_p[t],  min_{m∈Mp} ⌊ I_m[t] / r_{p,m} ⌋ )

Fill rate:        FR[t] = Σ_{p∈P} ( Q_p[t] / D_p[t] ) · u_p`}
              </pre>
              <Prose>
                <p>
                  Fill rate is the primary KPI — weighted by unit price <code>u_p</code> to reflect
                  financial value. It is also used for steady-state detection because it normalises
                  for demand variation, giving a cleaner convergence signal than absolute revenue.
                </p>
                <h3 className="text-base font-semibold pt-2">Disruption model</h3>
                <p>
                  A disruption at supplier <code>s*</code> starting at week <code>t*</code> with
                  duration <code>Δt</code> extends the lead time:{" "}
                  <code>T^disr = T_s* + Δt</code>. All scheduled receipts due within the disruption
                  window are shifted forward by <code>Δt</code>; in-transit inventory is propagated
                  across the disruption horizon.
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`I^R,disr_{m*}[t + Δt] = I^R_{m*}[t]
I^R,disr_{m*}[t]       = 0            for t ∈ [t*, t* + Δt]
I^T,disr_{m*}[t + τ]   = I^T_{m*}[t]  for τ ∈ [1, Δt - 1]`}
              </pre>
              <Prose>
                <p>
                  In the study, disruption duration is uniform over [5, 10] weeks; start time is
                  uniform over weeks 85–87.
                </p>
              </Prose>
            </Section>

            <Section id="strategies" icon={TrendingUp} title="Resilience strategies">
              <Prose>
                <p>
                  Five resilience strategies are modelled individually and in combination. Strategy S0
                  is the baseline — built-in buffers only.
                </p>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">ID</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Strategy</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Trigger / decision rule</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Key parameters</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Cost component</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t text-xs [&_tr:nth-child(even)]:bg-muted/20">
                    <tr>
                      <td className="font-mono font-semibold">S1</td>
                      <td>Backup supplier</td>
                      <td>When disruption hits <code>s*</code>, reroute new orders to cheapest alternative <code>s'</code></td>
                      <td><code>T_s' = 6 wks</code>; price premium <code>Δc_m</code></td>
                      <td>Backup price premium per unit ordered</td>
                    </tr>
                    <tr>
                      <td className="font-mono font-semibold">S2</td>
                      <td>Safety stock</td>
                      <td>Pre-disruption: ABC-XYZ classification assigns service level <code>z_m</code>; embedded into <code>s_m</code> and <code>S_m</code></td>
                      <td>9-class ABC-XYZ matrix; holding cost 20%/yr of material value</td>
                      <td>Annual holding cost on safety stock inventory</td>
                    </tr>
                    <tr>
                      <td className="font-mono font-semibold">S3</td>
                      <td>Short-term capacity (overtime)</td>
                      <td><code>δ^o_p = 1</code> if <code>(Q^o_p − Q^base_p) · u_p {">"} C^o_p</code></td>
                      <td>Overtime cost = 5% of unit price <code>u_p</code></td>
                      <td>Overtime labour cost per activated product-week</td>
                    </tr>
                    <tr>
                      <td className="font-mono font-semibold">S4</td>
                      <td>Material allocation (LP)</td>
                      <td>Solve LP maximising revenue over 4-week rolling horizon subject to material availability, demand, and capacity</td>
                      <td>Planning horizon W = 4 weeks; integer <code>Q_p[t]</code></td>
                      <td>Indirect labour (208 hr/yr × hourly rate)</td>
                    </tr>
                    <tr>
                      <td className="font-mono font-semibold">S5</td>
                      <td>Expedite shipments</td>
                      <td><code>δ_m = 1</code> if revenue gain from early arrival <code>{">"}</code> expedite cost over planning horizon W</td>
                      <td>Expedite cost = 3% of material value; material available in current week <code>t</code></td>
                      <td>Expediting logistics cost per material-week</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Prose>
                <h3 className="text-base font-semibold pt-3">Cost of resilience</h3>
                <p>
                  The total economic burden from disruption onset through recovery covers five components:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`C^res = Σ_t [ Σ_{m∈M} ( h_m · I^safety_m  +  Q_m[t] · Δc_m  +  δ_m[t] · C^exp_m )
             + Σ_{p∈P} ( δ^o_p[t] · C^o_p  +  u_p · ΔQ_p[t] )
             + C^alc ]

  h_m     = 0.20 · c_m            (safety stock holding, 20% annual)
  Δc_m    = c_{m,s'} − c_{m,s*}  (backup supplier premium)
  C^exp_m = 0.03 · c_m            (expediting cost, 3% of material value)
  C^o_p   = 0.05 · u_p            (overtime, 5% of unit price)
  ΔQ_p    = Q^base_p − Q^disr_p   (lost sales relative to baseline)
  C^alc   = 208 hr × rate         (material allocation labour, annual)`}
              </pre>
              <Prose>
                <h3 className="text-base font-semibold pt-3">Performance metrics</h3>
                <p>
                  Each strategy combination <em>i</em> is evaluated relative to the baseline S0 on two
                  normalised indicators:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`ΔC^res_i = 1 − C^res_i / C^res_S0        (positive = lower cost than baseline)
ΔR_i     = Σ u_p (Q_{p,i} − Q_{p,S0})
           ─────────────────────────────   (positive = revenue recovered)
           Σ u_p (D_p − Q_{p,S0})`}
              </pre>
            </Section>

            <Section id="network-sci" icon={Share2} title="Network science methods">
              <Prose>
                <p>
                  The supply chain is represented as an <strong>integrated firm-product network</strong>
                  {" "}that combines supplier-buyer relationships with bill-of-materials structure.
                  This integration — relatively unexplored in prior literature — allows structural
                  metrics at the material node level to predict resilience impact without requiring
                  disruption probability estimates or TTR data from suppliers.
                </p>
                <h3 className="text-base font-semibold pt-2">Structural metrics computed per node</h3>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Metric</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Measures</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Supply chain interpretation</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t text-sm [&_tr:nth-child(even)]:bg-muted/20">
                    <tr>
                      <td className="font-medium">Degree centrality</td>
                      <td>Direct connections</td>
                      <td>How many products depend on this supplier or material</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Betweenness centrality</td>
                      <td>Control over flow paths</td>
                      <td>How often this node sits on the critical path between suppliers and products</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Eigenvector centrality</td>
                      <td>Influence via neighbours</td>
                      <td>Whether this node connects to other structurally important nodes</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Closeness centrality</td>
                      <td>Proximity to all other nodes</td>
                      <td>How quickly a disruption at this node propagates through the network</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Prose>
                <h3 className="text-base font-semibold pt-3">Nexus materials</h3>
                <p>
                  A <strong>nexus material</strong> is one whose disruption causes disproportionate
                  performance loss relative to its procurement spend — due to its structural network
                  position, not its cost. A machine learning classifier trained on the four structural
                  metrics above predicts nexus status with approximately 80% precision across various
                  criticality thresholds. This avoids the need to simulate every material individually
                  to discover which ones matter.
                </p>
                <p>Nexus identification operates at two levels:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>
                    <strong>Initial (fast):</strong> Network science metrics computed from the uploaded
                    BOM and supplier data. Available immediately after data upload.
                  </li>
                  <li>
                    <strong>Comprehensive (thorough):</strong> Individual supplier stress tests run in
                    the Simulation Lab. Each supplier is disrupted in isolation and ranked by revenue
                    impact. Validates and refines the network-science ranking with simulation evidence.
                  </li>
                </ul>
              </Prose>
            </Section>

            <Section id="stats" icon={Activity} title="Statistical methods">
              <Prose>
                <p>
                  Simulation results are reported as statistical estimates, not point values.
                  All experiments use <strong>30 independent replications</strong> with distinct random
                  seeds to produce confidence intervals.
                </p>
                <h3 className="text-base font-semibold pt-2">Warmup detection</h3>
                <p>
                  An empty supply chain is not representative of steady-state operations. Two warmup
                  detection methods are applied and the more conservative result is used:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>
                    <strong>Conway's rule:</strong> Identifies steady-state start at week 84 by
                    inspecting the fill rate time series for stabilisation.
                  </li>
                  <li>
                    <strong>MSER-5</strong> (Marginal Standard Error Rule, batch size 5): Identifies
                    steady-state start at week 15 — a less conservative estimate.
                  </li>
                </ul>
                <p>
                  Week 85 is used as the steady-state start. The analysis period spans weeks 85–137
                  (52 weeks). All KPI statistics are computed over this window only.
                </p>
                <h3 className="text-base font-semibold pt-2">Confidence intervals and stopping</h3>
                <p>
                  With 30 replications, the weekly mean fill rate can be estimated within ±5% accuracy
                  at the 95% confidence level for all weeks in the analysis period.
                  The CI half-width convergence criterion drives the stopping rule in the Simulation Lab:
                  replications are added until the half-width target is met or the configured maximum
                  replication count is reached.
                </p>
                <h3 className="text-base font-semibold pt-2">Strategy comparison</h3>
                <p>
                  Performance improvements for strategy portfolio <em>i</em> are reported as{" "}
                  <code>ΔC^res_i</code> (cost of resilience reduction) and <code>ΔR_i</code> (revenue
                  recovery rate), both relative to the no-strategy baseline S0 under identical
                  disruption scenarios and seeds.
                </p>
              </Prose>
            </Section>

            {/* ── FOR IT ── */}

            <Section id="tldr" icon={Activity} title="TL;DR" eyebrow={firstIdOfGroup.get("tldr")}>
              <Prose>
                <p>
                  <strong>Supabase stores. Fly.io computes. Realtime delivers.</strong>{" "}
                  The browser writes baseline data (projects, nodes, edges, BOM, scenarios, policies)
                  directly to Supabase Postgres via PostgREST under RLS. For interactive simulation,
                  the browser issues a <code>command</code> through the <code>sim-command</code> edge
                  function; the command is fanned out via an Upstash Redis stream to a long-running
                  Fly.io worker that runs DES on a warm in-memory copy of the graph and broadcasts KPI
                  deltas back through Supabase Realtime. Persistent results land in Supabase tables.
                </p>
              </Prose>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                <Stat label="E2E target" value="≈130 ms" />
                <Stat label="Worker DES budget" value="≤80 ms p95" />
                <Stat label="Command transport" value="Redis stream" />
                <Stat label="Result store" value="Postgres + RLS" />
              </div>
            </Section>

            <Section id="boundary" icon={Boxes} title="System boundary">
              <Prose>
                <p>
                  Two simulation systems exist in the repository. This document covers{" "}
                  <strong>System 1</strong>; System 2 is legacy and being phased out.
                </p>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Aspect</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">System 1 — Realtime</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">System 2 — Batch (legacy)</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20">
                    <tr><td>Entry</td><td><code>sim-command</code></td><td className="text-muted-foreground"><code>simulation-runner</code></td></tr>
                    <tr><td>Compute</td><td>Fly.io <code>sim-worker</code></td><td className="text-muted-foreground">Render <code>sc-sim-api-brbl</code></td></tr>
                    <tr><td>Transport</td><td>Upstash Redis stream</td><td className="text-muted-foreground">HTTP POST → edge → HTTP</td></tr>
                    <tr><td>Latency target</td><td>Sub-second, interactive</td><td className="text-muted-foreground">Minutes, job-based</td></tr>
                    <tr><td>Result table</td><td><code>simulation_runs</code>, <code>run_replications</code></td><td className="text-muted-foreground"><code>simulation_jobs</code></td></tr>
                    <tr><td>Used by</td><td>Product/Process UI, Policies preview, Sim Lab</td><td className="text-muted-foreground">Older one-shot runs</td></tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="flow" icon={Workflow} title="Realtime simulation flow">
              <Prose>
                <p>
                  Solid arrows are command/event paths; the dashed arrow is the baseline PostgREST
                  read path the browser uses to hydrate the project before any simulation runs.
                </p>
              </Prose>
              <ArchitectureDiagram />
            </Section>

            <Section id="contract" icon={Radio} title="Command contract">
              <Prose>
                <p>
                  <code>sim-command</code> validates every request with a Zod schema before forwarding
                  to Redis.
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`{
  project_id: uuid,
  scenario_id?: uuid,
  kind: "scenario.changed"
      | "scenario.reset"
      | "simulation.snapshot"
      | "simulation.fork"
      | "policy.changed"
      | "experiment.run"
      | "experiment.cancel"
      | "experiment.add_reps",
  payload: Record<string, unknown>,
  client_ts?: number
}`}
              </pre>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Kind</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Emitter</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Persists?</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Worker action</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t font-mono text-xs [&_tr:nth-child(even)]:bg-muted/20">
                    <tr><td>scenario.changed</td><td>Product / Process UI</td><td>No (preview)</td><td>Incremental DES on dirty sub-graph</td></tr>
                    <tr><td>scenario.reset</td><td>Scenario rail</td><td>No</td><td>Clear deltas</td></tr>
                    <tr><td>simulation.snapshot</td><td>Sim Lab</td><td>Yes</td><td>Write <code>simulation_runs</code> row</td></tr>
                    <tr><td>simulation.fork</td><td>Sim Lab</td><td>Yes</td><td>Branch a scenario</td></tr>
                    <tr><td>policy.changed</td><td>/policies</td><td>No (preview)</td><td>Apply policy delta only</td></tr>
                    <tr><td>experiment.run</td><td>Sim Lab</td><td>Yes</td><td>N replications, aggregate KPIs</td></tr>
                    <tr><td>experiment.cancel</td><td>Sim Lab</td><td>Yes</td><td>Stop, mark cancelled</td></tr>
                    <tr><td>experiment.add_reps</td><td>Sim Lab</td><td>Yes</td><td>Extend in-flight run</td></tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="persistence" icon={DbIcon} title="Persistence model">
              <Prose>
                <p>
                  <strong>Decision rule:</strong> if a human or a downstream report needs to see it
                  later → Supabase. If it is a transient compute artifact → it never leaves Fly.io.
                </p>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Data</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Owner</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Why</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t text-sm [&_tr:nth-child(even)]:bg-muted/20">
                    <tr><td>Projects, nodes, edges, BOM, demand</td><td>Supabase</td><td>Baseline twin; RLS-scoped per user/project</td></tr>
                    <tr><td>policy_defaults, policy_overrides</td><td>Supabase</td><td>Auditable rules; realtime-subscribed by UI</td></tr>
                    <tr><td>scenarios (disruptions, horizon, reps)</td><td>Supabase</td><td>The "what-if" definition</td></tr>
                    <tr><td>simulation_runs, run_replications</td><td>Supabase</td><td>Committed experiment results</td></tr>
                    <tr><td>Effective-policy map (merged defaults + overrides)</td><td>Fly.io RAM</td><td>Rebuilt from Supabase; cached in GraphCache</td></tr>
                    <tr><td>SimPy graph, RNG state, dirty sub-graph</td><td>Fly.io RAM</td><td>Per-tick compute; cheap to rebuild</td></tr>
                    <tr><td>Command stream sim.cmd.&#123;project_id&#125;</td><td>Upstash</td><td>Transient transport; MAXLEN ~1000</td></tr>
                    <tr><td>KPI deltas (preview mode)</td><td>Realtime</td><td>Broadcast only — not persisted</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {[
                  {
                    title: "Supabase Postgres (truth)",
                    items: [
                      "projects, project_members",
                      "nodes, edges, bom",
                      "scenarios, disruption schedules",
                      "policy_defaults, policy_overrides",
                      "simulation_runs, run_replications",
                      "uploads, raw CSV staging",
                    ],
                  },
                  {
                    title: "Upstash Redis (transient)",
                    items: [
                      "sim.cmd.{project_id} command stream",
                      "MAXLEN ~ 1000 entries (auto-trim)",
                      "Native rediss:// protocol for XREAD BLOCK",
                    ],
                  },
                  {
                    title: "Fly.io worker memory (cache)",
                    items: [
                      "NetworkX graph per active project",
                      "Previous KPI vector for diffing",
                      "LRU eviction after IDLE_TTL",
                    ],
                  },
                  {
                    title: "Supabase Realtime (transport)",
                    items: [
                      "channel sim:{project_id}",
                      "events: command (echo), kpi.delta, run.queued",
                      "Ephemeral — not a data store",
                    ],
                  },
                ].map((g) => (
                  <Card key={g.title} className="border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{g.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                        {g.items.map((i) => <li key={i}>{i}</li>)}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Section>

            <Section id="security" icon={ShieldCheck} title="Security model">
              <Prose>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Browser holds the Supabase anon key + user JWT only — never the service role.</li>
                  <li><code>sim-command</code> requires <code>Authorization: Bearer &lt;jwt&gt;</code>; project access is verified via an RLS-checked SELECT before any Redis write.</li>
                  <li>All <code>public.*</code> tables have RLS policies; data API GRANTs are explicit per role.</li>
                  <li>The Fly.io worker holds the service-role key and writes results directly via PostgREST, bypassing RLS by design.</li>
                  <li>Upstash credentials are stored as edge-function secrets, never exposed to the browser.</li>
                </ul>
              </Prose>
            </Section>

            <Section id="state" icon={AlertTriangle} title="Honest current state">
              <Prose>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>
                    <code>sim-command</code> emits a <code>source: "stub"</code> KPI delta on every{" "}
                    <code>scenario.changed</code> / <code>policy.changed</code> so the UI loop is alive
                    even before the Fly worker is deployed. Clients prefer <code>source: "worker"</code>{" "}
                    deltas when both arrive.
                  </li>
                  <li>
                    The <code>sim-worker/engine.py</code> is a Phase 1 analytical stub (tanh curve over
                    average disruption magnitude). The policy bundles are loaded and cached but the
                    per-family decision rules (S1–S5) are not yet wired into the DES. Phase 2 replaces
                    <code>compute_kpis()</code> with the full SimPy model described in the Modelers section.
                  </li>
                  <li>
                    <code>experiment.run</code> currently synthesises replications inline in the edge
                    function (recovery-aware stub). The Fly worker will upsert real results over them.
                  </li>
                  <li>
                    System 2 (Render <code>sc-sim-api-brbl</code> + <code>simulation-runner</code> /{" "}
                    <code>external-simulation-processor</code>) still exists in the codebase but is not
                    part of this flow and is slated for removal.
                  </li>
                </ul>
              </Prose>
            </Section>

            {/* ── REFERENCE ── */}

            <Section id="glossary" icon={Library} title="Glossary" eyebrow={firstIdOfGroup.get("glossary")}>
              <Glossary />
            </Section>

            <footer className="pt-8 border-t text-xs text-muted-foreground">
              Source of truth for this document:{" "}
              <code>supabase/functions/sim-command/index.ts</code>,{" "}
              <code>sim-worker/README.md</code>, dissertation Article 2 (DES model), Article 3 (DSCT architecture).
              Keep this page in sync when those change.
            </footer>

          </div>
        </div>
      </div>
    </PageLayout>
  );
}
