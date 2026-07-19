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
  description?: ReactNode;
  actions?: ReactNode;
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
  description,
  actions,
  children,
}: AdminLayoutProps) {
  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader title={title} subtitle={description} rightContent={actions} />

        <div className="grid grid-cols-[180px_1fr] gap-6">
          <nav className="flex flex-col gap-0.5">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      isActive
                        ? "bg-muted/80 text-foreground before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-primary"
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </PageLayout>
  );
}
