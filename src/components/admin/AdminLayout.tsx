// Reskinned AdminLayout — same API and 180px sub-nav as the original, but the
// active item uses the SuReSuite red rail + soft-grey pill (bg-muted/80), and
// spacing is tightened to the Ledger language. Drop-in replacement for
// src/components/admin/AdminLayout.tsx.
import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
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
import { cn } from '@/lib/utils';

interface AdminLayoutProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  title: string;
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshLoading?: boolean;
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
  actions,
  onRefresh,
  refreshLoading,
  children,
}: AdminLayoutProps) {
  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title={title}
          rightContent={actions}
          onRefresh={onRefresh}
          refreshLoading={refreshLoading}
        />

        {/* Horizontal tab nav — same TabsList/TabsTrigger treatment as Developer API */}
        <div className="mb-5 inline-flex h-auto items-center gap-0.5 rounded-sm border border-[#ebebeb] bg-white p-[3px]">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] px-[15px] py-[7px] text-[12.5px] font-medium transition-colors',
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
