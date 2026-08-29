// "Connect a data source" — sits beside the existing Upload Wizard entry
// point in a project's expanded card (src/pages/DataManager.tsx), per
// docs/design/erp-mrp-integration-plan.md §6c. Shows:
//   - a connection-status dot per link (§6c.1.A, same active/revoked
//     pattern as DeveloperApi.tsx's API-key table)
//   - that link's most recent Sync Mapping Report, reusing
//     MappingWarningsCard unmodified (§6c.1.B)
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Unplug, Plug } from "lucide-react";
import { useErpConnections } from "@/hooks/useErpConnections";
import { MappingWarningsCard } from "@/components/sim/RunProgressPanel";
import { startOrbitMrpConnect } from "@/lib/erp/orbitMrpOAuth";

const ORBIT_MRP_BASE_URL = import.meta.env.VITE_ORBIT_MRP_BASE_URL as string | undefined;

const STATUS_META = {
  active: { dot: "bg-emerald-500", label: "Connected" },
  needs_attention: { dot: "bg-amber-500", label: "Needs attention" },
  revoked: { dot: "bg-red-500", label: "Disconnected" },
} as const;

export function ErpConnectionsPanel({ projectId }: { projectId: string }) {
  const { links, runsByLink, loading, triggerSync, applySync, revokeLink } = useErpConnections(projectId);
  const [syncing, setSyncing] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!ORBIT_MRP_BASE_URL) {
      toast.error("VITE_ORBIT_MRP_BASE_URL is not configured for this environment");
      return;
    }
    try {
      await startOrbitMrpConnect(ORBIT_MRP_BASE_URL, projectId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the orbit-mrp connection");
    }
  };

  const handleSync = async (linkId: string) => {
    setSyncing(linkId);
    const { error } = await triggerSync(linkId);
    setSyncing(null);
    if (error) toast.error("Sync failed to start");
    else toast.success("Sync complete — review the mapping report below before applying");
  };

  const handleApply = async (runId: string) => {
    const { error } = await applySync(runId);
    if (error) toast.error("Apply failed");
    else toast.success("Synced data applied to this project's item masters");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Connect a data source</CardTitle>
        <Button size="sm" variant="outline" onClick={handleConnect}>
          <Plug className="h-3.5 w-3.5 mr-1.5" /> Connect orbit-mrp
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-xs text-muted-foreground">Loading connections…</p>}
        {!loading && links.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No external data sources connected yet. Excel upload above remains the default —
            this is an additional, complementary way to bring in item master and BOM data.
          </p>
        )}
        {links.map((link) => {
          const meta = STATUS_META[link.status];
          const latestRun = runsByLink[link.id]?.[0];
          return (
            <div key={link.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-medium">{link.external_company_name ?? link.external_company_id}</span>
                  <Badge variant="outline" className="text-[10px]">{link.external_system}</Badge>
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" disabled={link.status === "revoked" || syncing === link.id} onClick={() => handleSync(link.id)}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncing === link.id ? "animate-spin" : ""}`} /> Sync now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revokeLink(link.id)}>
                    <Unplug className="h-3.5 w-3.5 mr-1" /> Revoke
                  </Button>
                </div>
              </div>
              {link.status_detail && <p className="text-xs text-amber-600 dark:text-amber-400">{link.status_detail}</p>}
              {latestRun && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Last sync: {latestRun.rows_new} new · {latestRun.rows_changed} changed ·{" "}
                    {latestRun.rows_removed} removed upstream
                  </p>
                  <MappingWarningsCard warnings={latestRun.mapping_warnings} status={latestRun.status === "staged" ? "done" : "running"} />
                  {latestRun.status === "staged" && (
                    <Button size="sm" onClick={() => handleApply(latestRun.id)}>
                      Apply sync to this project
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
