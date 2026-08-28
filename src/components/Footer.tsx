import React from "react";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface FooterProps {
  isCollapsed?: boolean;
  hasNavBar?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isCollapsed = false, hasNavBar = true }) => {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem("ss.footerCredit") === "dismissed";
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem("ss.footerCredit", "dismissed");
    } catch {
      /* ignore storage failures */
    }
    setDismissed(true);
  };

  return (
    <footer
      className={`fixed left-0 right-0 z-30 md:bottom-0 ${
        dismissed ? "hidden md:block" : ""
      }`}
      style={
        isMobile
          ? { bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }
          : undefined
      }
    >
      <div
        className={`relative text-white pl-3 pr-10 py-2 text-xs text-center transition-all duration-500 md:pr-3
          bg-[linear-gradient(to_right,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.60)_10%,rgba(0,0,0,0.64)_22%,rgba(0,0,0,0.68)_34%,rgba(0,0,0,0.72)_44%,rgba(0,0,0,0.78)_50%,rgba(0,0,0,0.72)_56%,rgba(0,0,0,0.68)_66%,rgba(0,0,0,0.64)_78%,rgba(0,0,0,0.60)_90%,rgba(0,0,0,0.55)_100%)]
          md:bg-[linear-gradient(to_right,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0.50)_10%,rgba(0,0,0,0.56)_22%,rgba(0,0,0,0.61)_34%,rgba(0,0,0,0.66)_44%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.66)_56%,rgba(0,0,0,0.61)_66%,rgba(0,0,0,0.56)_78%,rgba(0,0,0,0.50)_90%,rgba(0,0,0,0.45)_100%)]
          ${hasNavBar ? (isCollapsed ? "ml-0 md:ml-14" : "ml-0 md:ml-48") : ""}`}
        style={{
          WebkitBackdropFilter: "blur(8px)",
          backdropFilter: "blur(8px)",
          textShadow: "0 1px 2px rgba(0,0,0,0.55)",
        }}
      >
        Developed by <span className="font-semibold">Phu Nguyen</span> &{" "}
        <span className="font-semibold">Prof. Dmitry Ivanov</span> (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss credit bar"
          className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-white md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </footer>
  );
};

export default Footer;
