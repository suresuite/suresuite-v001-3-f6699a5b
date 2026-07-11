import { Link } from "react-router-dom";
import {
  Home,
  Network,
  ChevronLeft,
  LogOut,
  User,
  Database,
  FlaskConical,
  Info,
  HelpCircle,
  ChevronRight,
  Factory,
  Layers,
  Brain,
  SlidersHorizontal,
  Shield,
  Code2,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
    ],
  },
  {
    items: [
      {
        to: "/project-intelligence",
        icon: Brain,
        label: "Project Intelligence",
        tooltip: "AI-powered project insights",
      },
      {
        to: "/developer",
        icon: Code2,
        label: "Developer API",
        tooltip: "API keys, scopes, and quickstarts for programmatic access",
      },
    ],
  },
  {
    items: [
      {
        to: "/admin",
        icon: Shield,
        label: "Super Admin",
        tooltip: "Platform administration",
      },
    ],
  },
  {
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
    collapsedW: "w-14",
    expandedW: "w-48",
    logoBoxH: "h-10",
    logoBoxW: "w-24",
    navItemPadding: "p-2",
    logoIconSize: "h-[14px] w-[14px]",
    navIconSize: 14,
  } as const;

  return (
    <div
      className={cn(
        "light fixed left-0 top-0 h-full flex z-[60] overflow-hidden transition-[width] duration-500 ease-in-out",
        isCollapsed ? sizes.collapsedW : `w-full ${sizes.expandedW}`
      )}
    >
      <nav
        className={cn(
          "w-full bg-background border-r border-border relative",
          isCollapsed ? "p-2" : "p-3"
        )}
      >
        {/* Header */}
        <div className="mb-4 h-10 relative">
          {!isCollapsed ? (
            <>
              <div className="absolute left-2 right-10 top-0 h-full flex items-center justify-center">
                <img
                  src="/logo.png"
                  alt="SuReSuite"
                  className="object-contain h-6"
                  width={144}
                  height={80}
                />
              </div>
              <div className="absolute right-2 top-0 h-full flex items-center">
                <button
                  onClick={() => setIsCollapsed(true)}
                  aria-label="Collapse sidebar"
                  title="Collapse navigation bar"
                  className="p-2 rounded-md hover:bg-accent"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="absolute left-0 right-0 top-0 h-full flex items-center justify-center">
              <button
                onClick={() => setIsCollapsed(false)}
                aria-label="Expand navigation bar"
                title="Expand navigation bar"
                className="group relative p-2 rounded-md hover:bg-muted hover:text-foreground"
              >
                <img
                  src="/logo1.png"
                  alt="SuReSuite compact"
                  className="h-6 w-6 object-contain transition-opacity group-hover:opacity-0"
                />
                <ChevronRight
                  size={14}
                  className="absolute inset-0 m-auto opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            </div>
          )}
        </div>

        {/* Links */}
        <div>
          {visibleSections.map((section, index) => (
            <div key={section.title ?? index}>
              {index > 0 && <Separator className="my-3 bg-border/50" />}
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

        {/* Bottom area — account menu */}
        <div className="absolute bottom-3 left-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                title="Account"
                className={cn(
                  "group w-full flex items-center rounded-md outline-none transition-all duration-200",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  "hover:bg-accent active:scale-[0.98]",
                  isCollapsed ? "justify-center p-1.5" : "gap-2 p-1.5"
                )}
              >
                <Avatar
                  className={cn(
                    "h-7 w-7 ring-1 ring-border transition-shadow duration-200",
                    "group-hover:ring-primary/40 group-focus-visible:ring-primary"
                  )}
                >
                  {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt="Avatar" /> : null}
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs leading-none">
                    {user?.name ? (
                      user.name.charAt(0).toUpperCase()
                    ) : (
                      <User className="h-3 w-3" />
                    )}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {user?.display_name || user?.name || "User"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {user?.role || "user"}
                    </p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isCollapsed ? "right" : "top"}
              align={isCollapsed ? "end" : "start"}
              sideOffset={8}
              className="light w-52 z-[70]"
            >
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-xs font-medium truncate">
                  {user?.display_name || user?.name || "Account"}
                </span>
                <span className="text-[10px] font-normal text-muted-foreground truncate">
                  {user?.role || "user"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile">
                  <User className="mr-2 h-4 w-4" /> My Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/help">
                  <HelpCircle className="mr-2 h-4 w-4" /> Help
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} title="Log out">
                <LogOut className="mr-2 h-4 w-4" /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
      <Separator orientation="vertical" className="h-full" />
    </div>
  );
};

export default Navbar;
