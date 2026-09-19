import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface NetworkMetric {
  id: string;
  uid: string;
  name: string;
  revenue: number | null;
  degree_centrality: number | null;
  weighted_degree_centrality: number | null;
  eigenvector_centrality: number | null;
  betweenness_centrality: number | null;
  closeness_centrality: number | null;
  prominence: number | null;
  connection_count: number;
  /**
   * WP 6.3 · §4 D88 — WHICH HALF OF THE DUAL READ ANSWERED.
   *
   * `store`  — `analysis_results`, from a recorded run: reproducible, and it
   *            carries the hash of the dataset it was computed from.
   * `column` — the entity mirror on `network_nodes`, because the store has no row
   *            for this node. Legacy, written before provenance existed, and
   *            nothing can say which data produced it.
   * `none`   — neither half has a number. NOT zero (§4 D17).
   *
   * These arrive from `get_network_metrics_for_materials`, which does the
   * preference in ONE place so no screen has to. Optional on the type because the
   * page renders before the columns land and a partial dataset must not crash a
   * table; absent is treated exactly as `none` would be — unknown, said out loud.
   */
  metrics_source?: 'store' | 'column' | 'none' | null;
  run_id?: string | null;
  computed_from_hash?: string | null;
  computed_at?: string | null;
  /** NULL when there is no hash to compare. Unknown is not stale (D70). */
  hash_is_current?: boolean | null;
}

/**
 * The one-line account of where this table's numbers came from — §5 T2, at the
 * point of display.
 *
 * A screen that showed reproducible figures and legacy ones in the same font
 * would be T1 with the source silently removed, and that is the state every
 * project is in right now: 439 of 1 824 rows carry a hash and the rest predate
 * provenance (§15 run 35399391429). The columns cannot be dropped until every
 * project has been re-run, and the rows cannot be backfilled — inventing a hash is
 * the fabricated provenance I6 forbids — so the honest move is to SAY which.
 */
function provenanceSummary(metrics: NetworkMetric[]): string | null {
  if (metrics.length === 0) return null;
  const n = (k: NetworkMetric['metrics_source']) =>
    metrics.filter((m) => (m.metrics_source ?? 'none') === k).length;
  const store = n('store');
  const column = n('column');
  const none = n('none');
  // The stale count is only meaningful for rows that HAVE a hash, which is why it
  // is counted separately rather than folded into `store`.
  const stale = metrics.filter((m) => m.hash_is_current === false).length;
  const unknown = metrics.filter(
    (m) => (m.metrics_source ?? 'none') !== 'none' && m.hash_is_current == null,
  ).length;

  const parts: string[] = [];
  if (store > 0) parts.push(`${store} from a recorded analysis run`);
  if (column > 0) {
    parts.push(
      `${column} from values stored before this project tracked provenance — ` +
        `nothing can say which data produced them`,
    );
  }
  if (none > 0) parts.push(`${none} not computed yet`);
  if (parts.length === 0) return null;

  let out = `Where these numbers come from: ${parts.join('; ')}.`;
  if (stale > 0) {
    out +=
      ` ${stale} were computed from a different version of this dataset than the ` +
      `one loaded now — re-run the analysis before quoting them.`;
  }
  if (unknown > 0 && column > 0) {
    out += ` For ${unknown} of them we cannot tell, which is not the same as up to date.`;
  }
  return out;
}

interface NetworkMetricsTableProps {
  metrics: NetworkMetric[];
  loading?: boolean;
}

type SortField = keyof NetworkMetric;
type SortDirection = 'asc' | 'desc' | null;

