import React from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";

/** Retained for callers that still import it; the bar no longer renders below
 *  `md`, so the mobile reservation it used to describe is zero. */
export const MOBILE_FOOTER_H = 0;

interface FooterProps {
  isCollapsed?: boolean;
  hasNavBar?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isCollapsed = false, hasNavBar = true }) => {
  const isMobile = useIsMobile();

  // The credit bar does not come to mobile (mobile skin spec §4: the chrome
  // budget is status bar, page header, segmented row, action bar, tab bar —
  // and nothing else). It wrapped to three lines at 320-390px and spent a
  // fifth of the screen on every page saying the same sentence.
  //
  // The credit itself is not lost, which is the condition on removing it:
  // About & help carries it in full — the people section names the developer
  // and the supervisor, and the funding strip carries HWR, ACCURATE and the
  // EU acknowledgement with its grant number. Desktop is unchanged.
  //
  // The dismiss control went with it. It was `md:hidden` — a mobile-only
  // affordance for a bar that no longer appears on mobile — so the stored
  // `ss.footerCredit` preference has nothing left to gate and is not read.
  if (isMobile) return null;

  return (
    // `md:bottom-0`, not `bottom-0`: the bar only exists from `md` up, and
    // writing the pin at the breakpoint that owns it says so in the class
    // rather than in a comment. It is also what keeps the adaptive-UI audit's
    // §2.6 rule pointed at real mobile chrome.
    <footer className="fixed left-0 right-0 z-30 md:bottom-0">
      <div
        className={`relative px-3 py-2 text-center text-xs text-white transition-all duration-500
          bg-[linear-gradient(to_right,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0.50)_10%,rgba(0,0,0,0.56)_22%,rgba(0,0,0,0.61)_34%,rgba(0,0,0,0.66)_44%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.66)_56%,rgba(0,0,0,0.61)_66%,rgba(0,0,0,0.56)_78%,rgba(0,0,0,0.50)_90%,rgba(0,0,0,0.45)_100%)]
          ${hasNavBar ? (isCollapsed ? "ml-14" : "ml-48") : ""}`}
        style={{
          WebkitBackdropFilter: "blur(8px)",
          backdropFilter: "blur(8px)",
          textShadow: "0 1px 2px rgba(0,0,0,0.55)",
        }}
      >
        Developed by <span className="font-semibold">Phu Nguyen</span> &{" "}
        <span className="font-semibold">Prof. Dmitry Ivanov</span> (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union
      </div>
    </footer>
  );
};

export default Footer;
