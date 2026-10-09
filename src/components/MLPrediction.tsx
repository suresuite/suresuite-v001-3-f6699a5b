import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Brain, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import {
  M,
  MobileButton,
  MobileNote,
  MobilePanel,
  MobileRow,
  MobileStatGrid,
} from '@/components/mobile';

/** One ranked node, as `get_critical_node_stats` returns it (§4 D307). */
interface NexusNode {
  node_id: string;
  /** READ from `node_list.echelon` (§4 D127), never inferred here. */
  echelon: string | null;
  score: number;
  is_critical: boolean;
  rank: number;
  products_affected: number;
  sole_source_of: string[];
}

interface NexusStats {
  run_id: string | null;
  finished_at?: string | null;
  /** False when the lanes changed after the run; null when that cannot be told. */
  is_current?: boolean | null;
  method?: string | null;
  threshold?: number | null;
  demand_basis?: 'weekly_volume' | 'equal_per_product' | null;
  warnings?: Array<{ code: string; meaning?: string; count?: number }>;
  total?: number;
  nexus?: number;
  top?: NexusNode[];
}

type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;
/** `get_critical_node_stats` is newer than the generated client types. */
const sb = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => RpcResult };

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

/** Why a node is nexus, in the words of the drivers the run stored. */
function drivers(n: NexusNode): string {
  const parts = [`${pct(n.score)} of demand at risk`];
  if (n.sole_source_of.length === 1) parts.push(`sole source of ${n.sole_source_of[0]}`);
  else if (n.sole_source_of.length > 1) parts.push(`sole source of ${n.sole_source_of.length} materials`);
  parts.push(`${n.products_affected} product${n.products_affected === 1 ? '' : 's'} affected`);
  return parts.join(' · ');
}

interface MLPredictionProps {
  /**
   * Kept for the three pages that pass it. §4 D307 — the score is per PROJECT:
   * a node carries one score on `node_list`, so a run for one plant would clear
   * every other plant's.
   */
  selectedPlant: string | null;
  /**
   * Wear the mobile skin (v2 §4C).
   *
   * This is the last shadcn `Card` inside the three converted lens pages, and
   * it is mounted by both platforms — so the skin arrives as a prop. `skin`
   * false renders the desktop card; true renders the same inventory in the
   * skin's vocabulary: the panel, the stat grid, the one black button, and the
   * caveat line. Same handler, same figures, same copy, same link — nothing is
   * added and nothing is hidden.
   */
  skin?: boolean;
}

