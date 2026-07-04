// Public multi-audience reference page for the DSCT platform.
// Five groups: Overview · For Users · For Modelers · For IT · Reference (Glossary)
// No auth required, no business logic, purely presentational.

import { Link } from "react-router-dom";
import { PageLayout, PageHeader, YouTubeEmbed } from "@/components/shared";
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
  Layers,
  SlidersHorizontal,
  Gauge,
  Dices,
  Sigma,
  Microscope,
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
  "des-model": "For Modelers", "sim-params": "For Modelers", distributions: "For Modelers", policies: "For Modelers", "network-sci": "For Modelers", stats: "For Modelers", kpis: "For Modelers", experiments: "For Modelers",
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

// ── scsim engine reference (parameters · policies · KPIs · pipeline) ──────────
// Source of truth: scsim/docs/reference/{variables,policies,kpis,pipeline}.md,
// generated by scsim/scripts/gen_docs.py from the scsim Pydantic registry
// (engine 0.2.0). Keep these tables in sync when the registry changes.

type Row6 = [string, string, string, string, string, string];
const PARAM_HEAD: [string, string, string, string, string, string] = [
  "Parameter", "Unit", "Scope", "Default", "Range", "Notes",
];

const SCOPE_LEGEND: [string, string][] = [
  ["G", "global"],
  ["P", "product"],
  ["M", "material"],
  ["S", "supplier"],
  ["SM", "supplier × material"],
  ["E", "edge / lane"],
  ["C", "customer"],
];

function ScopeLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {SCOPE_LEGEND.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5 rounded border bg-muted/30 px-2 py-0.5">
          <code className="font-mono text-[10px] font-semibold">{k}</code>
          <span className="text-muted-foreground">{v}</span>
        </span>
      ))}
    </div>
  );
}

