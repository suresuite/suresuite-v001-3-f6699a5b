// The project-scope chip (handoff v3 §1.4): the header second-row control on
// every project-scoped root — Network, Policies, Lab and Ask. Editing a
// policy in the wrong project is expensive, so the project rides along on
// the header rather than being one Select buried in a row of controls.
//
// It is a chip and not the title because the title has to stay the
// destination name — that is what keeps the tab-bar roots legible. Projects
// itself carries no chip (it IS the picker), and a pushed view never repeats
// it — the chip is one back-tap away and the object's own name is the more
// useful title there.
//
// Switching project does not navigate: it calls the caller's `onSelect`,
// which is expected to flow into `useGlobalProject`'s setter the way every
// project-scoped screen already does. Because the screen underneath doesn't
// change, whatever search term or filters it holds in local state survive
// the switch for free — there is nothing here to preserve.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M } from './tokens';
import { MobileHeaderSearch } from './HeaderSearch';
import { MobileSheet, MobileSheetRow } from '@/components/shared/MobileSheet';

/** Above this many projects the sheet grows a filter field. Below it, scrolling
 *  the sheet IS the search and a field would only cost a row of height — a
 *  modeller with five projects reads them faster than they type. */
const FILTER_FROM = 8;

export interface ProjectChipProject {
  id: string;
  name: string;
}

export function ProjectChip({
  projects,
  selectedId,
  onSelect,
  className,
}: {
  projects: ProjectChipProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const rowsRef = React.useRef<HTMLDivElement | null>(null);

  const q = query.trim().toLowerCase();
  const matches = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;

  // Opening onto row 1 of 40 hides the project you are ON — and with it the
  // only tick that says which one that is. The sheet opens at the current
  // project instead, so a long list starts where the user already is and
  // scrolls both ways from there.
  React.useEffect(() => {
    if (!open) return;
    const el = rowsRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  const openSheet = () => {
    // A stale filter from the last switch would open the sheet on a subset of
    // the projects with no sign of why — the field starts empty every time.
    setQuery('');
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        title={selected ? selected.name : 'Choose a project'}
        aria-label={selected ? `Project ${selected.name}, change project` : 'Choose a project'}
        className={cn(
          // 26px visible, a transparent 44px hit area around it — the same
          // technique the toggle and stepper use to clear the touch floor
          // without growing the control itself.
          'relative flex h-[26px] min-w-0 max-w-full shrink-0 items-center gap-1.5',
          'rounded-[3px] border border-[#d4d4d4] bg-white px-2',
          'after:absolute after:-inset-x-1.5 after:-inset-y-[9px] after:content-[""]',
          className,
        )}
      >
        <span
          aria-hidden
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: M.firm }}
        />
        <span className="min-w-0 truncate font-mono text-[10.5px] text-[#171717]">
          {selected ? selected.name : 'Select project'}
        </span>
        {/* Same allowlisted chevron the rest of the skin uses for "expand" —
            not U+2304, which the emoji sweep flags (spec's own glyph reads as
            a down arrow either way, v1 Controls). */}
        <span aria-hidden className="shrink-0 text-[8px] leading-none text-[#525252]">
          ▾
        </span>
      </button>

      <MobileSheet
        open={open}
        title="Switch project"
        sub={projects.length >= FILTER_FROM ? `${projects.length} projects` : undefined}
        onClose={() => setOpen(false)}
      >
        {projects.length >= FILTER_FROM && (
          // Sticky, not scrolled with the rows: on a list long enough to need
          // a filter at all, a field that scrolls away is a field you have to
          // scroll back to (the same argument §1.2 makes for header search).
          <div className="sticky top-0 z-10 flex border-b border-[#e8e8ea] bg-white px-3 py-2">
            <MobileHeaderSearch
              value={query}
              onChange={setQuery}
              placeholder="Find a project"
            />
          </div>
        )}
        <div ref={rowsRef}>
          {matches.map((p) => (
            <MobileSheetRow
              key={p.id}
              title={p.name}
              checked={p.id === selectedId}
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            />
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-9 text-center text-[13px] leading-relaxed text-[#525252]">
              No project matches “{query.trim()}”.
            </p>
          )}
        </div>
      </MobileSheet>
    </>
  );
}
