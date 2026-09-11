// The header second-row search field (v3 §1.2 / §2.1 / §3.1): pinned with
// the title inside `MobilePageHeader`'s fixed block, so it never scrolls
// away. Shared by the Projects root and the Policies root — both put search
// on the second row rather than in the scrolling body, for the same reason
// (§1.2: "search never scrolls away" is the whole argument for putting it
// in the header at all).
import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { M } from './tokens';

export function MobileHeaderSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2"
        style={{ color: M.quiet }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full min-w-0 rounded-[6px] border bg-white pl-8 pr-3 font-mono text-[13px] text-[#171717] outline-none placeholder:font-sans placeholder:text-[13px]"
        style={{ borderColor: M.hair }}
      />
    </div>
  );
}
