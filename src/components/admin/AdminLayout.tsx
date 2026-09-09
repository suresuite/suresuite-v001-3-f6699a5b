// Reskinned AdminLayout — same API and 180px sub-nav as the original, but the
// active item uses the SuReSuite red rail + soft-grey pill (bg-muted/80), and
// spacing is tightened to the Ledger language. Drop-in replacement for
// src/components/admin/AdminLayout.tsx.
import { ReactNode, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Building2,
  FolderKanban,
  Cpu,
  Activity,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { PAGE_GUTTER } from '@/components/shared/PageBody';
import { cn } from '@/lib/utils';

interface AdminLayoutProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  title: string;
  /** Forwarded to PageHeader. Admin pages that carry a context line (user
   *  access has email + role + super-admin) had nowhere to put it, so it was
   *  computed and dropped on the floor. */
  subtitle?: ReactNode;
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshLoading?: boolean;
  /** Forwarded to PageHeader's mobile back affordance (spec §4.1). Only the
   *  drill-down pages have a parent route; it is not decoration. */
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}

const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/roles', label: 'Role Defaults', icon: ShieldCheck },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/admin/models', label: 'AI Models', icon: Cpu },
  { to: '/admin/usage', label: 'AI Usage', icon: Activity },
  { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
];

export function AdminLayout({
  isCollapsed,
  setIsCollapsed,
  title,
  subtitle,
  actions,
  onRefresh,
  refreshLoading,
  onBack,
  backLabel,
  children,
}: AdminLayoutProps) {
  const { pathname } = useLocation();
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = activeRef.current;
    const strip = el?.parentElement;
    if (!el || !strip) return;
    const target = el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2;
    strip.scrollLeft = Math.max(0, target);
  }, [pathname]);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        <PageHeader
          title={title}
          subtitle={subtitle}
          rightContent={actions}
          onRefresh={onRefresh}
          refreshLoading={refreshLoading}
          onBack={onBack}
          backLabel={backLabel}
        />

        {/* Horizontal tab nav — same TabsList/TabsTrigger treatment as Developer API.
            overflow-x-auto is the real fix: at 390px this strip is ~855px wide against
            a ~336px container, so without it the last five tabs are unreachable. */}
        <div
          className="mb-5 flex h-auto max-w-full items-stretch gap-0.5 overflow-x-auto rounded-sm
                     border border-[--hair-border] bg-white p-[3px]
                     [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                     md:inline-flex md:overflow-visible"
        >
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                ref={isActive ? activeRef : undefined}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[2px] px-[15px] py-[7px] text-[12.5px] font-medium transition-colors md:min-h-0',
                    isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </div>

        <main className="min-w-0">{children}</main>
      </div>
    </PageLayout>
  );
}
