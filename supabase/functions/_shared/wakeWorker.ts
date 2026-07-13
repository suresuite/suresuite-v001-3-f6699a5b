// Scale-to-zero wake path — the restart half of the sim-worker cost control.
//
// When the Fly sim-worker is configured to stop itself while idle
// (sim-worker/fly.toml → IDLE_SHUTDOWN_SECONDS + `[[restart]] policy =
// "on-failure"`), *something* has to start it again the moment a command is
// enqueued — the worker gets its work from a Redis stream, not the Fly proxy,
// so Fly's own auto-start never fires. This helper is that something: the
// dispatcher calls it (fire-and-forget) right after pushing a command, and it
// starts any stopped worker machine via the Fly Machines API. The enqueued
// command persists in the stream, so the freshly-started worker picks it up as
// soon as it connects — ordering between the enqueue and this call is
// irrelevant.
//
// Fully opt-in: with FLY_API_TOKEN / FLY_APP_NAME unset it is a no-op (logged
// once), so an always-on worker deployment is unaffected. Starting a machine
// that is already started is a harmless no-op on Fly's side, so it is also safe
// to enable the wake secrets BEFORE flipping the worker to scale-to-zero.

import { cleanEnv } from "./env.ts";

const FLY_MACHINES_API = "https://api.machines.dev/v1";
const WAKE_TIMEOUT_MS = 4000;

interface FlyMachine {
  id: string;
  state: string;
  config?: { standbys?: string[] };
}

let warnedUnconfigured = false;

/** Start any stopped sim-worker machine so it can consume the just-enqueued
 * command. Never throws — failures are logged and swallowed, because a failed
 * wake must not take command dispatch down (the command is already queued and
 * a later command, a scheduled deploy, or a manual start still recovers it). */
export async function wakeWorker(): Promise<void> {
  const token = cleanEnv("FLY_API_TOKEN");
  const app = cleanEnv("FLY_APP_NAME");
  if (!token || !app) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.log(
        "wakeWorker: FLY_API_TOKEN/FLY_APP_NAME not set — scale-to-zero wake " +
          "disabled (worker assumed always-on). Set both edge-function secrets " +
          "to enable waking a stopped worker.",
      );
    }
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WAKE_TIMEOUT_MS);
  try {
    const listRes = await fetch(`${FLY_MACHINES_API}/apps/${app}/machines`, {
      headers,
      signal: ctrl.signal,
    });
    if (!listRes.ok) {
      console.error("wakeWorker: list machines failed", listRes.status, await listRes.text());
      return;
    }
    const machines = (await listRes.json()) as FlyMachine[];
    const toStart = machines.filter(
      (m) =>
        m.state !== "started" &&
        m.state !== "starting" &&
        m.state !== "replacing" &&
        // Standby machines are Fly's own failover spares — leave them to Fly.
        !(m.config?.standbys && m.config.standbys.length > 0),
    );
    if (toStart.length === 0) return;
    await Promise.all(
      toStart.map(async (m) => {
        const r = await fetch(`${FLY_MACHINES_API}/apps/${app}/machines/${m.id}/start`, {
          method: "POST",
          headers,
          signal: ctrl.signal,
        });
        if (!r.ok) {
          console.error("wakeWorker: start failed", m.id, r.status, await r.text());
        } else {
          console.log("wakeWorker: started machine", m.id);
        }
      }),
    );
  } catch (e) {
    console.error("wakeWorker: error", String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Fire wakeWorker in the background without blocking the response, keeping the
 * edge isolate alive until it settles (EdgeRuntime.waitUntil when available;
 * a floating promise otherwise, e.g. local/test). */
export function fireWakeWorker(): void {
  const p = wakeWorker().catch((e) => console.error("wakeWorker failed", e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}
