import { Link } from "react-router-dom";
import {
  Home,
  Network,
  ChevronLeft,
  LogOut,
  User,
  Building2,
  Database,
  FlaskConical,
  Info,
  HelpCircle,
  ChevronRight,
  Factory,
  Layers,
  Target,
  Brain,
  SlidersHorizontal,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { canAccessRoute } from "@/lib/permissions";
import type { UserRole } from "@/hooks/useUserRole";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import NavItem, { type NavItemConfig } from "./NavItem";

interface NavbarProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

const sectionLabel =
  "px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider";

const NAV_SECTIONS: { title?: string; items: NavItemConfig[] }[] = [
  {
    items: [
      { to: "/", icon: Home, label: "Getting Started", tooltip: "Getting Started" },
      {
        to: "/project-manager",
        icon: Database,
        label: "Project Manager",
        tooltip: "Project Manager",
      },
    ],
  },
  {
    title: "Networks",
    items: [
      {
        to: "/network/product-level",
        icon: Factory,
        label: "Product-Level",
        tooltip: "Product-Level",
      },
      {
        to: "/network/process-level",
        icon: Layers,
        label: "Process-Level",
        tooltip: "Process-Level",
      },
      {
        to: "/network/firm-level",
        icon: Network,
        label: "Firm-Level",
        tooltip: "Firm-Level",
      },
    ],
  },
  {
    title: "Simulation",
    items: [
      {
        to: "/policies",
        icon: SlidersHorizontal,
        label: "Policies",
        tooltip: "Sourcing, inventory, transportation, fulfillment",
      },
      {
        to: "/simulation-lab",
        icon: FlaskConical,
        label: "Simulation Lab",
        tooltip: "Scientific experiments: replications, warm-up, utilization KPIs",
      },
      {
        to: "/simulation",
        icon: FlaskConical,
        label: "Legacy Sim",
        tooltip: "Legacy single-run simulation",
      },
    ],
  },
  {
    title: "AI Assistant",
    items: [
      {
        to: "/project-intelligence",
        icon: Brain,
        label: "Project Intelligence",
        tooltip: "AI-powered project insights",
      },
    ],
  },
  {
    title: "About",
    items: [
      {
        to: "/help",
        icon: Info,
        label: "About & Help",
        tooltip: "About & Help",
      },
    ],
  },
];

const Navbar = ({ isCollapsed, setIsCollapsed }: NavbarProps) => {
  const { user, logout } = useAuth();

  const handleLogout = () => logout();

  const role = (user?.role as UserRole | undefined) ?? undefined;
  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute(item.to, role)),
    }))
    .filter((section) => section.items.length > 0);

  const sizes = {
    collapsedW: "w-[64px]",
    expandedW: "w-56",
    logoBoxH: "h-12",
    logoBoxW: "w-28",
    // Match NavItem exact dimensions and spacing
    navItemPadding: "p-2.5", // exact NavItem padding
    logoIconSize: "h-[15px] w-[15px]", // same size as nav icons
    navIconSize: 15,
  } as const;

  return (
    <div
      className={cn(
        "fixed left-0 top-0 h-full flex z-[60] overflow-hidden transition-[width] duration-500 ease-in-out",
        isCollapsed ? sizes.collapsedW : `w-full ${sizes.expandedW}`
      )}
    >
      <nav
        className={cn(
          "w-full bg-background border-r border-border relative",
          isCollapsed ? "p-2" : "p-4"
        )}
      >
        {/* Header - Unified positioning approach */}
        <div className="mb-6 h-12 relative">
          {!isCollapsed ? (
            /* Expanded state */
            <>
              <div className="absolute left-2 right-12 top-0 h-full flex items-center justify-center">
                <img
                  src="/logo.png"
                  alt="SuReSuite"
                  className="object-contain h-8"
                  width={144}
                  height={80}
                />
              </div>
              <div className="absolute right-2 top-0 h-full flex items-center">
                <button
                  onClick={() => setIsCollapsed(true)}
                  aria-label="Collapse sidebar"
                  title="Collapse navigation bar"
                  className="p-2.5 rounded-md hover:bg-accent"
                >
                  <ChevronLeft size={15} />
                </button>
              </div>
            </>
          ) : (
            /* Collapsed state - centered in the collapsed width */
            <div className="absolute left-0 right-0 top-0 h-full flex items-center justify-center">
              <div className="relative">
                <button
                  onClick={() => setIsCollapsed(false)}
                  aria-label="Expand navigation bar"
                  title="Expand navigation bar"
                  className="p-2.5 rounded-md hover:bg-muted hover:text-foreground"
                >
                  <img
                    src="/logo1.png"
                    alt="SuReSuite compact"
                    className="h-[32px] w-[32px] object-contain"
                  />
                </button>
                <button
                  onClick={() => setIsCollapsed(false)}
                  aria-label="Expand sidebar" 
                  title="Expand navigation bar"
                  className="absolute inset-0 p-2.5 rounded-md opacity-0 hover:opacity-100 hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Links */}
        <div>
          {visibleSections.map((section, index) => (
            <div key={section.title ?? index} className={cn(index > 0 && "mt-6")}>
              {!isCollapsed && section.title && (
                <div className={sectionLabel}>{section.title}</div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem
                    key={item.to}
                    {...item}
                    isCollapsed={isCollapsed}
                    iconSize={sizes.navIconSize}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom area */}
        <div className="absolute bottom-3 left-3 right-3">
          {isCollapsed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account menu (collapsed)" title="Account" className="w-full flex justify-center">
                  <Avatar className="h-7 w-7">
                    {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt="Avatar" /> : null}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs leading-none">
                      {user?.name ? (
                        user.name.charAt(0).toUpperCase()
                      ) : (
                        <User className="h-3 w-3" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-44 z-[70]">
                <DropdownMenuLabel>{user?.name || "User"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <User className="mr-2 h-4.5 w-4.5" /> My Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/help">
                    <HelpCircle className="mr-2 h-4.5 w-4.5" /> Help
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} title="Log out">
                  <LogOut className="mr-2 h-4.5 w-4.5" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account menu"
                  className="flex items-center space-x-2"
                  title="Account"
                >
                  <Avatar className="h-7 w-7">
                    {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt="Avatar" /> : null}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs leading-none">
                      {user?.name ? (
                        user.name.charAt(0).toUpperCase()
                      ) : (
                        <User className="h-3 w-3" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {user?.display_name || user?.name || "User"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {user?.role || "user"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52 z-[70]">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <User className="mr-2 h-4.5 w-4.5" /> My Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/help">
                    <HelpCircle className="mr-2 h-4.5 w-4.5" /> Help
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} title="Log out">
                  <LogOut className="mr-2 h-4.5 w-4.5" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>
      <Separator orientation="vertical" className="h-full" />
    </div>
  );
};

export default Navbar;
