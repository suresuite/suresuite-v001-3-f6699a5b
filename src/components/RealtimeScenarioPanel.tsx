import { useState, useCallback } from "react";
import { useScenarioSimulation, type CommandEchoEvent } from "@/hooks/useScenarioSimulation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

interface Props {
  projectId: string;
}

const KPI_DEFS: Array<{ key: keyof NonNullable<ReturnType<typeof useScenarioSimulation>["kpis"]>; label: string; fmt: (v: unknown) => string }> = [
  { key: "fill_rate", label: "Fill Rate", fmt: (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—") },
  { key: "otif", label: "OTIF", fmt: (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—") },
  { key: "revenue", label: "Revenue", fmt: (v) => (typeof v === "number" ? `$${(v / 1000).toFixed(0)}k` : "—") },
  { key: "lead_time_days", label: "Lead Time", fmt: (v) => (typeof v === "number" ? `${v.toFixed(1)}d` : "—") },
  { key: "co2_kg", label: "CO₂", fmt: (v) => (typeof v === "number" ? `${(v / 1000).toFixed(1)}t` : "—") },
];

/**
 * Drop-in demo of the real-time scenario loop: a single disruption slider,
 * KPI cards that update via Supabase Realtime broadcasts, and collab cursors
 * so two users moving the same slider see each other live.
 */
export function RealtimeScenarioPanel({ projectId }: Props) {
  const [magnitude, setMagnitude] = useState(0);
  const [remoteMagnitude, setRemoteMagnitude] = useState<number | null>(null);

  const onRemoteCommand = useCallback((cmd: CommandEchoEvent) => {
    if (cmd.kind === "scenario.changed") {
      const m = Number((cmd.payload as Record<string, unknown> | undefined)?.magnitude);
      if (!Number.isNaN(m)) setRemoteMagnitude(m);
    }
  }, []);

  const { kpis, latencyMs, connected, send } = useScenarioSimulation({
    projectId,
    onRemoteCommand,
  });

  const handleChange = (value: number[]) => {
    const m = value[0];
    setMagnitude(m);
    send({
      project_id: projectId,
      kind: "scenario.changed",
      payload: { magnitude: m, lever: "disruption.global" },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Real-Time Scenario Simulation</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"}>
            {connected ? "live" : "connecting…"}
          </Badge>
          {latencyMs !== null && (
            <Badge variant="outline" className="font-mono">
              {latencyMs} ms
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Global disruption magnitude</span>
            <span className="font-mono">{magnitude}</span>
          </div>
          <Slider value={[magnitude]} min={0} max={100} step={1} onValueChange={handleChange} />
          {remoteMagnitude !== null && remoteMagnitude !== magnitude && (
            <p className="mt-2 text-xs text-muted-foreground">
              teammate is at <span className="font-mono">{remoteMagnitude}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {KPI_DEFS.map(({ key, label, fmt }) => (
            <div key={key as string} className="rounded-md border bg-card p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-1 text-lg font-semibold">{fmt(kpis?.[key])}</div>
            </div>
          ))}
        </div>

        {kpis?.source === "stub" && (
          <p className="text-xs text-muted-foreground">
            Showing stub KPIs from the edge function. Deploy the Fly.io <code>sim-worker</code> to
            replace these with incremental DES results from your supply chain graph.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
