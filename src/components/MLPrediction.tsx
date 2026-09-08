// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Brain, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PredictionStats {
  total: number;
  critical: number;
  non_critical: number;
  last_prediction: string | null;
}

interface MLPredictionProps {
  selectedPlant: string | null;
}

export default function MLPrediction({ selectedPlant }: MLPredictionProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const { user } = useAuth();

  const fetchPredictionStats = async () => {
    if (!selectedPlant || !user?.id || !user?.email) {
      setStats(null);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_prediction_stats', {
        p_plant_name: selectedPlant,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;

      if (data && data.length > 0) {
        const stats = data[0];
        setStats({
          total: Number(stats.total_count) || 0,
          critical: Number(stats.critical_count) || 0,
          non_critical: Number(stats.non_critical_count) || 0,
          last_prediction: stats.last_prediction_timestamp,
        });
      } else {
        setStats({
          total: 0,
          critical: 0,
          non_critical: 0,
          last_prediction: null,
        });
      }
    } catch (err) {
      console.error('Error fetching prediction stats:', err);
    }
  };

  const runPrediction = async () => {
    if (!selectedPlant || !user?.id) {
      toast.error('Please select a plant before running prediction');
      return;
    }

    setIsRunning(true);
    setProgress(0);

    try {
      toast.info('Starting ML prediction process...', {
        description: 'This may take a few minutes for large datasets',
      });

      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + Math.random() * 10));
      }, 1000);

      const { data, error } = await supabase.functions.invoke('predict-critical-nodes', {
        body: { plant_name: selectedPlant, uploaded_by: user.id },
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (error) throw error;

      toast.success('Prediction completed successfully!', {
        description: `Updated ${data?.predictions ?? 0} records with critical node predictions`,
      });

      await fetchPredictionStats();
    } catch (error: any) {
      console.error('Error running prediction:', error);
      toast.error('Prediction failed', {
        description: error?.message || 'An unexpected error occurred',
      });
    } finally {
      setIsRunning(false);
      setProgress(0);
    }
  };

  useEffect(() => {
    void fetchPredictionStats();
  }, [selectedPlant, user?.id]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            Nexus Node Prediction
            <a
              href="/docs/nexus-node.md"
              target="_blank"
              rel="noopener noreferrer"
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

          {stats && (
            <div className="pt-1 space-y-2">
              {/* Last Run (closer to title + button) */}
              <div className="text-center">
                <div className="text-[10px] font-medium text-muted-foreground">
                  Last Run:{' '}
                  {stats.last_prediction
                    ? new Date(stats.last_prediction).toLocaleString()
                    : 'Never'}
                </div>
              </div>

              {/* Run Prediction button */}
              <Button
                onClick={runPrediction}
                disabled={isRunning || !selectedPlant}
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

              {/* Stats grid below button with extra breathing room */}
              <div className="grid grid-cols-3 gap-2 pt-3 md:gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">Total Nodes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-[#bf2330]">{stats.critical}</div>
                  <div className="text-xs text-muted-foreground">Nexus</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-[#14b8c4]">{stats.non_critical}</div>
                  <div className="text-xs text-muted-foreground">Non-Nexus</div>
                </div>
              </div>

              <p className="pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Nexus nodes are a prediction about cascading failure. The
                single-source material count on the lens pages is a structural
                fact about sourcing — the two answer different questions.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
