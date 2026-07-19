import { TableCell, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

/** Unified loading row for data tables — sibling of TableEmpty. */
export function TableLoading({ colSpan }: { colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
}
