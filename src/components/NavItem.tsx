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
  iconSize?: number; // WIDE type
}

const linkBase =
  "flex items-center rounded-md transition-all duration-200 p-2.5 text-sm font-medium";
const linkActive = "bg-accent text-accent-foreground shadow-sm";
const linkHover = "hover:bg-muted hover:text-foreground";

const NavItem = ({
  to,
  icon: Icon,
  label,
  tooltip,
  isCollapsed,
  iconSize = 16, // default (number, not literal-only type)
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
            {!isCollapsed && <span className="ml-2">{label}</span>}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent
            side="right"
            className="px-2 py-1 text-sm text-white bg-black"
          >
            {tooltip}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

export default NavItem;
