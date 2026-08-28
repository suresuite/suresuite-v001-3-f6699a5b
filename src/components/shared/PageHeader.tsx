import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_GUTTER_BLEED } from './PageBody';

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
    <div
      className={cn(
        'sticky top-0 z-40 mb-4 lg:mb-5 bg-header-background/95 backdrop-blur-md border-b border-header-border',
        PAGE_GUTTER_BLEED,
      )}
    >
      <div className="px-4 py-3 sm:px-6 lg:px-8 lg:py-3.5 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold text-foreground leading-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
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
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
          {rightContent}
        </div>
      </div>
    </div>
  );
}
