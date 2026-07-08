import { Link, useLocation } from "react-router-dom";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface NavItemConfig {
  to: string;
  icon: LucideIcon;
  label: string;
  tooltip: string;
}

interface NavItemProps extends NavItemConfig {
  isCollapsed: boolean;
  iconSize?: number;
}

const linkBase =
  "relative flex items-center rounded-md transition-all duration-200 p-2 text-xs font-medium gap-2 min-w-0";
const linkActive =
  "bg-muted/80 text-foreground font-medium before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-primary";
const linkHover = "hover:bg-muted/50 hover:text-foreground text-muted-foreground";

const NavItem = ({
  to,
  icon: Icon,
  label,
  tooltip,
  isCollapsed,
  iconSize = 14,
}: NavItemProps) => {
  const location = useLocation();
  const active = location.pathname === to;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            aria-label={label}
            className={cn(
              linkBase,
              isCollapsed && "justify-center",
              active ? linkActive : linkHover
            )}
          >
            <Icon size={iconSize} className="flex-shrink-0" />
            {!isCollapsed && <span className="truncate">{label}</span>}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right" className="px-2 py-1 text-xs">
            {tooltip}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

export default NavItem;
