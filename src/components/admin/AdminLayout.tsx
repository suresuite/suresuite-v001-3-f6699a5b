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
import { cn } from '@/lib/utils';

interface AdminLayoutProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  title: string;
  description?: string;
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
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>

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
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
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
