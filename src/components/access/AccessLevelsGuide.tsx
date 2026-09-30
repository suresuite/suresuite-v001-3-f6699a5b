// §4 D213 — the three access levels side by side: every role on each level, who it is,
// and what it lets a person do as the rules stand today. Rendered on /profile (My Access)
// and on /admin (Users, Projects); the words live in `src/lib/auth/accessLevels.ts`.
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_TIERS, ENFORCEMENT_NOTE, LEVELS, ORG_ROLES, ORG_ROLE_INFO, PLATFORM_ROLES, PROJECT_LEVEL_NOTE,
  PROJECT_ROLES, PROJECT_ROLE_INFO, type RoleInfo,
} from '@/lib/auth/accessLevels';

export interface MyRoles {
  /** 'super_admin' | 'standard' */
  platform?: string | null;
  tier?: string | null;
  orgRole?: string | null;
}

interface Entry { key: string; heading?: string; info: RoleInfo; mine: boolean }

function RoleEntry({ entry }: { entry: Entry }) {
  const { info } = entry;
  return (
    <details className={cn('group rounded-md border px-3 py-2', entry.mine ? 'border-foreground/40 bg-muted/40' : 'border-border')}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 md:min-h-0">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {info.label}
            {entry.mine && <span className="ml-2 rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">You</span>}
          </span>
          <span className="block text-xs text-muted-foreground">{info.summary}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Details</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide</span>
      </summary>
      {(info.can.length > 0 || info.cannot.length > 0) && (
        <ul className="mt-2 space-y-1 text-xs">
          {info.can.map((c) => (
            <li key={c} className="flex gap-1.5">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span className="min-w-0">{c}</span>
            </li>
          ))}
          {info.cannot.map((c) => (
            <li key={c} className="flex gap-1.5 text-muted-foreground">
              <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">{c}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function AccessLevelsGuide({ mine, className }: { mine?: MyRoles; className?: string }) {
  const columns: Record<string, { sub?: string; entries: Entry[] }[]> = {
    platform: [{
      entries: (['super_admin', 'standard'] as const).map((k) => ({ key: k, info: PLATFORM_ROLES[k], mine: mine?.platform === k })),
    }],
    organization: [
      {
        sub: 'Account tier — one per account, applies in every organization it belongs to',
        entries: (Object.keys(ACCOUNT_TIERS) as (keyof typeof ACCOUNT_TIERS)[]).map((k) => ({ key: k, info: ACCOUNT_TIERS[k], mine: mine?.tier === k })),
      },
      {
        sub: 'Role in the organization — one per membership',
        entries: ORG_ROLES.map((k) => ({ key: k, info: ORG_ROLE_INFO[k], mine: mine?.orgRole === k })),
      },
    ],
    project: [{
      sub: 'Project role — one per project',
      entries: PROJECT_ROLES.map((k) => ({ key: k, info: PROJECT_ROLE_INFO[k], mine: false })),
    }],
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
        {LEVELS.map((level, i) => (
          <section key={level.key} className="min-w-0 rounded-md border border-border p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Level {i + 1} &middot; {level.label}
            </div>
            <h3 className="mt-1 text-sm font-semibold">{level.question}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{level.where}</p>
            <div className="mt-3 space-y-3">
              {columns[level.key].map((group) => (
                <div key={group.sub ?? level.key} className="space-y-1.5">
                  {group.sub && <div className="text-[11px] font-medium text-muted-foreground">{group.sub}</div>}
                  {group.entries.map((e) => <RoleEntry key={e.key} entry={e} />)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{PROJECT_LEVEL_NOTE}</p>
      <p className="text-xs text-muted-foreground">{ENFORCEMENT_NOTE}</p>
    </div>
  );
}
