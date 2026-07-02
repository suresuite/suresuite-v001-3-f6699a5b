import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "react-router-dom";
import { YouTubeEmbed } from "@/components/shared";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import NetworkVisualization3D from "@/components/NetworkVisualization3D";
import {
  Network,
  FileSpreadsheet,
  Share2,
  Crosshair,
  Shuffle,
  CheckCircle2,
  PlayCircle,
  Sparkles,
  Layers3,
  MapPin,
  CalendarDays,
  ArrowRight,
} from "lucide-react";

interface GettingStartedProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

type TechKey = 'network' | 'nexus' | 'simulation' | null;

const featureRoutes = {
  multiPlant: { path: "/features/multi-plant", enabled: false },
  gis: { path: "/features/gis-mapping", enabled: false },
  deepTier: { path: "/features/deep-tier", enabled: false },
};

const StatChip = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm text-muted-foreground bg-background">
    <CheckCircle2 className="h-4 w-4 text-green-600" />
    <span>{children}</span>
  </div>
);

const Section = ({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="px-6 sm:px-8 lg:px-12 py-12 border-t bg-background">
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">{title}</h2>
        {subtitle ? (
          <p className="text-lg text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  </section>
);

const DarkSection = ({
  title,
  subtitle,
  children,
  compact = false,
  noBorder = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
  noBorder?: boolean;
}) => (
  <section className={`px-6 sm:px-8 lg:px-12 ${compact ? 'py-2' : 'py-16'} ${noBorder ? '' : 'border-t'} bg-black text-white`}>
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        {title ? (
          <h2 className="text-3xl font-bold tracking-tight mb-2">{title}</h2>
        ) : null}
        {subtitle ? (
          <p className="text-lg text-white/70">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  </section>
);

const GettingStarted = ({ isCollapsed, setIsCollapsed }: GettingStartedProps) => {
  // Default selected sub-block
  const [activeTech, setActiveTech] = useState<TechKey>('network');

  const leftTabsRef = useRef<HTMLDivElement | null>(null);
  const [panelH, setPanelH] = useState<number | undefined>(undefined);

  // Dynamic accent for the detail panel
  const panelAccent =
    activeTech === 'network'
      ? 'border-primary ring-2 ring-primary/20'
      : activeTech === 'nexus'
      ? 'border-purple-500 ring-2 ring-purple-400/20'
      : activeTech === 'simulation'
      ? 'border-red-500 ring-2 ring-red-400/20'
      : 'border-border';

  // Keep detail panel height equal to the left sub-blocks column, even when navbar collapses
  useEffect(() => {
    const el = leftTabsRef.current;
    if (!el) return;

    const measure = () => setPanelH(el.offsetHeight);
    measure(); // initial

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    // also re-measure once the page fully settles
    const onLoad = () => measure();
    window.addEventListener("load", onLoad);

    return () => {
      ro.disconnect();
      window.removeEventListener("load", onLoad);
    };
  }, []);

  // One round rotation:
  // t=0s: network (default)
  // t=3s: nexus
  // t=6s: simulation
  // t=9s: back to network (then stop)
  useEffect(() => {
    // reflect selection in the hash (optional)
    window.location.hash = "tech-network";

    const t1 = setTimeout(() => {
      setActiveTech('nexus');
      window.location.hash = "tech-nexus";
    }, 3000);

    const t2 = setTimeout(() => {
      setActiveTech('simulation');
      window.location.hash = "tech-simulation";
    }, 6000);

    const t3 = setTimeout(() => {
      setActiveTech('network');
      window.location.hash = "tech-network";
      // stop here (do not loop further)
    }, 9000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex relative">
      <Navbar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <main
        className="flex-1 transition-all duration-300 px-6 sm:px-8 lg:px-12" // side margins
        style={{ marginLeft: isCollapsed ? 50 : 192 }}
      >
        {/* Intro */}
        <div className="relative overflow-hidden border-b">
          {/* background grid + soft gradient */}
          <div className="absolute inset-0 opacity-10 [background-image:linear-gradient(to_right,rgba(0,0,0,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-[420px] w-[900px] bg-gradient-to-r from-orange-400/30 via-pink-400/30 to-teal-400/30 blur-3xl rounded-full" />
          <div className="relative px-6 sm:px-8 lg:px-12 py-16 sm:py-20">
            <div className="max-w-5xl">
              <div className="mb-8">
                <div className="inline-flex items-center gap-3 mb-6">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
                    <Network className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-primary tracking-tight">SuReSuite</h1>
                    <p className="text-sm text-muted-foreground">Supply Chain Resilience Suite</p>
                  </div>
                </div>
                
                <h2 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight">
                  Stress Testing Your Supply Chain with Known and Unknown Disruptions
                </h2>

                <p className="text-xl text-muted-foreground leading-relaxed mb-8 max-w-3xl">
                  Leverage advanced network science to uncover hidden critical suppliers and materials. SuReSuite's intelligent simulation engine enables side-by-side testing of resilience tactics and strategies—delivering decision support capabilities unmatched by other tools.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-12">
                <Button size="lg" className="text-lg px-6" asChild>
                  <Link to="/project-manager">
                    <FileSpreadsheet className="mr-2 h-5 w-5" />
                    Start Analysis
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="text-lg px-6">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  View Demo
                </Button>
              </div>

              {/* Quick facts */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 ">
                <div className="pr-4"><StatChip>3 network levels</StatChip></div>
                <div className="px-4"><StatChip>5k+ sims</StatChip></div>
                <div className="px-4"><StatChip>5 tactics</StatChip></div>
                <div className="pl-4"><StatChip>Easy scenarios</StatChip></div>
              </div>
            </div>
          </div>
        </div>

        {/* Introduction video */}
        <Section
          title={<span className="text-foreground font-bold">See SuReSuite in action</span>}
          subtitle={
            <div className="max-w-3xl mx-auto">
              <span>
                A two-minute walkthrough of how to map your supply chain, detect nexus materials, and stress-test resilience strategies.
              </span>
            </div>
          }
        >
          <div className="max-w-[900px] mx-auto">
            {/* Replace VIDEO_ID with your home page intro video ID */}
            <YouTubeEmbed videoId="VIDEO_ID" title="SuReSuite introduction" />
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" asChild>
                <Link to="/help/network-sci">
                  View the full network view tutorial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </Section>

        {/* Core Features */}
        <Section
          title={
            <div className="text-center">
              <span className="text-foreground font-bold">Core Capabilities</span>
            </div>
          } 
          subtitle={
            <div className="text-center max-w-3xl mx-auto">
              <span>Discover hidden vulnerabilities and test resilience strategies with SuReSuite's comprehensive supply chain analysis platform</span>
            </div>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-0 bg-gradient-to-br from-blue-50/50 to-indigo-100/50 dark:from-blue-950/30 dark:to-indigo-900/30">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="p-8">
                <div className="mb-6 h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Network className="h-8 w-8 text-white" />
                </div>
                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium">
                    Interactive Network Graph
                  </div>
                  <h3 className="text-xl font-bold tracking-tight">See disruption impact fast</h3>
                  <p className="text-muted-foreground leading-relaxed">Explore your network at three levels—firm, product, and process—to spot propagation paths and critical dependencies.</p>
                  <Button variant="ghost" size="sm" className="group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 mt-4">
                    Learn more <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-0 bg-gradient-to-br from-purple-50/50 to-violet-100/50 dark:from-purple-950/30 dark:to-violet-900/30">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/5 to-violet-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="p-8">
                <div className="mb-6 h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg">
                  <Crosshair className="h-8 w-8 text-white" />
                </div>
                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-sm font-medium">
                    Hidden Critical Detection
                  </div>
                  <h3 className="text-xl font-bold tracking-tight">Surface nexus nodes automatically</h3>
                  <p className="text-muted-foreground leading-relaxed">ML trained on 5,000 simulations highlights critical suppliers/materials and cascading risks before they occur.</p>
                  <Button variant="ghost" size="sm" className="group-hover:bg-purple-100 dark:group-hover:bg-purple-900/30 mt-4">
                    Learn more <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-0 bg-gradient-to-br from-emerald-50/50 to-teal-100/50 dark:from-emerald-950/30 dark:to-teal-900/30">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/5 to-teal-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="p-8">
                <div className="mb-6 h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                  <Shuffle className="h-8 w-8 text-white" />
                </div>
                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium">
                    Strategy Simulation
                  </div>
                  <h3 className="text-xl font-bold tracking-tight">Test tactics side-by-side</h3>
                  <p className="text-muted-foreground leading-relaxed">Compare dual sourcing, buffers, and capacity shifts under known & unknown disruptions with real-time analysis.</p>
                  <Button variant="ghost" size="sm" className="group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 mt-4">
                    Learn more <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Quick Start */}
        <DarkSection
          title={<span className="text-[#BF2330]">Quick Start with SuReSuite</span>}
          subtitle="Transform your supply chain resilience analysis in three simple steps."
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-white/10 pb-8 mb-12 gap-6">
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Ready to strengthen your supply chain?</h3>
              <p className="text-white/70 text-lg">Upload data → Analyze vulnerabilities → Simulate strategies</p>
            </div>
            <Button asChild variant="outline" size="lg" className="rounded-full bg-background/10 border-white/20 text-white hover:bg-background/20 transition-all duration-200 hover:scale-105">
              <Link to="/project-manager">Launch SuReSuite <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
              <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">1</span>
                <span className="uppercase tracking-wider font-medium">Data Upload</span>
              </div>
              <h3 className="text-2xl font-bold mb-3 text-white">Import Supply Chain Data</h3>
              <p className="text-white font-semibold mb-2">Use SuReSuite's structured CSV template.</p>
              <p className="text-white/80 leading-relaxed">Define firms, materials, and connections with precise sourcing ratios for comprehensive network mapping.</p>
            </div>

            <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
              <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">2</span>
                <span className="uppercase tracking-wider font-medium">AI Analysis</span>
              </div>
              <h3 className="text-2xl font-bold mb-3 text-white">Discover Critical Vulnerabilities</h3>
              <p className="text-white font-semibold mb-2">Advanced ML algorithms identify hidden nexus points.</p>
              <p className="text-white/80 leading-relaxed">Network topology analysis reveals critical nodes and potential disruption cascades before they occur.</p>
            </div>

            <div className="group py-8 md:px-6 transition-all duration-300 hover:transform hover:scale-105">
              <div className="mb-4 flex items-center gap-3 text-sm text-white/60">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-[#F8D448] to-[#F8D448]/80 text-foreground font-bold shadow-lg">3</span>
                <span className="uppercase tracking-wider font-medium">Strategy Testing</span>
              </div>
              <h3 className="text-2xl font-bold mb-3 text-white">Simulate Resilience Strategies</h3>
              <p className="text-white font-semibold mb-2">Compare multiple mitigation tactics simultaneously.</p>
              <p className="text-white/80 leading-relaxed">Test dual sourcing, inventory buffers, and capacity adjustments under diverse disruption scenarios.</p>
            </div>
          </div>
        </DarkSection>

        {/* Technical Overview */}
        <section className="px-6 sm:px-8 lg:px-12 py-16 border-t bg-background">
          <div className="max-w-7xl mx-auto">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight mb-4 text-foreground">SuReSuite Technical Architecture</h2>
              <p className="text-lg text-muted-foreground max-w-4xl mx-auto">Explore the advanced analytics engine and simulation capabilities that power comprehensive supply chain resilience analysis</p>
            </div>

            {/* Tab Navigation */}
            <div className="flex justify-center mb-8">
              <div className="flex bg-muted rounded-xl p-1 max-w-md mx-auto">
                <button
                  onClick={() => { setActiveTech('network'); window.location.hash = 'tech-network'; }}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTech === 'network' 
                      ? 'bg-background text-[#BF2330] shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Network
                </button>
                <button
                  onClick={() => { setActiveTech('nexus'); window.location.hash = 'tech-nexus'; }}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTech === 'nexus' 
                      ? 'bg-background text-purple-600 shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Nexus Detection
                </button>
                <button
                  onClick={() => { setActiveTech('simulation'); window.location.hash = 'tech-simulation'; }}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTech === 'simulation' 
                      ? 'bg-background text-[#BF2330] shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Simulation
                </button>
              </div>
            </div>

            {/* Content Panel */}
            <div className="bg-gradient-to-br from-muted to-background rounded-2xl border border-border overflow-hidden shadow-lg">
              {activeTech === 'network' && (
                <div className="grid lg:grid-cols-3 gap-0">
                  {/* Left: Info Panel */}
                  <div className="lg:col-span-1 p-8 bg-background border-r border-border">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-3 rounded-xl bg-[#BF2330]/10">
                        <Share2 className="h-6 w-6 text-[#BF2330]"/>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-foreground">Network Graph</h3>
                        <p className="text-sm text-muted-foreground">Multi-layer topology</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-muted border">
                        <div className="flex items-center gap-2 mb-2">
                          <Layers3 className="h-5 w-5 text-[#BF2330]"/>
                          <span className="font-medium text-foreground">3 Network Levels</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Process, Product, and Firm layers with interconnected dependencies</p>
                      </div>
                      
                      <div className="p-4 rounded-lg bg-muted border">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin className="h-5 w-5 text-[#BF2330]"/>
                          <span className="font-medium text-foreground">Centrality Analysis</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Betweenness and closeness metrics identify critical nodes</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Right: 3D Visualization */}
                  <div className="lg:col-span-2 h-[500px] bg-gradient-to-br from-slate-900 to-gray-800">
                    <NetworkVisualization3D />
                  </div>
                </div>
              )}

              {activeTech === 'nexus' && (
                <div className="p-12 text-center min-h-[500px] flex flex-col items-center justify-center">
                  <div className="p-6 rounded-2xl bg-purple-50 mb-6">
                    <Crosshair className="h-16 w-16 text-purple-500 mx-auto" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-4">Nexus Node Detection</h3>
                  <p className="text-muted-foreground max-w-lg mx-auto">ML algorithms trained on 5,000+ simulations identify critical suppliers and materials that could cause cascading failures across your network.</p>
                </div>
              )}

              {activeTech === 'simulation' && (
                <div className="p-12 text-center min-h-[500px] flex flex-col items-center justify-center">
                  <div className="p-6 rounded-2xl bg-red-50 mb-6">
                    <Shuffle className="h-16 w-16 text-[#BF2330] mx-auto" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-4">Monte Carlo Simulation</h3>
                  <p className="text-muted-foreground max-w-lg mx-auto">Test multiple resilience strategies side-by-side using advanced simulation scenarios to compare performance under various disruption conditions.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* CTA: Ready to Boost */}
        <DarkSection title="" noBorder compact>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xl font-semibold text-white md:flex-1 md:mb-8">
              Ready to boost the resilience of your supply chain?
            </p>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-full bg-background/10 border-white/20 text-white hover:bg-background/20 shrink-0 whitespace-nowrap md:self-start md:ml-auto md:-mt-2"
            >
              <Link to="/project-manager">
                Start now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </DarkSection>

        {/* Roadmap */}
        <Section title="Roadmap" subtitle="What we're building next">
          <div className="relative max-w-5xl">
            {/* vertical line */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
            <ol className="space-y-3">
              {/* Item 1 */}
              <li className="relative pl-16">
                <div className="absolute left-0 top-0 h-10 w-10 rounded-full border bg-background grid place-items-center shadow-sm">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="rounded-lg border p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <div className="text-sm"><span className="font-semibold">Enhanced Training.</span> <span className="text-muted-foreground">Broaden simulation scenarios and industry datasets to improve model robustness.</span></div>
                    <div className="flex flex-col items-end gap-0.5 text-right">
                      <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">In progress</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Q4 2025</span>
                    </div>
                  </div>
                </div>
              </li>

              {/* Item 2 */}
              <li className="relative pl-16">
                <div className="absolute left-0 top-0 h-10 w-10 rounded-full border bg-background grid place-items-center shadow-sm">
                  <MapPin className="h-5 w-5 text-blue-600" />
                </div>
                <div className="rounded-lg border p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <div className="text-sm"><span className="font-semibold">GIS Mapping.</span> <span className="text-muted-foreground">Geospatial visualization of suppliers/customers for location-based risk analysis.</span></div>
                    <div className="flex flex-col items-end gap-0.5 text-right">
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-700">Planned</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Q1 2026</span>
                    </div>
                  </div>
                </div>
              </li>

              {/* Item 3 */}
              <li className="relative pl-16">
                <div className="absolute left-0 top-0 h-10 w-10 rounded-full border bg-background grid place-items-center shadow-sm">
                  <Layers3 className="h-5 w-5 text-green-600" />
                </div>
                <div className="rounded-lg border p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <div className="text-sm"><span className="font-semibold">Deep-Tier Analysis.</span> <span className="text-muted-foreground">Extend to tier-2/3 suppliers to capture cascading dependencies across the network.</span></div>
                    <div className="flex flex-col items-end gap-0.5 text-right">
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-700">Planned</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Q2 2026</span>
                    </div>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </Section>

        <DarkSection title="" compact noBorder>
          <div className="grid grid-cols-1 md:[grid-template-columns:30%_17%_53%] items-start gap-0">
            {/* Left: Developer / Digital SC Lab */}
            <div className="md:justify-self-start w-full">
              <img src="/logo3.png" alt="Digital SC Lab" className="h-12 w-auto mb-4" />
              <p className="text-sm text-white/80">
                Developer: <span className="text-white">Phu Nguyen</span><br/>
                Supervisor: <span className="text-white">Prof. Dmitry Ivanov</span><br/>
                Digital SC Lab @ HWR Berlin
              </p>
            </div>
            {/* Middle: Spacer (blank) */}
            <div aria-hidden className="hidden md:block" />
            {/* Right: ACCURATE / EU */}
            <div className="md:justify-self-start">
              <img src="/logo2.png" alt="EU / ACCURATE logo" className="h-12 w-auto mb-4" />
              <p className="text-sm text-white/80">
                The ACCURATE project is funded by the European Union, under Grant Agreement number 101138269. Views and opinions expressed are however those of the author(s) only and do not necessarily reflect those of the European Union or the European Health and Digital Executive Agency. Neither the European Union nor the granting authority can be held responsible for them.
              </p>
              <div className="mt-4 text-sm text-white/80">
                <div><span className="font-medium text-white">Start:</span> 01/12/2023</div>
                <div><span className="font-medium text-white">Finish:</span> 30/11/2026</div>
              </div>
            </div>
          </div>
          <div className="h-8" />
        </DarkSection>

        <Footer isCollapsed={isCollapsed} />
      </main>
    </div>
  );
};

export default GettingStarted;