export default function MLPrediction({ skin = false }: MLPredictionProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<NexusStats | null>(null);
  const { user } = useAuth();
  const { globalSelectedProjectId } = useGlobalProject();

  const fetchStats = useCallback(async () => {
    if (!globalSelectedProjectId || !user?.id) {
      setStats(null);
      return;
    }
    try {
      const { data, error } = await sb.rpc('get_critical_node_stats', {
        p_project_id: globalSelectedProjectId,
        p_user_id: user.id,
      });
      if (error) throw error;
      setStats((data as NexusStats | null) ?? { run_id: null });
    } catch (err) {
      console.error('Error fetching nexus node stats:', err);
    }
  }, [globalSelectedProjectId, user?.id]);

  const runPrediction = async () => {
    if (!globalSelectedProjectId || !user?.id) {
      toast.error('Select a project before running the prediction');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + Math.random() * 10));
    }, 1000);

    try {
      const { data, error } = await supabase.functions.invoke('predict-critical-nodes', {
        // WP 10.1 · §4 D236 — the project travels with the request. §4 D307 — and
        // nothing else selects the graph: the score is per project.
        body: { project_id: globalSelectedProjectId, uploaded_by: user.id },
      });
      if (error) throw error;

      const res = (data ?? {}) as { cache_hit?: boolean; in_progress?: boolean; nodes?: number; nexus?: number };
      if (res.in_progress) {
        toast.info('Already running', { description: 'Another request is computing this exact analysis.' });
      } else {
        toast.success(res.cache_hit ? 'Up to date — nothing changed since the last run' : 'Prediction completed', {
          description: `${res.nodes ?? 0} nodes scored; ${res.nexus ?? 0} nexus`,
        });
      }
      await fetchStats();
    } catch (error) {
      console.error('Error running prediction:', error);
      toast.error('Prediction failed', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      clearInterval(progressInterval);
      setIsRunning(false);
      setProgress(0);
    }
  };

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const hasRun = Boolean(stats?.run_id);
  const total = stats?.total ?? 0;
  const nexus = stats?.nexus ?? 0;
  const topNexus = (stats?.top ?? []).filter((n) => n.is_critical).slice(0, 5);
  const lastRun = stats?.finished_at ? new Date(stats.finished_at).toLocaleString() : null;
  const stale = hasRun && stats?.is_current === false;

  const ruleCopy =
    `Nexus = losing the node alone puts at least ${pct(stats?.threshold ?? 0.1)} of ` +
    `finished-goods demand at risk (${stats?.demand_basis === 'equal_per_product'
      ? 'every product weighted equally — no outbound volume was uploaded'
      : 'weighted by weekly volume'}).`;
  const nexusCopy =
    'A first-order estimate: no rerouting, no safety stock, no recovery. A stress ' +
    'test simulates the same outage over time. The single-source material count on ' +
    'the lens pages is a structural fact about sourcing — the two answer different questions.';
  const warningLines = (stats?.warnings ?? [])
    .filter((w) => w.meaning)
    .map((w) => `${w.meaning}${w.count ? ` (${w.count})` : ''}`);

  if (skin) {
    return (
      <>
        <MobilePanel
          label="Nexus node prediction"
          counter={isRunning ? `${Math.round(progress)}%` : undefined}
        >
          <MobileRow
            chevron={false}
            dot={isRunning ? M.process : stale ? M.blocking : undefined}
            label={isRunning ? 'Processing predictions…' : 'Last run'}
            sub={stale ? `${lastRun} · lanes changed since` : (lastRun ?? 'never')}
            value={isRunning ? `${Math.round(progress)}%` : undefined}
          />
          <MobileRow
            label="What a nexus node is"
            sub="opens the reference"
            onClick={() => window.open('/docs/nexus-node.md', '_blank', 'noopener,noreferrer')}
          />
          <div className="p-3">
            {/* §8: the control is shown and disabled, and the line beneath it
                says why — it is never hidden. */}
            <MobileButton
              block
              onClick={runPrediction}
              disabled={isRunning || !globalSelectedProjectId}
            >
              {isRunning ? 'Running prediction…' : 'Run prediction'}
            </MobileButton>
            {!globalSelectedProjectId && (
              <p className="mt-1.5 text-[12px] leading-[1.4] text-[#525252] [text-wrap:pretty]">
                Select a project first — the prediction scores one project's network.
              </p>
            )}
          </div>
        </MobilePanel>

        {hasRun && (
          <MobileStatGrid
            stats={[
              { label: 'Total nodes', value: String(total) },
              { label: 'Nexus', value: String(nexus), dot: M.blocking },
              { label: 'Non-nexus', value: String(total - nexus), dot: M.process },
            ]}
          />
        )}

        {topNexus.length > 0 && (
          <MobilePanel label="Highest demand at risk">
            {topNexus.map((n) => (
              <MobileRow
                key={n.node_id}
                chevron={false}
                dot={M.blocking}
                label={n.node_id}
                sub={`${n.echelon ?? 'role not derived'} · ${drivers(n)}`}
                value={pct(n.score)}
              />
            ))}
          </MobilePanel>
        )}

        {hasRun && <MobileNote tone="caveat" mark="·">{ruleCopy}</MobileNote>}
        {warningLines.map((w) => (
          <MobileNote key={w} tone="caveat" mark="·">{`Substituted: ${w}`}</MobileNote>
        ))}
        {hasRun && <MobileNote tone="caveat" mark="·">{nexusCopy}</MobileNote>}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            Nexus Node Prediction
            {/* Spec 2.4: 44px hit area below `md`, with the negative margin
                giving the space straight back so nothing moves visually, and
                `md:` restoring the bare 16px icon the desktop card has always
                had. Every icon-only control carries aria-label AND title. */}
            <a
              href="/docs/nexus-node.md"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="What a nexus node is"
              title="What a nexus node is"
              className="-my-3.5 -mr-3.5 grid h-11 w-11 shrink-0 place-items-center
                         md:m-0 md:h-4 md:w-4"
            >
              <Info className="h-4 w-4 text-muted-foreground hover:text-primary cursor-pointer" />
            </a>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {isRunning && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center justify-between text-sm">
                <span>Processing predictions...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          <div className="pt-1 space-y-2">
            <div className="text-center">
              <div className="text-[10px] font-medium text-muted-foreground">
                Last Run: {lastRun ?? 'Never'}
                {stale && <span className="text-[#bf2330]"> · lanes changed since — re-run</span>}
              </div>
            </div>

            <Button
              onClick={runPrediction}
              disabled={isRunning || !globalSelectedProjectId}
              className="w-full"
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running Prediction...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Run Prediction
                </>
              )}
            </Button>
            {!globalSelectedProjectId && (
              <p className="text-[11.5px] text-muted-foreground">
                Select a project first — the prediction scores one project's network.
              </p>
            )}

            {hasRun && (
              <div className="grid grid-cols-3 gap-2 pt-3 md:gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{total}</div>
                  <div className="text-xs text-muted-foreground">Total Nodes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-[#bf2330]">{nexus}</div>
                  <div className="text-xs text-muted-foreground">Nexus</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-[#14b8c4]">{total - nexus}</div>
                  <div className="text-xs text-muted-foreground">Non-Nexus</div>
                </div>
              </div>
            )}

            {topNexus.length > 0 && (
              <div className="pt-2">
                <div className="text-xs font-medium text-muted-foreground pb-1">
                  Highest demand at risk
                </div>
                <ul className="space-y-1">
                  {topNexus.map((n) => (
                    <li key={n.node_id} className="text-[12px] leading-snug">
                      <span className="font-medium">{n.node_id}</span>
                      <span className="text-muted-foreground">
                        {' '}· {n.echelon ?? 'role not derived'} · {drivers(n)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasRun && (
              <p className="pt-1 text-[11.5px] leading-relaxed text-muted-foreground">{ruleCopy}</p>
            )}
            {warningLines.map((w) => (
              <p key={w} className="text-[11.5px] leading-relaxed text-muted-foreground">
                Substituted: {w}
              </p>
            ))}
            {hasRun && (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">{nexusCopy}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
