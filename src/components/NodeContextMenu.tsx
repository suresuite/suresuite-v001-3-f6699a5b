import { useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { AlertTriangle, Eye, Plus } from 'lucide-react';

interface NodeContextMenuProps {
  children: React.ReactNode;
  nodeId: string;
  onAddDisruption: (nodeId: string) => void;
  onViewScenarios: (nodeId: string) => void;
  hasScenarios?: boolean;
}

export function NodeContextMenu({ 
  children, 
  nodeId, 
  onAddDisruption, 
  onViewScenarios,
  hasScenarios = false 
}: NodeContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onAddDisruption(nodeId)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Disruption Scenario
        </ContextMenuItem>
        {hasScenarios && (
          <ContextMenuItem onClick={() => onViewScenarios(nodeId)}>
            <Eye className="mr-2 h-4 w-4" />
            View Scenarios
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}