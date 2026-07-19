import { TableCell, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Unified loading state for data tables — sibling of TableEmpty.
 * Skeleton rows at the real row height so the table doesn't jump when data lands.
 */
export function TableLoading({ colSpan, rows = 3 }: { colSpan: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          <TableCell colSpan={colSpan}>
            <Skeleton className="h-4 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
