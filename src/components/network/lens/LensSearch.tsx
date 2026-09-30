/**
 * "find a node" — the header search on all three lenses (network-lenses handoff §9).
 *
 * The icon button opens a 192px input. Typing lists up to eight CONTAINS matches
 * from the visible set; Enter or a mousedown picks one (mousedown, so the pick
 * lands before the input blurs). An exact typed id already highlights on the
 * graph, so the list hides for it. Blur with an empty term collapses the input.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HDR_ICON_BUTTON } from '@/components/shared';
import { isExactHit, nodeSuggestions } from '@/lib/graph';
import { cn } from '@/lib/utils';
import { LENS } from './tokens';

export interface SearchCandidate {
  id: string;
  /** What is matched and shown: the node id, or a firm's name. */
  label: string;
  color: string;
  classLabel: string;
}

interface LensSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  term: string;
  onTermChange: (term: string) => void;
  candidates: SearchCandidate[];
  onPick: (candidate: SearchCandidate) => void;
  /** Ids in JetBrains Mono; firm names stay in Inter. */
  monoLabels?: boolean;
}

export function LensSearch({
  open,
  onOpenChange,
  term,
  onTermChange,
  candidates,
  onPick,
  monoLabels = true,
}: LensSearchProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const matches = useMemo(() => nodeSuggestions(candidates, term), [candidates, term]);
  const showList = suggestOpen && term.trim() !== '' && !isExactHit(candidates, term);

  const pick = (c: SearchCandidate) => {
    onTermChange(c.label);
    setSuggestOpen(false);
    onPick(c);
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="icon"
        className={HDR_ICON_BUTTON}
        onClick={() => onOpenChange(true)}
        aria-label="Search"
        title="Search"
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative w-[192px]">
      <Search
        className={cn('pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', LENS.muted)}
        aria-hidden
      />
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-label="Find a node"
        className={cn(
          'h-11 w-full rounded-[4px] border bg-white pl-9 pr-3 text-[13px] outline-none md:h-9',
          LENS.border,
          'focus:border-[var(--brand-ink)]',
        )}
        placeholder="find a node"
        value={term}
        onChange={(e) => {
          onTermChange(e.target.value);
          setSuggestOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSuggestOpen(false);
          if (e.key === 'Enter' && showList && matches[0]) {
            e.preventDefault();
            pick(matches[0]);
          }
        }}
        onBlur={() => {
          setSuggestOpen(false);
          if (!term) onOpenChange(false);
        }}
      />
      {showList && (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 top-10 z-50 flex max-h-[288px] w-[240px] flex-col gap-px overflow-y-auto rounded-[4px] border bg-white p-1',
            LENS.border,
          )}
        >
          {matches.length === 0 ? (
            <p className={cn('p-2 text-[12px]', LENS.muted)}>No node matches.</p>
          ) : (
            matches.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={cn('flex h-[30px] w-full items-center gap-2 rounded-[3px] px-2 text-left', LENS.hoverRow)}
              >
                <span aria-hidden className="h-2 w-2 flex-none rounded-[2px]" style={{ background: c.color }} />
                <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', LENS.ink, monoLabels && 'font-mono')}>
                  {c.label}
                </span>
                <span className={cn('flex-none whitespace-nowrap text-[11px]', LENS.muted)}>{c.classLabel}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
