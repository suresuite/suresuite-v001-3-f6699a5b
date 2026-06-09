import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  rightContent?: React.ReactNode;
  onRefresh?: () => void;
  refreshLoading?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightContent,
  onRefresh,
  refreshLoading = false,
}: PageHeaderProps) {
  return (
    <div className="sticky top-0 z-40 -mx-12 -mt-6 mb-6 bg-header-background border-b border-header-border">
      <div className="px-8 py-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground leading-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <div className="text-[13px] text-muted-foreground mt-1">
              {subtitle}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <Button
              onClick={onRefresh}
              disabled={refreshLoading}
              variant="outline"
              size="sm"
              className="h-8 px-2.5"
            >
              <RefreshCw className={`h-4 w-4 ${refreshLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
          {rightContent}
        </div>
      </div>
    </div>
  );
}
