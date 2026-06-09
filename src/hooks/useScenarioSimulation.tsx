import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ScenarioCommandKind =
  | "scenario.changed"
  | "scenario.reset"
  | "simulation.snapshot"
  | "simulation.fork";

export interface ScenarioCommand {
  project_id: string;
  scenario_id?: string;
  kind: ScenarioCommandKind;
  payload?: Record<string, unknown>;
}

export interface KpiVector {
  fill_rate?: number;
  otif?: number;
  revenue?: number;
  lead_time_days?: number;
  co2_kg?: number;
  source?: string;
  [k: string]: unknown;
}

export interface KpiDeltaEvent {
  kpis: KpiVector;
  ts: number;
  source?: string;
}

export interface CommandEchoEvent {
  user_id: string;
  kind: ScenarioCommandKind;
  payload?: Record<string, unknown>;
  server_ts: number;
  client_ts?: number;
}

interface UseScenarioSimulationOptions {
  projectId: string | null | undefined;
  /** Debounce window for outgoing slider/disruption changes (ms). */
  debounceMs?: number;
  /** Called whenever a remote user (or the worker echo) emits a command. */
  onRemoteCommand?: (cmd: CommandEchoEvent) => void;
}

/**
 * Real-time scenario simulation hook.
 *
 *  - Debounces outgoing slider changes (default 80 ms).
 *  - Subscribes to `sim:{projectId}` Supabase Realtime channel for KPI deltas
 *    and collaborative command echoes.
 *  - Tracks round-trip latency for instrumentation.
 */
export function useScenarioSimulation({
  projectId,
  debounceMs = 80,
  onRemoteCommand,
}: UseScenarioSimulationOptions) {
  const [kpis, setKpis] = useState<KpiVector | null>(null);
  const [lastDeltaTs, setLastDeltaTs] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  const pendingRef = useRef<ScenarioCommand | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<number>(0);

  // Realtime subscription
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase.channel(`sim:${projectId}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    channel
      .on("broadcast", { event: "kpi.delta" }, ({ payload }) => {
        const ev = payload as KpiDeltaEvent;
        setKpis((prev) => ({ ...(prev ?? {}), ...ev.kpis }));
        setLastDeltaTs(ev.ts);
        if (lastSentRef.current) {
          setLatencyMs(Date.now() - lastSentRef.current);
        }
      })
      .on("broadcast", { event: "command" }, ({ payload }) => {
        onRemoteCommand?.(payload as CommandEchoEvent);
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [projectId, onRemoteCommand]);

  const flush = useCallback(async () => {
    const cmd = pendingRef.current;
    pendingRef.current = null;
    if (!cmd) return;
    lastSentRef.current = Date.now();
    try {
      await supabase.functions.invoke("sim-command", {
        body: { ...cmd, client_ts: lastSentRef.current },
      });
    } catch (err) {
      console.error("sim-command invoke failed", err);
    }
  }, []);

  const send = useCallback(
    (cmd: ScenarioCommand) => {
      pendingRef.current = cmd; // last-write-wins coalescing
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  // Cleanup pending timer on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { kpis, lastDeltaTs, latencyMs, connected, send };
}
