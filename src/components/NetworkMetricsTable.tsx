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
            <span>📊 <strong>Degree:</strong> Connection ratio to max possible</span>
            <span>⚖️ <strong>Weighted:</strong> Revenue-weighted connections</span>
            <span>🎯 <strong>Eigenvector:</strong> Connected to important nodes</span>
            <span>🌉 <strong>Betweenness:</strong> Bridge between network clusters</span>
            <span>📍 <strong>Closeness:</strong> Average distance to all nodes</span>
            <span>⭐ <strong>Prominence:</strong> Overall network importance</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}