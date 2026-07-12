import { ReactNode } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Inbox } from 'lucide-react';

interface TableEmptyProps {
  colSpan: number;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** Unified empty state for admin tables. */
export function TableEmpty({
  colSpan,
  message = 'Nothing to show yet.',
  action,
  icon,
}: TableEmptyProps) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="text-muted-foreground/70">
            {icon ?? <Inbox className="h-5 w-5" />}
          </div>
          <div className="text-sm text-muted-foreground">{message}</div>
          {action}
        </div>
      </TableCell>
    </TableRow>
  );
}