export function NetworkMetricsTable({ metrics, loading = false }: NetworkMetricsTableProps) {
  const [sortField, setSortField] = useState<SortField>('betweenness_centrality');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showAll, setShowAll] = useState(false);
  
  const displayLimit = 10;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedMetrics = React.useMemo(() => {
    if (!sortField || !sortDirection) return showAll ? metrics : metrics.slice(0, displayLimit);

    const sorted = [...metrics].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
      // Handle null values
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return showAll ? sorted : sorted.slice(0, displayLimit);
  }, [metrics, sortField, sortDirection, showAll, displayLimit]);

  const formatNumber = (value: number | null, decimals = 3) => {
    if (value === null) return '-';
    return value.toFixed(decimals);
  };

  const formatRevenue = (value: number | null) => {
    if (value === null) return '-';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4" />;
    if (sortDirection === 'asc') return <ArrowUp className="h-4 w-4" />;
    if (sortDirection === 'desc') return <ArrowDown className="h-4 w-4" />;
    return <ArrowUpDown className="h-4 w-4" />;
  };

  const getProminenceColor = (prominence: number | null) => {
    if (prominence === null) return '';
    if (prominence >= 0.8) return 'text-destructive font-semibold';
    if (prominence >= 0.6) return 'text-warning font-medium';
    if (prominence >= 0.4) return 'text-primary';
    return 'text-muted-foreground';
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Network Science Metrics</CardTitle>
          <CardDescription>Analyzing network centrality for nexus materials...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Network Science Metrics</CardTitle>
          <CardDescription>No network metrics available for material nodes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No material nodes with calculated network metrics found.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network Science Metrics - Nexus Materials</CardTitle>
        <CardDescription>
          {showAll 
            ? `Network centrality analysis for ${metrics.length} material nodes.`
            : `Top ${Math.min(displayLimit, metrics.length)} of ${metrics.length} material nodes by betweenness centrality.`
          } Higher values indicate more critical positions in the supply network.
        </CardDescription>
        {/* §4 D88 · T2 — the substitution is visible where the numbers are, not in
            a log. `provenanceSummary` returns null only when the table is empty,
            so a populated table always accounts for itself. */}
        {provenanceSummary(metrics) && (
          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
            {provenanceSummary(metrics)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[120px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('name')}
                  >
                    Material Name
                    {getSortIcon('name')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('connection_count')}
                  >
                    Connections
                    {getSortIcon('connection_count')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('revenue')}
                  >
                    Revenue
                    {getSortIcon('revenue')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('degree_centrality')}
                  >
                    Degree
                    {getSortIcon('degree_centrality')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('weighted_degree_centrality')}
                  >
                    Wtd. Degree
                    {getSortIcon('weighted_degree_centrality')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('eigenvector_centrality')}
                  >
                    Eigenvector
                    {getSortIcon('eigenvector_centrality')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('betweenness_centrality')}
                  >
                    Betweenness
                    {getSortIcon('betweenness_centrality')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('closeness_centrality')}
                  >
                    Closeness
                    {getSortIcon('closeness_centrality')}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-semibold text-white hover:bg-transparent hover:text-white"
                    onClick={() => handleSort('prominence')}
                  >
                    Prominence
                    {getSortIcon('prominence')}
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMetrics.map((metric) => (
                <TableRow key={metric.id}>
                  <TableCell className="font-medium">
                    {metric.name || metric.uid}
                  </TableCell>
                  <TableCell className="text-right">
                    {metric.connection_count}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatRevenue(metric.revenue)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(metric.degree_centrality)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(metric.weighted_degree_centrality)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(metric.eigenvector_centrality)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(metric.betweenness_centrality)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(metric.closeness_centrality)}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm ${getProminenceColor(metric.prominence)}`}>
                    {formatNumber(metric.prominence)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {metrics.length > displayLimit && (
          <div className="flex justify-center mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll 
                ? 'Show Less' 
                : `Show ${metrics.length - displayLimit} More Nodes`
              }
            </Button>
          </div>
        )}
        
        <div className="mt-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-4">
            <span><strong>Degree:</strong> Connection ratio to max possible</span>
            <span><strong>Weighted:</strong> Revenue-weighted connections</span>
            <span><strong>Eigenvector:</strong> Connected to important nodes</span>
            <span><strong>Betweenness:</strong> Bridge between network clusters</span>
            <span><strong>Closeness:</strong> Average distance to all nodes</span>
            <span><strong>Prominence:</strong> Overall network importance</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}