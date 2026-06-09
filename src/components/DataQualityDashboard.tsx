import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, AlertTriangle, Link2, Unlink } from 'lucide-react';

interface ConnectionStats {
  total: number;
  connected: number;
  bridgeConnections: number;
  avgConfidence: number;
}

interface DataSourceBreakdown {
  inbound: number;
  bom: number;
  outbound: number;
  bridge: number;
  multi_tier: number;
}

interface DataQualityDashboardProps {
  connectionStats: ConnectionStats;
  sourceBreakdown: DataSourceBreakdown;
  show: boolean;
}

export function DataQualityDashboard({ 
  connectionStats, 
  sourceBreakdown, 
  show 
}: DataQualityDashboardProps) {
  if (!show) return null;

  const connectionRate = (connectionStats.connected / connectionStats.total) * 100;
  const disconnectedCount = connectionStats.total - connectionStats.connected;
  
  const getConnectionStatus = () => {
    if (connectionRate >= 90) return { status: 'excellent', color: 'text-green-600', icon: CheckCircle };
    if (connectionRate >= 75) return { status: 'good', color: 'text-yellow-600', icon: AlertTriangle };
    return { status: 'needs attention', color: 'text-red-600', icon: Unlink };
  };

  const { status, color, icon: StatusIcon } = getConnectionStatus();

  return (
    <div className="space-y-4">
      {/* Connection Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4" />
            Supply Chain Integration Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusIcon className={`h-4 w-4 ${color}`} />
              <span className={`text-sm font-medium ${color}`}>
                {status.toUpperCase()}
              </span>
            </div>
            <Badge variant="outline">
              {connectionStats.connected}/{connectionStats.total} connected
            </Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Connection Rate</span>
              <span>{connectionRate.toFixed(1)}%</span>
            </div>
            <Progress value={connectionRate} className="h-2" />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Bridge Connections</div>
              <div className="font-medium text-yellow-600">
                {connectionStats.bridgeConnections}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Avg. Confidence</div>
              <div className="font-medium">
                {(connectionStats.avgConfidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {disconnectedCount > 0 && (
            <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/20">
              <div className="flex items-center gap-2">
                <Unlink className="h-4 w-4 text-red-500" />
                <div className="text-sm">
                  <div className="font-medium text-red-800 dark:text-red-200">
                    {disconnectedCount} Isolated Nodes Found
                  </div>
                  <div className="text-red-700 dark:text-red-300">
                    These nodes are not connected to the main supply chain flow
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Source Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Data Source Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Inbound (Suppliers):</span>
              <Badge variant="outline">{sourceBreakdown.inbound || 0}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">BOM (Materials):</span>
              <Badge variant="outline">{sourceBreakdown.bom || 0}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Outbound (Customers):</span>
              <Badge variant="outline">{sourceBreakdown.outbound || 0}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bridge Mappings:</span>
              <Badge variant="secondary">{sourceBreakdown.bridge || 0}</Badge>
            </div>
            {sourceBreakdown.multi_tier > 0 && (
              <div className="flex justify-between col-span-2">
                <span className="text-muted-foreground">Multi-tier Edges:</span>
                <Badge variant="outline">{sourceBreakdown.multi_tier || 0}</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tips for Improvement */}
      {connectionRate < 90 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-yellow-600">Improvement Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {(sourceBreakdown.inbound > 0 && sourceBreakdown.bom > 0 && connectionStats.bridgeConnections === 0) && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-red-500" />
                  <span><strong>Critical:</strong> Inbound suppliers not connecting to BOM materials - check material ID consistency</span>
                </div>
              )}
              {connectionStats.bridgeConnections === 0 && sourceBreakdown.inbound > 0 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-500" />
                  <span>No automatic bridges found - inbound materials may not match BOM material IDs</span>
                </div>
              )}
              {connectionStats.avgConfidence < 0.8 && connectionStats.bridgeConnections > 0 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-500" />
                  <span>Low mapping confidence ({(connectionStats.avgConfidence * 100).toFixed(0)}%) - consider standardizing material naming</span>
                </div>
              )}
              {disconnectedCount > connectionStats.total * 0.2 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-500" />
                  <span>Many isolated nodes ({disconnectedCount}) - verify data completeness across all sources</span>
                </div>
              )}
              {connectionRate > 90 && connectionStats.bridgeConnections > 0 && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-3 w-3 mt-0.5 text-green-500" />
                  <span>Excellent integration! {connectionStats.bridgeConnections} bridge connections successfully link inbound to BOM data</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}