/** Dense six-column reference table used for both variables and policy parameters. */
function Row6Table({ head, rows }: { head: typeof PARAM_HEAD; rows: Row6[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border rounded-md">
        <thead className="bg-muted/40 text-left">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-2.5 [&_td]:py-2 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-mono text-[11px] font-medium whitespace-nowrap">{r[0]}</td>
              <td className="text-muted-foreground whitespace-nowrap">{r[1]}</td>
              <td className="font-mono text-[10px]">{r[2]}</td>
              <td className="font-mono text-[10px] whitespace-nowrap">{r[3]}</td>
              <td className="font-mono text-[10px] whitespace-nowrap">{r[4]}</td>
              <td className="text-muted-foreground">{r[5]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Phase pipeline (PH-00 … PH-99) ────────────────────────────────────────────

const PHASES: [string, string, string][] = [
  ["PH-00", "week_start", "Onset / recovery profiles → physical disruption state for the week."],
  ["PH-10", "demand_realization", "Update the forecast from history, then draw D_p[t] from the world demand stream."],
  ["PH-20", "detection", "Firm-visible events (t ≥ start + detection_lag). P-S.4 / P-X.1 evaluate here."],
  ["PH-30", "fulfill_from_stock", "MTS serves D_p from finished-goods stock; no-op for MTO products."],
  ["PH-40", "production_planning", "Default greedy plan; P-P.5 / P-P.9 adjust the plan here."],
  ["PH-50", "production_execute", "Produce Q_p and consume materials — pure mechanics (Eqs. 8 / 9)."],
  ["PH-60", "fulfillment", "F_p, B_p, L_p — P-C.1 / P-C.2 / P-C.3 resident."],
  ["PH-70", "material_planning", "D_m projection (Eq. 1); s_m / S_m levels (Eqs. 2–3) + safety stock."],
  ["PH-80", "procurement", "Order release (Eqs. 4–6) and sourcing; orders enter the supplier queue."],
  ["PH-90", "logistics", "Capacity gating, deferral (Eqs. 11–12), expedite (Eqs. 18–19), land arrivals."],
  ["PH-99", "accounting", "Read-only KPI rows, cost rollup, trace."],
];

function PhasePipeline() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded-md">
        <thead className="bg-muted/40 text-left">
          <tr>
            {["Phase", "Name", "What happens in the weekly tick"].map((h) => (
              <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
          {PHASES.map((p) => (
            <tr key={p[0]}>
              <td className="font-mono text-xs whitespace-nowrap">{p[0]}</td>
              <td className="font-mono text-xs whitespace-nowrap">{p[1]}</td>
              <td className="text-muted-foreground text-[13px]">{p[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Simulation parameter dictionary (Part III) ────────────────────────────────

type ParamGroup = { entity: string; title: string; blurb: string; rows: Row6[] };

const SIM_PARAM_GROUPS: ParamGroup[] = [
  {
    entity: "simulation_settings",
    title: "§3.0 · Global simulation & statistics",
    blurb: "Global clock, horizon, seeds, and statistical controls (scope G).",
    rows: [
      ["time_step", "week", "G", "1", "—", "Weekly clock; fixed."],
      ["horizon", "weeks", "G", "156", "[52, 520]", "T_sim. Manuscript: 156."],
      ["warmup_method", "enum", "G", "most_conservative", "{conway, mser5, manual, most_conservative}", "Runs Conway and MSER-5, adopts the later week."],
      ["warmup_end", "week", "G", "auto", "see schema", "t_w. Required when warmup_method=manual; auto-detected otherwise. Manuscript: 85."],
      ["analysis_window", "weeks", "G", "52", "[13, 156]", "KPI window starting at warmup_end."],
      ["project_seed", "—", "G", "required", "[0, 2^64]", "Root of the SeedSequence tree (Part VIII)."],
      ["model_seeds", "count", "G", "30", "[1, 200]", "Replications over world streams. Study floor 30; below 10 carries a below_replication_floor badge."],
      ["disruption_event_seeds", "count", "G", "18", "[1, 100]", "(start, duration, magnitude) draws. Collapses to 1 when all events are fixed."],
      ["crn_enabled", "—", "G", "true", "—", "Common random numbers; required for synergy math."],
      ["bootstrap_resamples", "count", "G", "10000", "[1000, 100000]", "Percentile bootstrap on Δ and synergy metrics."],
      ["ci_level", "%", "G", "95", "{90, 95, 99}", "Confidence level for all intervals."],
      ["replication_stopping", "enum", "G", "fixed", "{fixed, sequential_ci}", "sequential_ci stops when FR CI half-width ≤ ε."],
      ["ci_halfwidth_target", "—", "G", "0.05", "[0.01, 0.1]", "ε for sequential stopping."],
      ["run_mode", "enum", "G", "full", "{full, fast_scan}", "fast_scan: 10×6 seeds, kpi_only traces, wide-CI badge. Never silently mixed with full results."],
      ["detection_lag_weeks", "weeks", "G/S", "0", "[0, 4]", "Delay between physical disruption start and firm knowledge (PH-20). Governed by P-S.4."],
      ["demand_floor_factor", "—", "G/P", "0.3", "[0.0, 1.0]", "ν — partial-observability correction: a_p = max{0,(1−ν)·b_p}."],
      ["visibility_horizon", "weeks", "G/P", "52", "[4, 104]", "τ* — MTO order-schedule length."],
      ["trace_verbosity", "enum", "G", "weekly", "{kpi_only, weekly, full_debug}", "Stress tests default to kpi_only (≈100× less IO)."],
    ],
  },
  {
    entity: "product",
    title: "§3.1–3.3 · Customer demand, plant products & fulfillment mode",
    blurb: "Product + demand model + fulfillment mode (CODP).",
    rows: [
      ["id", "id", "P", "required", "—", ""],
      ["name", "—", "P", "''", "—", ""],
      ["unit_price", "€/unit", "P", "required", "[0, ∞]", "u_p."],
      ["demand_model", "enum", "P", "triangular", "{deterministic, triangular, poisson, negbin, bootstrap}", ""],
      ["demand_mode", "units/wk", "P", "required", "[0, ∞]", "b_p — historical median."],
      ["demand_min", "units/wk", "P", "auto", "see schema", "a_p; default max{0,(1−ν)·b_p}."],
      ["demand_max", "units/wk", "P", "auto", "see schema", "c_p — historical max; default (1+ν)·b_p."],
      ["demand_floor_factor", "—", "P", "—", "see schema", "ν override; falls back to the global setting."],
      ["demand_history", "units/wk", "P", "—", "—", "Required for demand_model=bootstrap."],
      ["negbin_dispersion", "—", "P", "1.0", "[0, ∞]", "k for negbin (variance = b + b²/k)."],
      ["production_capacity", "units/wk", "P", "required", "[0, ∞]", "O_p."],
      ["fulfillment_mode", "enum", "P", "mto", "{mto, mts, ato}", ""],
      ["fg_policy", "enum", "P", "base_stock", "{base_stock, min_max}", "MTS only."],
      ["fg_base_stock", "units", "P", "auto", "see schema", "S^FG_p; derived if None. MTS only."],
      ["forecast_model", "enum", "P", "ma", "{naive, ma, exp_smoothing, perfect}", "MTS plans to forecast."],
      ["forecast_window", "weeks", "P", "8", "[2, 26]", ""],
      ["forecast_bias", "%", "P", "0.0", "[-30.0, 30.0]", "Experimental mis-forecast lever."],
    ],
  },
  {
    entity: "customer",
    title: "§3.1 · Customer segments",
    blurb: "Customer segments. Needed by P-C.2; inert for single-customer MTO.",
    rows: [
      ["id", "—", "C", "required", "—", ""],
      ["name", "—", "C", "''", "—", ""],
      ["segment", "—", "C", "default", "—", "≤10 segments."],
      ["priority_weight", "—", "C", "1.0", "[0, ∞]", ""],
    ],
  },
  {
    entity: "bom_line",
    title: "§3.2 · Bill of materials",
    blurb: "r_{p,m}. ALL listed materials are required (hard constraint, Eq. 8).",
    rows: [
      ["product_id", "—", "P", "required", "—", ""],
      ["material_id", "—", "M", "required", "—", ""],
      ["rate", "units m / unit p", "P×M", "required", "[0, ∞]", "r_{p,m}."],
    ],
  },
  {
    entity: "material",
    title: "§3.4 · Material inventory",
    blurb: "Plant material master.",
    rows: [
      ["id", "id", "M", "required", "—", ""],
      ["name", "—", "M", "''", "—", ""],
      ["cost", "€/unit", "M", "required", "[0, ∞]", "c_m at the primary source."],
      ["holding_cost_rate", "%/yr of c_m", "G/M", "20.0", "[5.0, 50.0]", "h_m."],
      ["initial_on_hand", "units", "M", "auto", "see schema", "None → initialized to the order-up-to level S_m at t=0 (warm start)."],
    ],
  },
  {
    entity: "supplier",
    title: "§3.5 · Supplier echelon",
    blurb: "Supplier echelon.",
    rows: [
      ["id", "id", "S", "required", "—", ""],
      ["name", "—", "S", "''", "—", ""],
      ["capacity_per_week", "units/wk", "S", "∞", "see schema", "None = ∞ (manuscript). Finite required for capacity_reduction events and P-S.3."],
      ["reliability_score", "—", "S", "1.0", "[0.0, 1.0]", "Selection-rule input (P-S.1 reliability rule)."],
      ["tier", "—", "S", "1", "[1, 3]", "Reserved extension point; v1 simulates tier 1 only."],
    ],
  },
  {
    entity: "supplier_link",
    title: "§3.5 · Qualified (supplier × material) sources",
    blurb: "Qualified source — SM-scoped sourcing variables.",
    rows: [
      ["supplier_id", "—", "S", "required", "—", ""],
      ["material_id", "—", "M", "required", "—", ""],
      ["cost", "€/unit", "SM", "required", "[0, ∞]", "c_{m,s}."],
      ["lead_time_weeks", "weeks", "SM", "required", "[1, 51]", "T_s; includes transport in v1."],
      ["lead_time_dist", "enum", "SM", "deterministic", "{deterministic, lognormal, gamma, empirical}", "Stochastic LT consumes the world leadtime stream only when an order is placed."],
      ["lead_time_cv", "—", "SM", "0.0", "[0.0, 1.0]", "CV for lognormal / gamma lead-time dists."],
      ["moq", "units", "SM", "0.0", "[0, ∞]", "Q_MOQ — minimum order quantity."],
    ],
  },
  {
    entity: "lane",
    title: "§3.6 · Transport edges 🧩",
    blurb: "Transport edge. Defaults are behavior-neutral (folded into T_s).",
    rows: [
      ["id", "id", "E", "required", "—", ""],
      ["supplier_id", "—", "S", "required", "—", ""],
      ["plant_id", "id", "E", "plant", "—", "v1 single plant."],
      ["mode", "enum", "E", "default", "{default, sea, air, road, rail}", ""],
      ["lead_time_weeks", "weeks", "E", "0", "[0, 26]", "T_E; 0 = folded into supplier T_s (v1)."],
      ["capacity_per_week", "units/wk", "E", "∞", "see schema", "None = ∞."],
      ["cost_per_unit", "€/unit", "E", "0.0", "[0, ∞]", ""],
    ],
  },
  {
    entity: "disruption_event",
    title: "§3.7 · Disruption event model",
    blurb: "What fails, when, and for how long — the stress applied to the twin.",
    rows: [
      ["target_type", "enum", "event", "node:supplier", "{node:supplier, node:plant, edge:lane}", "node:supplier ✅; node:plant ✅; edge:lane 🧩."],
      ["target_id", "id", "event", "required", "—", ""],
      ["effect_type", "enum", "event", "lead_time_extension", "{lead_time_extension, capacity_reduction}", "LT extension ✅ (Eqs. 11–12) vs capacity throttle."],
      ["capacity_factor", "—", "event", "0.0", "[0.0, 1.0]", "φ — 0 = full outage. capacity_reduction only."],
      ["overflow_rule", "enum", "event", "queue", "{queue, reject}", "reject logs lost_inbound_units."],
      ["onset_profile", "enum", "event", "step", "{step, ramp_linear}", "ramp_linear applies to capacity_reduction only."],
      ["recovery_profile", "enum", "event", "step", "{step, ramp_linear}", "ramp_linear applies to capacity_reduction only."],
      ["ramp_weeks", "weeks", "event", "0", "[0, 8]", ""],
      ["start", "week", "event", "auto", "see schema", "t*. None → auto: U{t_w .. t_w+2} from the hazard_start stream."],
      ["duration", "weeks", "event", "auto", "see schema", "Δt. int = fixed; range = U{min..max} from the hazard_duration stream."],
    ],
  },
];

function SimParameters() {
  return (
    <div className="space-y-8">
      <ScopeLegend />
      {SIM_PARAM_GROUPS.map((g) => (
        <div key={g.entity} className="space-y-2.5">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="text-base font-semibold">{g.title}</h3>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{g.entity}</code>
          </div>
          <p className="text-sm text-muted-foreground">{g.blurb}</p>
          <Row6Table head={PARAM_HEAD} rows={g.rows} />
        </div>
      ))}
    </div>
  );
}

// ── Supply chain policy catalog (Part IV) ─────────────────────────────────────

type Hook5 = [string, string, string, string, string];
type Policy = {
  ref: string;
  id: string;
  stage: "customer" | "plant" | "supplier" | "transport" | "cross";
  cls: "built_in" | "strategic" | "anticipation" | "improvisation" | "meta";
  constraint: string;
  status: "✅" | "🧩";
  milestone?: string;
  logic: string;
  /** Decision rule / formula block (implemented policies). Plain text, rendered monospace. */
  math?: string;
  hooks?: Hook5[];
  params: Row6[];
};

const POLICY_CLASS_STYLE: Record<Policy["cls"], string> = {
  built_in: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  strategic: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  anticipation: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  improvisation: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  meta: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const POLICY_STAGES: { key: Policy["stage"]; label: string }[] = [
  { key: "customer", label: "Customer · demand-side" },
  { key: "plant", label: "Plant · production & inventory" },
  { key: "supplier", label: "Supplier · sourcing" },
  { key: "transport", label: "Transport · logistics" },
  { key: "cross", label: "Cross-cutting" },
];

const POLICY_CATALOG: Policy[] = [
  {
    ref: "P-C.1", id: "unmet_demand_handling", stage: "customer", cls: "built_in",
    constraint: "demand_side", status: "✅",
    logic: "What happens to an unservable order: it dies (lost_sales — competitive markets), waits (backorder — contractual B2B), or splits (partial_backorder). Backorders convert lost revenue into delay cost, changing the economics of every strategy.",
    math: "FIFO: clear existing backlog first, then serve this week's demand. unmet = D_p − served_new. lost_sales ⇒ lost = unmet, no backlog. backorder ⇒ all unmet waits; partial_backorder ⇒ unmet·partial_accept_prob waits, the rest is lost. Waiting units age in FIFO buckets; a bucket older than backorder_horizon expires to lost; backorder_penalty (€/unit/wk) charged on aged backlog.",
    hooks: [["PH-60", "50", "demand, fg_fulfillment, production_output", "fulfillment, state.backlog, state.cost_ledger, state.lost_sales", "—"]],
    params: [
      ["rule", "enum", "P", "lost_sales", "{lost_sales, backorder, partial_backorder}", "lost_sales ✅ (manuscript)."],
      ["backorder_horizon", "weeks", "P", "4", "[0, 26]", "Aged-out backlog becomes lost."],
      ["backorder_penalty", "€/unit/wk", "P", "0.0", "[0, ∞]", ""],
      ["partial_accept_prob", "—", "P", "0.5", "[0.0, 1.0]", "Share of unmet demand that waits."],
    ],
  },
  {
    ref: "P-C.2", id: "customer_allocation", stage: "customer", cls: "improvisation",
    constraint: "demand_side", status: "🧩", milestone: "M7",
    logic: "Under scarcity, 'who do we disappoint first' is deliberate — protect strategic accounts / SLA tiers / spread pain. Inert for single-customer MTO. Hook: PH-60.",
    params: [
      ["rule", "enum", "C", "fcfs", "{fcfs, priority, fair_share, sla_tier}", ""],
      ["priority_weights", "weight per customer", "C", "—", "—", ""],
      ["sla_tiers", "tier → fill floor %", "C", "—", "—", ""],
      ["fair_share_basis", "enum", "G", "demand", "{demand, history}", ""],
    ],
  },
  {
    ref: "P-C.3", id: "demand_shaping", stage: "customer", cls: "improvisation",
    constraint: "demand_side", status: "🧩", milestone: "M8",
    logic: "Move demand instead of fighting supply — substitution offers, delay incentives; cheap when customers accept. Hook: PH-60.",
    params: [
      ["substitution_offer", "product → substitute", "P", "—", "—", ""],
      ["substitution_accept_prob", "—", "P", "0.5", "[0.0, 1.0]", ""],
      ["substitution_discount", "€/unit", "P", "0.0", "[0, ∞]", ""],
      ["delay_incentive", "€/unit", "P", "0.0", "[0, ∞]", ""],
      ["delay_accept_prob", "—", "P", "0.3", "[0.0, 1.0]", ""],
    ],
  },
  {
    ref: "P-P.1", id: "inventory_control", stage: "plant", cls: "built_in",
    constraint: "material_availability", status: "✅",
    logic: "Everyday replenishment rule (min-max / base-stock / (R,Q) / periodic). The baseline shock absorber every chain already has; quantifying it prevents over-buying dedicated resilience.",
    math: "Levels (Eqs. 2–3): s_m = E[D_m]·T_s,  S_m = E[D_m]·(T_s + κ).  position = on_hand + in_transit + supplier queue. Release (each ≥ MOQ): min_max → if position < s_m, order S_m − position every review_cadence_weeks; base_stock → order S_m − position whenever short; rop_q → fixed rop_q_quantity when position < s_m; periodic → order S_m − position every periodic_review_weeks.",
    hooks: [
      ["PH-70", "50", "material_demand", "inventory_levels", "—"],
      ["PH-80", "50", "inventory_levels, state.on_hand, state.pipeline, state.queue", "purchase_orders", "—"],
    ],
    params: [
      ["policy_type", "enum", "M", "min_max", "{min_max, base_stock, rop_q, periodic}", "min_max ✅ (manuscript)."],
      ["coverage_weeks", "weeks", "G/M", "—", "[0, 26]", "κ — order-up-to cover beyond lead time. Strip 8/10/12."],
      ["review_cadence_weeks", "weeks", "G", "1", "{1, 2, 4}", ""],
      ["rop_q_quantity", "units", "M", "—", "see schema", "Fixed (R,Q) lot; ≥ MOQ enforced."],
      ["periodic_review_weeks", "weeks", "G", "4", "[1, 13]", ""],
    ],
  },
  {
    ref: "P-P.2", id: "lot_sizing", stage: "plant", cls: "built_in",
    constraint: "material_availability", status: "🧩", milestone: "M8",
    logic: "Batching exists for setup economics but can amplify shocks (bullwhip) — test whether your lots worsen propagation. Hook: PH-80.",
    params: [
      ["rule", "enum", "M", "lot_for_lot", "{lot_for_lot, fixed_qty, epq}", ""],
      ["fixed_qty", "units", "M", "—", "see schema", "≥ MOQ enforced."],
      ["epq_setup_cost", "€/setup", "M", "—", "see schema", ""],
    ],
  },
  {
    ref: "P-P.3", id: "safety_stock_materials", stage: "plant", cls: "strategic",
    constraint: "material_availability", status: "✅",
    logic: "ABC-XYZ-differentiated material safety stock (Eqs. 20–21). Dominates short disruptions; depletes — beyond ~7–9 weeks expediting wins (run the crossover sweep). Requires pre-deployment.",
    math: "Eqs. 20–21: ss_s = z_m·σ_{D_m}·√T_s ,  ss_S = z_m·σ_{D_m}·√(T_s + κ), added on top of P-P.1's base levels. z_m = Φ⁻¹(SL_m/100) (normal quantile) from the ABC-XYZ z-matrix: AX 99.5% … CZ 80%. ABC by cumulative value share (80/95), XYZ by demand CV (0.13/0.25). king variant: z·σ_D·√T + z·μ_D·σ_LT. Weekly holding cost h_m·c_m·ss.",
    hooks: [["PH-70", "60", "inventory_levels, material_demand", "inventory_levels, state.cost_ledger", "Adds the safety-stock buffer on top of inventory_control's levels (priority 50) — Eqs. 20–21."]],
    params: [
      ["classification", "enum", "G", "abc_xyz", "{abc_xyz, uniform, fixed_days, king}", "abc_xyz ✅."],
      ["z_matrix", "% service level", "G", "—", "[80, 99.9]", "Nine ABC×XYZ cells."],
      ["abc_breakpoints", "cumulative value share", "G", "[0.8, 0.95]", "—", "A up to 80%, B up to 95%, C the rest (80/15/5)."],
      ["xyz_cv_breakpoints", "demand CV", "G", "[0.13, 0.25]", "—", "X ≤ 0.13, Y ≤ 0.25, Z above."],
      ["uniform_service_level", "%", "G", "95.0", "[80.0, 99.9]", "classification=uniform."],
      ["fixed_days_cover", "days", "G", "14.0", "[0.0, 84.0]", "classification=fixed_days."],
    ],
  },
  {
    ref: "P-P.4", id: "fg_safety_stock", stage: "plant", cls: "strategic",
    constraint: "demand_side", status: "✅",
    logic: "The only buffer DOWNSTREAM of production (MTS only): keeps serving customers while production is blocked, and the only feasible buffer when suppliers are single-sourced. Costs full COGS per unit held. Requires pre-deployment.",
    math: "MTS only. service_level: SS^FG_p = z^FG_p·σ_{D_p} (one-week production cycle); fixed_days: forecast_p·days/7; fixed_units: constant. z^FG = Φ⁻¹(SL/100); abc_by_revenue trims B −2pp, C −5pp (floor 80). Added on the cycle-stock base FG target. Holding cost (h^FG/52)·COGS_p·SS.",
    hooks: [["PH-70", "55", "forecast, state.fg_target", "state.cost_ledger, state.fg_target", "Adds FG safety stock on top of the cycle-stock base target (priority 45) — ADR 0001."]],
    params: [
      ["sizing", "enum", "P", "service_level", "{service_level, fixed_days, fixed_units}", ""],
      ["service_level_pct", "%", "P", "95.0", "[80.0, 99.9]", "z^FG_p."],
      ["fixed_days_cover", "days", "P", "2.0", "[0.0, 12.0]", ""],
      ["fixed_units", "units", "P", "—", "see schema", "sizing=fixed_units."],
      ["holding_cost_rate", "%/yr of COGS", "P", "20.0", "[5.0, 50.0]", "h^FG_p."],
      ["segmentation", "enum", "G", "uniform", "{uniform, abc_by_revenue}", "abc_by_revenue: A = configured SL, B −2 pp, C −5 pp (floor 80)."],
    ],
  },
  {
    ref: "P-P.5", id: "short_term_capacity", stage: "plant", cls: "anticipation",
    constraint: "production_capacity", status: "✅",
    logic: "Overtime: pay-per-use plant headroom (Eq. 22). Bites only when production capacity binds — in material-constrained networks that is rare; check utilization first.",
    math: "Eq. 22: feasible output is computed at base capacity O_p and at O_p·max_overtime_factor; extra = Q^o − Q^base. revenue_positive ⇒ activate only if (Q^o − Q^base)·u_p > C^o, where C^o = extra·u_p·(premium/100). Premium charged on units produced above O_p.",
    hooks: [["PH-40", "40", "demand, firm_knowledge, state.backlog, state.on_hand", "overtime_capacity", "—"]],
    params: [
      ["overtime_premium_pct_of_price", "% of u_p / OT unit", "P", "5.0", "[1.0, 25.0]", "C^o."],
      ["max_overtime_factor", "× O_p", "P", "1.5", "[1.0, 2.0]", ""],
      ["activation", "enum", "G", "revenue_positive", "{revenue_positive, always_during_disruption}", "revenue_positive ✅ (Eq. 22)."],
    ],
  },
  {
    ref: "P-P.6", id: "standing_capacity_reserve", stage: "plant", cls: "strategic",
    constraint: "production_capacity", status: "🧩", milestone: "M8",
    logic: "Permanently maintained plant headroom — option premium vs P-P.5's pay-per-use. Requires pre-deployment. Hook: PH-40.",
    params: [
      ["reserve_factor", "× O_p", "P", "0.2", "[0.0, 0.5]", ""],
      ["standing_cost", "€/wk", "P", "required", "[0, ∞]", ""],
    ],
  },
  {
    ref: "P-P.7", id: "process_flexibility", stage: "plant", cls: "anticipation",
    constraint: "production_capacity", status: "🧩", milestone: "M8",
    logic: "Which lines make which products; Jordan–Graves chaining — a little flexibility buys most of the value. Requires pre-deployment. Hook: PH-40.",
    params: [
      ["flexibility_matrix", "line → products", "P", "required", "—", ""],
      ["switchover_cost", "€/switch", "P", "0.0", "[0, ∞]", ""],
      ["switchover_time_weeks", "weeks", "P", "0", "[0, 2]", ""],
    ],
  },
  {
    ref: "P-P.8", id: "alternative_bom", stage: "plant", cls: "anticipation",
    constraint: "material_availability", status: "🧩", milestone: "M8",
    logic: "Pre-qualified substitutes (Tesla chip-redesign pattern) — the only material-side answer to single-sourced bottlenecks; qualification must precede the crisis. Hooks: PH-40 / PH-50.",
    params: [
      ["substitute_map", "material → substitutes", "M", "required", "—", ""],
      ["substitution_cost", "€/unit", "M", "0.0", "[0, ∞]", ""],
      ["substitute_rates", "units m′ / unit p", "P×M", "—", "—", "r′_{p,m′} > 0."],
      ["auto_substitute", "—", "G", "true", "—", ""],
    ],
  },
  {
    ref: "P-P.9", id: "material_allocation", stage: "plant", cls: "improvisation",
    constraint: "allocation_efficiency", status: "✅",
    logic: "The weekly war-room as a rolling LP (Eqs. 13–17): reassign shared materials across products to protect revenue during scarcity. Costs planner time only; value scales with the shared-material index.",
    math: "Eqs. 13–17: rolling LP over W = window_weeks. max Σ_p w_p·x[p,τ] subject to cumulative shared-material balance Σ_p r_{p,m}·Σ_{τ'≤τ} x[p,τ'] ≤ I_m + arrivals(≤τ), plus per-week capacity and demand caps. objective sets w_p (max_revenue ⇒ w_p = u_p). Solved with HiGHS; weeks with no binding shared material skip the solve; on solver failure it falls back to a revenue-ranked greedy plan (counted in lp_fallbacks).",
    hooks: [["PH-40", "60", "demand, firm_knowledge, overtime_capacity, state.backlog, state.on_hand, state.pipeline", "production_plan, state.cost_ledger", "Replaces the default greedy plan (priority 50) with the rolling-LP allocation when active."]],
    params: [
      ["window_weeks", "weeks", "G", "4", "[1, 13]", "W — rolling horizon."],
      ["objective", "enum", "G", "max_revenue", "{max_revenue, max_fill_rate, priority_weighted, fg_replenish}", "max_revenue ✅; fg_replenish is MTS-only (M7)."],
      ["priority_weights", "weight per product", "P", "—", "—", "objective=priority_weighted; missing products weigh 1."],
      ["annual_cost", "€/yr", "G", "6240.0", "[0, ∞]", "C^alc — planner labor."],
      ["activation", "enum", "G", "during_disruption", "{during_disruption, always}", ""],
      ["solver", "enum", "G", "lp", "{lp, greedy}", "greedy = revenue-ranked heuristic (R3 fallback flag)."],
    ],
  },
  {
    ref: "P-P.10", id: "repurposing", stage: "plant", cls: "improvisation",
    constraint: "production_capacity", status: "🧩", milestone: "M8",
    logic: "Convert lines to new capability mid-crisis (Intel substrate) — high cost, delay, true bounce-forward. Hook: PH-40.",
    params: [
      ["conversion_map", "line → capability", "P", "required", "—", ""],
      ["conversion_cost", "€/conversion", "P", "required", "[0, ∞]", ""],
      ["conversion_time_weeks", "weeks", "P", "2", "[1, 8]", ""],
      ["reversion_time_weeks", "weeks", "P", "1", "[0, 4]", ""],
    ],
  },
  {
    ref: "P-S.1", id: "backup_supplier", stage: "supplier", cls: "strategic",
    constraint: "material_availability", status: "✅",
    logic: "Contingent rerouting to a qualified backup source — premium paid only on rerouted orders. Slower than warm dual-sourcing, and useless when a BoM peer is single-sourced: one missing material still blocks the product. Requires pre-deployment.",
    math: "While the firm SEES a disruption on a material's primary source, this week's released order reroutes to a backup s′ chosen by selection_rule (min_cost | min_leadtime | reliability). Premium (c_{m,s′} − c_{m,s})·qty → backup_premium. activation_trigger=coverage_threshold skips rerouting while position covers ≥ threshold weeks; rerouting persists cooldown_weeks after the event clears (anti-flap). Single-sourced materials are skipped.",
    hooks: [["PH-80", "60", "firm_knowledge, purchase_orders, state.on_hand, state.pipeline, state.queue", "purchase_orders, state.cost_ledger", "Reroutes orders released by inventory_control (priority 50) away from firm-visibly disrupted primary suppliers."]],
    params: [
      ["enabled_materials", "ids", "M", "all_multi_sourced", "see schema", "Materials covered; single-sourced ones are skipped."],
      ["backup_lead_time_weeks", "weeks", "SM", "—", "see schema", "T_{s′} override; None → the backup link's own lead time. Plan default 6."],
      ["selection_rule", "enum", "G", "min_cost", "{min_cost, min_leadtime, reliability}", ""],
      ["activation_trigger", "enum", "G", "on_disruption", "{on_disruption, coverage_threshold}", ""],
      ["coverage_threshold_weeks", "weeks-of-supply", "G", "4.0", "[0.5, 26]", "Reroute only when position covers fewer weeks than this."],
      ["cooldown_weeks", "weeks", "G", "0", "[0, 8]", "Keep using the backup this long after the event clears."],
    ],
  },
  {
    ref: "P-S.2", id: "proactive_multi_sourcing", stage: "supplier", cls: "strategic",
    constraint: "material_availability", status: "✅",
    logic: "Split orders across warm sources in NORMAL operations — no activation delay, permanent premium; the structural answer to capacity-cut events. Pay-always vs P-S.1's pay-on-activation; each slice carries its own source's lead time, so a disruption hits only its slice. Requires pre-deployment.",
    math: "Always-on split of each released order across qualified links by shares w_{m,s} (sum 100; default = equal over the cheapest k where 100/k ≥ min_share_pct). Premium on non-primary slices = Σ (c_{m,s} − c_{m,primary} + secondary_premium)·slice. rebalance_trigger=disruption renormalizes shares onto healthy sources. Each slice carries its own source's lead time, so a disruption hits only its slice.",
    hooks: [["PH-80", "55", "firm_knowledge, purchase_orders", "purchase_orders, state.cost_ledger", "Splits orders released by inventory_control (priority 50) across qualified links; P-S.1 (priority 60) may still reroute a disrupted slice afterwards."]],
    params: [
      ["weights", "share % per (material → supplier)", "SM", "—", "—", "w_{m,s}; each material's shares sum to 100. Absent materials use the default equal split."],
      ["min_share_pct", "%", "G", "20.0", "[5.0, 50.0]", "Smallest viable slice; caps how many sources the default split spreads across."],
      ["rebalance_trigger", "enum", "G", "none", "{none, disruption}", "disruption: shift shares away from firm-visibly disrupted suppliers."],
      ["secondary_premium", "€/unit", "SM", "0.0", "[0, ∞]", "Contractual premium on non-primary slices, on top of the link cost difference."],
    ],
  },
  {
    ref: "P-S.3", id: "capacity_reservation", stage: "supplier", cls: "strategic",
    constraint: "material_availability", status: "🧩", milestone: "M8",
    logic: "Real-options contract (semiconductor-style): standing fee for callable capacity; reserved units bypass capacity cuts. Cheaper than stock for slow, expensive materials. Requires pre-deployment. Hook: PH-80.",
    params: [
      ["reserved_capacity", "units/wk", "SM", "required", "[0, ∞]", ""],
      ["reservation_fee", "€/unit/wk", "SM", "required", "[0, ∞]", ""],
      ["call_leadtime_weeks", "weeks", "SM", "0", "[0, 4]", ""],
    ],
  },
  {
    ref: "P-S.4", id: "early_warning_failover", stage: "supplier", cls: "anticipation",
    constraint: "response_time", status: "🧩", milestone: "M7",
    logic: "Visibility investments compress disruption-start → firm-knows. Makes 'what is a week of warning worth?' a first-class experiment. Requires pre-deployment. Hook: PH-20.",
    params: [
      ["detection_lag_weeks", "weeks", "G/S", "1", "[0, 4]", "Applies to ALL reactive strategies (PH-20)."],
      ["failover_threshold_weeks", "weeks-of-supply", "G", "4.0", "[1.0, 12.0]", ""],
      ["monitoring_cost", "€/yr", "G", "0.0", "[0, ∞]", ""],
    ],
  },
  {
    ref: "P-T.1", id: "multimodal_lane_portfolio", stage: "transport", cls: "strategic",
    constraint: "transport_capacity", status: "🧩", milestone: "M7",
    logic: "Qualified alternative lanes / modes per supplier — edge-risk redundancy; prerequisite for P-T.3 mode_shift. Requires pre-deployment. Hook: PH-90.",
    params: [
      ["lanes", "lanes per supplier link", "SM", "—", "—", "≤3 per SM."],
      ["mode_split_pct", "%", "SM", "—", "—", "Shares sum to 100."],
    ],
  },
  {
    ref: "P-T.2", id: "expedited_shipments", stage: "transport", cls: "improvisation",
    constraint: "response_time", status: "✅",
    logic: "Premium freight pulls existing in-transit forward (Eqs. 18–19) — repeatable every week, hence the strongest long-disruption strategy. Cannot conjure units a capacity cut never shipped (the supplier queue is out of reach).",
    math: "Eqs. 18–19: coverage gap need_m = E[D_m] + backlog_m − on_hand_m − arrivals[t+1,t+2). revenue_positive ⇒ expedite only if marginal value max_p(u_p / r_{p,m}) > premium_unit = c_m·premium/100. Pull up to the gap forward from the earliest future pipeline slots into next week's landing; cost = pulled·c_m·premium/100. Touches in-transit only — never the supplier queue.",
    hooks: [["PH-90", "40", "firm_knowledge, material_demand, state.backlog, state.on_hand, state.pipeline", "state.cost_ledger, state.pipeline", "Runs after the deferral mechanic (priority 10) and before landing (priority 90): expedited quantities land this week at a premium."]],
    params: [
      ["premium_pct_of_cost", "% of c_m / unit", "M", "3.0", "[1.0, 50.0]", "C^exp_m."],
      ["decision", "enum", "G", "revenue_positive", "{revenue_positive, always_during_disruption}", "revenue_positive ✅."],
      ["scope", "enum", "G", "disrupted_materials", "{disrupted_materials, all}", "disrupted_materials ✅."],
    ],
  },
  {
    ref: "P-T.3", id: "mode_shift", stage: "transport", cls: "improvisation",
    constraint: "response_time", status: "🧩", milestone: "M7",
    logic: "Switch NEW orders to a faster lane (sea→air) — composable with P-T.2, which moves the EXISTING flow. Requires P-T.1. Hooks: PH-80 / PH-90.",
    params: [
      ["upgrade_lane", "lane id", "E", "required", "—", "Requires P-T.1."],
      ["lt_saving_weeks", "weeks", "E", "required", "[1, ∞]", ""],
      ["upgrade_cost", "€/unit", "E", "required", "[0, ∞]", ""],
      ["decision", "enum", "G", "revenue_positive", "{revenue_positive, always_during_disruption}", ""],
    ],
  },
  {
    ref: "P-T.4", id: "leadtime_hedging", stage: "transport", cls: "anticipation",
    constraint: "response_time", status: "🧩", milestone: "M8",
    logic: "Order earlier than policy dictates for long-lead / critical materials — a time buffer instead of a unit buffer. Hook: PH-70.",
    params: [
      ["hedge_weeks", "weeks", "M", "2", "[0, 8]", ""],
      ["applies_to", "enum", "G", "long_lt", "{all, long_lt, abc_a_only}", ""],
      ["long_lt_threshold_weeks", "weeks", "G", "12", "[1, 51]", ""],
    ],
  },
  {
    ref: "P-X.1", id: "recovery_playbook", stage: "cross", cls: "meta",
    constraint: "—", status: "🧩", milestone: "M8",
    logic: "Firms execute SEQUENCED responses — detect → expedite → backup → overtime — gated by triggers and budget. Composes enabled policies; replaces flat recovery lists. Hook: PH-20 (evaluation) + delegated.",
    params: [
      ["steps", "ordered steps", "G", "required", "—", ""],
      ["cost_cap", "€", "G", "—", "see schema", ""],
      ["evaluation_cadence_weeks", "weeks", "G", "1", "{1, 2}", ""],
    ],
  },
];

function PolicyCard({ p }: { p: Policy }) {
  return (
    <Card className="border bg-card">
      <CardHeader className="pb-2 space-y-1.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded">{p.ref}</code>
            <CardTitle className="text-base font-mono">{p.id}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5", POLICY_CLASS_STYLE[p.cls])}>
              {p.cls}
            </span>
            <Badge variant={p.status === "✅" ? "secondary" : "outline"} className="text-[10px]">
              {p.status === "✅" ? "implemented" : p.milestone ? `planned · ${p.milestone}` : "planned"}
            </Badge>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          constraint: <code className="text-[11px]">{p.constraint}</code>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{p.logic}</p>
        {p.math && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Formula / decision rule</div>
            <pre className="rounded-md border bg-muted/40 p-3 text-[11.5px] leading-5 whitespace-pre-wrap break-words">{p.math}</pre>
          </div>
        )}
        {p.hooks && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Engine hooks — where the logic fires</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border rounded-md">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    {["Phase", "Prio", "Reads", "Writes", "Resolution"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&_td]:px-2.5 [&_td]:py-2 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
                  {p.hooks.map((h, i) => (
                    <tr key={i}>
                      <td className="font-mono text-[10px] whitespace-nowrap">{h[0]}</td>
                      <td className="font-mono text-[10px]">{h[1]}</td>
                      <td className="text-muted-foreground text-[11px]">{h[2]}</td>
                      <td className="text-muted-foreground text-[11px]">{h[3]}</td>
                      <td className="text-muted-foreground text-[11px]">{h[4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Parameters</div>
          <Row6Table head={PARAM_HEAD} rows={p.params} />
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyCatalog() {
  return (
    <div className="space-y-8">
      <ScopeLegend />
      {POLICY_STAGES.map((st) => {
        const items = POLICY_CATALOG.filter((p) => p.stage === st.key);
        if (!items.length) return null;
        return (
          <div key={st.key} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">{st.label}</h3>
            <div className="space-y-4">
              {items.map((p) => <PolicyCard key={p.id} p={p} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── KPI dictionary (Part V) ───────────────────────────────────────────────────

const KPI_ROWS: { kpi: string; symbol: string; def: string; unit: string }[] = [
  { kpi: "fill_rate", symbol: "FR", def: "Value-weighted served demand: Σ u_p·served_p / Σ u_p·D_p over the analysis window (Eq. 10); weekly FR[t] recorded in the trace.", unit: "%" },
  { kpi: "lost_sales_value", symbol: "—", def: "Σ u_p · L_p over the window.", unit: "€" },
  { kpi: "cost_of_resilience", symbol: "C^res", def: "Material-SS holding + backup premiums + multi-sourcing premiums + expediting + overtime + lost sales + allocation labor + FG-SS holding (MTS) + backorder penalties (Eq. 23).", unit: "€" },
  { kpi: "delta_cost", symbol: "ΔC^res_i", def: "1 − C^res_i / C^res_S0, CRN-paired per replication; positive = cheaper than do-nothing.", unit: "%" },
  { kpi: "delta_revenue", symbol: "ΔR_i", def: "Σu_p(Q_i − Q_S0) / Σu_p(D − Q_S0), CRN-paired; share of S0's lost revenue recovered.", unit: "%" },
  { kpi: "ttr_weeks", symbol: "TTR", def: "Weeks from disruption start until weekly FR re-enters the pre-disruption band (3-week sustained); 0 if FR never left the band.", unit: "wks" },
  { kpi: "tts_weeks", symbol: "TTS", def: "Weeks from disruption start that FR survives inside the band (time-to-survive under the shock).", unit: "wks" },
  { kpi: "service_loss_area", symbol: "SLA", def: "∫ max(0, FR_clean − FR_disrupted) dt over the window, CRN-paired against the same portfolio without events.", unit: "%·wks" },
  { kpi: "max_backlog", symbol: "—", def: "Peak Σ_p B_p within the window.", unit: "units" },
  { kpi: "lost_inbound_units", symbol: "—", def: "Inbound rejected under overflow_rule=reject.", unit: "units" },
  { kpi: "synergy_R / synergy_C", symbol: "—", def: "Δ_portfolio − Σ Δ_components, CRN-paired, percentile-bootstrap stars.", unit: "pp" },
  { kpi: "resilience_index", symbol: "RI", def: "100·[w1(1−SLA) + w2(1−TTR) + w3·TTS + w4(1−C)], w=(.35,.25,.15,.25) editable; components always shown.", unit: "0–100" },
];

function KpiDictionary() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded-md">
        <thead className="bg-muted/40 text-left">
          <tr>
            {["KPI", "Symbol", "Definition", "Unit"].map((h) => (
              <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
          {KPI_ROWS.map((k) => (
            <tr key={k.kpi}>
              <td className="font-mono text-xs font-medium whitespace-nowrap">{k.kpi}</td>
              <td className="font-mono text-xs whitespace-nowrap">{k.symbol}</td>
              <td className="text-muted-foreground text-[13px]">{k.def}</td>
              <td className="text-muted-foreground whitespace-nowrap text-xs">{k.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Generic two-column reference table ────────────────────────────────────────

function TwoColTable({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded-md">
        <thead className="bg-muted/40 text-left">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
          {rows.map((r) => (
            <tr key={r[0]}>
              <td className="font-mono text-[12px] whitespace-nowrap">{r[0]}</td>
              <td className="text-muted-foreground text-[13px]">{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Engine mechanics (always-on, non-optional) ────────────────────────────────

const MECHANICS: [string, string][] = [
  ["mech.demand · PH-10", "Update the forecast from history, then draw D_p[t] from the world demand stream."],
  ["mech.fulfill_from_stock · PH-30", "MTS serves D_p from finished-goods stock (no-op for MTO)."],
  ["mech.default_plan · PH-40", "Greedy feasible production plan, capacity-gated."],
  ["mech.production_execute · PH-50", "Produce Q_p and consume materials (Eqs. 8–9)."],
  ["mech.material_demand · PH-70", "Project material demand D_m (Eq. 1)."],
  ["mech.fg_target_base · PH-70", "Cycle-stock base FG target (MTS, ADR 0001, priority 45)."],
  ["mech.orders_to_queue · PH-80", "Released purchase orders enter the supplier queue (priority 90)."],
  ["mech.defer / ship_queue / land · PH-90", "Capacity gating, LT-extension deferral (Eqs. 11–12), arrivals landing."],
  ["mech.accounting · PH-99", "Cost rollup, KPI rows, trace (read-only)."],
];

// ── Probability distributions (Part III / engine sampling) ────────────────────

type DistRow = { name: string; form: string; notes: string };

const DEMAND_DISTS: DistRow[] = [
  { name: "triangular ✅", form: "Tri(a, b, c) — inverse-CDF", notes: "Manuscript core. E=(a+b+c)/3; Var=(a²+b²+c²−ab−ac−bc)/18. Default a=max{0,(1−ν)·b}, c=(1+ν)·b." },
  { name: "triangularAV", form: "triangular(avg·(1−v), avg, avg·(1+v))", notes: "'Average & Variability' form: mode = avg, symmetric ±v range (a floored at 0). In scsim: demand_mode = avg, demand_floor_factor (ν) = v. e.g. avg 100, v 0.30 → Tri(70, 100, 130). Use Product.with_triangular_av(average, variability)." },
  { name: "deterministic", form: "D = b", notes: "No randomness; Var = 0." },
  { name: "poisson", form: "Pois(λ), λ = b", notes: "Counts; E = Var = b." },
  { name: "negbin", form: "NB(k, p), p = k/(k+b)", notes: "Over-dispersed counts. E = b; Var = b + b²/k. Larger k → closer to Poisson." },
  { name: "bootstrap", form: "uniform resample of demand_history", notes: "Empirical. E, Var from the sample (ddof = 1). Requires demand_history." },
];

const LEADTIME_DISTS: DistRow[] = [
  { name: "deterministic ✅", form: "T = lead_time_weeks", notes: "No randomness (manuscript)." },
  { name: "lognormal", form: "σ²=ln(1+CV²), μ=ln(T)−σ²/2; round", notes: "E[X] = T, Var = T²·CV²." },
  { name: "gamma", form: "α=1/CV², β=T·CV²; round", notes: "E[X] = T, Var = T²·CV²." },
  { name: "empirical", form: "— (M7)", notes: "Lands with the data-import path; compiling one today raises a clear error." },
];

const DISRUPTION_DRAWS: [string, string][] = [
  ["start (t*)", "U{t_w … t_w+2} from the hazard_start stream (manuscript U{85..87}); fixed when start is given."],
  ["duration (Δt)", "U{min … max} from the hazard_duration stream; fixed when an int is given (default range 5–10)."],
  ["magnitude (φ)", "capacity_reduction factor, drawn from the hazard_magnitude stream when ranged (0 = full outage)."],
];

const ENUM_GROUPS: [string, string][] = [
  ["DemandModel", "deterministic · triangular ✅ · poisson · negbin · bootstrap"],
  ["LeadTimeDist", "deterministic ✅ · lognormal · gamma · empirical (M7)"],
  ["FulfillmentMode (CODP)", "mto ✅ · mts (M7) · ato (reserved)"],
  ["ForecastModel", "naive · ma ✅ · exp_smoothing · perfect"],
  ["EffectType", "lead_time_extension ✅ · capacity_reduction"],
  ["TargetType", "node:supplier ✅ · node:plant ✅ · edge:lane (behavior-neutral)"],
  ["OverflowRule", "queue · reject (→ lost_inbound_units)"],
  ["Onset / RecoveryProfile", "step · ramp_linear"],
  ["TransportMode", "default · sea · air · road · rail"],
  ["WarmupMethod", "conway · mser5 · manual · most_conservative ✅"],
  ["RunMode", "full ✅ · fast_scan"],
  ["ReplicationStopping", "fixed ✅ · sequential_ci"],
];

function DistTable({ caption, rows }: { caption: string; rows: DistRow[] }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{caption}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border rounded-md">
          <thead className="bg-muted/40 text-left">
            <tr>
              {["Distribution", "Form / sampling", "Moments & notes"].map((h) => (
                <th key={h} className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:px-2.5 [&_td]:py-2 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="font-mono text-[11px] font-medium whitespace-nowrap">{r.name}</td>
                <td className="font-mono text-[11px]">{r.form}</td>
                <td className="text-muted-foreground text-[12px]">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── KPI cost components & Resilience Index normalization ──────────────────────

const COST_COMPONENTS: [string, string][] = [
  ["mat-SS holding", "h_m·c_m on safety-stock inventory (P-P.3)."],
  ["backup premium", "(c_{m,s′} − c_{m,s})·qty on rerouted orders (P-S.1)."],
  ["multi-sourcing premium", "non-primary slice premium + secondary_premium (P-S.2)."],
  ["expediting", "c_m·premium on pulled-forward units (P-T.2)."],
  ["overtime", "u_p·premium on units above O_p (P-P.5)."],
  ["lost sales", "u_p·L_p — unmet demand valued at price."],
  ["allocation labor", "annual planner cost amortized weekly (P-P.9)."],
  ["FG-SS holding", "(h^FG/52)·COGS on FG safety stock (P-P.4, MTS)."],
  ["backorder penalty", "backorder_penalty on aged backlog (P-C.1)."],
];

const RI_COMPONENTS: { comp: string; weight: string; norm: string; note: string }[] = [
  { comp: "ŠLA — service loss", weight: "w₁ = .35", norm: "SLA / window_weeks", note: "FR ∈ [0,1] bounds the loss area by window length." },
  { comp: "ŤTR — time-to-recover", weight: "w₂ = .25", norm: "TTR / window_weeks", note: "Censored at window ⇒ 1 (never recovered)." },
  { comp: "ŤTS — time-to-survive", weight: "w₃ = .15", norm: "TTS / window_weeks", note: "Entered as +ŤTS (more survival = better); censored ⇒ 1." },
  { comp: "Č — cost", weight: "w₄ = .25", norm: "C^res / clean-baseline revenue", note: "Cost in units of healthy revenue, clipped to [0,1]." },
];

function ResilienceIndexTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded-md">
        <thead className="bg-muted/40 text-left">
          <tr>
            {["Component", "Weight", "Normalization", "Rationale"].map((h) => (
              <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
          {RI_COMPONENTS.map((r) => (
            <tr key={r.comp}>
              <td className="font-medium text-[13px] whitespace-nowrap">{r.comp}</td>
              <td className="font-mono text-xs whitespace-nowrap">{r.weight}</td>
              <td className="font-mono text-[11px] whitespace-nowrap">{r.norm}</td>
              <td className="text-muted-foreground text-[12px]">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Experiments: synergy · stress tests · performance · roadmap ───────────────

const STRESS_TESTS: { id: string; status: string; desc: string }[] = [
  { id: "ST-1", status: "✅", desc: "Supplier outage sweep — each supplier × lead-time extension × Δt {5, 8, 10} weeks (manuscript)." },
  { id: "ST-2", status: "✅", desc: "Supplier capacity-cut sweep — supplier × φ {0.75, 0.5, 0.25, 0} × {4, 8} weeks; cells without finite capacity are skipped with a reason." },
  { id: "ST-3", status: "🧩 M7", desc: "Material shortage sweep." },
  { id: "ST-4", status: "🧩 M7", desc: "Edge / lane shock (needs the edge split)." },
  { id: "ST-5", status: "🧩 M7", desc: "Demand surge." },
  { id: "ST-6", status: "🧩 M7", desc: "Compound shock (ST-1 ∩ ST-5)." },
  { id: "ST-7", status: "🧩 M7", desc: "Nexus-node attack — top-k ML-critical nodes (ml-service integration)." },
];

const PERF_TARGETS: { workload: string; target: string; measured: string }[] = [
  { workload: "Single rep, manuscript scale (15 P × 556 M × 58 S × 156 wk)", target: "≤ 0.5 s", measured: "~0.33 s" },
  { workload: "Large instance (200 P × 5,000 M × 300 S × 156 wk)", target: "≤ 5 s/rep", measured: "~2.5 s" },
  { workload: "One experiment cell (540 reps)", target: "≤ 90 s / 8 cores", measured: "embarrassingly parallel" },
];

const PERF_TECHNIQUES: string[] = [
  "Phase-sweep vectorization — inventory math is NumPy over material vectors; production walks the sparse BoM (CSR) once.",
  "Ring-buffer pipeline — in-transit is a circular [links × W] array; LT-extension deferral and expediting are slot moves.",
  "Parallelism across runs only — replications and stress cells are embarrassingly parallel; within a run stays single-threaded and deterministic.",
  "Warm-state snapshots — stress batteries restore the post-warm-up world per model seed (bit-identity tested).",
  "LP discipline (P-P.9) — active-products × binding-shared-materials prefilter, 4-week horizon, HiGHS; non-binding weeks skip the solve.",
  "IO discipline — traces buffer in NumPy, one Parquet (zstd) file per replication; verbosity kpi_only / weekly / full_debug.",
];

const ROADMAP: { m: string; deliverable: string; status: string }[] = [
  { m: "M1", deliverable: "Entities + Part III dictionary; registry; phase-pipeline skeleton.", status: "✅" },
  { m: "M2", deliverable: "MTO core loop (PH-10..99); LT-extension injector; warm-up detection; ring-buffer pipeline.", status: "✅" },
  { m: "M3", deliverable: "Policies as plugins; keyed policy RNG; warm-state snapshots.", status: "✅" },
  { m: "M4", deliverable: "ST-1 end-to-end + scorecard + Resilience Index; fast_scan.", status: "✅ engine" },
  { m: "M5", deliverable: "Portfolio study + synergy decomposition (CRN, bootstrap stars, breadth ladder).", status: "✅ engine" },
  { m: "M6", deliverable: "Docs auto-generation + docs CI gate; validation suite.", status: "✅" },
  { m: "M7", deliverable: "capacity_reduction ✅, ST-2 ✅, MTS + P-P.4 ✅, P-S.2 ✅; plant/edge targets, edge split, P-S.4, P-C.2, ST-3/4/5.", status: "🔜 most shipped" },
  { m: "M8", deliverable: "Remaining policies; P-X.1 recovery playbook; LLM diff proposer.", status: "🧩" },
];

function Experiments() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Portfolio synergy</h3>
        <Prose>
          <p>
            A portfolio study runs S0 (built-ins only) and each strategy portfolio under one shared
            world (CRN by construction), with one warm-up detected on S0 and reused across all
            portfolios. Per replication it records ΔR, ΔC, and SLA, then decomposes the combination
            effect:
          </p>
        </Prose>
        <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`synergy_X(AB…) = Δ_X(combo) − Σ Δ_X(components)      (X ∈ {R, C})

  > 0  complementary  — the combination unlocks more than the parts
  < 0  submodular     — the strategies overlap on the same bottleneck`}
        </pre>
        <Prose>
          <p>
            Synergy is CRN-paired per replication and percentile-bootstrapped (two-sided, stars at
            .05/.01/.001). A breadth ladder reports mean ΔR/ΔC by portfolio breadth (the inverted-U);
            portfolios with breadth ≥ 4, or ≥ 2 pre-deployed strategies on one constraint tag, carry
            structured feasibility warnings.
          </p>
        </Prose>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Stress-test battery</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-md">
            <thead className="bg-muted/40 text-left">
              <tr>
                {["Test", "Status", "What it sweeps"].map((h) => (
                  <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
              {STRESS_TESTS.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs whitespace-nowrap">{s.id}</td>
                  <td className="text-xs whitespace-nowrap">{s.status}</td>
                  <td className="text-muted-foreground text-[13px]">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Prose>
          <p className="text-sm text-muted-foreground">
            All cells share one clean reference run (SLA series, RI cost normalization) and one
            warm-state snapshot per model seed — cells restore at t_w and simulate only post-warm-up
            weeks under the same world streams (paired). ST-1 ranks suppliers under delay; ST-2 ranks
            them under volume loss — the same supplier can rank differently across the two.
          </p>
        </Prose>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-md">
            <thead className="bg-muted/40 text-left">
              <tr>
                {["Workload", "Target", "Measured"].map((h) => (
                  <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
              {PERF_TARGETS.map((p) => (
                <tr key={p.workload}>
                  <td className="text-[13px]">{p.workload}</td>
                  <td className="font-mono text-xs whitespace-nowrap">{p.target}</td>
                  <td className="font-mono text-xs whitespace-nowrap">{p.measured}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
          {PERF_TECHNIQUES.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Roadmap (M1–M8)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-md">
            <thead className="bg-muted/40 text-left">
              <tr>
                {["Milestone", "Deliverable", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20 align-top">
              {ROADMAP.map((r) => (
                <tr key={r.m}>
                  <td className="font-mono text-xs whitespace-nowrap">{r.m}</td>
                  <td className="text-muted-foreground text-[13px]">{r.deliverable}</td>
                  <td className="text-xs whitespace-nowrap">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
  { id: "des-model",    label: "Engine & phase pipeline", group: "For Modelers" },
  { id: "sim-params",   label: "Simulation parameters", group: "For Modelers" },
  { id: "distributions", label: "Probability distributions", group: "For Modelers" },
  { id: "policies",     label: "Supply chain policies", group: "For Modelers" },
  { id: "network-sci",  label: "Network science",       group: "For Modelers" },
  { id: "stats",        label: "Statistical methods",   group: "For Modelers" },
  { id: "kpis",         label: "KPIs & Resilience Index", group: "For Modelers" },
  { id: "experiments",  label: "Synergy, stress & performance", group: "For Modelers" },
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

// Per-page documentation bodies, keyed by slug. Rendered by the /help docs site
// (src/pages/help/HelpPage.tsx) inside the dedicated DocsLayout chrome. Each body
// returns one titled <Section>; sub-headings (h3) feed the right-hand rail.
export const DOC_BODIES: Record<string, () => JSX.Element> = {
  overview: () => (
            <Section id="overview" icon={BookOpen} title="What is this tool">
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
  ),
  "user-stories": () => (
            <Section id="user-stories" icon={Users} title="User stories">
              <Prose>
                <p className="text-muted-foreground">
                  Each story follows the standard format: <em>As a [role], I want [goal] so that [benefit].</em>
                </p>
              </Prose>
              <UserStoryList />
            </Section>
  ),
  accurate: () => (
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
  ),
  workflow: () => (
            <Section id="workflow" icon={ListChecks} title="Planner workflow">
              <Prose>
                <p>
                  The typical end-to-end workflow follows six steps. Each step corresponds to a
                  specific page in the application.
                </p>
              </Prose>
              <WorkflowSteps />
            </Section>
  ),
  "use-cases": () => (
            <Section id="use-cases" icon={BarChart3} title="Use cases by page">
              <Prose>
                <p>
                  Each page in the application serves a distinct role in the resilience assessment process.
                </p>
              </Prose>
              <UseCaseCards />
            </Section>
  ),
  pilots: () => (
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
  ),
  "des-model": () => (
            <Section id="des-model" icon={FlaskConical} title="Engine & phase pipeline">
              <Prose>
                <p>
                  The simulation engine is <strong>scsim</strong> (engine 0.2.0) — a discrete-time
                  simulator of a <strong>three-echelon network</strong> (suppliers → plant → customers)
                  advancing on weekly ticks. The default product mode is <strong>make-to-order
                  (MTO)</strong>; make-to-stock (MTS) and assemble-to-order (ATO) are supported per
                  product. Manuscript constructs are the validated core (✅); everything else is a
                  governed extension (🧩) that lands at the listed milestone — compiling a planned
                  policy raises a clear error, never a silent no-op.
                </p>
                <p>
                  The weekly cycle is <strong>data, not code</strong>: each tick runs a fixed sequence
                  of eleven phases (PH-00 … PH-99). Two kinds of code attach to a phase —
                  <strong> mechanics</strong> and <strong>policies</strong>:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>
                    <strong>Mechanics</strong> are the always-on conservation math (demand draw,
                    production, material balance, logistics, accounting). They cannot be disabled and
                    do not read policy parameters — they are the physics of the chain.
                  </li>
                  <li>
                    <strong>Policies</strong> are optional, configurable decision modules that adjust
                    choices <em>within</em> that physics (how much to order, where to source, whether to
                    expedite). The twenty-two policies compose without rewriting the engine.
                  </li>
                </ul>
                <p>
                  Both register as phase hooks with declared <code>reads</code>/<code>writes</code> and a
                  <strong> priority</strong>. Load-time validation rejects an illegal read or write; when
                  two hooks write the same key in the same phase they must declare distinct priorities and
                  a resolution rule (e.g. P-P.3 adds safety stock <em>after</em> P-P.1 sets base levels;
                  P-P.9 replaces the default plan).
                </p>
              </Prose>
              <PhasePipeline />
              <Prose>
                <p className="text-sm text-muted-foreground pt-1">
                  The always-on mechanics behind those phases:
                </p>
              </Prose>
              <TwoColTable head={["Mechanic · phase", "Role"]} rows={MECHANICS} />
              <Prose>
                <h3 className="text-base font-semibold pt-2">Warm start (t = 0)</h3>
                <p>
                  An empty chain is not steady state, so the engine runs the PH-70 planning chain once to
                  obtain levels, then seeds on-hand inventory at{" "}
                  <code>I_m(0) = max(S_m − E[D_m]·T_s, 0)</code> (position starts exactly at the order-up-to
                  level <code>S_m</code>, in saw-tooth phase) and primes the in-transit pipeline with one
                  expected week of demand per slot. <code>initial_on_hand</code> overrides per material;
                  MTS products start at their finished-goods target.
                </p>
                <p>
                  The three manuscript processes — demand management, material procurement, and
                  production &amp; fulfillment — map onto these phases. Their core equations follow.
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
                  This is the <code>lead_time_extension</code> effect (✅ Eqs. 11–12): units are{" "}
                  <em>delayed, never destroyed</em>. The second effect, <code>capacity_reduction</code>,
                  throttles a supplier's weekly outbound flow to <code>φ · capacity_per_week</code> (φ = 0
                  is a full outage). Under <code>overflow_rule = queue</code> nothing is lost — the cut
                  volume waits in the supplier queue; under <code>reject</code> the excess is dropped and
                  logged as <code>lost_inbound_units</code>. Both onset and recovery can be a{" "}
                  <code>step</code> or a <code>ramp_linear</code> over <code>ramp_weeks</code>. Detection
                  is gated: a firm only sees an event at <code>t ≥ start + detection_lag_weeks</code>.
                </p>
                <p className="text-sm text-muted-foreground">
                  In the manuscript study, disruption duration is uniform over [5, 10] weeks and start
                  time is uniform over weeks 85–87 (steady state). See{" "}
                  <a href="#distributions" className="underline">Probability distributions</a> for how
                  every random quantity is drawn.
                </p>
              </Prose>
            </Section>
  ),
  "sim-params": () => (
            <Section id="sim-params" icon={SlidersHorizontal} title="Simulation parameters">
              <Prose>
                <p>
                  Every quantity the engine reads is a typed, range-checked parameter in the scsim
                  registry — Pydantic is canonical, so an undocumented parameter fails the docs CI gate.
                  The tables below are the complete <strong>variable dictionary</strong>, grouped by the
                  entity that owns each parameter. Symbols (<code>u_p</code>, <code>T_s</code>,{" "}
                  <code>r_&#123;p,m&#125;</code>, κ, ν, …) match the equations in the previous section.
                  Scope tags say how broadly a value applies.
                </p>
              </Prose>
              <SimParameters />
            </Section>
  ),
  distributions: () => (
            <Section id="distributions" icon={Dices} title="Probability distributions">
              <Prose>
                <p>
                  The simulation is stochastic: demand, lead times, and disruption timing are drawn from
                  named distributions, each seeded from the project's <a href="#stats" className="underline">seed
                  tree</a> so runs are reproducible and configurations are comparable on identical draws.
                  Below is every distribution the engine can sample, with its exact form.
                </p>
              </Prose>
              <DistTable caption="Demand models (per product · demand_model)" rows={DEMAND_DISTS} />
              <Prose>
                <p>
                  <strong>triangularAV</strong> ("Average &amp; Variability") is the convenience form most
                  pilots use: instead of giving an explicit (min, mode, max), you give an{" "}
                  <em>average</em> and a <em>± variability</em> fraction, and the engine builds a symmetric
                  triangular around it:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`triangularAV(average, variability)
    = triangular( average·(1 − variability),  average,  average·(1 + variability) )

example:  triangularAV(100, 0.30)  =  triangular(70, 100, 130)

In scsim:  demand_mode = average,  demand_floor_factor (ν) = variability
           Product.with_triangular_av(average=100, variability=0.30, …)`}
              </pre>
              <DistTable caption="Lead-time distributions (per supplier link · lead_time_dist, lead_time_cv)" rows={LEADTIME_DISTS} />
              <Prose>
                <p className="text-sm text-muted-foreground">
                  Stochastic lead times consume the world <code>leadtime</code> stream only when an order
                  actually ships — a documented CRN caveat (different ordering patterns consume different
                  numbers of draws). The manuscript uses deterministic lead times, so it is unaffected.
                </p>
                <h3 className="text-base font-semibold pt-2">Disruption draws</h3>
              </Prose>
              <TwoColTable head={["Quantity", "Sampling"]} rows={DISRUPTION_DRAWS} />
              <Prose>
                <h3 className="text-base font-semibold pt-2">Normal distribution</h3>
                <p>
                  The normal (Gaussian) distribution is not used to generate demand — it appears as the
                  service-level <strong>z-score</strong> for safety stock: <code>z = Φ⁻¹(SL%)</code> (the
                  inverse normal CDF), computed once at policy setup for P-P.3 and P-P.4. A 95% service
                  level gives <code>z ≈ 1.645</code>; the ABC-XYZ matrix assigns a different SL (hence z)
                  to each material class.
                </p>
                <h3 className="text-base font-semibold pt-2">Allowed values (enums)</h3>
                <p className="text-sm text-muted-foreground">
                  The full set of accepted values for the categorical parameters above (✅ = validated /
                  default-selected today).
                </p>
              </Prose>
              <TwoColTable head={["Enum", "Allowed values"]} rows={ENUM_GROUPS} />
            </Section>
  ),
  policies: () => (
            <Section id="policies" icon={Layers} title="Supply chain policies">
              <Prose>
                <p>
                  Policies in scsim are <strong>operational supply-chain policies</strong> — the everyday
                  rules a chain runs every week: <strong>inventory</strong> (min-max, base-stock, (R,Q),
                  safety stock), <strong>production</strong> (lot sizing, overtime, material allocation),
                  <strong> sourcing</strong> (backup, multi-sourcing), <strong>transport</strong>
                  {" "}(expediting, lane choice), and <strong>demand</strong> (lost-sales / backorder).
                  They are <em>not</em> merely "resilience strategies": the everyday rules are the
                  operational baseline, and the resilience levers are a subset layered on top. Each is a
                  module that hooks a phase — distinct from the always-on{" "}
                  <a href="#des-model" className="underline">mechanics</a>.
                </p>
                <p>
                  Twenty-two policies span five <em>classes</em> (the second axis, orthogonal to the
                  network stage they act on). The do-nothing baseline (<strong>S0</strong>) runs the
                  built-in policies only:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li><strong>built_in</strong> — everyday operational baseline (inventory control, lot sizing, unmet-demand handling). NOT resilience levers — they are what resilience is measured against.</li>
                  <li><strong>strategic</strong> — pre-positioned structural choices; require pre-deployment before the shock (safety stock, dual-sourcing, backup, reservation).</li>
                  <li><strong>anticipation</strong> — capabilities readied ahead of time and triggered on detection (overtime, flexibility, early-warning failover).</li>
                  <li><strong>improvisation</strong> — in-crisis reactions that need no pre-build (material allocation, expediting, demand shaping).</li>
                  <li><strong>meta</strong> — orchestration that sequences other policies (recovery playbook).</li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  Status: <strong>✅ implemented</strong> = validated manuscript core, runnable today;{" "}
                  <strong>🧩 planned</strong> = full parameter schema lives in the registry, with the
                  engine landing at the listed milestone (compiling one raises a clear error, never a
                  silent no-op). Cards are grouped by network stage; each lists the policy logic, its
                  formula / decision rule (implemented policies), the engine hook(s) it fires in (phase,
                  priority, reads, writes, conflict resolution), and its complete parameter set.
                </p>
              </Prose>
              <PolicyCatalog />
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
  ),
  "network-sci": () => (
            <Section id="network-sci" icon={Share2} title="Network science methods">
              <Prose>
                <p>
                  The supply chain is represented as an <strong>integrated firm-product network</strong>
                  {" "}that combines supplier-buyer relationships with bill-of-materials structure.
                  This integration — relatively unexplored in prior literature — allows structural
                  metrics at the material node level to predict resilience impact without requiring
                  disruption probability estimates or TTR data from suppliers.
                </p>
                <h3 className="text-base font-semibold pt-2">Video walkthrough: exploring the network view</h3>
                <p>
                  Watch the tutorial below to see how the three network levels, nexus detection, and structural metrics work together in the app.
                </p>
              </Prose>
              {/* Replace VIDEO_ID with your network view tutorial video ID */}
              <YouTubeEmbed videoId="VIDEO_ID" title="Network view tutorial" className="max-w-[760px]" />
              <Prose>
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
  ),
  stats: () => (
            <Section id="stats" icon={Sigma} title="Statistical methods">
              <Prose>
                <p>
                  Results are statistical estimates, not point values. Every random draw descends from a
                  single <code>project_seed</code> through a keyed <strong>SeedSequence tree</strong> with
                  three realms, so stream identity is structural (independent of creation order) and fully
                  reproducible:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`project_seed
 ├─ WORLD  (realm, model_rep, stream_id)      demand, leadtime
 │      keyed by model_rep ONLY → identical world across every portfolio
 │      and event seed of a project  ⇒  Common Random Numbers (CRN)
 ├─ HAZARD (realm, event_rep, event_idx, draw) start, duration, magnitude
 └─ POLICY (realm, model_rep, event_rep, policy_key)   one stream per policy
        policy_key = SHA-256(policy_id) → adding policy #22 cannot perturb
        the draws of policies #1–21 or of the world streams (G-RNG guarantee)`}
              </pre>
              <Prose>
                <h3 className="text-base font-semibold pt-1">Replications &amp; CRN</h3>
                <p>
                  The replication grid is <code>model_seeds × disruption_event_seeds</code> (default
                  30 × 18); the event axis collapses to 1 when every event is fixed. The study-grade floor
                  is 30 model seeds — below 10 carries a <code>below_replication_floor</code> badge.
                  Because world streams are keyed by <code>model_rep</code> alone, every portfolio and
                  stress cell sees the <em>same</em> demand and lead-time trajectory — the pairing that
                  makes strategy deltas and synergy measurable.
                </p>
                <h3 className="text-base font-semibold pt-2">Warmup detection</h3>
                <p>
                  An empty chain is not steady state, so an initial window is discarded. Both detectors
                  run on the clean (no-event) fill-rate series and <code>warmup_method</code> defaults to{" "}
                  <code>most_conservative</code> — the later (max) of the two:
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`MSER-5 : batch the series into means of width 5; pick the truncation d*
         that minimizes  z(d) = Var(batch_means[d:]) / (n_b − d)²
         (search restricted to the first half of the batches)

Conway : first index k such that x[k] is NEITHER the max NOR the min
         of the remaining tail x[k:]

adopted = max(Conway, MSER-5)        # most_conservative (default)`}
              </pre>
              <Prose>
                <p>
                  KPI statistics are computed only over the <code>analysis_window</code> (default 52
                  weeks) starting at the adopted <code>warmup_end</code> (manuscript ≈ 85).
                </p>
                <h3 className="text-base font-semibold pt-2">Bootstrap &amp; significance</h3>
                <p>
                  Δ and synergy metrics are summarized by a <strong>percentile bootstrap</strong>
                  {" "}(<code>bootstrap_resamples</code>, default 10 000): resample the <em>replication
                  indices</em> with replacement (which preserves CRN pairing), recompute the mean, and take
                  the <code>ci_level</code> percentile bounds. The two-sided p-value is{" "}
                  <code>2·min(frac≤0, frac≥0)</code>, with stars at .05 / .01 / .001. The bootstrap RNG is
                  analysis-time only — separate from the simulation seed tree, so CIs are themselves
                  deterministic.
                </p>
                <p className="text-sm text-muted-foreground">
                  Note: the only variance-reduction techniques in the engine are <strong>CRN</strong> and
                  the <strong>bootstrap</strong> — there are no antithetic variates. (triangularAV is a{" "}
                  <a href="#distributions" className="underline">distribution form</a>, not a
                  variance-reduction method.)
                </p>
                <h3 className="text-base font-semibold pt-2">Confidence intervals &amp; stopping</h3>
                <p>
                  Intervals are reported at <code>ci_level</code> (default 95%).{" "}
                  <code>replication_stopping</code> is <code>fixed</code> by default; setting{" "}
                  <code>sequential_ci</code> adds replications until the fill-rate CI half-width meets{" "}
                  <code>ci_halfwidth_target</code> (ε, default 0.05) or the cap is reached. Portfolio
                  comparison reports <code>ΔC^res_i</code> and <code>ΔR_i</code>, CRN-paired against the
                  do-nothing baseline S0.
                </p>
              </Prose>
            </Section>
  ),
  kpis: () => (
            <Section id="kpis" icon={Gauge} title="KPIs & Resilience Index">
              <Prose>
                <p>
                  The engine emits a fixed-shape KPI vector each run. <code>fill_rate</code> is the
                  primary service-level KPI and the basis for steady-state detection; the remaining
                  metrics quantify cost, recovery dynamics (TTR / TTS), service loss, and combination
                  effects. Δ and synergy metrics are CRN-paired against the S0 baseline.
                </p>
              </Prose>
              <KpiDictionary />
              <Prose>
                <h3 className="text-base font-semibold pt-2">Cost of resilience — components</h3>
                <p>
                  <code>cost_of_resilience</code> sums these components over the analysis window; each is
                  attributed to the policy that incurs it.
                </p>
              </Prose>
              <TwoColTable head={["Component", "Definition"]} rows={COST_COMPONENTS} />
              <Prose>
                <h3 className="text-base font-semibold pt-2">Recovery band (TTR / TTS)</h3>
                <p>
                  TTR and TTS use each replication's own pre-disruption fill-rate band: the mean over
                  [t_w, t*) minus 2 pp (<code>FR_BAND_PP = 0.02</code>). TTS = weeks the fill rate survives
                  inside the band; TTR = weeks until it re-enters the band and holds for 3 sustained weeks
                  (<code>TTR_SUSTAIN_WEEKS = 3</code>); both are censored at the window.
                </p>
                <h3 className="text-base font-semibold pt-2">Resilience Index</h3>
                <p>
                  A single 0–100 score blends four normalized components (weights editable, must sum to 1);
                  the components are always shown alongside it.
                </p>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`RI = 100 · [ w₁(1 − ŠLA) + w₂(1 − ŤTR) + w₃·ŤTS + w₄(1 − Č) ]      w = (.35, .25, .15, .25)`}
              </pre>
              <ResilienceIndexTable />
            </Section>
  ),
  experiments: () => (
            <Section id="experiments" icon={Microscope} title="Synergy, stress tests & performance">
              <Prose>
                <p>
                  Beyond a single run, scsim answers portfolio-level questions: do strategies reinforce or
                  cannibalize each other (synergy), which supplier hurts most under delay vs volume loss
                  (stress tests), and does it all run fast enough to be interactive (performance).
                </p>
              </Prose>
              <Experiments />
            </Section>
  ),
  tldr: () => (
            <Section id="tldr" icon={Activity} title="TL;DR">
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
  ),
  "data-flow": () => (
            <Section id="data-flow" icon={Workflow} title="Data → simulation mapping">
              <Prose>
                <p>
                  Stored project data is turned into a simulation run by <strong>one canonical
                  mapper</strong> — <code>scsim/scsim/io/project_map.py</code>
                  {" "}(<code>ProjectData → from_project_data → Scenario</code>). The full, authoritative
                  contract lives in <code>docs/data-simulation-mapping.md</code>; this page is the
                  summary. The economics that drive KPIs come from the <strong>item-master</strong>
                  tables first (materials · products · suppliers); logistics and policy values are only
                  fallbacks, and <em>every</em> fallback is recorded as a warning so nothing is silently
                  wrong.
                </p>
                <h3 className="text-base font-semibold pt-1">Pipeline</h3>
              </Prose>
              <pre className="rounded-md border bg-muted/40 p-4 text-[12.5px] leading-6 overflow-x-auto">
{`item masters ─┐
logistics/BOM ├─ datamap.py ─► ProjectData ─► from_project_data ─► Scenario + MappingWarnings
policies      │   (service       (typed,        (reducers · units ·
scenario      ┘    role read)     pure)          defaults · warnings)
                                        └─► run_scenario ─► ScenarioResult ─► save (worker)`}
              </pre>
              <Prose>
                <h3 className="text-base font-semibold pt-1">Key field rules</h3>
                <p>
                  All time is normalized to <strong>weeks</strong>. First non-null wins; a ⚠ default is
                  surfaced to the planner.
                </p>
              </Prose>
              <TwoColTable
                head={["scsim parameter", "Source · reducer · default"]}
                rows={[
                  ["Material.cost c_m", "materials.cost → cheapest supplier link → 1.0 ⚠"],
                  ["Product.unit_price u_p", "products.sell_price → demand-weighted avg outbound price → 1.0 ⚠"],
                  ["Product.demand_mode b_p", "products.demand_mean → Σ weekly outbound volume (all units normalized)"],
                  ["Product.demand_model", "scenarios.demand_model → products.demand_distribution → triangularAV(mean, cv)"],
                  ["Product.production_capacity O_p", "products.production_capacity → policy cap×7×util → default ⚠"],
                  ["Product.fulfillment_mode", "products.fulfillment_mode → projects.supply_chain_model (MTS/MTO/ATO)"],
                  ["SupplierLink.cost / lead_time", "inbound_logistics.unit_price / lead_time → weeks"],
                  ["DisruptionEvent", "scenarios.disruption_schedule; magnitude<100 + finite capacity → capacity_reduction"],
                ]}
              />
              <Prose>
                <h3 className="text-base font-semibold pt-2">Run → save → persist</h3>
                <p>
                  The <strong>worker is the sole authoritative writer</strong> of results. The edge
                  function only inserts a <code>queued</code> <code>simulation_runs</code> row and
                  enqueues the command (no stub KPIs). The worker then owns the lifecycle{" "}
                  <code>queued → running → done|failed|cancelled</code>, idempotent by <code>run_id</code>:
                  it UPSERTs <code>run_replications</code> on <code>(run_id, rep_index)</code> with per-rep
                  KPIs + time series, then writes <code>aggregate_kpis</code>, <code>ci_half_widths</code>,
                  <code> warmup_detected_at</code>, <code>code_version="scsim-&lt;ver&gt;"</code>, and the{" "}
                  <code>mapping_warnings</code>. The Simulation Lab reads the real rows live via
                  Realtime — no more fabricated numbers.
                </p>
              </Prose>
            </Section>
  ),
  boundary: () => (
            <Section id="boundary" icon={Boxes} title="System boundary">
              <Prose>
                <p>
                  A single realtime simulation system powers the app. (An older batch system —
                  Render-hosted, job-based — has been removed from the codebase.)
                </p>
              </Prose>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Aspect</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Realtime system</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:px-3 [&_td]:py-2.5 [&_tr]:border-t [&_tr:nth-child(even)]:bg-muted/20">
                    <tr><td>Entry</td><td><code>sim-command</code></td></tr>
                    <tr><td>Compute</td><td>Fly.io <code>sim-worker</code></td></tr>
                    <tr><td>Transport</td><td>Upstash Redis stream</td></tr>
                    <tr><td>Latency target</td><td>Sub-second, interactive</td></tr>
                    <tr><td>Result table</td><td><code>simulation_runs</code>, <code>run_replications</code></td></tr>
                    <tr><td>Used by</td><td>Product/Process UI, Policies preview, Sim Lab</td></tr>
                  </tbody>
                </table>
              </div>
            </Section>
  ),
  flow: () => (
            <Section id="flow" icon={Workflow} title="Realtime simulation flow">
              <Prose>
                <p>
                  Solid arrows are command/event paths; the dashed arrow is the baseline PostgREST
                  read path the browser uses to hydrate the project before any simulation runs.
                </p>
              </Prose>
              <ArchitectureDiagram />
            </Section>
  ),
  contract: () => (
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
  ),
  persistence: () => (
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
  ),
  security: () => (
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
  ),
  state: () => (
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
                    per-policy decision rules are not yet wired into this realtime worker. Phase 2
                    replaces <code>compute_kpis()</code> with the <strong>scsim</strong> engine (engine
                    0.2.0) documented in the Modelers section — the nine ✅ policies (inventory control,
                    material &amp; FG safety stock, overtime, allocation, backup, multi-sourcing,
                    expediting, unmet-demand handling) are implemented there today.
                  </li>
                  <li>
                    <code>experiment.run</code> currently synthesises replications inline in the edge
                    function (recovery-aware stub). The Fly worker will upsert real results over them.
                  </li>
                  <li>
                    The legacy batch system (Render <code>sc-sim-api-brbl</code> +{" "}
                    <code>simulation-runner</code> / <code>external-simulation-processor</code>) has been
                    removed from the codebase. Its database tables (<code>simulation_jobs</code>,{" "}
                    <code>simulation_results</code>, …) remain in Postgres, inert, pending a cleanup
                    migration.
                  </li>
                </ul>
              </Prose>
            </Section>
  ),
  glossary: () => (
            <Section id="glossary" icon={Library} title="Glossary">
              <Glossary />
            </Section>
  ),
};
