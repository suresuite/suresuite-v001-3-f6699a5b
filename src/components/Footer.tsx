import React from "react";

interface FooterProps {
  isCollapsed?: boolean;
  hasNavBar?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isCollapsed = false, hasNavBar = true }) => (
  <footer className="fixed bottom-0 left-0 right-0 z-50">
    <div
      className={`bg-black text-white border-t border-border px-3 py-2 text-xs text-center transition-all duration-500 ${
        hasNavBar ? (isCollapsed ? "ml-14" : "ml-0 sm:ml-48") : ""
      }`}
    >
      Developed by <span className="font-medium text-foreground">Phu Nguyen</span> &{" "}
      <span className="font-medium text-foreground">Prof. Dmitry Ivanov</span> (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union
    </div>
  </footer>
);

export default Footer;